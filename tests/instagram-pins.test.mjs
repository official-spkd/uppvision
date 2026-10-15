import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visualPinnedKeys, decodeScreen } from '../server/instagram-pins.mjs';
import { parseUi, gridTiles } from '../server/instagram-core.mjs';
import { InstagramManager, NetworkError, SkipPostError } from '../server/instagram.mjs';

const badges = JSON.parse(readFileSync(new URL('./fixtures/instagram-grid-badges.json', import.meta.url)));
const id = name => `com.instagram.android:id/${name}`;
function grid(scale = 1) {
  const bounds = c => [362 * c, 300, 362 * c + 356, 775].map(n => Math.round(n * scale));
  return parseUi(`<hierarchy><node text="target.one" resource-id="${id('action_bar_title')}"/><node resource-id="${id('media_set_row_content_identifier')}">${[0, 1, 2].map(c => {
    const [l, t, r, b] = bounds(c);
    return `<node><node resource-id="${id('image_button')}" clickable="true" content-desc="Reel at row 1, column ${c + 1}" bounds="[${l},${t}][${r},${b}]"/></node>`;
  }).join('')}</node></hierarchy>`);
}
function frame(scale = 1, fill = 20) {
  const width = Math.round(1080 * scale), height = Math.round(1920 * scale);
  const raw = Buffer.alloc(16 + width * height * 4, fill);
  raw.writeUInt32LE(width, 0); raw.writeUInt32LE(height, 4); raw.writeUInt32LE(1, 8); raw.writeUInt32LE(0, 12);
  return raw;
}
function stamp(raw, badge, col, scale = 1) {
  const width = raw.readUInt32LE(0), left = Math.round((362 * col + 356 - 74) * scale), top = Math.round(320 * scale);
  for (let y = 0; y < Math.round(56 * scale); y++) for (let x = 0; x < Math.round(56 * scale); x++) {
    const value = badge[Math.min(55, Math.floor(y / scale))][Math.min(55, Math.floor(x / scale))] === '1' ? 255 : 20;
    const i = 16 + ((top + y) * width + left + x) * 4;
    raw[i] = raw[i + 1] = raw[i + 2] = value;
  }
}

test('real Android badge masks: two drawn pins are skipped, a Reel badge is not, at multiple display scales', () => {
  for (const scale of [1, 2 / 3, 4 / 3]) {
    const raw = frame(scale), tiles = gridTiles(grid(scale));
    stamp(raw, badges.pin, 0, scale); stamp(raw, badges.pin, 1, scale); stamp(raw, badges.reel, 2, scale);
    assert.deepEqual(tiles.map(t => t.pinned), [false, false, false], 'reproduces missing accessibility badges');
    assert.deepEqual([...visualPinnedKeys(raw, tiles)], ['1:1', '1:2'], `scale ${scale}`);
  }
});
test('bright thumbnails alone are not pin badges; malformed or unsupported captures are rejected', () => {
  assert.equal(visualPinnedKeys(frame(1, 255), gridTiles(grid())).size, 0);
  assert.equal(visualPinnedKeys(frame(), gridTiles(grid())).size, 0);
  assert.throws(() => decodeScreen(Buffer.alloc(16)));
  const raw = frame(); raw.writeUInt32LE(4, 8);
  assert.throws(() => decodeScreen(raw));
  assert.throws(() => decodeScreen(raw.subarray(0, 100)));
});
test('text-only and pin resource badges are recognized without treating the entire row as pinned', () => {
  for (const badge of ['text="Pinned"', 'text="Disematkan"', `resource-id="${id('profile_pin_icon')}"`]) {
    const nodes = grid();
    nodes.find(n => n['resource-id'] === id('image_button')).parent.children.push(...parseUi(`<hierarchy><node ${badge}/></hierarchy>`));
    assert.deepEqual(gridTiles(nodes).map(t => t.pinned), [true, false, false]);
  }
});
test('actual grid selection takes the first non-pinned tile rather than either unlabeled pin', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.logs.write = () => {};
  const nodes = grid(), raw = frame(); stamp(raw, badges.pin, 0); stamp(raw, badges.pin, 1); stamp(raw, badges.reel, 2);
  manager.closeSheets = async () => {};
  manager.openProfileGrid = async () => {};
  manager.ui = async () => nodes;
  manager.inspectGrid = async (serial, tiles) => ({ pins: visualPinnedKeys(raw, tiles), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) });
  manager.swipe = async () => assert.fail('The third tile is already visible');
  const entry = { serial: 'phone1', target: 'target.one', posts: 1 };
  const result = await manager.lockPosts({ logs: [] }, entry, { serial: 'phone1' });
  assert.equal(result.pinned, 2, 'both drawn pins are detected before the list is locked');
  assert.deepEqual(result.posts, [{ key: '1:3', identity: 'Reel', visual: 'image-1:3', ambiguous: false }], 'the first non-pinned tile is locked');
  manager.inspectGrid = async () => { throw new NetworkError('Cannot inspect pin'); };
  await assert.rejects(manager.lockPosts({ logs: [] }, entry, { serial: 'phone1' }), NetworkError);
});
test('a late-rendered pin badge is caught by the first-screen resample before the list locks', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.logs.write = () => {};
  const nodes = grid(), raw = frame();
  stamp(raw, badges.pin, 0); stamp(raw, badges.pin, 1);
  // First sample sees nothing (badges not drawn yet); the resample catches both pins.
  const scans = [new Set(), visualPinnedKeys(raw, gridTiles(nodes))];
  manager.closeSheets = async () => {};
  manager.openProfileGrid = async () => {};
  manager.ui = async () => nodes;
  manager.inspectGrid = async (serial, tiles) => ({ pins: scans.length ? scans.shift() : visualPinnedKeys(raw, tiles), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) });
  manager.swipe = async () => assert.fail('no swipe is needed with three visible tiles');
  const result = await manager.lockPosts({ logs: [] }, { serial: 'phone1', target: 'target.one', posts: 1 }, { serial: 'phone1' });
  assert.equal(result.pinned, 2, 'the resample sees both pins the first scan missed');
  assert.deepEqual(result.posts, [{ key: '1:3', identity: 'Reel', visual: 'image-1:3', ambiguous: false }], 'no pinned tile enters the locked list');
});
test('a shifting grid is inspected again before returning tap coordinates', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.logs.write = () => {};
  const nodes = grid(), changed = grid();
  changed.find(n => n['resource-id'] === id('image_button')).bounds = '[0,400][356,875]';
  const reads = [nodes, changed, nodes, nodes]; let captures = 0;
  manager.closeSheets = async () => {};
  manager.openProfileGrid = async () => {};
  manager.ui = async () => reads.shift();
  manager.inspectGrid = async (serial, tiles) => { captures++; return { pins: new Set(['1:1', '1:2']), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) }; };
  await manager.lockPosts({ logs: [] }, { serial: 'phone1', target: 'target.one', posts: 1 }, { serial: 'phone1' });
  assert.equal(captures, 4, 'two samples per screen attempt: the first screen always resamples for late badges');
});
test('a pin label discovered after opening stops the post before any like or comment action', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.closeSheets = async () => {};
  manager.openLockedPost = async () => ({ tile: {} });
  manager.tap = async () => {};
  manager.ui = async () => [{ text: 'Pinned' }];
  manager.expandCaption = async () => assert.fail('Pinned posts must not reach comment preparation');
  await assert.rejects(manager.openPost('phone1', 'account.one', 'target.one', { identity: 'Reel', twin: 1 }), SkipPostError);
});
