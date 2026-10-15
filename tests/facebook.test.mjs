import test from 'node:test';
import assert from 'node:assert/strict';
import facebook, { normalizeTarget, createFixtures } from '../server/platforms/facebook.mjs';

test('Facebook profile aliases normalize to one canonical target', () => {
  const expected = 'https://www.facebook.com/demo.halaman';
  for (const input of ['demo.Halaman', ' @Demo.Halaman ', 'facebook.com/Demo.Halaman', 'https://www.facebook.com/Demo.Halaman/', 'http://m.facebook.com/demo.halaman?mibextid=demo', 'https://mbasic.facebook.com/demo.halaman?utm_source=demo#about']) {
    assert.equal(normalizeTarget(input), expected, input);
  }
  assert.equal(normalizeTarget(expected), expected);
});

test('Facebook numeric profile IDs are preserved without numeric precision loss', () => {
  const id = '100123456789012345';
  for (const input of [`profile.php?id=${id}`, `https://m.facebook.com/profile.php?id=${id}&ref=demo`, `facebook.com/profile.php?id=${id}`]) {
    assert.equal(normalizeTarget(input), `https://www.facebook.com/profile.php?id=${id}`);
  }
  for (const input of ['profile.php', 'profile.php?id=', 'profile.php?id=hello', 'profile.php?id=-1', 'profile.php?id=0', 'profile.php?id=1&id=2']) assert.throws(() => normalizeTarget(input), /id Facebook/, input);
});

test('Facebook target rejects ambiguous, unrelated and unsupported links', () => {
  for (const input of ['', null, {}, 'dua kata', 'https://example.com/page', 'https://facebook.com.evil.test/page', 'https://www.facebook.com@evil.test/page', 'https://user:pass@facebook.com/page', 'ftp://facebook.com/page', 'https://facebook.com:999/page', 'https://facebook.com/groups/123', 'https://facebook.com/page/posts/123', 'https://facebook.com/story.php?story_fbid=123&id=456', 'https://facebook.com/profile.php?id=123&story_fbid=456', 'https://facebook.com/page?fbid=123', 'https://facebook.com/', 'https://facebook.com/watch', 'https://facebook.com/page/../other', 'https://facebook.com/%70age', 'https://facebook.com/page//', 'https://facebook.com\\evil.test/page', '@@page', 'page..name']) {
    assert.throws(() => normalizeTarget(input), /facebook/i, String(input));
  }
});

test('Facebook fixtures are stable per target, independent and cover skip/top-up cases', () => {
  const first = createFixtures('demo.halaman');
  assert.deepEqual(first, createFixtures('https://m.facebook.com/Demo.Halaman/'));
  assert.notEqual(first[0].id, createFixtures('halaman.lain')[0].id);
  assert.ok(first.length >= 6);
  assert.equal(new Set(first.map(post => post.id)).size, first.length);
  assert.ok(first.some(post => post.pinned));
  assert.ok(first.some(post => !post.commentsEnabled));
  assert.ok(first.some(post => post.liked));
  assert.ok(first.some(post => post.existing > 0));
  for (const post of first) {
    assert.match(post.caption, /^Simulasi:/);
    assert.equal(typeof post.commentsEnabled, 'boolean');
    assert.equal(typeof post.pinned, 'boolean');
    assert.ok(Number.isInteger(post.existing) && post.existing >= 0);
  }
  first[0].existing = 99;
  assert.equal(createFixtures('demo.halaman')[0].existing, 0);
  assert.equal(facebook.liveSupported, false);
  assert.equal(facebook.sampleAccounts.length, 2);
  assert.ok(facebook.liveChecklist.length > 0);
  assert.equal(facebook.targetType, 'page');
  assert.equal(facebook.requiresLivePageVerification, true);
  assert.match(facebook.targetHint, /bukan profil pribadi/);
});
