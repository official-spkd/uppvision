import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUi } from '../server/instagram-core.mjs';
import { pageIdentity, ownIdentity, composer, postIdentity, verifyDraft, sendButton, sameReel, renderedComment } from '../server/live/facebook-core.mjs';
import { FacebookAdapter } from '../server/live/facebook.mjs';
const ui = nodes => parseUi(`<hierarchy>${nodes.replaceAll('<node ', '<node package="com.facebook.katana" ')}</hierarchy>`);
const pageUi = ui('<node content-desc="Report Page"/><node text="TV Rakyat’s Page link"/><node text="https://www.facebook.com/tvrakyatofficial"/>');
const page = pageIdentity(pageUi, 'tvrakyatofficial');

test('Facebook requires explicit Page metadata and matching URL, not professional category or followers', () => {
  assert.equal(page.targetType, 'page');
  assert.equal(page.targetLabel, 'TV Rakyat');
  assert.throws(() => pageIdentity(ui('<node text="News &amp; media website"/><node text="1.9K followers"/><node text="https://www.facebook.com/tvrakyatofficial"/>'), 'tvrakyatofficial'), /belum terbukti/);
  assert.throws(() => pageIdentity(ui('<node content-desc="Report profile"/><node text="TV Rakyat’s profile link"/><node text="https://www.facebook.com/tvrakyatofficial"/>'), 'tvrakyatofficial'), /belum terbukti/);
  assert.throws(() => pageIdentity(pageUi, 'other.page'), /tidak cocok/);
  const foreign = pageUi.map(node => ({ ...node, package: 'com.other.app' }));
  assert.throws(() => pageIdentity(foreign, 'tvrakyatofficial'), /belum terbukti/);
});
test('Facebook own account ID comes from its own profile link, not Instagram handle or display name', () => {
  const nodes = ui('<node text="Your profile link"/><node text="https://www.facebook.com/demo.account"/><node content-desc="Copy Demo Account’s link"/>');
  assert.deepEqual(ownIdentity(nodes), { username: 'demo.account', displayName: 'Demo Account', url: 'https://www.facebook.com/demo.account', active: true });
  assert.throws(() => ownIdentity(ui('<node text="demo.instagram"/><node text="Demo Account"/>')), /belum terbaca/);
  assert.throws(() => ownIdentity(nodes.map(node => ({ ...node, package: 'com.other.app' }))), /belum terbaca/);
});
const postUi = extra => ui(`<node content-desc="TV Rakyat’s post"/><node text="23m•Shared with: Public"/><node class="android.view.ViewGroup" text="Caption lengkap contoh kegiatan membaca di taman kota." content-desc="Caption lengkap contoh kegiatan membaca di taman kota."/>${extra}`);
test('Facebook post fingerprint binds full caption to verified Page and leaves unread counts unknown', () => {
  const nodes = postUi('<node class="android.widget.AutoCompleteTextView" text="Comment as Demo Account" content-desc="Comment as Demo Account"/>');
  const post = postIdentity(nodes, page);
  assert.equal(post.commentsEnabled, true);
  assert.equal(post.existing, null);
  assert.equal(post.liked, null);
  assert.equal(post.countsComplete, false);
  assert.equal(post.identityComplete, false);
  assert.equal(post.pinned, null);
  assert.equal(post.id, postIdentity(nodes, page).id);
  assert.throws(() => postIdentity(nodes, { ...page, targetLabel: 'Other Page' }), /Pemilik/);
  assert.equal(composer(nodes).displayName, 'Demo Account');
  assert.equal(composer(nodes.map(node => ({ ...node, package: 'com.other.app' }))), null);
});
test('Facebook draft verification cannot confuse a placeholder or changed text with a successful send', async () => {
  const draft = postUi('<node class="android.widget.AutoCompleteTextView" text="Contoh draft"/>');
  assert.equal(verifyDraft(draft, 'Contoh draft').draft, 'Contoh draft');
  assert.throws(() => verifyDraft(draft, 'Lain'), /belum cocok/);
  assert.throws(() => verifyDraft(postUi('<node class="android.widget.AutoCompleteTextView" text="Comment as Demo Account"/>'), 'Comment as Demo Account'), /belum cocok/);
  const adapter = new FacebookAdapter({ serial: 'test-device' });
  adapter.sh = () => assert.fail('submit must not touch a device before send is verified');
  await assert.rejects(adapter.submit({ text: 'Contoh draft' }), /Bukti draft/);
  await assert.rejects(adapter.prepare({ text: 'Contoh draft' }), /Periksa Halaman/);
});
test('Facebook composer preserves sender in description while reading actual draft text and scopes Send to its vicinity', () => {
  const nodes = postUi('<node class="android.widget.AutoCompleteTextView" text="Contoh draft" content-desc="Comment as Demo Account" bounds="[36,1467][1044,1637]"/><node class="android.widget.Button" content-desc="Send" enabled="true" clickable="true" bounds="[948,1643][1068,1763]"/>');
  assert.equal(composer(nodes).displayName, 'Demo Account');
  assert.equal(verifyDraft(nodes, 'Contoh draft').draft, 'Contoh draft');
  assert.ok(sendButton(nodes));
  assert.equal(sendButton(nodes.map(node => node['content-desc'] === 'Send' ? { ...node, package: 'other.app' } : node)), null);
  assert.equal(sendButton(nodes.map(node => node['content-desc'] === 'Send' ? { ...node, bounds: '[948,100][1068,200]' } : node)), null);
});

