import test from 'node:test';
import assert from 'node:assert/strict';
import { InternetWatch } from '../server/internet.mjs';

function watch({ online = {}, restore = () => true, busy = [], job = false } = {}) {
  const calls = [], lines = [];
  const w = new InternetWatch({
    devices: () => Object.keys(online).map((serial, i) => ({ serial, status: 'device', name: `HP 0${i + 1}` })),
    net: { phoneOnline: async serial => online[serial], restoreInternet: async (serial, options) => { calls.push({ serial, ...options }); const ok = restore(serial); if (ok) online[serial] = true; return { online: ok, relay: false }; } },
    logs: { create: async () => ({ file: 'f' }), write: (file, line) => lines.push(line) },
    isBusy: serial => busy.includes(serial), jobRunning: () => job, settle: 0,
  });
  return { w, calls, lines };
}
test('offline HP are reconnected one by one and logged; online HP are only marked', async () => {
  const { w, calls, lines } = watch({ online: { a: true, b: false, c: false } });
  await w.check();
  assert.deepEqual(calls.map(c => c.serial), ['b', 'c']);
  assert.equal(w.status.get('a').state, 'online'); assert.equal(w.status.get('b').state, 'online');
  assert.ok(lines.some(l => /HP 02 internet terputus/.test(l)) && lines.some(l => /HP 02 terhubung kembali/.test(l)));
  assert.deepEqual(w.summary(), { total: 3, online: 3, offline: 0, restoring: 0 });
});
test('a failed reconnect is marked offline, counts consecutive failures, and asks to check the cable after 3', async () => {
  const { w } = watch({ online: { a: false }, restore: () => false });
  for (let i = 0; i < 3; i++) await w.check();
  assert.equal(w.status.get('a').state, 'offline'); assert.equal(w.status.get('a').failures, 3);
  assert.match(w.status.get('a').message, /kabel USB/);
});
test('HP busy with Instagram are left alone, and the relay is not restarted while a job runs', async () => {
  const { w, calls } = watch({ online: { a: false, b: false }, busy: ['a'], job: true });
  await w.check();
  assert.deepEqual(calls, [{ serial: 'b', relayRestart: false }]);
  await w.check(['a'], { manual: true });
  assert.equal(calls.at(-1).serial, 'b', 'manual recovery must not interrupt a busy HP');
});
test('an HP whose USB connection was rebuilt (new transport id) is checked again right away', async () => {
  let transport = '7';
  const w = new InternetWatch({ devices: () => [{ serial: 'a', status: 'device', name: 'HP 01', transportId: transport }], net: {}, logs: {} });
  const checked = [];
  w.check = async serials => { checked.push(serials); };
  const realTimeout = globalThis.setTimeout; globalThis.setTimeout = fn => fn();
  try {
    w.noticeDevices(); w.noticeDevices();
    transport = '21'; w.status.set('a', { state: 'online' }); w.noticeDevices();
  } finally { globalThis.setTimeout = realTimeout; }
  assert.deepEqual(checked, [['a'], ['a']], 'first sight and after the transport id changed, not on an unchanged scan');
  assert.equal(w.status.get('a').state, 'checking');
});
test('a restarted adb server makes every HP checked again, even with the same transport ids', async () => {
  const w = new InternetWatch({ devices: () => [{ serial: 'a', status: 'device', transportId: '1' }, { serial: 'b', status: 'device', transportId: '2' }], net: {}, logs: {} });
  const checked = [];
  w.check = async serials => { checked.push(serials); };
  const realTimeout = globalThis.setTimeout; globalThis.setTimeout = fn => fn();
  try { w.noticeDevices('100'); w.noticeDevices('100'); w.noticeDevices('200'); } finally { globalThis.setTimeout = realTimeout; }
  assert.deepEqual(checked, [['a', 'b'], ['a', 'b']]);
});
test('after the relay restarts, HP that reconnected by themselves are not restarted again', async () => {
  const online = { a: false, b: false, c: false }, calls = [];
  const w = new InternetWatch({
    devices: () => Object.keys(online).map(serial => ({ serial, status: 'device', name: serial })),
    net: { phoneOnline: async serial => online[serial], restoreInternet: async serial => { calls.push(serial); online.a = online.b = online.c = true; return { online: true, relay: true }; } },
    logs: { create: async () => ({ file: 'f' }), write: () => {} }, settle: 0,
  });
  await w.check();
  assert.deepEqual(calls, ['a'], 'only the first HP needed the relay restart');
  assert.deepEqual(w.summary(), { total: 3, online: 3, offline: 0, restoring: 0 });
});
test('the relay is restarted at most once per check, so HP still reconnecting are not cut again', async () => {
  const online = { a: false, b: false }, calls = [];
  const w = new InternetWatch({
    devices: () => Object.keys(online).map(serial => ({ serial, status: 'device', name: serial })),
    net: { phoneOnline: async serial => online[serial], restoreInternet: async (serial, options) => { calls.push({ serial, ...options }); return { online: false, relay: options.relayRestart }; } },
    logs: { create: async () => ({ file: 'f' }), write: () => {} }, settle: 0,
  });
  await w.check();
  assert.deepEqual(calls, [{ serial: 'a', relayRestart: true }, { serial: 'b', relayRestart: false }]);
});
test('a relay out of connection slots is restarted first, even during a job, and logged', async () => {
  const lines = [], events = [];
  const w = new InternetWatch({
    devices: () => [{ serial: 'a', status: 'device', name: 'HP 01' }],
    net: { relayStrained: async () => events.length === 0, restartRelay: async () => { events.push('restart'); }, phoneOnline: async () => { events.push('check'); return true; }, restoreInternet: async () => ({ online: true }) },
    logs: { create: async () => ({ file: 'f' }), write: (file, line) => lines.push(line) }, jobRunning: () => true, settle: 0,
  });
  await w.check();
  assert.deepEqual(events, ['restart', 'check']);
  assert.ok(lines.some(l => /kehabisan slot koneksi/.test(l)));
  await w.watchRelay();
  assert.deepEqual(events, ['restart', 'check'], 'a healthy relay triggers nothing');
});
test('an HP that keeps failing no longer restarts the relay that every other HP is using', async () => {
  const { w, calls } = watch({ online: { a: true, b: true, c: true, d: false }, restore: () => false });
  for (let i = 0; i < 3; i++) await w.check();
  assert.deepEqual(calls.map(c => c.relayRestart), [true, true, false]);
});
