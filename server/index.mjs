import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, listDevices, getDetails, input, usbOverview, adbEnv, adbServerId } from './adb.mjs';
import { StreamManager } from './streams.mjs';
import { boxStatus } from './box.mjs';
import { InstagramManager } from './instagram.mjs';
import { InstagramLogin } from './instagram-login.mjs';
import { TikTokManager } from './tiktok.mjs';
import { InternetWatch } from './internet.mjs';
import { phoneOnline, restoreInternet, restartRelay, relayStrained, wifiName, configureNetwork } from './network.mjs';
import { NetworkPolicy, validateConnection } from './network-policy.mjs';
import { connectionInfo, wifiNetworks } from './wifi.mjs';
import { registerSocialRoutes } from './social-routes.mjs';
import { getDisplay, rotateDisplay } from './display.mjs';
import { JSON_BODY_LIMIT } from './body-limit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');
const port = Number(process.env.PORT || (offline ? 5180 : 5179));
const production = process.argv.includes('--production');
const app = express(), server = createServer(app), streams = new StreamManager();
const token = randomBytes(32).toString('hex');
const cookieName = port === 5179 ? 'phonefarm' : `phonefarm-${port}`;
const statePath = join(root, '.phonefarm', 'settings.json');
let settings = { expectedCount: 19, aliases: {}, knownDevices: [] };
try { settings = { ...settings, ...JSON.parse(await readFile(statePath, 'utf8')) }; } catch {}
const inventory = new Map(settings.knownDevices.map(d => [d.serial, d]));
let devices = offline ? [] : [...inventory.values()].map(d => ({ ...d, name: settings.aliases[d.serial] || `HP ${String(d.index).padStart(2, '0')}`, status: 'offline', present: false })), detectedCount = 0, lastUpdated = null, scanError = null, scanning = null;
const details = new Map(), subscribers = new Set();
// One HP never runs Instagram and TikTok at the same time: both managers share their device locks.
const deviceLocks = new Set();
const networkPolicy = new NetworkPolicy(join(root, '.phonefarm', 'network.json'));
if (!offline) await networkPolicy.load();
configureNetwork(serial => networkPolicy.get(serial));
const instagram = new InstagramManager({ statePath: join(root, '.phonefarm', 'instagram.json'), devices: () => devices.filter(d => !d.serial.startsWith('emulator-')), locks: deviceLocks });
instagram.login = new InstagramLogin(instagram);
const tiktok = new TikTokManager({ statePath: join(root, '.phonefarm', 'tiktok.json'), devices: () => devices.filter(d => !d.serial.startsWith('emulator-')), locks: deviceLocks });
if (!offline) { await instagram.load(); await tiktok.load(); }
// Reserve queued job devices immediately: internet recovery must not take their
// lock while runJob is awaiting its initial network checks or staggered start.
const platformBusy = serial => instagram.busy(serial) || tiktok.busy(serial);
const anyJobRunning = () => [instagram, tiktok].some(m => ['running', 'stopping'].includes(m.job?.status));
const restoreIdleInternet = async (serial, options) => {
  if (platformBusy(serial)) return { online: false, message: 'HP sedang digunakan. Pemulihan menunggu proses selesai.' };
  deviceLocks.add(serial);
  try { return await restoreInternet(serial, options); } finally { deviceLocks.delete(serial); }
};
const internet = new InternetWatch({ devices: () => devices, net: { phoneOnline, restoreInternet: restoreIdleInternet, restartRelay, relayStrained, wifiName, connectionInfo, preference: serial => networkPolicy.get(serial) }, logs: instagram.logs,
  isBusy: platformBusy, jobRunning: anyJobRunning, onChange: () => publish() });
