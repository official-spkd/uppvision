import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
import { parseUi } from '../server/instagram-core.mjs';

const id = name => `com.instagram.android:id/${name}`;
// Expanding profile headers can move the same visible rows over several swipes.
function screen(y, next = false) {
  const tile = (row, top, col) => `<node resource-id="${id('media_set_row_content_identifier')}"><node><node resource-id="${id('image_button')}" clickable="true" content-desc="Post ${row}, Row ${row}, Column ${col}" bounds="[${(col-1)*362},${top}][${(col-1)*362+356},${top + 475}]"/></node></node>`;
  return parseUi(`<hierarchy><node><node resource-id="${id('action_bar_title')}" text="target.one"/><node scrollable="true" bounds="[0,250][1080,1776]">${[1,2,3].map(c=>tile(1,y,c)).join('')}${next ? [1,2,3].map(c=>tile(2,y+481,c)).join('') : ''}</node></node></hierarchy>`);
}
function fixture() {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.closeSheets = async () => {}; manager.openProfileGrid = async () => {};
  manager.logs.write = () => {}; manager.logs.create = async () => null;
  const screens = [screen(1200), screen(850), screen(300, true)];
  let index = 0;
  manager.ui = async () => screens[index];
  manager.swipe = async () => { index = Math.min(index + 1, screens.length - 1); };
  manager.inspectGrid = async (serial, tiles) => ({ pins: new Set(['1:1', '1:2', '2:1', '2:2']), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) });
  return manager;
}
test('profile selection continues when the same row keys move within the viewport', async () => {
  const manager = fixture();
  const { posts } = await manager.lockPosts({ logs: [] }, { serial: 'phone1', target: 'target.one', posts: 2 }, {});
  assert.deepEqual(posts.map(p => p.key), ['1:3', '2:3']);
});
test('reopening a locked target continues past moving rows with unchanged keys', async () => {
  const manager = fixture();
  const { tile } = await manager.openLockedPost('phone1', 'target.one', { identity: 'Post 2', visual: 'image-2:3' });
  assert.equal(tile['content-desc'], 'Post 2, Row 2, Column 3');
});

test('selection refuses to fill a skipped grid row with older posts', async () => {
  const manager = fixture();
  let index = 0;
  const first = screen(300);
  const later = parseUi(`<hierarchy><node><node resource-id="${id('action_bar_title')}" text="target.one"/><node scrollable="true" bounds="[0,250][1080,1776]"><node resource-id="${id('media_set_row_content_identifier')}"><node><node resource-id="${id('image_button')}" clickable="true" content-desc="Older post, Row 3, Column 1" bounds="[0,300][356,775]"/></node></node></node></node></hierarchy>`);
  manager.ui = async () => index ? later : first;
  manager.swipe = async () => { index++; };
  manager.inspectGrid = async (serial, tiles) => ({ pins: new Set(['1:1', '1:2']), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) });
  await assert.rejects(manager.lockPosts({ logs: [] }, { serial: 'phone1', target: 'target.one', posts: 2 }, {}), error => error instanceof NetworkError && /grid terbaru yang terlewat/.test(error.message));
});
