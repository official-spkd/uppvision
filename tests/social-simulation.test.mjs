import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import facebook from '../server/platforms/facebook.mjs';
import { SocialSimulation } from '../server/social-simulation.mjs';

const generate = async ({ count, hindari = [] }) => ({
  comments: Array.from({ length: count }, (_, i) => `Komentar contoh unik ${hindari.length + i + 1}`),
  suasana: 'netral',
});

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'phonefarm-social-test-'));
  const manager = new SocialSimulation({ platform: facebook, statePath: join(directory, 'facebook.json'), generate, delay: 0, stagger: 0, ...options });
  t.after(async () => { manager.stop(); await manager.task?.catch(() => {}); await manager.writing.catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await manager.load();
  return { manager, directory };
}

function body(manager, changes = {}) {
  return {
    mode: 'simulation', startMode: 'serentak', scenario: 'normal',
    accounts: [{ ...manager.accounts()[0], target: 'demo.halaman', posts: 2, comments: 4, tone: 'netral' }],
    ...changes,
  };
}

async function run(manager, plan = body(manager)) {
  await manager.start(plan);
  await manager.task;
  return manager.snapshot().job;
}

test('social simulation sends a fresh quota per job and keeps pins, closed comments and likes idempotent', async t => {
  const { manager } = await setup(t);
  const plan = body(manager);
  plan.accounts[0].posts = 4;
  const first = await run(manager, plan);
  assert.equal(first.status, 'completed');
  assert.equal(first.simulated, 12, 'three eligible posts receive four new comments each');
  assert.equal(first.skipped, 1, 'closed comments are skipped');
  const fixtures = facebook.createFixtures(plan.accounts[0].target);
  const ledger = structuredClone(manager.state.ledger);
  assert.equal(Object.keys(ledger).length, 3);
  assert.ok(!Object.keys(ledger).some(key => key.includes(fixtures[0].id)), 'pinned post never receives a ledger entry');
  assert.ok(!Object.keys(ledger).some(key => key.includes(fixtures[3].id)), 'closed post never receives a ledger entry');
  assert.ok(Object.values(ledger).every(entry => entry.texts.length === 4 && new Set(entry.texts).size === entry.texts.length));
  const second = await run(manager, plan);
  assert.equal(second.simulated, 12);
  assert.ok(second.accounts.every(a => a.liked === 0));
  for (const [key, value] of Object.entries(ledger)) assert.equal(manager.state.ledger[key].count, value.count + 4);
  plan.accounts[0].comments = 5;
  assert.equal((await run(manager, plan)).simulated, 15, 'a new job adds five to each eligible post');
  assert.ok(Object.values(manager.state.ledger).every(entry => entry.texts.length === 13 && new Set(entry.texts).size === entry.texts.length));
});

test('social preview leaves both seeded counts and previously simulated sends unchanged', async t => {
  const { manager } = await setup(t);
  const plan = body(manager);
  const fresh = await manager.preview(plan);
  assert.equal(fresh.results[0].existing, undefined);
  assert.equal(fresh.results[0].need, 4);
  assert.equal(fresh.results[0].samples.length, 3);
  assert.deepEqual(manager.state.ledger, {});
  await run(manager, plan);
  const before = structuredClone(manager.state.ledger);
  const full = await manager.preview(plan);
  assert.equal(full.results[0].existing, undefined);
  assert.equal(full.results[0].need, 4);
  assert.deepEqual(manager.state.ledger, before);
  assert.equal(manager.snapshot().job.kind, 'preview');
  assert.equal(manager.snapshot().job.simulated, 0);
});

test('stopping preserves completed sends and an explicit new start allocates a fresh quota', async t => {
  const { manager } = await setup(t);
  let calls = 0;
  manager.generate = async options => {
    if (++calls === 2) manager.stop();
    return generate(options);
  };
  const stopped = await run(manager);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.simulated, 4);
  assert.equal(Object.keys(manager.state.ledger).length, 1);
  const completedPost = structuredClone(Object.values(manager.state.ledger)[0]);
  manager.generate = generate;
  const resumed = await run(manager);
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.simulated, 8);
  assert.equal(Object.values(manager.state.ledger)[0].count, completedPost.count + 4);
  assert.deepEqual(Object.values(manager.state.ledger).map(entry => entry.texts.length), [8, 4]);
});

