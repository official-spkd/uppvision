import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUi } from '../server/instagram-core.mjs';
import { profileIdentity, visiblePosts, detailControls, replyField, expandedComposer } from '../server/live/threads-core.mjs';
import { ThreadsAdapter } from '../server/live/threads.mjs';

const ui = xml => parseUi(`<hierarchy><node bounds="[0,0][1080,1920]">${xml}</node></hierarchy>`.replace(/<node(?=[ >])/g, '<node package="com.instagram.barcelona"'));
const profile = own => ui(`<node resource-id="profile_screen_ig_app_switcher"/><node resource-id="ProfilePicture" bounds="[840,254][1032,446]"/><node resource-id="ig_text" text="Contoh Media" bounds="[48,271][790,446]"/><node resource-id="ig_text" text="contoh.media" bounds="[48,482][369,535]"/>${own ? '<node text="Edit profile"/>' : ''}`);
const post = (owner, caption, top = 281) => `<node resource-id="feed_post_header" bounds="[0,${top}][1080,${top + 144}]"><node content-desc="${owner} posted"/></node><node resource-id="feed_post_text" bounds="[36,${top + 171}][996,${top + 400}]"><node text="${caption}"/></node>`;

test('Threads profile identity requires observed header evidence and own-profile marker for account reads', () => {
  assert.deepEqual(profileIdentity(profile(true), { own: true }), { username: 'contoh.media', displayName: 'Contoh Media' });
  assert.equal(profileIdentity(profile(false), { own: true }), null);
  assert.equal(profileIdentity(ui('<node text="contoh.media"/>')), null);
});

test('Threads posts pair caption with the preceding owner and keep unobserved facts unknown', () => {
  const posts = visiblePosts(ui(post('contoh.media', 'Catatan kegiatan membaca.') + post('akun.lain', 'Postingan lain.', 1200)), 'contoh.media');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].caption, 'Catatan kegiatan membaca.');
  for (const key of ['pinned', 'existing', 'liked', 'commentsEnabled', 'url']) assert.equal(posts[0][key], null);
  assert.equal(posts[0].id, visiblePosts(ui(post('contoh.media', 'Catatan kegiatan membaca.')), 'contoh.media')[0].id);
  assert.equal(posts[0].identityEvidence, 'owner-and-caption-only');
  assert.deepEqual(visiblePosts(ui('<node resource-id="feed_post_text"><node text="Tidak ada pemilik"/></node>'), 'contoh.media'), []);
});

test('Threads caption preceding its header in accessibility order is paired by screen position', () => {
  const nodes = ui('<node resource-id="feed_post_text" bounds="[0,500][1080,800]"><node text="Caption dahulu di XML"/></node><node resource-id="feed_post_header" bounds="[0,281][1080,425]"><node content-desc="contoh.media posted"/></node>');
  assert.equal(visiblePosts(nodes, 'contoh.media')[0].caption, 'Caption dahulu di XML');
});

test('Threads detail controls require permalink context and exact reply target', () => {
  const controls = '<node content-desc="Reply to contoh.media"/><node resource-id="feed_post_ufi_like_button" content-desc="Like" selected="false"/>';
  assert.deepEqual(detailControls(ui(controls), 'contoh.media'), { commentsEnabled: null, liked: null });
  assert.deepEqual(detailControls(ui(`<node resource-id="PermalinkScreen">${controls}</node>`), 'contoh.media'), { commentsEnabled: true, liked: false });
  assert.equal(detailControls(ui(`<node resource-id="PermalinkScreen">${controls}</node>`), 'akun.lain').commentsEnabled, null);
  assert.equal(replyField(ui('<node class="android.widget.EditText" resource-id="BdsSearchBarInput"/>')), null);
});

test('Threads adapter rejects incomplete preparation and preserves unrelated existing drafts', async () => {
  const adapter = new ThreadsAdapter({ serial: 'test-only' });
  adapter.sh = () => { throw new Error('Device should not be touched'); };
  await assert.rejects(adapter.prepare({ text: 'Contoh' }), /Target Threads/);
  await assert.rejects(adapter.submit({}));
  adapter.read = async () => ui('<node class="android.widget.EditText" resource-id="permalink_inline_composer" text="Draft yang sudah ada"/>');
  await assert.rejects(adapter.clearDraft(), /tidak dihapus otomatis/);
});

