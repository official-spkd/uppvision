import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager } from '../server/instagram.mjs';

test('normal and locked previews expose full caption and new-job quota without publishing', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  const caption = 'Keterangan awal. '.repeat(25) + 'Bagian akhir yang mengubah konteks berita.';
  const account = { serial: 'phone1', username: 'account.one', target: 'https://www.instagram.com/p/DeZvmI2Bldj/', posts: 1, comments: 3, tone: 'positif' };
  const ref = { kind: 'post', url: account.target, shortcode: 'DeZvmI2Bldj', owner: 'target.one' };
  manager.prepareDevice = async () => {};
  manager.accountSheet = async () => {};
  manager.lockPosts = async () => ({ posts: [ref], pinned: 0 });
  manager.openPost = async () => ({ owner: ref.owner, nodes: [], fingerprint: 'post-fingerprint', caption });
  manager.readScreen = async () => 'Screen context';
  manager.openThread = async (serial, username, owner) => {
    assert.equal(owner, 'target.one');
    return { caption, loaded: true, complete: false, mine: ['one observed comment'], others: [] };
  };
  manager.generate = async request => {
    assert.equal(request.caption, caption, 'drafts use the full caption, including its tail');
    return { suasana: 'berita', tone: 'positif', comments: ['Draft only'] };
  };
  manager.back = async () => {};
  manager.log = () => {};
  manager.likePost = async () => assert.fail('preview must not like');
  manager.sendComment = async () => assert.fail('preview must not publish');
  manager.state.counts['account.one:post-fingerprint'] = { count: 2 };
  const before = JSON.stringify(manager.state);
  for (const locked of [null, ref]) {
    const result = await manager.inspect({ logs: [] }, account, locked);
    assert.equal(result.fullCaption, caption);
    assert.equal(result.caption, locked ? caption : caption.slice(0, 300), 'existing UI summary is preserved');
    assert.equal(result.commentMode, 'new-per-job');
    assert.equal(result.commentsComplete, undefined);
    assert.equal(result.existing, undefined); assert.equal(result.need, 3);
    assert.equal('context' in result, Boolean(locked));
  }
  assert.equal(JSON.stringify(manager.state), before, 'read-only preview leaves counts/history unchanged');
});
