import test from 'node:test';
import assert from 'node:assert/strict';
import { XAdapter, xScreenBlocker } from '../server/live/x.mjs';

const login = [
  { package: 'com.twitter.android', text: '<icon>  Login with username <icon>' },
  { package: 'com.twitter.android', text: 'Continue with Phone' },
];
test('X login evidence requires both observed controls in the X package', () => {
  assert.equal(xScreenBlocker(login).code, 'X_LOGIN_REQUIRED');
  assert.equal(xScreenBlocker(login.slice(0, 1)).code, 'X_UI_UNVERIFIED');
  assert.equal(xScreenBlocker(login.map(n => ({ ...n, package: 'other' }))).code, 'X_UI_UNVERIFIED');
});
test('X cannot accept a fabricated send proof or claim that an unknown screen is logged in', async () => {
  const adapter = new XAdapter({ serial: 'test-x' });
  adapter.launch = async () => {};
  adapter.read = async () => login;
  adapter.tap = async () => assert.fail('No controls may be tapped while unverified');
  assert.equal((await adapter.scan()).complete, false);
  assert.equal((await adapter.inspect({ target: 'demo' })).verified, false);
  await assert.rejects(adapter.submit({ verified: true }), { code: 'X_LOGIN_REQUIRED' });
  adapter.read = async () => [];
  await assert.rejects(adapter.submit({ verified: true }), { code: 'X_UI_UNVERIFIED' });
});