test('foreign app labels never satisfy Threads profile, post, or composer evidence', () => {
  const nodes = [...profile(true), ...ui(`<node resource-id="PermalinkScreen">${post('contoh.media', 'Teks peniru')}<node content-desc="Reply to contoh.media"/><node class="android.widget.EditText" resource-id="permalink_inline_composer"/></node>`)];
  for (const node of nodes) node.package = 'other.application';
  assert.equal(profileIdentity(nodes, { own: true }), null);
  assert.deepEqual(visiblePosts(nodes, 'contoh.media'), []);
  assert.deepEqual(detailControls(nodes, 'contoh.media'), { commentsEnabled: null, liked: null });
  assert.equal(replyField(nodes), null);
});

test('Threads inspection rejects a different profile before tapping or scrolling', async () => {
  const adapter = new ThreadsAdapter({ serial: 'test-only' });
  adapter.scan = async () => ({ current: { username: 'demo.account', displayName: 'Demo' } });
  adapter.targetProfile = async () => profile(false);
  adapter.sh = adapter.tap = () => { throw new Error('Must not interact with mismatched target'); };
  await assert.rejects(adapter.inspect({ target: 'another.target' }), /Identitas profil tujuan Threads belum cocok/);
});

test('Threads refuses to search when the device drops a character during typing', async () => {
  const adapter = new ThreadsAdapter({ serial: 'test-only' });
  const frames = [ui('<node content-desc="Search"/>'), ui('<node resource-id="BdsSearchBarInput" text=""/>'), ui('<node resource-id="BdsSearchBarInput" text="contoh.medai"/>')];
  adapter.read = async () => frames.shift();
  adapter.tap = adapter.typeText = async () => {};
  adapter.pause = async () => {};
  adapter.clearField = async () => {};
  frames.push(ui('<node resource-id="BdsSearchBarInput" text="contoh.medai"/>'));
  adapter.sh = async () => { throw new Error('Must not submit mismatched query'); };
  await assert.rejects(adapter.targetProfile('contoh.media'), /tidak cocok setelah pengetikan/);
});

test('observed expanded composer binds active sender, reply target and enabled Post control', () => {
  const nodes = ui('<node content-desc="Cancel"/><node text="Reply"/><node><node class="android.widget.EditText" resource-id="new_thread_screen_composer" text=""><node content-desc="Reply to contoh.media…"/></node><node class="android.widget.Button" content-desc="demo.account"/><node content-desc="demo.account profile photo"/></node><node resource-id="new_thread_screen_post_button"><node clickable="true" enabled="false"><node text="Post"/></node></node>');
  const empty = expandedComposer(nodes);
  assert.equal(empty.username, 'demo.account'); assert.equal(empty.target, 'contoh.media'); assert.equal(empty.button, null);
  nodes.find(node => node.clickable === 'true').enabled = 'true';
  assert.ok(expandedComposer(nodes).button);
});