test('live mode, forged device accounts and duplicate plans are rejected before generation or persistence', async t => {
  let generated = 0;
  const { manager } = await setup(t, { generate: async options => { generated++; return generate(options); } });
  const live = body(manager, { mode: 'live' });
  await assert.rejects(manager.start(live), /Mode perangkat asli/);
  await assert.rejects(manager.preview(live), /Mode perangkat asli/);
  await assert.rejects(manager.savePlan(live), /Mode perangkat asli/);
  await assert.rejects(manager.reset(live), /Mode perangkat asli/);
  for (const patch of [{ serial: 'real-adb-serial' }, { username: 'real.account' }]) {
    const forged = body(manager);
    Object.assign(forged.accounts[0], patch);
    await assert.rejects(manager.start(forged), /Akun simulasi tidak valid/);
  }
  const duplicate = body(manager);
  duplicate.accounts.push({ ...duplicate.accounts[0] });
  await assert.rejects(manager.start(duplicate), /dipilih dua kali/);
  assert.equal(generated, 0);
  assert.deepEqual(manager.state.ledger, {});
  assert.deepEqual(manager.state.runs, []);
  assert.equal(manager.snapshot().busy, false);
});

test('simulation persists its ledger and isolates target, account and platform histories', async t => {
  const { manager, directory } = await setup(t);
  const plan = body(manager);
  await run(manager, plan);
  const firstLedger = structuredClone(manager.state.ledger);
  const reloaded = new SocialSimulation({ platform: facebook, statePath: manager.statePath, generate, delay: 0, stagger: 0 });
  await reloaded.load();
  assert.deepEqual(reloaded.state.ledger, firstLedger);
  assert.equal((await run(reloaded, plan)).simulated, 8);
  const anotherTarget = body(reloaded);
  anotherTarget.accounts[0].target = 'demo.lain';
  assert.equal((await run(reloaded, anotherTarget)).simulated, 8);
  const anotherAccount = body(reloaded);
  Object.assign(anotherAccount.accounts[0], reloaded.accounts()[1]);
  assert.equal((await run(reloaded, anotherAccount)).simulated, 8);
  assert.equal(Object.keys(reloaded.state.ledger).length, 6);
  for (const [key, entry] of Object.entries(firstLedger)) assert.equal(reloaded.state.ledger[key].count, entry.count + 4);
  const alternatePlatform = { ...facebook, id: 'other-platform' };
  const wrongFile = new SocialSimulation({ platform: alternatePlatform, statePath: manager.statePath, generate, delay: 0, stagger: 0 });
  await assert.rejects(wrongFile.load(), /Format data simulasi tidak valid/);
  const isolated = new SocialSimulation({ platform: alternatePlatform, statePath: join(directory, 'other.json'), generate, delay: 0, stagger: 0 });
  await isolated.load();
  assert.deepEqual(isolated.state.ledger, {});
  assert.deepEqual(isolated.state.runs, []);
  assert.equal((await run(isolated)).simulated, 8);
  await isolated.reset({ mode: 'simulation' });
  const verifyOriginal = new SocialSimulation({ platform: facebook, statePath: manager.statePath, generate });
  await verifyOriginal.load();
  assert.equal(Object.keys(verifyOriginal.state.ledger).length, 6, 'resetting another platform does not erase Facebook');
});

test('network interruption scenario recovers without retry duplicates', async t => {
  const { manager } = await setup(t);
  const plan = body(manager, { scenario: 'network' });
  const first = await run(manager, plan);
  assert.equal(first.status, 'completed');
  assert.equal(first.simulated, 8);
  assert.ok(first.logs.some(log => /internet putus/.test(log.message)));
  assert.ok(first.logs.some(log => /internet pulih/.test(log.message)));
  const ledger = structuredClone(manager.state.ledger);
  assert.equal((await run(manager, plan)).simulated, 8);
  for (const [key, value] of Object.entries(ledger)) assert.equal(manager.state.ledger[key].count, value.count + 4);
});

test('uncertain sends stay uncounted and blocked across preview, normal rerun and reload', async t => {
  const { manager } = await setup(t);
  const plan = body(manager, { scenario: 'uncertain' });
  const first = await run(manager, plan);
  assert.equal(first.simulated, 4, 'only the second post receives confirmed simulated sends');
  const uncertain = Object.entries(manager.state.ledger).find(([, entry]) => entry.uncertain);
  assert.ok(uncertain);
  assert.equal(uncertain[1].count, 1, 'uncertain result never increments the seeded count');
  assert.deepEqual(uncertain[1].texts, []);
  const preview = await manager.preview(plan);
  assert.equal(preview.results[0].uncertain, true);
  assert.equal(preview.results[0].need, 0);
  const before = structuredClone(manager.state.ledger);
  assert.equal((await run(manager, body(manager))).simulated, 4);
  assert.deepEqual(manager.state.ledger[uncertain[0]], before[uncertain[0]]);
  const reloaded = new SocialSimulation({ platform: facebook, statePath: manager.statePath, generate, delay: 0, stagger: 0 });
  await reloaded.load();
  assert.equal((await run(reloaded, body(reloaded))).simulated, 4);
  assert.deepEqual(reloaded.state.ledger[uncertain[0]], before[uncertain[0]]);
});
