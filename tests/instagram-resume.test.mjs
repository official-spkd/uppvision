import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager } from '../server/instagram.mjs';
const account = { serial: 'phone1', username: 'account.one', target: 'target.one', posts: 2, comments: 2, tone: 'positif' };
const refs = [{ key: '1:3', identity: 'First', visual: 'aaa', ambiguous: false }, { key: '2:1', identity: 'Second', visual: 'bbb', ambiguous: false }];
function fixture(logPrefix = '') {
  const manager = new InstagramManager({ statePath: '/unused', logPrefix, devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.state.devices = [{ serial: 'phone1', accounts: [{ username: 'account.one' }] }];
  manager.state.resumableJob = { id: 'saved-job', commentMode: 'new-per-job', commentRunId: 'original-job', accounts: [{ ...account, lockedPosts: structuredClone(refs) }] };
  manager.rememberPlans = async () => {}; manager.run = async () => {}; manager.save = async () => {};
  return manager;
}
test('resume copies only server-owned references and freezes the original list', () => {
  const manager = fixture();
  manager.start({ resumeJobId: 'saved-job', accounts: [{ ...account, lockedPosts: [{ identity: 'client injection' }] }] });
  assert.equal(manager.job.resumedFrom, 'saved-job');
  assert.equal(manager.job.commentRunId, 'original-job');
  assert.deepEqual(manager.job.accounts[0].lockedPosts, refs);
  assert.ok(Object.isFrozen(manager.job.accounts[0].lockedPosts));
  assert.ok(manager.job.accounts[0].lockedPosts.every(Object.isFrozen));
});
test('resume rejects changed settings, a missing snapshot, busy execution, and TikTok', () => {
  for (const change of [{ target: 'another.one' }, { posts: 3 }, { comments: 3 }, { tone: 'netral' }]) {
    assert.throws(() => fixture().start({ resumeJobId: 'saved-job', accounts: [{ ...account, ...change }] }), /harus sama/);
  }
  assert.throws(() => fixture().start({ resumeJobId: 'unknown', accounts: [account] }), /tidak tersedia/);
  assert.throws(() => fixture('tt').start({ resumeJobId: 'saved-job', accounts: [account] }), /tidak tersedia/);
  const busy = fixture(); busy.locks.add('phone1');
  assert.throws(() => busy.start({ resumeJobId: 'saved-job', accounts: [account] }), /berjalan/);
});
test('ordinary starts ignore caller references and persist only script-collected lists', async () => {
  const manager = fixture();
  manager.start({ accounts: [{ ...account, lockedPosts: refs }] });
  assert.equal(manager.job.accounts[0].lockedPosts, undefined);
  manager.job.accounts[0].lockedPosts = structuredClone(refs);
  await manager.rememberLockedJob(manager.job);
  assert.deepEqual(manager.state.resumableJob.accounts[0].lockedPosts, refs);
  assert.equal(manager.state.resumableJob.id, manager.job.id);
});
test('read-only resume preview inspects only frozen stored references without running a job', async () => {
  const manager = fixture(), inspected = [];
  manager.openLog = async () => {}; manager.logs.write = () => {};
  manager.ensurePhoneInternet = async () => true;
  manager.inspect = async (job, account, ref) => { assert.ok(Object.isFrozen(ref)); inspected.push(ref); return { ok: true, caption: 'Full caption', samples: ['Draft'] }; };
  manager.likePost = manager.sendComment = manager.run = async () => { throw Error('Preview cannot like, send or run'); };
  const response = await manager.preview({ resumeJobId: 'saved-job', accounts: [account] });
  assert.deepEqual(inspected, refs); assert.equal(response.results.length, 2);
  assert.equal(manager.previewPending, false); assert.equal(manager.locks.size, 0);
  assert.equal(manager.job, null);
  await assert.rejects(manager.preview({ resumeJobId: 'saved-job', accounts: [{ ...account, comments: 4 }] }), /harus sama/);
});

test('a pre-change total-target job cannot silently resume as a new quota', () => {
  const manager = fixture(); delete manager.state.resumableJob.commentMode;
  assert.throws(() => manager.start({ resumeJobId: 'saved-job', accounts: [account] }), /target total/);
  manager.start({ accounts: [account] });
  assert.equal(manager.job.commentRunId, manager.job.id);
});