test('durable Threads attempt claim excludes concurrent workers and persists pending state before sending', async t => {
  const journalDir = await mkdtemp(join(tmpdir(), 'threads-live-journal-'));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const first = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const second = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const proof = { id: 'one', username: 'demo.account', target: 'contoh.media', text: 'Komentar netral.', post: { id: 'unique-post' } };
  const results = await Promise.allSettled([first.reserveAttempt(proof), second.reserveAttempt(proof)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const record = JSON.parse(await readFile(first.attemptPath(proof), 'utf8'));
  assert.equal(record.status, 'pending'); assert.equal(record.text, proof.text);
  await assert.rejects(second.assertNoAttempt({ ...proof, text: 'Different text' }), /tidak boleh dikirim ulang/);
  await first.atomicRecord(first.attemptPath(proof), { ...record, status: 'sent', evidence: ['reopened'] });
  await assert.rejects(second.reserveAttempt(proof), /tidak boleh dikirim ulang/);
});

test('orphaned Threads lock after a crash permanently blocks automatic resend', async t => {
  const journalDir = await mkdtemp(join(tmpdir(), 'threads-live-crash-'));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const adapter = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const proof = { username: 'demo.account', target: 'contoh.media', post: { id: 'unique-post' } };
  await writeFile(`${adapter.attemptPath(proof)}.lock`, 'incomplete');
  await assert.rejects(adapter.reserveAttempt(proof), /tidak boleh dikirim ulang/);
});

test('Threads submit persists pending before one tap, rejects modified proofs, and never retries an uncertain send', async t => {
  const journalDir = await mkdtemp(join(tmpdir(), 'threads-live-submit-'));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const adapter = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const proof = { id: 'reviewed', serial: 'test-only', username: 'demo.account', target: 'contoh.media', text: 'Komentar netral.', post: { id: 'unique-post' }, status: 'prepared' };
  await adapter.atomicRecord(join(journalDir, 'prepared-test-only.json'), proof);
  let taps = 0, validations = 0;
  adapter.verifyDraft = async () => { validations++; return { composer: { button: {} }, parentScreenshot: 'parent.png' }; };
  adapter.tap = async () => {
    const persisted = JSON.parse(await readFile(adapter.attemptPath(proof), 'utf8'));
    assert.equal(persisted.status, 'pending'); assert.equal(persisted.text, proof.text);
    taps++;
  };
  adapter.pause = async () => {};
  adapter.screenshot = async () => 'after.png';
  await assert.rejects(adapter.submit({ ...proof, text: 'Changed after review' }), /Proof draft/);
  assert.equal(validations, 0); assert.equal(taps, 0);
  assert.equal((await adapter.submit(proof)).status, 'uncertain');
  assert.equal(taps, 1);
  await assert.rejects(adapter.submit(proof), /tidak boleh dikirim ulang/);
  assert.equal(taps, 1);
});

test('Threads post-tap error leaves uncertainty and its durable claim blocks any retry', async t => {
  const journalDir = await mkdtemp(join(tmpdir(), 'threads-live-uncertain-'));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const adapter = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const proof = { id: 'reviewed', serial: 'test-only', username: 'demo.account', target: 'contoh.media', text: 'Komentar netral.', post: { id: 'unique-post' }, status: 'prepared' };
  await adapter.atomicRecord(join(journalDir, 'prepared-test-only.json'), proof);
  adapter.verifyDraft = async () => ({ composer: { button: {} }, parentScreenshot: 'parent.png' });
  let taps = 0;
  adapter.tap = async () => { taps++; throw new Error('connection lost after input'); };
  await assert.rejects(adapter.submit(proof), /jangan kirim ulang/);
  assert.equal(taps, 1);
  assert.equal(JSON.parse(await readFile(adapter.attemptPath(proof), 'utf8')).status, 'uncertain');
  await assert.rejects(adapter.submit(proof), /tidak boleh dikirim ulang/);
  assert.equal(taps, 1);
});

test('Threads confirmation requires a reopened rendered own reply without pending/error UI', async t => {
  const journalDir = await mkdtemp(join(tmpdir(), 'threads-live-confirm-'));
  t.after(() => rm(journalDir, { recursive: true, force: true }));
  const adapter = new ThreadsAdapter({ serial: 'test-only', journalDir });
  const proof = { id: 'reviewed', serial: 'test-only', username: 'demo.account', target: 'contoh.media', text: 'Komentar netral.', post: { id: 'unique-post' } };
  adapter.screenshot = async path => path;
  adapter.sh = adapter.tap = async () => { throw new Error('Confirmation must never send'); };
  for (const status of ['Posting…', 'Sending...', 'Try again', 'Post failed']) {
    await adapter.atomicRecord(adapter.attemptPath(proof), { ...proof, status: 'uncertain' });
    adapter.openSelectedPost = async () => ui(`<node resource-id="PermalinkScreen">${post('demo.account', proof.text)}<node text="${status}"/></node>`);
    assert.equal((await adapter.verifySubmitted(proof)).status, 'uncertain', status);
    assert.equal(JSON.parse(await readFile(adapter.attemptPath(proof), 'utf8')).status, 'uncertain');
  }
  adapter.openSelectedPost = async () => ui(`<node resource-id="PermalinkScreen">${post('other.account', proof.text)}</node>`);
  assert.equal((await adapter.verifySubmitted(proof)).status, 'uncertain', 'the same text by another author is insufficient');
  adapter.openSelectedPost = async () => ui(`<node resource-id="PermalinkScreen">${post('demo.account', proof.text)}</node>`);
  assert.equal((await adapter.verifySubmitted(proof)).status, 'sent');
  const durable = JSON.parse(await readFile(adapter.attemptPath(proof), 'utf8'));
  assert.equal(durable.status, 'sent'); assert.equal(durable.evidence.length, 2);
  assert.ok(durable.verifiedAt);
});
