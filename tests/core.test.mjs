import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevices, inputArgs, shellQuote, JpegParser } from '../server/core.mjs';

test('distinguishes authorized, unauthorized, offline and Wi-Fi transports', () => {
  const devices = parseDevices('List of devices attached\nTESTSERIAL01 device usb:1-1.1.4.4 product:test model:Test_Phone device:test\nabc unauthorized usb:12\n192.168.1.5:5555 offline\n* daemon started successfully\n');
  assert.equal(devices.length, 3);
  assert.equal(devices[0].model, 'Test-Phone');
  assert.equal(devices[1].status, 'unauthorized');
  assert.equal(devices[2].transport, 'Wi-Fi');
});
test('scales normalized touch coordinates and rejects malicious or invalid controls', () => {
  const geometry = { width: 1080, height: 1920 };
  assert.deepEqual(inputArgs({ type: 'tap', x: 1, y: 1 }, geometry), ['shell', 'input', 'tap', '1079', '1919']);
  assert.deepEqual(inputArgs({ type: 'swipe', x: .5, y: .8, endX: .5, endY: .2, duration: 350 }, geometry), ['shell', 'input', 'swipe', '540', '1535', '540', '384', '350']);
  assert.throws(() => inputArgs({ type: 'tap', x: -1, y: .5 }, geometry));
  assert.throws(() => inputArgs({ type: 'tap', x: NaN, y: .5 }, geometry));
  assert.throws(() => inputArgs({ type: 'key', key: 'home; reboot' }, geometry));
  assert.throws(() => inputArgs({ type: 'swipe', x: 0, y: 0, endX: 0, endY: 0, duration: 60000 }, geometry));
  assert.throws(() => inputArgs({ type: 'tap', x: .5, y: .5 }, null));
});
test('quotes text for Android shell without executing user-provided syntax', () => {
  assert.equal(shellQuote("x' $(echo secret); `id`"), "'x'\\'' $(echo secret); `id`'");
  assert.deepEqual(inputArgs({ type: 'text', text: 'hello world' }), ['shell', 'input', 'text', "'hello%sworld'"]);
  assert.throws(() => inputArgs({ type: 'text', text: 'a'.repeat(501) }));
  assert.throws(() => inputArgs({ type: 'text', text: 'hello\x00' }));
});
test('assembles JPEGs across fragmented stdout chunks and drops excess data', () => {
  const frames = [];
  const parser = new JpegParser(frame => frames.push(Buffer.from(frame)));
  parser.push(Buffer.from([9, 255]));
  parser.push(Buffer.from([216, 10, 11, 255]));
  assert.equal(frames.length, 0);
  parser.push(Buffer.from([217, 255, 216, 12, 255, 217, 4]));
  assert.deepEqual(frames, [Buffer.from([255, 216, 10, 11, 255, 217]), Buffer.from([255, 216, 12, 255, 217])]);
  parser.push(Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8 * 1024 * 1024 + 1)]));
  assert.equal(parser.buffer.length, 0);
});
