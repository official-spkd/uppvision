import test from 'node:test';
import assert from 'node:assert/strict';
import youtube, { normalizeTarget, createFixtures } from '../server/platforms/youtube.mjs';

const channel = 'UC0L1uV8pgO4pCAIBNGxxy5w';

test('YouTube handles and channel tabs normalize to the same stable handle', () => {
  for (const target of [
    ' @Demo_Channel ', 'demo_channel', 'https://www.youtube.com/@Demo_Channel',
    'youtube.com/@Demo_Channel/videos?si=example', 'https://m.youtube.com/@Demo_Channel/shorts/',
    'https://youtube.com/@Demo_Channel/community#latest',
  ]) assert.equal(normalizeTarget(target), '@demo_channel');
  assert.equal(normalizeTarget('https://youtube.com/@caf%C3%A9'), '@café');
  assert.equal(normalizeTarget('@Cafe\u0301'), '@café');
  assert.equal(normalizeTarget('@猫'), '@猫');
  assert.equal(normalizeTarget('@かな'), '@かな');
});

test('YouTube UC channel IDs retain case in direct IDs and URLs', () => {
  assert.equal(normalizeTarget(channel), channel);
  assert.equal(normalizeTarget(`https://youtube.com/channel/${channel}/videos`), channel);
  assert.equal(normalizeTarget(`youtube.com/channel/${channel}/`), channel);
  assert.notEqual(normalizeTarget(channel), channel.toLowerCase());
  for (const invalid of ['UC123', `${channel}a`, 'UC!!!!!!!!!!!!!!!!!!!!!!', 'uc0L1uV8pgO4pCAIBNGxxy5w']) {
    assert.throws(() => normalizeTarget(`https://youtube.com/channel/${invalid}`), /ID channel/);
  }
  assert.throws(() => normalizeTarget('UC123'), /ID channel/);
});

test('YouTube rejects video, playlist, custom legacy and malformed channel paths', () => {
  for (const target of [
    'https://youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://youtube.com/shorts/abc',
    'https://youtube.com/live/abc', 'https://youtube.com/playlist?list=abc',
    'https://youtube.com/@demo/watch', 'https://youtube.com/@demo/videos/extra',
    'https://youtube.com/@demo?list=abc', 'https://youtube.com/@demo?v=abc',
    'https://youtube.com/@demo//', 'https://youtube.com/@demo%2Fvideos%2Fextra',
    'https://youtube.com/c/demo', 'https://youtube.com/user/demo', 'https://youtube.com',
    'https://youtube.com/@bad%ZZ',
  ]) assert.throws(() => normalizeTarget(target), /YouTube|channel/, target);
});

test('YouTube rejects deceptive hosts, credentials, ports and invalid handle syntax', () => {
  for (const target of [
    'https://youtube.com.evil.test/@demo', 'https://evil.test/@demo',
    'https://youtube.com@evil.test/@demo', 'https://user@youtube.com/@demo',
    'https://youtube.com:9000/@demo', 'ftp://youtube.com/@demo',
    'https://youtube.com\\@evil.test/@demo',
    '', ' ', null, undefined, 13, {}, '@', '@ab', '@a b', '@-demo', '@demo_', '@demo.',
    '@demo/other', '@demo?query', '@demo#hash', '@demo@other', `@${'a'.repeat(31)}`,
  ]) assert.throws(() => normalizeTarget(target), /YouTube|channel/, String(target));
});

test('YouTube rejects raw traversal and encoded separators before the URL parser can change the channel', () => {
  for (const target of [
    'https://youtube.com/watch/../@other', 'https://youtube.com/@demo/./',
    'https://youtube.com/@demo/%2e%2e/@other', 'https://youtube.com/@demo/.%2E/@other',
    'https://youtube.com/@demo%2Fvideos', 'https://youtube.com/@demo%5Cvideos',
    'https://youtube.com//@demo', 'https://youtube.com/@demo//videos',
    'https://youtube.com\\@demo', 'https:////youtube.com/@demo',
    `https://youtube.com/channel/${channel}/../${channel}`,
  ]) assert.throws(() => normalizeTarget(target), /YouTube|channel/, target);
  assert.equal(normalizeTarget('https://youtube.com/@caf%C3%A9/videos?si=share'), '@café', 'Unicode handles still accept percent-encoded letters');
});

test('YouTube fixtures are deterministic, canonicalized and isolated between channels', () => {
  const items = createFixtures('@Demo_Channel');
  assert.ok(items.length >= 6);
  assert.deepEqual(items, createFixtures('https://youtube.com/@demo_channel/videos'));
  assert.deepEqual(createFixtures(channel), createFixtures(`https://youtube.com/channel/${channel}`));
  const others = new Set(createFixtures('@Other_Channel').map(item => item.id));
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.ok(items.every(item => !others.has(item.id)));
  assert.ok(items.some(item => !item.commentsEnabled));
  assert.ok(items.some(item => item.pinned && /Simulasi/.test(item.caption)));
  assert.ok(items.some(item => item.existing > 0));
  for (const item of items) {
    assert.equal(typeof item.caption, 'string');
    assert.equal(typeof item.pinned, 'boolean');
    assert.equal(typeof item.commentsEnabled, 'boolean');
    assert.equal(typeof item.liked, 'boolean');
    assert.ok(Number.isInteger(item.existing) && item.existing >= 0);
  }
  items[0].liked = !items[0].liked;
  assert.notDeepEqual(items, createFixtures('@demo_channel'), 'each fixture request gets independent records');
});

test('YouTube metadata keeps live execution disabled and demo accounts explicitly fictional', () => {
  assert.equal(youtube.id, 'youtube');
  assert.equal(youtube.item, 'video');
  assert.equal(youtube.action, 'komentar');
  assert.equal(youtube.liveSupported, false);
  assert.equal(youtube.sampleAccounts.length, 2);
  assert.equal(new Set(youtube.sampleAccounts.map(account => account.username)).size, 2);
  assert.ok(youtube.sampleAccounts.every(account => /fiktif/.test(account.displayName)));
  assert.ok(youtube.liveChecklist.some(item => /simulasi.*belum/.test(item)));
});