const snapshot = () => ({ devices, detectedCount, expectedCount: settings.expectedCount, lastUpdated, error: scanError, offline, streaming: streams.sessions.size, internet: internet.snapshot(), internetSummary: internet.summary(), networkPreferences: networkPolicy.choices });
const publish = () => { const data = `data: ${JSON.stringify(snapshot())}\n\n`; for (const client of subscribers) client.write(data); };
async function scan() {
  if (offline) { lastUpdated = new Date().toISOString(); publish(); return; }
  if (scanning) return scanning;
  scanning = (async () => {
    try {
      const found = await listDevices();
      await Promise.allSettled(found.map(async device => {
        if (device.status !== 'device') return;
        let entry = details.get(device.serial);
        if (!entry || Date.now() - entry.at > 30000) {
          try { entry = { data: await getDetails(device.serial), at: Date.now() }; details.set(device.serial, entry); } catch {}
        }
        if (entry) Object.assign(device, entry.data);
        if (!platformBusy(device.serial)) {
          const display = await getDisplay(device.serial).catch(() => null);
          if (display && !platformBusy(device.serial)) {
            Object.assign(device, display);
            if (entry) Object.assign(entry.data, display);
            streams.reconcileDisplay(device.serial, display);
          }
        }
      }));
      let inventoryChanged = false;
      for (const device of found.sort((a, b) => a.serial.localeCompare(b.serial))) {
        const previous = inventory.get(device.serial);
        if (!previous) inventoryChanged = true;
        inventory.set(device.serial, { ...previous, ...device, index: previous?.index || Math.max(0, ...[...inventory.values()].map(d => d.index || 0)) + 1, lastSeen: new Date().toISOString() });
      }
      const present = new Map(found.map(d => [d.serial, d.status]));
      detectedCount = found.length;
      devices = [...inventory.values()].sort((a, b) => a.index - b.index).map(device => ({ ...device, status: present.get(device.serial) || 'offline', present: present.has(device.serial), name: settings.aliases[device.serial] || `HP ${String(device.index).padStart(2, '0')}`, battery: Number.isFinite(device.battery) ? device.battery : null }));
      if (inventoryChanged) {
        settings.knownDevices = [...inventory.values()];
        settingWrite = settingWrite.catch(() => {}).then(saveSettings); await settingWrite;
      }
      streams.disconnectMissing(new Set(found.filter(d => d.status === 'device').map(d => d.serial)));
      internet.noticeDevices(await adbServerId());
      scanError = null; lastUpdated = new Date().toISOString(); publish();
    } catch (error) {
      // Sebab aslinya ikut ditampilkan: tanpa itu, satu kegagalan di tengah pemindaian hanya
      // terlihat sebagai "periksa koneksi ADB" walau ADB-nya sendiri baik-baik saja.
      scanError = error.code === 'ENOENT' ? 'ADB belum terpasang.' : `Pemindaian perangkat gagal (${error.message}). Periksa koneksi ADB.`;
      publish();
    }
  })().finally(() => { scanning = null; });
  return scanning;
}