async function fakeAdapter(t) {
  const pendingDir = await mkdtemp(join(tmpdir(), 'facebook-attempt-test-'));
  t.after(() => rm(pendingDir, { recursive: true, force: true }));
  const adapter = new FacebookAdapter({ serial: 'test-device', pendingDir });
  const input = text => postUi(`<node class="android.widget.AutoCompleteTextView" text="${text}" content-desc="Comment as Demo Account" bounds="[36,1467][1044,1637]"/><node class="android.widget.Button" content-desc="Send" enabled="true" clickable="true" bounds="[948,1643][1068,1763]"/>`);
  const account = { username: 'demo.account', displayName: 'Demo Account', url: 'https://www.facebook.com/demo.account' };
  const post = postIdentity(input('Comment as Demo Account'), page);
  adapter.inspection = { ...page, account, posts: [post] };
  let draft = 'Comment as Demo Account';
  let sends = 0;
  adapter.read = async () => input(draft);
  adapter.pause = async () => {};
  adapter.typeText = async text => { draft = text; };
  adapter.tap = async node => { if (node['content-desc'] === 'Send') { sends++; const records = [...adapter.proofs.values()]; const disk = JSON.parse(await readFile(join(pendingDir, `${records[0].key}.json`), 'utf8')); assert.equal(disk.status, 'pending', 'pending is durable before Send'); } };
  return { adapter, plan: { target: page.target, post, account, text: 'Contoh draft' }, sends: () => sends, setDraft: text => { draft = text; } };
}
test('Facebook claims pending durably before exactly one Send and refuses uncertain retry or forged proof', async t => {
  const { adapter, plan, sends } = await fakeAdapter(t);
  const proof = await adapter.prepare(plan);
  await assert.rejects(adapter.submit({ ...proof, text: 'Tampered' }), /Bukti draft/);
  assert.equal(sends(), 0);
  assert.equal((await adapter.submit(proof)).status, 'uncertain');
  assert.equal(sends(), 1);
  await assert.rejects(adapter.submit(proof), /Bukti draft/);
  assert.equal(sends(), 1);
  const disk = JSON.parse(await readFile(join(adapter.pendingDir, `${proof.key}.json`), 'utf8'));
  assert.equal(disk.status, 'uncertain');
});
test('Facebook preserves existing drafts and exclusive persistent attempt prevents a restarted adapter from drafting twice', async t => {
  const { adapter, plan, setDraft } = await fakeAdapter(t);
  setDraft('Existing private draft');
  await assert.rejects(adapter.prepare(plan), /draft sebelumnya/);
  setDraft('Comment as Demo Account');
  const proof = await adapter.prepare(plan);
  setDraft('Comment as Demo Account');
  const restarted = new FacebookAdapter({ serial: 'test-device', pendingDir: adapter.pendingDir });
  restarted.inspection = adapter.inspection;
  restarted.read = adapter.read;
  restarted.tap = () => assert.fail('must not type or tap on duplicate durable attempt');
  await assert.rejects(restarted.prepare(plan), /Sudah ada percobaan/);
  assert.equal(JSON.parse(await readFile(join(adapter.pendingDir, `${proof.key}.json`), 'utf8')).attemptId, proof.attemptId);
});

const commentUi = (author = 'Demo Account', extra = '') => ui(`<node class="android.view.ViewGroup"><node class="android.view.ViewGroup"><node class="android.widget.ImageView" content-desc="${author} profile picture"/><node class="android.widget.Button" text="${author}" content-desc="${author}"/><node class="android.view.ViewGroup" text="1m"/><node class="android.view.ViewGroup"><node class="android.widget.Button" text="Contoh draft" content-desc="Contoh draft"/></node></node><node class="android.widget.Button" content-desc="Reply to Demo's comment, button. Double tap to reply to the comment."/>${extra}</node><node class="android.widget.AutoCompleteTextView" text="Comment as Demo Account" content-desc="Comment as Demo Account"/>`);
const reelUi = record => ui(`<node class="android.widget.Button" content-desc="Reel details"/><node class="android.widget.Button" content-desc="${record.targetLabel}, Privacy setting Public"/><node class="android.widget.Button" content-desc="${record.caption}"/><node class="android.widget.Button" content-desc="1 comment"/>`);

