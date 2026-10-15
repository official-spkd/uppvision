import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailIdentities } from '../server/instagram-posts.mjs';
import { parseUi, gridTiles } from '../server/instagram-core.mjs';
import { InstagramManager, NetworkError, SkipPostError } from '../server/instagram.mjs';

const id = name => `com.instagram.android:id/${name}`;
function grid(posts) {
  return parseUi(`<hierarchy><node resource-id="${id('action_bar_title')}" text="target.one"/><node resource-id="${id('media_set_row_content_identifier')}">${posts.map((p, i) => `<node><node resource-id="${id('image_button')}" clickable="true" content-desc="${p.desc || 'Photo on the same day'}, Row ${p.row || 1}, Column ${i + 1}" bounds="[${i * 100},200][${i * 100 + 100},350]"/>${p.pinned ? '<node text="Pinned"/>' : ''}</node>`).join('')}</node></hierarchy>`);
}
function runner() {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.closeSheets = async () => {};
  manager.openProfileGrid = async () => {};
  manager.swipe = async () => {};
  manager.logs.write = () => {};
  return manager;
}
function inspection(tiles, values, pins = []) {
  return { pins: new Set(pins), visuals: new Map(tiles.map((t, i) => [t.key, values[i]]).filter(([, v]) => v)) };
}
function rawFrame(nodes, variants) {
  const width = 400, height = 500, raw = Buffer.alloc(16 + width * height * 4);
  raw.writeUInt32LE(width, 0); raw.writeUInt32LE(height, 4); raw.writeUInt32LE(1, 8);
  for (const [i, tile] of gridTiles(nodes).entries()) {
    const [l, t, r, b] = tile.node.bounds.match(/\d+/g).map(Number);
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) {
      const at = 16 + (y * width + x) * 4;
      raw[at] = (x - l + variants[i] * 17) % 256;
      raw[at + 1] = (y - t + variants[i] * 31) % 256;
      raw[at + 2] = (x - l + y - t) % 256;
      raw[at + 3] = 255;
    }
  }
  return raw;
}

test('thumbnail identity survives translation and distinguishes same-day images; blank and clipped tiles have no identity', () => {
  const first = grid([{}, {}]), moved = grid([{}, {}, {}]);
  const before = thumbnailIdentities(rawFrame(first, [1, 2]), gridTiles(first));
  const after = thumbnailIdentities(rawFrame(moved, [3, 1, 2]), gridTiles(moved));
  assert.equal(before.get('1:1'), after.get('1:2'));
  assert.equal(before.get('1:2'), after.get('1:3'));
  assert.notEqual(before.get('1:1'), after.get('1:1'));
  const blank = rawFrame(first, [1, 2]); blank.fill(0, 16);
  assert.equal(thumbnailIdentities(blank, gridTiles(first)).size, 0);
  const clipped = gridTiles(first); clipped[0].node.bounds = '[0,200][100,270]';
  assert.equal(thumbnailIdentities(rawFrame(first, [1, 2]), clipped).has('1:1'), false);
});

test('a new same-day upload and a pin with the same alt text cannot take a locked post slot', async () => {
  const manager = runner(), nodes = grid([{ pinned: true }, {}, {}]);
  manager.ui = async () => nodes;
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, ['pin-image', 'new-image', 'locked-image'], ['1:1']);
  const post = await manager.openLockedPost('phone', 'target.one', { key: '1:2', identity: 'Photo on the same day', visual: 'locked-image' });
  assert.equal(post.tile.bounds, '[200,200][300,350]');
});

test('deleted/changed posts, ambiguous identities and newly pinned posts are skipped without position fallback', async () => {
  const manager = runner();
  manager.ui = async () => grid([{}, {}]);
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, ['replacement', 'other']);
  const ref = { key: '1:1', identity: 'Photo on the same day', visual: 'original' };
  await assert.rejects(manager.openLockedPost('phone', 'target.one', ref), SkipPostError);
  await assert.rejects(manager.openLockedPost('phone', 'target.one', { ...ref, visual: null }), SkipPostError);
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, ['original', 'original']);
  await assert.rejects(manager.openLockedPost('phone', 'target.one', ref), SkipPostError);
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, ['original', 'other'], ['1:1']);
  await assert.rejects(manager.openLockedPost('phone', 'target.one', ref), SkipPostError);
});

test('locking reads exactly eight non-pinned posts across screens and records ambiguous images without adding replacements', async () => {
  const manager = runner(); let page = 0;
  const pages = [grid([{ pinned: true }, {}, {}]), grid([{ row: 2 }, { row: 2 }, { row: 2 }]), grid([{ row: 3 }, { row: 3 }, { row: 3 }])];
  manager.ui = async () => pages[page];
  manager.swipe = async () => { page++; };
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, tiles.map(t => t.key === '2:2' || t.key === '2:3' ? 'duplicate' : `image-${t.key}`), page === 0 ? ['1:1'] : []);
  const { posts, pinned } = await manager.lockPosts({ logs: [] }, { serial: 'phone', target: 'target.one', posts: 8 }, {});
  assert.equal(pinned, 1);
  assert.deepEqual(posts.map(p => p.key), ['1:2', '1:3', '2:1', '2:2', '2:3', '3:1', '3:2', '3:3']);
  assert.equal(posts.filter(p => p.ambiguous).length, 2);
  assert.ok(Object.isFrozen(posts));
});

test('unloaded newest thumbnails cannot be silently replaced by older posts', async () => {
  const manager = runner();
  manager.ui = async () => grid([{}, {}]);
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, [null, 'older']);
  await assert.rejects(manager.lockPosts({ logs: [] }, { serial: 'phone', target: 'target.one', posts: 1 }, {}), NetworkError);
});

test('same-position content changes during a screen read cause a fresh lookup before returning coordinates', async () => {
  const manager = runner();
  const old = grid([{ desc: 'old' }]), changed = grid([{ desc: 'new' }, { desc: 'old' }]);
  const screens = [old, changed, changed, changed];
  manager.ui = async () => screens.shift();
  manager.inspectGrid = async (serial, tiles) => inspection(tiles, tiles.map(t => t.desc.startsWith('old') ? 'old-image' : 'new-image'));
  const { tile } = await manager.openLockedPost('phone', 'target.one', { identity: 'old', visual: 'old-image' });
  assert.equal(tile.bounds, '[100,200][200,350]');
});

test('real device clipped portrait bounds are excluded until the entire thumbnail is visible', () => {
  const screen = (top, bottom) => parseUi(`<hierarchy><node scrollable="true" bounds="[0,1082][1080,1776]"><node resource-id="${id('media_set_row_content_identifier')}"><node><node resource-id="${id('image_button')}" clickable="true" content-desc="Reel at row 1, column 1" bounds="[0,${top}][356,${bottom}]"/></node></node></node></hierarchy>`);
  assert.equal(gridTiles(screen(1348, 1776))[0].complete, false, '428px visible is still clipped, despite exceeding the 356px width');
  assert.equal(gridTiles(screen(1082, 1511))[0].complete, false, 'top clipping is equally unsafe');
  assert.equal(gridTiles(screen(1088, 1563))[0].complete, true, 'a full 475px tile has stable sample geometry');
});
