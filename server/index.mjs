import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, listDevices, getDetails, input, usbOverview, adbEnv } from './adb.mjs';
import { StreamManager } from './streams.mjs';
import { boxStatus } from './box.mjs';
import { InstagramManager } from './instagram.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5179);
const production = process.argv.includes('--production');
const app = express(), server = createServer(app), streams = new StreamManager();
const token = randomBytes(32).toString('hex');
const statePath = join(root, '.phonefarm', 'settings.json');
let settings = { expectedCount: 19, aliases: {}, knownDevices: [] };
try { settings = { ...settings, ...JSON.parse(await readFile(statePath, 'utf8')) }; } catch {}
const inventory = new Map(settings.knownDevices.map(d => [d.serial, d]));
let devices = [...inventory.values()].map(d => ({ ...d, status: 'offline', present: false })), detectedCount = 0, lastUpdated = null, scanError = null, scanning = null;
const details = new Map(), subscribers = new Set();
const instagram = new InstagramManager({ statePath: join(root, '.phonefarm', 'instagram.json'), devices: () => devices.filter(d => !d.serial.startsWith('emulator-')) });
await instagram.load();
const snapshot = () => ({ devices, detectedCount, expectedCount: settings.expectedCount, lastUpdated, error: scanError, streaming: streams.sessions.size });
const publish = () => { const data = `data: ${JSON.stringify(snapshot())}\n\n`; for (const client of subscribers) client.write(data); };
async function scan() {
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
      scanError = null; lastUpdated = new Date().toISOString(); publish();
    } catch (error) { scanError = error.code === 'ENOENT' ? 'ADB belum terpasang.' : 'Pemindaian perangkat gagal. Periksa koneksi ADB.'; publish(); }
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
const authenticated = req => trustedRequest(req) && req.headers.cookie?.split(';').some(part => part.trim() === `phonefarm=${token}`);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (req, res) => {
  if (!trustedRequest(req)) return res.sendStatus(403);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ app: 'phonefarm-panel', version: '0.1.0' });
});
app.get('/api/session', (req, res) => {
  if (!trustedRequest(req)) return res.sendStatus(403);
  res.setHeader('Set-Cookie', `phonefarm=${token}; HttpOnly; SameSite=Strict; Path=/`);
  res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true });
});
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); if (!authenticated(req)) return res.status(403).json({ error: 'Buka panel melalui localhost untuk mengakses perangkat.' }); next(); });
app.get('/api/devices', (req, res) => res.json(snapshot()));
app.get('/api/ig', (req, res) => res.json(instagram.snapshot()));
app.post('/api/ig/accounts/scan', async (req, res) => {
  try { res.json(await instagram.scanAccounts()); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/ig/preview', async (req, res) => {
  try { res.json(await instagram.preview(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/ig/start', (req, res) => {
  try { res.json(instagram.start(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/ig/stop', (req, res) => res.json(instagram.stop()));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  subscribers.add(res); res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  const timer = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(timer); subscribers.delete(res); });
});
app.post('/api/scan', async (req, res) => { await scan(); res.json(snapshot()); });
app.get('/api/connection', async (req, res) => {
  const results = await Promise.allSettled([usbOverview(), boxStatus()]);
  const usb = results[0].status === 'fulfilled' ? results[0].value : null;
  const box = results[1].status === 'fulfilled' ? results[1].value : { available: false };
  res.json({ ...snapshot(), usb, box, keyLoaded: Boolean(adbEnv.ADB_VENDOR_KEYS), bridge: 'ADB + scrcpy', host: '127.0.0.1', platform: process.platform });
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
  try { const device = getDevice(req.params.serial); if (instagram.busy(device.serial)) throw new Error('HP sedang digunakan proses Instagram. Hentikan proses sebelum mengontrol layar.'); await input(device.serial, req.body, device); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message?.includes('Command failed') ? 'Kontrol gagal. Periksa koneksi perangkat.' : error.message }); }
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

await adb(['start-server']).catch(() => {});
await scan();
const scanTimer = setInterval(scan, 5000);
server.listen(port, '127.0.0.1', () => console.log(`Phonefarm siap: http://127.0.0.1:${port}`));
function shutdown() { instagram.stop(); clearInterval(scanTimer); clearInterval(socketTimer); streams.close(); for (const res of subscribers) res.end(); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2500).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
