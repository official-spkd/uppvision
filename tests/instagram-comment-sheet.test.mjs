import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
import { offlineNotice } from '../server/instagram-core.mjs';
const id = name => `com.instagram.android:id/${name}`;
const composer = { 'resource-id': id('layout_comment_thread_edittext_multiline'), text: 'Comment as account.one…' };
const entry = { serial: 'phone1', username: 'account.one', target: 'target.one', comments: 2 };
const fixture = () => new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
test('composer opens without scrolling or reading a populated comment list', async () => {
  const manager = fixture();
  manager.ui = async () => [composer, { 'resource-id': id('sticky_header_list') }, { 'content-desc': 'account.one said Old comment' }];
  manager.tap = async () => {};
  manager.swipe = manager.closeSheets = async () => assert.fail('no list scanning or reopening');
  assert.deepEqual(await manager.openThread('phone1', 'account.one', 'target.one', [{ 'resource-id': id('row_feed_button_comment') }], 'Caption'), { caption: 'Caption' });
});
test('a missing composer or explicit offline banner retries without typing or reserving a comment', async () => {
  for (const nodes of [[], [{ text: "You're offline. Your likes will be updated when you're connected." }], [composer, { text: 'You’re offline' }]]) {
    const manager = fixture(); manager.ui = async () => nodes;
    manager.tap = async () => { throw Error('Must not tap'); };
    await assert.rejects(manager.sendComment({ logs: [] }, entry, 'k', 'Hello'), NetworkError);
    assert.equal(manager.state.history.length, 0); assert.equal(manager.countFor('k'), 0);
  }
  assert.equal(offlineNotice([{ text: "You're offline. Your likes will be updated when you're connected." }]), true);
});
test('a genuine mismatched account or unknown draft remains a hard stop', async () => {
  for (const nodes of [[{ ...composer, text: 'Comment as wrong.account…' }], [{ ...composer, text: 'Unrecognized draft' }, { 'resource-id': id('layout_comment_thread_post_button_icon'), enabled: 'true' }]]) {
    const manager = fixture(); manager.ui = async () => nodes;
    await assert.rejects(manager.sendComment({ logs: [] }, entry, 'k', 'Hello'), error => !(error instanceof NetworkError) && /tidak cocok|draft/.test(error.message));
    assert.equal(manager.state.history.length, 0);
  }
});
test('a red heart with an offline banner is not verified as a successful like', async () => {
  const manager = fixture();
  await assert.rejects(manager.likePost('phone1', [{ text: "You're offline" }]), NetworkError);
});
test('opening a composer rejects offline, wrong account and draft without scanning', async () => {
  for (const nodes of [[composer, { text: "You're offline" }], [{ ...composer, text: 'Comment as wrong.account…' }], [{ ...composer, text: 'Unknown draft' }]]) {
    const manager = fixture(); manager.ui = async () => nodes; manager.tap = async () => {};
    manager.swipe = async () => assert.fail('no scan');
    await assert.rejects(manager.openThread('phone1', 'account.one', 'target.one', [{ 'resource-id': id('row_feed_button_comment') }]), /offline|tidak cocok|draft/);
    assert.equal(manager.state.history.length, 0);
  }
});
test('an empty or loading list does not delay a ready, verified composer', async () => {
  const manager = fixture(); let reads = 0;
  manager.ui = async () => { reads++; return [composer]; }; manager.tap = async () => {};
  manager.swipe = async () => assert.fail('no scan');
  await manager.openThread('phone1', 'account.one', 'target.one', [{ 'resource-id': id('row_feed_button_comment') }], 'Full caption');
  assert.equal(reads, 1);
});
