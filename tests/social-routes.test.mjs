import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSocialRoutes } from '../server/social-routes.mjs';

const targets = { x: '@demo_target', threads: '@demo.target', facebook: 'demo.halaman', youtube: '@demo_channel' };
const generate = async ({ count, hindari = [] }) => ({ comments: Array.from({ length: count }, (_, i) => `Contoh balasan API ${hindari.length + i + 1}`), suasana: 'netral' });

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'phonefarm-routes-test-'));
  const app = express();
  app.use(express.json());
  const managers = await registerSocialRoutes(app, directory, { generate, delay: 0, stagger: 0, ...options });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  t.after(async () => {
    managers.forEach(manager => manager.stop());
    await Promise.all(managers.map(async manager => { await manager.task?.catch(() => {}); await manager.writing.catch(() => {}); }));
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    managers: Object.fromEntries(managers.map(manager => [manager.platform.id, manager])),
    request: async (platform, suffix = '', method = 'GET', body) => {
      const response = await fetch(`${origin}/api/social/${platform}${suffix}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    },
  };
}

function planFor(platform, snapshot) {
  return { mode: 'simulation', startMode: 'serentak', scenario: 'normal', accounts: [{ username: snapshot.accounts[0].username, serial: snapshot.accounts[0].serial, target: targets[platform], posts: 2, comments: 4, tone: 'netral' }] };
}

test('all four social APIs expose demo state and support plan, preview, run and history', async t => {
  const { request, managers } = await setup(t);
  for (const platform of Object.keys(targets)) {
    const state = await request(platform);
    assert.equal(state.status, 200, platform);
    assert.equal(state.data.platform.id, platform);
    assert.equal(state.data.mode, 'simulation');
    assert.equal(state.data.liveSupported, false);
    assert.equal(state.data.accounts.length, 2);
    assert.ok(state.data.accounts.every(account => account.serial.startsWith(`sim-${platform}-`)));
    assert.deepEqual(state.data.runs, []);
    const plan = planFor(platform, state.data);
    const saved = await request(platform, '/plan', 'PUT', plan);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.plans[0].username, plan.accounts[0].username);
    assert.equal(saved.data.plans[0].target, managers[platform].platform.normalizeTarget(targets[platform]));
    const preview = await request(platform, '/preview', 'POST', plan);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.mode, 'simulation');
    assert.equal(preview.data.results.length, 1);
    assert.equal(preview.data.results[0].samples.length, 3);
    const started = await request(platform, '/start', 'POST', plan);
    assert.equal(started.status, 200);
    assert.equal(started.data.job.kind, 'run');
    assert.equal(started.data.job.mode, 'simulation');
    await managers[platform].task;
    const completed = await request(platform);
    assert.equal(completed.data.job.status, 'completed');
    assert.ok(completed.data.job.simulated > 0);
    assert.equal(completed.data.busy, false);
    const history = await request(platform, `/history/${started.data.job.id}`);
    assert.equal(history.status, 200);
    assert.equal(history.data.id, started.data.job.id);
    assert.equal(history.data.simulated, completed.data.job.simulated);
    assert.ok(history.data.logs.length > 0);
    const second = await request(platform, '/start', 'POST', plan);
    assert.equal(second.status, 200);
    await managers[platform].task;
    assert.equal((await request(platform)).data.job.simulated, 8, `${platform}: new HTTP start adds a fresh quota`);
    const idleStop = await request(platform, '/stop', 'POST');
    assert.equal(idleStop.status, 200);
    assert.equal(idleStop.data.job.status, 'completed');
  }
});

test('HTTP stop cancels pending generation and the next run can resume', async t => {
  let release;
  let entered;
  const held = new Promise(resolve => { release = resolve; });
  const generationStarted = new Promise(resolve => { entered = resolve; });
  let pauseOnce = true;
  const { request, managers } = await setup(t, { generate: async options => { if (pauseOnce) { pauseOnce = false; entered(); await held; } return generate(options); } });
  const state = await request('facebook');
  const plan = planFor('facebook', state.data);
  try {
    assert.equal((await request('facebook', '/start', 'POST', plan)).status, 200);
    await generationStarted;
    const duplicate = await request('facebook', '/start', 'POST', plan);
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.data.error, /hentikan simulasi/);
    const stopped = await request('facebook', '/stop', 'POST');
    assert.equal(stopped.status, 200);
    assert.equal(stopped.data.job.status, 'stopping');
  } finally { release(); }
  await managers.facebook.task;
  const stoppedState = await request('facebook');
  assert.equal(stoppedState.data.job.status, 'stopped');
  assert.equal(stoppedState.data.job.simulated, 0);
  assert.equal((await request('facebook', '/start', 'POST', plan)).status, 200);
  await managers.facebook.task;
  const resumed = await request('facebook');
  assert.equal(resumed.data.job.status, 'completed');
  assert.equal(resumed.data.job.simulated, 8);
});

test('API validation rejects live mode and malformed targets before comment generation', async t => {
  let calls = 0;
  const { request } = await setup(t, { generate: async options => { calls++; return generate(options); } });
  for (const platform of Object.keys(targets)) {
    const initial = await request(platform);
    const plan = planFor(platform, initial.data);
    for (const [suffix, method] of [['/plan', 'PUT'], ['/preview', 'POST'], ['/start', 'POST'], ['/reset', 'POST']]) {
      const live = await request(platform, suffix, method, { ...plan, mode: 'live' });
      assert.equal(live.status, 400, `${platform}${suffix}`);
      assert.match(live.data.error, /Mode perangkat asli/);
    }
    const invalid = structuredClone(plan);
    invalid.accounts[0].target = 'https://example.invalid/not-a-platform';
    for (const [suffix, method] of [['/plan', 'PUT'], ['/preview', 'POST'], ['/start', 'POST']]) {
      const response = await request(platform, suffix, method, invalid);
      assert.equal(response.status, 400);
      assert.equal(typeof response.data.error, 'string');
      assert.ok(response.data.error.length > 0);
    }
    const forged = structuredClone(plan);
    forged.accounts[0].serial = 'physical-device';
    assert.equal((await request(platform, '/start', 'POST', forged)).status, 400);
    const after = await request(platform);
    assert.deepEqual(after.data.plans, []);
    assert.deepEqual(after.data.runs, []);
    assert.equal(after.data.busy, false);
  }
  assert.equal(calls, 0);
});

test('platform reset and history endpoints keep platform data isolated', async t => {
  const { request, managers } = await setup(t);
  const snapshots = {};
  const plans = {};
  for (const platform of Object.keys(targets)) {
    plans[platform] = planFor(platform, (await request(platform)).data);
    assert.equal((await request(platform, '/start', 'POST', plans[platform])).status, 200);
    await managers[platform].task;
    snapshots[platform] = (await request(platform)).data;
  }
  const foreignHistory = await request('youtube', `/history/${snapshots.facebook.job.id}`);
  assert.equal(foreignHistory.status, 400);
  assert.match(foreignHistory.data.error, /tidak ditemukan/);
  const reset = await request('facebook', '/reset', 'POST', { mode: 'simulation' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.job, null);
  assert.deepEqual(reset.data.runs, []);
  assert.equal((await request('facebook', `/history/${snapshots.facebook.job.id}`)).status, 400);
  for (const platform of ['x', 'threads', 'youtube']) {
    const state = await request(platform);
    assert.deepEqual(state.data, snapshots[platform], `${platform} state survives Facebook reset`);
    assert.equal((await request(platform, '/start', 'POST', plans[platform])).status, 200);
    await managers[platform].task;
    assert.equal((await request(platform)).data.job.simulated, 8, `${platform} keeps history but adds a fresh quota`);
  }
  assert.equal((await request('facebook', '/start', 'POST', plans.facebook)).status, 200);
  await managers.facebook.task;
  assert.equal((await request('facebook')).data.job.simulated, snapshots.facebook.job.simulated, 'Facebook reset clears its own simulation counts');
});
