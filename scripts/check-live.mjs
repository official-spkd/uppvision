import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = process.env.PHONEFARM_URL || 'http://127.0.0.1:5179';
const session = await fetch(base + '/api/session');
const cookie = session.headers.get('set-cookie').split(';')[0];
const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
assert.equal((await fetch(base + '/api/devices')).status, 403);
assert.equal((await fetch(base + '/api/devices', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
assert.equal((await fetch(base + '/api/settings', { method: 'PATCH', headers, body: JSON.stringify({ expectedCount: -3 }) })).status, 400);
console.log('Local session, origin, and capacity validation: passed');

let devices = [];
for (let attempt = 0; attempt < 8; attempt++) {
  const response = await fetch(base + '/api/scan', { method: 'POST', headers });
  const snapshot = await response.json();
  devices = snapshot.devices.filter(device => device.status === 'device');
  if (devices.length) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
assert.ok(devices.length, 'No authorized Android board is currently connected');
for (const device of devices) {
  assert.equal((await fetch(base + `/api/devices/${device.serial}/input`, { method: 'POST', headers, body: JSON.stringify({ type: 'tap', x: -1, y: 0 }) })).status, 400);
  const response = await fetch(base + `/api/devices/${device.serial}/screenshot`, { headers });
  assert.equal(response.status, 200, `${device.name}: screenshot available`);
  const image = Buffer.from(await response.arrayBuffer());
  assert.equal(image.readUInt32BE(0), 0x89504e47);
  console.log(`${device.name}: valid PNG screenshot (${image.length} bytes)`);
  const started = Date.now();
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/screen?serial=${encodeURIComponent(device.serial)}`, { headers: { Cookie: cookie, Origin: base } });
  let frames = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${device.name}: live frame timeout`)); }, 25000);
    const fail = error => { clearTimeout(timer); ws.close(); reject(error); };
    ws.on('error', fail);
    ws.on('message', (frame, binary) => {
      if (!binary) return fail(new Error(JSON.parse(frame.toString()).message));
      try { assert.equal(frame.readUInt16BE(0), 0xffd8); assert.equal(frame.readUInt16BE(frame.length - 2), 0xffd9); } catch (error) { return fail(error); }
      if (!frames++) console.log(`${device.name}: first live JPEG in ${Date.now() - started} ms`);
      if (frames === 2) { clearTimeout(timer); ws.close(); resolve(); }
    });
  });
  console.log(`${device.name}: live streaming passed (2 JPEG frames)`);
}