function trustedRequest(req) {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return false;
    return true;
  } catch { return false; }
}
const authenticated = req => trustedRequest(req) && req.headers.cookie?.split(';').some(part => part.trim() === `${cookieName}=${token}`);
app.disable('x-powered-by');
// See server/body-limit.mjs: a full plan of 100 accounts x 20 links is about 200 KB.
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.get('/api/health', (req, res) => {
  if (!trustedRequest(req)) return res.sendStatus(403);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ app: 'phonefarm-panel', version: '0.1.0' });
});
app.get('/api/session', (req, res) => {
  if (!trustedRequest(req)) return res.sendStatus(403);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true });
});
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); if (!authenticated(req)) return res.status(403).json({ error: 'Buka panel melalui localhost untuk mengakses perangkat.' }); next(); });
app.get('/api/devices', (req, res) => res.json(snapshot()));
// Tombol "Stop total" di panel: menghentikan semua proses di kedua platform sekaligus, termasuk
// penanda yang tersangkut, supaya pekerjaan berikutnya tidak lagi ditolak.
app.post('/api/stop-all', async (req, res) => {
  try {
    const stopAll = {};
    for (const [name, manager] of [['ig', instagram], ['tt', tiktok]]) stopAll[name] = await manager.stopEverything();
    res.json({ ...snapshot(), stopAll });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
const simulations = await registerSocialRoutes(app, process.env.PHONEFARM_DATA_DIR || join(root, '.phonefarm'));
// Offline launch never touches device transports, relay or account scanners.
app.use('/api', (req, res, next) => {
  if (offline && (['/ig', '/tt', '/connection', '/internet', '/devices/'].some(prefix => req.path.startsWith(prefix)) || (req.path === '/settings' && req.method !== 'GET'))) return res.status(409).json({ error: 'Panel dibuka dalam mode tanpa perangkat. Gunakan workspace simulasi X, Threads, Facebook, atau YouTube.' });
  next();
});
// The same comment workspace routes for each platform: /api/ig (Instagram) and /api/tt (TikTok).
for (const [prefix, manager] of [['ig', instagram], ['tt', tiktok]]) {
  const other = manager === instagram ? tiktok : instagram;
  const otherBusy = () => other.duplicates?.busy || other.login?.busy || other.logout?.busy || other.scanPending || other.previewPending || ['running', 'stopping'].includes(other.job?.status);
  const guard = res => otherBusy() ? (res.status(400).json({ error: `Tunggu proses ${other === tiktok ? 'TikTok' : 'Instagram'} selesai terlebih dahulu.` }), true) : false;
  if (prefix === 'ig') app.post('/api/ig/login/start', (req, res) => {
    if (guard(res)) return;
    try { res.json(instagram.login.start(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
    finally { if (Array.isArray(req.body?.accounts)) for (const account of req.body.accounts) if (account && typeof account === 'object') delete account.password; }
  });
  if (prefix === 'ig') app.post('/api/ig/accounts/deduplicate', (req, res) => {
    if (guard(res)) return;
    try { res.json(instagram.duplicates.start()); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  if (prefix === 'ig') app.post('/api/ig/accounts/logout', (req, res) => {
    if (guard(res)) return;
    try { res.json(instagram.logout.start(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get(`/api/${prefix}`, (req, res) => res.json(manager.snapshot()));
  app.post(`/api/${prefix}/accounts/scan`, async (req, res) => {
    if (guard(res)) return;
    try { res.json(await manager.scanAccounts()); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(`/api/${prefix}/preview`, async (req, res) => {
    if (guard(res)) return;
    try { res.json(await manager.preview(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  if (prefix === 'ig') app.post('/api/ig/links', async (req, res) => {
    if (guard(res)) return;
    try { res.json(await manager.collectLinks(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(`/api/${prefix}/start`, (req, res) => {
    if (guard(res)) return;
    try { res.json(manager.start(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(`/api/${prefix}/comments/review`, async (req, res) => {
    if (guard(res)) return;
    try { res.json(await manager.recovery.review(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(`/api/${prefix}/resume`, (req, res) => {
    if (guard(res)) return;
    try { res.json(manager.recovery.resume(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post(`/api/${prefix}/stop`, (req, res) => res.json(manager.stop()));
}
app.get('/api/ig/logs', async (req, res) => res.json({ logs: await instagram.listLogs() }));
app.get('/api/ig/logs/:id', async (req, res) => {
  try { res.json({ id: req.params.id, text: await instagram.readLog(req.params.id) }); } catch (error) { res.status(404).json({ error: error.message }); }
});
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  subscribers.add(res); res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  const timer = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(timer); subscribers.delete(res); });
});
app.post('/api/scan', async (req, res) => { await scan(); res.json(snapshot()); });
app.post('/api/internet/check', (req, res) => { internet.check(null, { manual: true, repair: false }).catch(() => {}); res.json(snapshot()); });
app.post('/api/internet/:serial/check', (req, res) => {
  if (!devices.some(d => d.serial === req.params.serial && d.status === 'device')) return res.status(400).json({ error: 'HP belum terhubung.' });
  internet.check([req.params.serial], { manual: true, repair: false }).catch(() => {}); res.json(snapshot());
});
app.post('/api/internet/:serial/reconnect', (req, res) => {
  if (!devices.some(d => d.serial === req.params.serial && d.status === 'device')) return res.status(400).json({ error: 'HP belum terhubung.' });
  if (!networkPolicy.get(req.params.serial)) return res.status(400).json({ error: 'Pilih metode internet di menu Koneksi terlebih dahulu.' });
  if (platformBusy(req.params.serial)) return res.status(409).json({ error: 'HP sedang digunakan proses lain.' });
  internet.check([req.params.serial], { manual: true }).catch(() => {}); res.json(snapshot());
});
app.get('/api/internet/:serial/wifi', async (req, res) => {
  try { getDevice(req.params.serial); res.json({ networks: await wifiNetworks(req.params.serial) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
let networkApplying = false;
app.post('/api/internet/method', async (req, res) => {
  let held = [];
  if (networkApplying) return res.status(409).json({ error: 'Tunggu penerapan metode internet selesai.' });
  try {
    const { serials, preference, password } = validateConnection(req.body);
    networkApplying = true;
    if (internet.running) await internet.running;
    for (const serial of serials) { getDevice(serial); if (platformBusy(serial)) throw new Error('Salah satu HP sedang digunakan. Tunggu proses selesai.'); }
    held = serials; for (const serial of held) deviceLocks.add(serial);
    await networkPolicy.set(serials, preference);
    for (const serial of serials) internet.set(serial, { preference, state: 'restoring', message: 'Menerapkan metode pilihan…' });
    const results = await Promise.all(serials.map(async serial => {
      try {
        // Recover the individual client first. A failed shared relay may be
        // restarted only while no platform job is running.
        const result = await restoreInternet(serial, { password, relayRestart: !anyJobRunning() });
        internet.set(serial, { ...await connectionInfo(serial), preference, state: result.online ? 'online' : 'offline', checkedAt: new Date().toISOString(), failures: result.online ? 0 : 1,
          message: result.online ? '' : result.message || 'Metode disimpan, tetapi koneksi internet belum berhasil. Periksa HP atau jaringan pilihan.' });
        return { serial, ok: result.online, message: internet.status.get(serial).message };
      } catch (error) {
        const message = error.message?.includes('Command failed') ? 'Penerapan koneksi gagal. Periksa layar HP.' : error.message;
        internet.set(serial, { ...await connectionInfo(serial), preference, state: 'offline', checkedAt: new Date().toISOString(), message });
        return { serial, ok: false, message };
      }
    }));
    res.json({ ...snapshot(), results });
  } catch (error) { res.status(400).json({ error: error.message }); }
  finally { for (const serial of held) deviceLocks.delete(serial); networkApplying = false; }
});
app.get('/api/connection', async (req, res) => {
  const results = await Promise.allSettled([usbOverview(), boxStatus()]);
  const usb = results[0].status === 'fulfilled' ? results[0].value : null;
  const box = results[1].status === 'fulfilled' ? results[1].value : { available: false };
  res.json({ ...snapshot(), usb, box, bridge: 'ADB + scrcpy', host: '127.0.0.1', platform: process.platform });
});
async function saveSettings() {
  await mkdir(dirname(statePath), { recursive: true });
  const temp = statePath + '.tmp'; await writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 }); await rename(temp, statePath);
}
let settingWrite = Promise.resolve();
app.patch('/api/settings', async (req, res) => {
  const { expectedCount, serial, name } = req.body;
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 200)) return res.status(400).json({ error: 'Jumlah slot harus 1–200.' });
  if (serial !== undefined && (!devices.some(d => d.serial === serial) || typeof name !== 'string' || !name.trim() || name.trim().length > 40)) return res.status(400).json({ error: 'Nama perangkat tidak valid.' });
  if (expectedCount !== undefined) settings.expectedCount = expectedCount;
  if (serial) settings.aliases[serial] = name.trim();
  settingWrite = settingWrite.catch(() => {}).then(saveSettings); await settingWrite; await scan(); res.json(snapshot());
});
function getDevice(serial) { const device = devices.find(d => d.serial === serial); if (!device || device.status !== 'device') throw new Error('Perangkat belum siap atau sudah terputus.'); return device; }
app.post('/api/devices/:serial/input', async (req, res) => {
  let serial;
  try { const device = getDevice(req.params.serial); if (platformBusy(device.serial)) throw new Error('HP sedang digunakan proses lain. Tunggu atau hentikan proses sebelum mengontrol layar.'); serial = device.serial; deviceLocks.add(serial); const geometry = ['tap', 'swipe'].includes(req.body.type) ? await getDisplay(serial) : device; await input(serial, req.body, geometry); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message?.includes('Command failed') ? 'Kontrol gagal. Periksa koneksi perangkat.' : error.message }); }
  finally { if (serial) deviceLocks.delete(serial); }
});
app.post('/api/devices/:serial/rotation', async (req, res) => {
  let serial;
  try {
    const device = getDevice(req.params.serial);
    if (platformBusy(device.serial)) return res.status(409).json({ error: 'HP sedang digunakan proses lain. Tunggu proses selesai sebelum memutar layar.' });
    serial = device.serial; deviceLocks.add(serial);
    const display = await rotateDisplay(serial, req.body.mode);
    streams.reconcileDisplay(serial, display);
    const current = devices.find(item => item.serial === serial);
    if (current) Object.assign(current, display);
    const cached = details.get(serial);
    if (cached) Object.assign(cached.data, display);
    publish(); res.json({ ok: true, ...display });
  } catch (error) { res.status(400).json({ error: error.message?.includes('Command failed') ? 'Rotasi gagal. Periksa koneksi perangkat.' : error.message }); }
  finally { if (serial) deviceLocks.delete(serial); }
});
app.get('/api/devices/:serial/screenshot', async (req, res) => {
  try {
    const device = getDevice(req.params.serial);
    const png = await adb(['-s', device.serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 12000 });
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Tangkapan layar belum tersedia.');
    res.setHeader('Content-Disposition', `attachment; filename="phonefarm-${device.serial}.png"`); res.type('png').send(png);
  } catch { res.status(400).json({ error: 'Tangkapan layar gagal. Periksa koneksi perangkat.' }); }
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (!production && url.pathname === '/ws/hmr' && trustedRequest(req)) return;
  const serial = url.searchParams.get('serial');
  if (url.pathname !== '/ws/screen' || !authenticated(req) || !devices.some(d => d.serial === serial && d.status === 'device')) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    streams.subscribe(serial, ws);
  });
});
const socketTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) { socket.terminate(); continue; }
    socket.alive = false; socket.ping();
  }
}, 30000);

if (production) {
  app.use(express.static(join(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(join(root, 'dist', 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { server, clientPort: port, path: '/ws/hmr' }, allowedHosts: ['localhost', '127.0.0.1'] }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error, req, res, next) => { console.error(error.message); if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan pada layanan lokal.' }); });

if (!offline) await adb(['start-server']).catch(() => {});
await scan();
const scanTimer = offline ? null : setInterval(scan, 5000);
server.listen(port, '127.0.0.1', () => { console.log(`Phonefarm siap: http://127.0.0.1:${port}${offline ? ' (tanpa perangkat)' : ''}`); if (!offline) internet.start(); });
function shutdown() { internet.stop(); instagram.stop(); tiktok.stop(); for (const manager of simulations) manager.stop(); clearInterval(scanTimer); clearInterval(socketTimer); streams.close(); for (const res of subscribers) res.end(); wss.close(); server.close(async () => { await Promise.allSettled(simulations.map(m => m.task || m.writing)); process.exit(0); }); setTimeout(() => process.exit(0), 2500).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
