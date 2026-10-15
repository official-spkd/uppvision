import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInstagramAccounts } from '../src/instagram-accounts.mjs';

test('counts usernames once across phones and duplicate rows, preserving distinct devices', () => {
  const summary = summarizeInstagramAccounts([
    { serial: 'a', name: 'Samsung 01', online: true, accounts: [{ username: 'Shared.User' }, { username: 'shared.user' }, { username: 'solo' }] },
    { serial: 'b', name: 'Samsung 02', online: true, accounts: [{ username: '@shared.user' }] },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.excluded, 0);
  assert.deepEqual(summary.byUsername.get('shared.user').devices.map(d => d.name), ['Samsung 01', 'Samsung 02']);
});

test('disabled on any phone excludes the whole username regardless of device order', () => {
  const devices = [
    { serial: 'a', accounts: [{ username: 'banned', disabled: false }, { username: 'usable' }] },
    { serial: 'b', accounts: [{ username: 'BANNED', disabled: true }] },
  ];
  for (const input of [devices, [...devices].reverse()]) {
    const summary = summarizeInstagramAccounts(input);
    assert.equal(summary.total, 1);
    assert.equal(summary.excluded, 1);
    assert.equal(summary.byUsername.get('banned').devices.length, 2);
  }
});

test('offline and incomplete inventories remain counted with explicit freshness indicators', () => {
  const summary = summarizeInstagramAccounts([
    { serial: 'a', online: false, accounts: [{ username: 'offline' }] },
    { serial: 'b', online: true, error: 'Scan failed', accounts: [{ username: 'cached' }] },
    { serial: 'c', online: true, complete: false, accounts: [{ username: 'partial' }] },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.byUsername.get('offline').devices[0].online, false);
  assert.equal(summary.byUsername.get('offline').devices[0].name, 'a');
  assert.equal(summary.byUsername.get('cached').devices[0].unverified, true);
  assert.equal(summary.byUsername.get('partial').devices[0].unverified, true);
  assert.equal(summarizeInstagramAccounts().total, 0);
});
