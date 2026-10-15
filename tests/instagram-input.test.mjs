import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, composerAccount, sendButton } from '../server/instagram-core.mjs';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
const pkg = 'com.instagram.android';
const field = ({ text = 'What do you think of this?', focused = 'false', qualified = false } = {}) => ({
  'resource-id': `${qualified ? pkg + ':id/' : ''}layout_comment_thread_edittext`, package: pkg,
  class: 'android.widget.ScrollView', text, focused, enabled: 'true', bounds: '[210,1638][846,1776]',
});
// Structure observed on Samsung 10 and 12: bare ID, ScrollView, nested hint, sibling Post icon.
const layout = (text = '', hint = 'What do you think of this?', post = false, focused = false) => parseUi(`<hierarchy><node package="${pkg}" bounds="[168,1638][1038,1776]">
  <node resource-id="layout_comment_thread_edittext" package="${pkg}" class="android.widget.ScrollView" text="${text}" enabled="true" focused="${focused}" bounds="[210,1638][846,1776]">${text ? '' : `<node resource-id="ig_text" package="${pkg}" text="${hint}"/>`}</node>
  ${post ? `<node package="${pkg}" clickable="true" enabled="true" bounds="[885,1638][1029,1776]"><node package="${pkg}" content-desc="Post" bounds="[921,1674][993,1746]"/></node>` : ''}
</node><node package="com.genfarmer.uiautomator" content-desc="Send" clickable="true" enabled="true" bounds="[550,1650][810,1776]"/></hierarchy>`);
const manager = () => {
  const m = new InstagramManager({ statePath: '/unused', devices: () => [] });
  m.inputPause = async () => {}; m.imeShown = async () => false;
  m.verifiedAccounts.set('phone', { username: 'account.one', at: Date.now() });
  return m;
};
test('Samsung layouts expose nested hints, drafts and the scoped Instagram Post button', () => {
  for (const hint of ['Start the conversation…', 'What do you think of this?', 'Add a comment for target.one…']) {
    const nodes = layout('', hint), c = composerAccount(nodes);
    assert.equal(c.field.text, hint); assert.equal(manager().composerMatches('phone', 'account.one', 'target.one', c), true);
    assert.equal(sendButton(nodes), undefined, 'keyboard Send must not be selected');
  }
  const nodes = layout('Draft uji', '', true, true);
  assert.equal(composerAccount(nodes).field.text, 'Draft uji');
  assert.equal(composerAccount(nodes).genericPlaceholder, false);
  assert.equal(sendButton(nodes).bounds, '[885,1638][1029,1776]');
  assert.equal(manager().composerMatches('phone', 'account.one', 'target.one', composerAccount(nodes)), false);
});
test('bare IDs require Instagram package; existing full IDs remain supported', () => {
  assert.equal(composerAccount([{ ...field(), package: 'other.app' }]).field, undefined);
  assert.equal(composerAccount([field({ qualified: true })]).field.focused, 'false');
  assert.equal(sendButton([{ 'resource-id': 'comment_composer_send_button', package: 'other.app', enabled: 'true' }]), undefined);
});
test('unknown nested draft is never treated as empty even with no Send button', () => {
  const c = composerAccount(layout('', 'Draft lama pengguna'));
  assert.equal(c.field.text, 'Draft lama pengguna'); assert.equal(c.genericPlaceholder, false);
  assert.equal(manager().composerMatches('phone', 'account.one', 'target.one', c), false);
});
test('Post outside the composer row, across packages, or ambiguous is rejected', () => {
  const nodes = layout('Draft', '', true, true), post = sendButton(nodes), row = post.parent;
  post.package = 'other.app'; assert.equal(sendButton(nodes), undefined);
  post.package = pkg; row.children.push({ ...post }); assert.equal(sendButton(nodes), undefined);
  row.children = row.children.filter(n => n === nodes.find(n => n['resource-id'] === 'layout_comment_thread_edittext'));
  assert.equal(sendButton(nodes), undefined, 'an unrelated Post still exists in the flat nodes but not the composer row');
});
test('focus is checked after tapping and retried before any typing', async () => {
  const m = manager(); let taps = 0;
  m.tap = async () => { taps++; }; m.ui = async () => [field({ focused: taps >= 2 ? 'true' : 'false' })];
  assert.equal((await m.focusCommentInput('phone', 'account.one', 'target.one')).field.focused, 'true');
  assert.equal(taps, 2);
  taps = 0; m.ui = async () => [field()];
  await assert.rejects(m.focusCommentInput('phone', 'account.one', 'target.one'), NetworkError); assert.equal(taps, 3);
});
test('wrong account, draft or lost composer during focus prevents typing', async () => {
  for (const text of ['Comment as wrong.account…', 'Draft lama']) {
    const m = manager(); let taps = 0; m.tap = async () => { taps++; };
    m.ui = async () => [field({ text })];
    await assert.rejects(m.focusCommentInput('phone', 'account.one', 'target.one'), /akun|draft/i); assert.equal(taps, 0);
  }
  const m = manager(); let reads = 0; m.tap = async () => {};
  m.ui = async () => ++reads === 1 ? [field()] : [];
  await assert.rejects(m.focusCommentInput('phone', 'account.one', 'target.one'), /tidak ditemukan/);
});
test('GenFarmer covering the composer is hidden and the fresh Post position is used', async () => {
  const m = manager(); let back = 0;
  m.back = async () => { back++; }; m.imeShown = async () => back === 0;
  m.ui = async () => { const nodes = layout('Draft uji', '', true, true); if (back) sendButton(nodes).bounds = '[885,1438][1029,1576]'; return nodes; };
  // Use a stable row with changed coordinates for both field and button after hiding.
  m.ui = async () => {
    const nodes = layout('Draft uji', '', true, true);
    if (back) for (const n of nodes) if (n.package === pkg && n.bounds) n.bounds = n.bounds.replaceAll('1638','1438').replaceAll('1776','1576').replaceAll('1674','1474').replaceAll('1746','1546');
    return nodes;
  };
  assert.equal((await m.prepareCommentSend('phone', 'Draft uji')).bounds, '[885,1438][1029,1576]'); assert.equal(back, 1);
});
test('hidden keyboard never triggers Back; stuck keyboard and changed text cannot send', async () => {
  const m = manager(); m.ui = async () => layout('Draft uji', '', true, true); m.back = async () => assert.fail('already hidden');
  assert.ok(await m.prepareCommentSend('phone', 'Draft uji'));
  m.imeShown = async () => true; m.back = async () => {};
  await assert.rejects(m.prepareCommentSend('phone', 'Draft uji'), /Keyboard masih/);
  m.imeShown = async () => false; m.ui = async () => layout('Teks berbeda', '', true, true);
  await assert.rejects(m.prepareCommentSend('phone', 'Draft uji'), /tidak cocok/);
});
test('delayed input is observed without typing again; missing input stops at a bounded limit', async () => {
  const m = manager(); let reads = 0;
  m.ui = async () => ++reads < 3 ? layout() : layout('Draft uji', '', true, true);
  assert.ok(await m.readCommentInput('phone', 'Draft uji')); assert.equal(reads, 3);
  reads = 0; m.ui = async () => { reads++; return layout(); };
  await assert.rejects(m.readCommentInput('phone', 'Draft uji'), /belum masuk/); assert.equal(reads, 4);
});
