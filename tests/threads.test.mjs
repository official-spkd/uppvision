import test from 'node:test';
import assert from 'node:assert/strict';
import threads, { normalizeTarget, createFixtures } from '../server/platforms/threads.mjs';

test('Threads normalizes handles and supported profile URL variants to the same identity', () => {
  for (const input of [
    ' Demo.Reader_1 ', '@Demo.Reader_1',
    'https://threads.net/@Demo.Reader_1',
    'https://www.threads.com/@Demo.Reader_1/',
    'HTTPS://THREADS.COM/@Demo.Reader_1?source=share#profile',
    'threads.net/@Demo.Reader_1',
    'www.threads.com/@Demo.Reader_1/',
  ]) assert.equal(normalizeTarget(input), 'demo.reader_1', input);
});

test('Threads refuses unsupported links and ambiguous target paths instead of changing their target', () => {
  for (const input of [
    undefined, null, 123, {}, '', ' ', '@', '@@demo', 'two names', '.', '..',
    'https://instagram.com/@demo', 'https://threads.com.evil.example/@demo',
    'https://evil.example/threads.com/@demo', 'https://threads.com@evil.example/@demo',
    'https://user@threads.com/@demo', 'https://threads.com:8000/@demo',
    'https://m.threads.com/@demo', 'ftp://threads.com/@demo',
    'https://threads.com/', 'https://threads.com/demo',
    'https://threads.com/@demo/post/abc', 'https://threads.net/@demo/post/abc?x=1',
    'https://threads.com/@demo/../@other', 'https://threads.com/@demo/%2e%2e/@other',
    'https://threads.com/%40demo', 'https://threads.com/@demo%2fpost',
    'https://threads.com\\@demo', 'https://threads.com/@demo//',
    '@demo/post/abc', '@demo?x=1', '@demo\nother',
  ]) assert.throws(() => normalizeTarget(input), /Target Threads/, String(input));
});

test('Threads fixture identities are canonical, target-specific, isolated, and explicitly simulated', () => {
  const fixtures = createFixtures('@Demo.Reader_1');
  assert.deepEqual(fixtures, createFixtures('https://threads.com/@demo.reader_1'));
  assert.ok(fixtures.length >= 6);
  assert.equal(new Set(fixtures.map(post => post.id)).size, fixtures.length);
  assert.ok(fixtures.every(post => post.caption.startsWith('[SIMULASI]')));
  assert.ok(fixtures.some(post => post.pinned));
  assert.ok(fixtures.some(post => !post.commentsEnabled));
  assert.ok(fixtures.some(post => post.existing === 0 && !post.pinned && post.commentsEnabled));
  assert.ok(fixtures.some(post => post.existing > 0 && !post.pinned && post.commentsEnabled));
  assert.ok(fixtures.some(post => post.liked));
  const otherIds = new Set(createFixtures('@another_demo').map(post => post.id));
  assert.ok(fixtures.every(post => !otherIds.has(post.id)));
  fixtures[1].existing = 99;
  assert.equal(createFixtures('@demo.reader_1')[1].existing, 0, 'each run gets fresh fixture objects');
  assert.throws(() => createFixtures('https://threads.com/@demo/post/abc'), /Target Threads/);
});

test('Threads exposes demo accounts and the real-device verification boundary', () => {
  assert.equal(threads.liveSupported, false);
  assert.equal(threads.id, 'threads');
  assert.equal(threads.sampleAccounts.length, 2);
  assert.ok(threads.sampleAccounts.every(account => /fiktif/.test(account.displayName)));
  assert.ok(threads.liveChecklist.length > 0);
});
