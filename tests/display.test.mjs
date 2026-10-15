import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplay, rotateDisplay } from '../server/display.mjs';
import { inputArgs } from '../server/core.mjs';
import { StreamManager } from '../server/streams.mjs';

const dump = rotation => `Display: mDisplayId=19\n init=720x404 cur=720x404\n mRotation=0\nDisplay: mDisplayId=0 (organized)\n init=1080x1920 cur=${rotation % 2 ? '1920x1080' : '1080x1920'}\n mRotation=${rotation}\n`;
function phone(rotation = 1, fail = false) {
  const state = { rotation, user: 'free', fixed: 'default', calls: [] };
  const run = async args => {
    assert.deepEqual(args.slice(0, 3), ['-s', 'phone', 'shell']);
    const command = args.slice(3); state.calls.push(command);
    if (command[0] === 'dumpsys') return dump(state.rotation);
    const [, setting, value, number] = command;
    if (!value) return setting === 'user-rotation' ? state.user : state.fixed;
    if (setting === 'fixed-to-user-rotation') state.fixed = value;
    else {
      if (fail && value === 'lock') throw new Error('Disconnected');
      state.user = value === 'lock' ? `lock ${number}` : value;
      if (value === 'lock') state.rotation = Number(number);
    }
    return '';
  };
  return { state, run };
}
test('uses main display geometry when virtual display appears first', () => {
  const geometry = parseDisplay(dump(1));
  assert.deepEqual(geometry, { width: 1920, height: 1080, rotation: 1 });
  assert.deepEqual(inputArgs({ type: 'tap', x: 1, y: 1 }, geometry), ['shell', 'input', 'tap', '1919', '1079']);
  assert.equal(parseDisplay(dump(0).replace('mRotation=0\n', 'mRotation=0\n').replace(/mRotation=0\n$/, 'mRotation=ROTATION_270\n')).rotation, 3);
  assert.throws(() => parseDisplay('Display: mDisplayId=19\n cur=720x404\n mRotation=0'));
  assert.throws(() => parseDisplay(dump(0).replace('cur=1080x1920', 'cur=0x1920')));
});
test('clockwise rotation cycles all four orientations and auto releases lock', async () => {
  const { state, run } = phone();
  for (const rotation of [2, 3, 0, 1]) {
    const result = await rotateDisplay('phone', 'clockwise', run);
    assert.equal(result.rotation, rotation);
    assert.equal(result.rotationMode, 'locked');
    assert.equal(state.fixed, 'enabled');
  }
  assert.equal((await rotateDisplay('phone', 'auto', run)).rotationMode, 'auto');
  assert.equal(state.user, 'free'); assert.equal(state.fixed, 'default');
});
test('restores original preferences if rotation command fails', async () => {
  const { state, run } = phone(1, true);
  await assert.rejects(rotateDisplay('phone', 'clockwise', run), /Disconnected/);
  assert.equal(state.user, 'free'); assert.equal(state.fixed, 'default');
});
test('rejects invalid mode before touching a phone', async () => {
  await assert.rejects(rotateDisplay('phone', 'invalid', () => assert.fail('No device access expected')), /Mode rotasi/);
});
test('reconnects encoder only when actual display dimensions change', () => {
  const manager = new StreamManager();
  const session = { display: { width: 1080, height: 1920 } };
  manager.sessions.set('phone', session);
  let stops = 0; manager.stop = value => { assert.equal(value, session); stops++; };
  manager.reconcileDisplay('phone', { width: 1080, height: 1920 });
  assert.equal(stops, 0);
  manager.reconcileDisplay('phone', { width: 1920, height: 1080 });
  assert.equal(stops, 1);
  manager.reconcileDisplay('missing', { width: 1920, height: 1080 });
  assert.equal(stops, 1);
});