test('Facebook confirmation rejects optimistic Posting, errors, wrong author and unrelated next-reel captions', () => {
  const record = { displayName: 'Demo Account', text: 'Contoh draft', targetLabel: 'TV Rakyat', caption: 'Caption complete' };
  assert.ok(renderedComment(commentUi(), record));
  assert.equal(renderedComment(commentUi('Different Author'), record), null);
  assert.equal(renderedComment(commentUi('Demo Account', '<node text="Posting..."/>'), record), null);
  assert.equal(renderedComment(commentUi('Demo Account', '<node text="Retry"/>'), record), null);
  assert.equal(renderedComment(commentUi().map(node => ({ ...node, package: 'other.app' })), record), null);
  assert.equal(sameReel(reelUi(record), record), true);
  assert.equal(sameReel(reelUi(record), { ...record, targetLabel: 'Another Page' }), false);
  const upcomingOnly = reelUi(record).map(node => node['content-desc'] === record.caption ? { ...node, class: 'android.view.ViewGroup' } : node);
  assert.equal(sameReel(upcomingOnly, record), false);
});

test('Facebook reconcile reopens matching permalink and confirms rendered author/text without another Send', async t => {
  const { adapter, plan, sends } = await fakeAdapter(t);
  const proof = await adapter.prepare({ ...plan, postUrl: 'https://www.facebook.com/share/r/example123/' });
  await adapter.submit(proof);
  let reads = 0;
  let reopened = false;
  adapter.openUrl = async url => { assert.equal(url, proof.postUrl); reopened = true; };
  adapter.read = async () => reads++ === 0 ? reelUi(proof) : commentUi();
  adapter.screenshot = async path => path;
  const confirmed = await adapter.reconcile(proof);
  assert.equal(confirmed.status, 'sent');
  assert.equal(reopened, true);
  assert.equal(confirmed.evidence.reopened, true);
  assert.equal(confirmed.evidence.author, 'Demo Account');
  assert.equal(sends(), 1);
  assert.equal(JSON.parse(await readFile(join(adapter.pendingDir, `${proof.key}.json`), 'utf8')).status, 'sent');
  await assert.rejects(adapter.submit(proof), /Bukti draft/);
  assert.equal(sends(), 1);
});

test('Facebook reconcile keeps uncertain when same post has only a posting placeholder or other author', async t => {
  const { adapter, plan, sends } = await fakeAdapter(t);
  const proof = await adapter.prepare({ ...plan, postUrl: 'https://www.facebook.com/share/r/example123/' });
  await adapter.submit(proof);
  for (const screen of [commentUi('Demo Account', '<node text="Posting..."/>'), commentUi('Other Account')]) {
    let reads = 0;
    adapter.openUrl = async () => {};
    adapter.read = async () => reads++ === 0 ? reelUi(proof) : screen;
    adapter.screenshot = () => assert.fail('unverified comment must not receive a sent screenshot');
    assert.equal((await adapter.reconcile(proof)).status, 'uncertain');
  }
  assert.equal(sends(), 1);
  assert.equal(JSON.parse(await readFile(join(adapter.pendingDir, `${proof.key}.json`), 'utf8')).status, 'uncertain');
});

test('Facebook Page fallback refuses a changed newest post and confirms only matching reopened post and author', async t => {
  const { adapter, plan, sends } = await fakeAdapter(t);
  const proof = await adapter.prepare({ ...plan, postUrl: 'https://www.facebook.com/share/r/example123/' });
  await adapter.submit(proof);
  adapter.inspect = async () => ({ ...adapter.inspection, posts: [{ ...plan.post, id: 'other-post' }] });
  adapter.read = () => assert.fail('changed post must not read or confirm unrelated comments');
  assert.equal((await adapter.reconcileViaPage(proof)).status, 'uncertain');
  adapter.inspect = async () => adapter.inspection;
  adapter.read = async () => [...ui('<node content-desc="TV Rakyat’s post"/>'), ...commentUi()];
  adapter.screenshot = async path => path;
  const result = await adapter.reconcileViaPage(proof);
  assert.equal(result.status, 'sent');
  assert.equal(result.evidence.reopenedVia, 'verified-page-post');
  assert.equal(sends(), 1);
});
