import test from 'node:test';
import assert from 'node:assert/strict';
import x, { normalizeTarget, createFixtures } from '../server/platforms/x.mjs';

test('X and Twitter profile aliases normalize to a case-insensitive account identity', () => {
  for (const target of [
    ' Demo_Account ', '@Demo_Account',
    'https://x.com/Demo_Account', 'https://www.x.com/Demo_Account/',
    'x.com/Demo_Account', 'mobile.x.com/Demo_Account',
    'https://twitter.com/Demo_Account?ref_src=example#profile',
    'https://www.twitter.com/Demo_Account/', 'mobile.twitter.com/Demo_Account',
    'HTTPS://TWITTER.COM/Demo_Account',
  ]) assert.equal(normalizeTarget(target), 'demo_account', target);
  assert.equal(normalizeTarget(normalizeTarget('@Demo_Account')), 'demo_account');
  assert.equal(normalizeTarget('@a'), 'a');
  assert.equal(normalizeTarget('@abcdefghijklmno'), 'abcdefghijklmno');
});

test('X rejects invalid usernames, platform routes, and individual posts', () => {
  for (const target of [
    undefined, null, 1, {}, [], '', ' ', '@', '@@demo', '@demo.account',
    '@demo-account', '@two names', '@demo\nother', '@éxample', '@abcdefghijklmnop',
    '@demo/status/123', 'https://x.com/demo/status/123', 'https://twitter.com/demo/status/123?s=20',
    'https://x.com/demo/with_replies', 'https://x.com/', 'https://twitter.com/i/status/123',
    'home', 'EXPLORE', '@Search', 'settings', 'notifications', 'messages', 'compose',
    'i', 'intent', 'login', 'signup', 'https://x.com/home', 'https://x.com/search?q=demo',
  ]) assert.throws(() => normalizeTarget(target), /username X|profil/i, String(target));
});

test('X refuses unrelated hosts, credentials, ports and encoded account names', () => {
  for (const target of [
    'https://example.com/demo', 'https://x.com.evil.test/demo',
    'https://twitter.com.evil.test/demo', 'https://x.com@evil.test/demo',
    'https://user:pass@x.com/demo', 'https://user@twitter.com/demo',
    'https://x.com:8000/demo', 'ftp://x.com/demo', 'javascript:demo',
    'https://x.com/%64emo', 'https://x.com/demo%2Fstatus', 'https://x.com/demo%ZZ',
  ]) assert.throws(() => normalizeTarget(target), /username X|profil/i, target);
});

test('X rejects path traversal and ambiguous separators before URL parsing changes the target', () => {
  for (const target of [
    'https://x.com/demo/../other', 'https://twitter.com/demo/./',
    'https://x.com/demo/%2e%2e/other', 'https://x.com/demo//',
    'https://x.com//demo', 'https://x.com\\demo',
    'https://x.com/demo/.%2E/other', 'https://x.com/demo%5Cstatus',
    'https:////x.com/demo', 'https://x.com/de\nmo',
  ]) assert.throws(() => normalizeTarget(target), /username X|profil/i, target);
});

test('X fixtures share stable identity across aliases while targets and returned records stay isolated', () => {
  const fixtures = createFixtures('@Demo_Account');
  assert.deepEqual(fixtures, createFixtures('https://twitter.com/demo_account/'));
  assert.ok(fixtures.length >= 6);
  assert.equal(new Set(fixtures.map(post => post.id)).size, fixtures.length);
  const other = new Set(createFixtures('@other_demo').map(post => post.id));
  assert.ok(fixtures.every(post => !other.has(post.id)));
  assert.ok(fixtures.some(post => post.pinned));
  assert.ok(fixtures.some(post => !post.commentsEnabled));
  assert.ok(fixtures.some(post => post.liked));
  assert.ok(fixtures.some(post => !post.pinned && post.commentsEnabled && post.existing === 0));
  assert.ok(fixtures.some(post => !post.pinned && post.commentsEnabled && post.existing > 0));
  for (const post of fixtures) {
    assert.match(post.caption, /^\[SIMULASI\]/);
    assert.equal(typeof post.pinned, 'boolean');
    assert.equal(typeof post.commentsEnabled, 'boolean');
    assert.equal(typeof post.liked, 'boolean');
    assert.ok(Number.isInteger(post.existing) && post.existing >= 0);
  }
  fixtures[1].existing = 99;
  assert.equal(createFixtures('@demo_account')[1].existing, 1);
  assert.throws(() => createFixtures('https://x.com/demo/status/123'), /username X|profil/i);
});

test('X contract advertises simulation and the separate device verification boundary', () => {
  assert.equal(x.id, 'x');
  assert.equal(x.action, 'balasan');
  assert.equal(x.item, 'postingan');
  assert.equal(x.liveSupported, false);
  assert.equal(x.sampleAccounts.length, 2);
  assert.equal(new Set(x.sampleAccounts.map(account => account.username)).size, 2);
  assert.ok(x.sampleAccounts.every(account => /contoh|demo/i.test(account.displayName)));
  assert.ok(x.liveChecklist.length > 0);
});
