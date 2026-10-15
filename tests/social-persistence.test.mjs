import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import threads from '../server/platforms/threads.mjs';
import { SocialSimulation } from '../server/social-simulation.mjs';

const generate = async ({ count, hindari }) => ({ comments: Array.from({ length: count }, (_, i) => `Contoh balasan ${hindari.length + i + 1}`) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'phonefarm-persistence-'));
  const manager = new SocialSimulation({ platform: threads, statePath: join(directory, 'state.json'), generate, delay: 0, stagger: 0 });
  t.after(async () => {
    manager.stop(); await manager.task?.catch(() => {}); await manager.committing.catch(() => {}); await manager.writing.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  return manager;
}
function plan(manager, both = false) {
  return { mode: 'simulation', startMode: 'serentak', scenario: 'normal', accounts: manager.accounts().slice(0, both ? 2 : 1).map(account => ({ ...account, target: '@demo_target', posts: 1, comments: 1, tone: 'netral' })) };
}

test('a failed comment write rolls back only that account while parallel commits remain durable', async t => {
  const manager = await setup(t), originalSave = manager.save.bind(manager);
  let writes = 0;
  manager.save = async () => { if (++writes === 2) throw new Error('injected disk failure'); return originalSave(); };
  await manager.start(plan(manager, true)); await manager.task;
  assert.equal(manager.job.status, 'completed_with_errors');
  assert.equal(manager.job.simulated, 1);
  assert.equal(manager.job.failed, 1);
  const failed = manager.job.accounts.find(account => account.status === 'failed');
  assert.equal(failed.simulated, 0); assert.equal(failed.liked, 0);
  const durable = JSON.parse(await readFile(manager.statePath, 'utf8'));
  assert.deepEqual(manager.state.ledger, durable.ledger);
  assert.equal(Object.keys(durable.ledger).length, 1);
  assert.equal(Object.values(durable.ledger)[0].count, 1);
  manager.save = originalSave;
  await manager.start(plan(manager, true)); await manager.task;
  assert.equal(manager.job.simulated, 2, 'a new job allocates one new comment to each account');
  assert.equal(Object.keys(manager.state.ledger).length, 2);
});

test('failed configuration and reset writes restore prior state and release the operation lock', async t => {
  const manager = await setup(t), originalSave = manager.save.bind(manager);
  const originalPlan = plan(manager);
  await manager.start(originalPlan); await manager.task;
  const before = structuredClone(manager.state), beforeJobId = manager.job.id;
  manager.save = async () => { throw new Error('injected disk failure'); };
  const changed = plan(manager); changed.accounts[0].target = '@other_target';
  await assert.rejects(manager.savePlan(changed), /injected disk failure/);
  assert.deepEqual(manager.state, before);
  assert.equal(manager.snapshot().busy, false);
  await assert.rejects(manager.reset({ mode: 'simulation' }), /injected disk failure/);
  assert.deepEqual(manager.state, before); assert.equal(manager.job.id, beforeJobId);
  assert.equal(manager.snapshot().busy, false);
  await assert.rejects(manager.start(changed), /injected disk failure/);
  assert.deepEqual(manager.state, before); assert.equal(manager.job.id, beforeJobId);
  manager.save = originalSave;
});

test('pending configuration/reset writes reject overlapping mutations', async t => {
  const manager = await setup(t), originalSave = manager.save.bind(manager);
  for (const operation of ['savePlan', 'reset']) {
    const entered = deferred(), release = deferred();
    manager.save = async () => { entered.resolve(); await release.promise; return originalSave(); };
    const pending = operation === 'savePlan' ? manager.savePlan(plan(manager)) : manager.reset({ mode: 'simulation' });
    await entered.promise;
    try {
      assert.equal(manager.snapshot().busy, true);
      await assert.rejects(manager.start(plan(manager)), /Tunggu atau hentikan/);
      await assert.rejects(manager.savePlan(plan(manager)), /Tunggu atau hentikan/);
      await assert.rejects(manager.reset({ mode: 'simulation' }), /Tunggu atau hentikan/);
    } finally { release.resolve(); await pending; }
    assert.equal(manager.snapshot().busy, false);
  }
});

test('completed run remains locked until final history persistence finishes', async t => {
  const manager = await setup(t), originalSave = manager.save.bind(manager);
  const entered = deferred(), release = deferred();
  manager.save = async () => {
    if (manager.job?.status === 'completed') { entered.resolve(); await release.promise; }
    return originalSave();
  };
  await manager.start(plan(manager));
  await entered.promise;
  try {
    assert.equal(manager.snapshot().job.status, 'completed');
    assert.equal(manager.snapshot().busy, true);
    await assert.rejects(manager.start(plan(manager)), /Tunggu atau hentikan/);
    await assert.rejects(manager.reset({ mode: 'simulation' }), /Tunggu atau hentikan/);
  } finally { release.resolve(); await manager.task; }
  assert.equal(manager.snapshot().busy, false);
});

test('failed preview persistence restores saved configuration and reports the error', async t => {
  const manager = await setup(t);
  await manager.savePlan(plan(manager));
  const before = structuredClone(manager.state.plans);
  manager.save = async () => { throw new Error('injected preview failure'); };
  const changed = plan(manager); changed.accounts[0].target = '@other_target';
  await assert.rejects(manager.preview(changed), /injected preview failure/);
  assert.deepEqual(manager.state.plans, before);
  assert.equal(manager.job.status, 'failed');
  assert.match(manager.job.error, /injected preview failure/);
  assert.equal(manager.snapshot().busy, false);
});

test('Stop during generation reports no uncommitted like and resuming likes exactly once', async t => {
  const manager = await setup(t);
  manager.generate = async request => { manager.stop(); return generate(request); };
  await manager.start(plan(manager)); await manager.task;
  assert.equal(manager.job.status, 'stopped');
  assert.equal(manager.job.accounts[0].liked, 0);
  assert.deepEqual(manager.state.ledger, {});
  manager.generate = generate;
  await manager.start(plan(manager)); await manager.task;
  assert.equal(manager.job.accounts[0].liked, 1);
  await manager.start(plan(manager)); await manager.task;
  assert.equal(manager.job.accounts[0].liked, 0);
  assert.equal(manager.job.simulated, 1);
});

test('preview explains uncertain hold and strips either synthetic caption prefix before generation', async t => {
  const manager = await setup(t), captions = [];
  manager.generate = async request => { captions.push(request.caption); return generate(request); };
  const request = { ...plan(manager), scenario: 'uncertain' };
  await manager.start(request); await manager.task;
  const preview = await manager.preview(request);
  assert.equal(preview.results[0].need, 0);
  assert.ok(manager.job.logs.some(log => /ditahan; perlu 0/.test(log.message)));
  await manager.samples(request.accounts[0], { ...threads.createFixtures('@demo_target')[1], caption: 'Simulasi: contoh judul' }, 1);
  assert.ok(captions.every(caption => !/^(?:\[SIMULASI\]|Simulasi:)/i.test(caption)));
  assert.equal(captions.at(-1), 'contoh judul');
});

test('seven-day retention removes expired current-job logs but retains duplicate-prevention counts', async t => {
  const manager = await setup(t);
  let now = Date.now(); manager.now = () => now;
  await manager.start(plan(manager)); await manager.task;
  const id = manager.job.id, ledger = structuredClone(manager.state.ledger);
  now += 7 * 86400000 - 1;
  assert.equal(manager.snapshot().job.id, id, 'history remains just inside the retention window');
  now++;
  assert.equal(manager.snapshot().job, null);
  assert.deepEqual(manager.snapshot().runs, []);
  assert.throws(() => manager.history(id), /Riwayat simulasi tidak ditemukan/);
  assert.deepEqual(manager.state.ledger, ledger);
  await manager.save();
  const durable = JSON.parse(await readFile(manager.statePath, 'utf8'));
  assert.deepEqual(durable.runs, []);
  assert.deepEqual(durable.ledger, ledger);
});

test('restart marks unfinished account states stopped while preserving completed or failed accounts', async t => {
  const manager = await setup(t);
  for (const status of ['running', 'stopping']) {
    const job = manager.makeJob('run', manager.validate(plan(manager)));
    job.status = status;
    job.accounts = ['running', 'paused', 'waiting', 'stopping', 'done', 'failed'].map((state, i) => ({ username: `demo_${i}`, status: state, simulated: i }));
    await manager.save();
    const reloaded = new SocialSimulation({ platform: threads, statePath: manager.statePath, generate, delay: 0, stagger: 0 });
    await reloaded.load();
    assert.equal(reloaded.job.status, 'stopped');
    assert.deepEqual(reloaded.job.accounts.map(account => account.status), ['stopped', 'stopped', 'stopped', 'stopped', 'done', 'failed']);
    assert.deepEqual(reloaded.job.accounts.map(account => account.simulated), [0, 1, 2, 3, 4, 5]);
    assert.ok(reloaded.job.finishedAt);
    assert.equal(reloaded.snapshot().busy, false);
    assert.ok(reloaded.job.logs.some(log => /layanan ditutup/.test(log.message)));
  }
});
