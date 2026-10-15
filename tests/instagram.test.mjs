import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, switcherAccounts, gridPosts, gridTiles, composerAccount, validatePlan, postFingerprint, likeState, threadComments, postCaption, commentCount, tileIdentity, saveState, repostButton, repostDialog, repostConfirmed, savedSheet, feedPreview, shareContacts, snackbarMessage, repostedNotice, contextMenu, metaAccountScreen, metaDoneButton } from '../server/instagram-core.mjs';
import { InstagramManager, BlockedError, NetworkError, SkipPostError } from '../server/instagram.mjs';
import { JobLogs } from '../server/joblog.mjs';
import { MAX_ACCOUNTS } from '../src/instagram-target.mjs';

const id = suffix => `com.instagram.android:id/${suffix}`;
const deviceAccounts = [{ serial: 'phone1', accounts: [{ username: 'account.one', disabled: false }, { username: 'disabled', disabled: true }] }];
const entry = { serial: 'phone1', username: 'account.one', target: '@target.one', posts: 1, comments: 1, tone: 'positif' };
const valid = { accounts: [entry] };

test('reads account rows rather than suggestions and detects deactivated accounts in nested UI', () => {
  const nodes = parseUi(`<hierarchy><node bounds="[0,0][1080,1920]"><node clickable="true" content-desc="account.one, 2 comments" bounds="[20,400][1000,600]"><node text="account.one"/><node text="2 comments"/></node><node clickable="true" content-desc="account.two" bounds="[20,600][1000,800]"><node text="account.two"/><node text="Deactivated"/></node><node clickable="true" content-desc="Add Instagram account"><node text="Add Instagram account"/></node><node resource-id="${id('suggested_entity_card_name')}" text="not_a_logged_in_account"/></node></hierarchy>`);
  assert.deepEqual(switcherAccounts(nodes).map(({ node, ...a }) => a), [{ username: 'account.one', disabled: false }, { username: 'account.two', disabled: true }]);
  assert.throws(() => parseUi('<!DOCTYPE hierarchy><hierarchy/>'));
});
test('finds grid tiles through nested containers, skips visible pinned badges, and verifies composer username', () => {
  const nodes = parseUi(`<hierarchy><node resource-id="${id('media_set_row_content_identifier')}"><node><node><node resource-id="${id('image_button')}" clickable="true" bounds="[0,300][350,750]"/><node content-desc="Pinned"/></node></node><node><node resource-id="${id('image_button')}" clickable="true" bounds="[360,300][710,750]"/></node></node><node resource-id="${id('layout_comment_thread_edittext_multiline')}" text="Berkomentar sebagai account.one…"/></hierarchy>`);
  assert.equal(gridPosts(nodes).length, 1);
  assert.equal(composerAccount(nodes).username, 'account.one');
  nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Tambahkan komentar untuk target.one';
  const otherVariant = composerAccount(nodes);
  assert.equal(otherVariant.username, null); assert.equal(otherVariant.target, 'target.one');
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', otherVariant), false);
  manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() });
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', otherVariant), true);
  assert.equal(manager.composerMatches('phone1', 'target.one', 'target.one', otherVariant), false);
  // Instagram clips a long owner name inside the composer hint. The visible prefix must still match,
  // because otherwise every send on that post is downgraded to "belum pasti".
  const field = nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline'));
  field.text = 'Add a comment for target.one…';
  assert.equal(composerAccount(nodes).target, 'target.one', 'a complete name followed by the ellipsis keeps every character');
  field.text = 'Add a comment for targ…';
  const clipped = composerAccount(nodes);
  assert.equal(clipped.target, 'targ'); assert.equal(clipped.targetTruncated, true);
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', clipped), true);
  assert.equal(manager.composerMatches('phone1', 'account.one', 'tarzan.two', clipped), false, 'another owner sharing the prefix never matches');
  field.text = 'Add a comment for targ';
  assert.equal(composerAccount(nodes).targetTruncated, false, 'without the UI ellipsis a shorter name is not a prefix');
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), false);
  field.text = 'Tambahkan komentar untuk target…';
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), true);
  // A turn of four links easily outlives the mark. Naming the account in the composer is fresh
  // evidence, so it must renew the mark instead of letting the turn die at the five minute mark.
  field.text = 'Berkomentar sebagai account.one…';
  manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() - 10 * 60000 });
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), true);
  assert.ok(Date.now() - manager.verifiedAccounts.get('phone1').at < 60000, 'the composer must renew the mark');
  // The owner-only hint still needs a live mark: an expired one is refused, and another account never passes.
  field.text = 'Add a comment for target.one…';
  manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() - 10 * 60000 });
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), false, 'an expired mark cannot back the owner-only hint');
  manager.verifiedAccounts.set('phone1', { username: 'other.one', at: Date.now() });
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), false, 'a mark for another account never matches');
  manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() });
  nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Mulai percakapan...';
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), true);
  nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Join the conversation…';
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), true);
  nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Apa pendapat Anda tentang ini?';
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(nodes)), true);
  const draft = [...nodes, { 'resource-id': id('layout_comment_thread_post_button_icon'), enabled: 'true' }];
  draft.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Draft lama yang belum dikirim';
  assert.equal(manager.composerMatches('phone1', 'account.one', 'target.one', composerAccount(draft)), false, 'a visible Send button means an existing draft');
  nodes.find(n => n['resource-id'] === id('layout_comment_thread_edittext_multiline')).text = 'Some existing draft';
  assert.equal(composerAccount(nodes).username, null);
});
test('validates one target, post count, comment target and tone per account', () => {
  assert.deepEqual(validatePlan(valid, deviceAccounts).accounts[0], { serial: 'phone1', username: 'account.one', target: 'target.one', posts: 1, comments: 1, tone: 'positif' });
  for (const change of [
    { serial: 'phone2' }, { username: 'disabled' }, { target: 'target;reboot' }, { target: 'https://example.com/' }, { target: '' },
    { target: 'account.one' }, { posts: 0 }, { posts: 51 }, { comments: 0 }, { comments: 101 }, { tone: 'marah' }, { posts: '3' }
  ]) assert.throws(() => validatePlan({ accounts: [{ ...entry, ...change }] }, deviceAccounts));
  assert.throws(() => validatePlan({ accounts: [] }, deviceAccounts));
  assert.equal(validatePlan({ accounts: [{ ...entry, posts: 50, comments: 100, tone: 'negatif' }] }, deviceAccounts).accounts[0].comments, 100);
});
test('rejects a plan above the account ceiling and states the limit instead of asking to pick an account', () => {
  const many = Array.from({ length: MAX_ACCOUNTS + 1 }, (_, i) => ({ username: `account.${String(i).padStart(3, '0')}`, disabled: false }));
  const devices = [{ serial: 'phone1', accounts: many }];
  const accounts = many.map(a => ({ serial: 'phone1', username: a.username, target: '@target.one', posts: 1, comments: 1, tone: 'positif' }));
  assert.equal(validatePlan({ accounts: accounts.slice(0, MAX_ACCOUNTS) }, devices).accounts.length, MAX_ACCOUNTS);
  assert.throws(() => validatePlan({ accounts }, devices), /Maksimal 100 akun per pekerjaan; pilihan berisi 101 akun/);
  // An empty selection keeps its own message; the two problems must not be conflated.
  assert.throws(() => validatePlan({ accounts: [] }, devices), /Pilih minimal satu akun Instagram\./);
});
test('post fingerprint ignores changing like counts and rejects a different profile', () => {
  const nodes = [{ 'resource-id': id('row_feed_photo_imageview'), 'content-desc': 'Reel by target.one, 1 like, September 15' }];
  const first = postFingerprint(nodes, 'target.one');
  nodes[0]['content-desc'] = 'Reel by target.one, 29 likes, September 15';
  assert.equal(postFingerprint(nodes, 'target.one'), first);
  assert.throws(() => postFingerprint(nodes, 'someone.else'));
});
test('orders grid tiles by row and column, reads like state and author-tagged comments', () => {
  const row = (r, tiles) => `<node resource-id="${id('media_set_row_content_identifier')}">${tiles}</node>`;
  const tile = (r, c, extra = '') => `<node><node resource-id="${id('image_button')}" clickable="true" content-desc="Reel dari target di Baris ${r}, Kolom ${c}" bounds="[${(c - 1) * 360},${r * 500}][${c * 360 - 4},${r * 500 + 470}]"/>${extra}</node>`;
  const grid = parseUi(`<hierarchy><node>${row(2, tile(2, 1))}${row(1, tile(1, 2) + tile(1, 1, '<node content-desc="Ikon postingan yang disematkan"/>'))}</node></hierarchy>`);
  assert.deepEqual(gridTiles(grid).map(t => [t.key, t.pinned]), [['1:1', true], ['1:2', false], ['2:1', false]]);
  assert.equal(gridPosts(grid).length, 2);
  const post = parseUi(`<hierarchy><node>
    <node resource-id="${id('row_feed_button_like')}" content-desc="Suka" selected="false" bounds="[36,765][108,903]"/>
    <node resource-id="${id('row_feed_button_comment')}" content-desc="Komentar" bounds="[182,765][254,903]"/>
    <node class="com.instagram.ui.widget.textview.IgTextLayoutView" text="target.one Banjir melanda Bekasi.… selengkapnya" bounds="[36,903][1080,1015]"/>
    <node class="com.instagram.ui.widget.textview.IgTextLayoutView" text="target.one Postingan lain" bounds="[36,1903][1080,2015]"/>
    <node resource-id="${id('row_feed_button_like')}" content-desc="Batal suka" bounds="[36,1765][108,1903]"/></node></hierarchy>`);
  assert.equal(likeState(post).status, 'not_liked');
  assert.equal(postCaption(post, 'target.one'), 'Banjir melanda Bekasi');
  post[1]['content-desc'] = 'Batal suka'; assert.equal(likeState(post).status, 'already');
  post[1]['content-desc'] = 'Sesuatu'; assert.equal(likeState(post).status, 'unknown', 'never tap a like button it cannot read');
  const thread = parseUi(`<hierarchy><node><node content-desc="account.one mengatakan Komentar pertama"/><node text="someone said Nice"/><node content-desc="target.one mengatakan Balasan pemilik"/></node></hierarchy>`);
  assert.deepEqual(threadComments(thread, 'target.one'), [{ author: 'account.one', text: 'Komentar pertama' }, { author: 'someone', text: 'Nice' }]);
});

test('a like is verified when the button switches to its liked state', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const button = liked => ({ 'resource-id': id('row_feed_button_like'), 'content-desc': liked ? 'Disukai' : 'Suka', selected: String(liked), bounds: '[36,765][108,903]' });
  const comment = { 'resource-id': id('row_feed_button_comment'), bounds: '[182,765][254,903]' };
  let tapped = 0;
  manager.tap = async () => { tapped++; };
  manager.ui = async () => [button(true), comment];
  assert.equal(await manager.likePost('phone1', [button(false), comment]), 'liked');
  assert.equal(await manager.likePost('phone1', [button(true), comment]), 'already');
  assert.equal(tapped, 1, 'an already liked post is never tapped (that would unlike it)');
});
const COMPOSER = id('layout_comment_thread_edittext_multiline'), SEND = id('layout_comment_thread_post_button_icon');
function fakeRunner({ existing = 0, uncertain = false, stopBeforeSend = false, blockedOn = null, devices = ['phone1', 'phone2'], owners = {}, complete = true } = {}) {
  const owner = serial => owners[serial] || 'account.one';
  const manager = new InstagramManager({ statePath: '/unused', devices: () => devices.map(serial => ({ serial, status: 'device' })) });
  const drafts = new Map(), submitted = new Map(), sent = [], requests = [];
  manager.deliveryPause = async () => {}; manager.inputPause = async () => {}; manager.imeShown = async () => false;
  manager.save = async () => {}; manager.back = async () => {}; manager.wait = async () => {};
  manager.readScreen = async () => ''; manager.logs.write = () => {}; manager.logs.create = async () => null; manager.closeSheets = async () => []; manager.prepareDevice = async () => {};
  manager.net = { macOnline: async () => true, phoneOnline: async () => true, restoreInternet: async () => ({ online: true }) };
  manager.accountSheet = async () => {};
  let current = 0;
  manager.lockPosts = async (job, entry) => ({ posts: Array.from({ length: entry.posts }, (_, index) => ({ index, identity: `post-${index}`, twin: 1 })), pinned: 0 });
  manager.openPost = async (serial, account, target, postRef) => { current = postRef.index; return { nodes: [], fingerprint: `post-${postRef.index}` }; };
  manager.likePost = async () => 'liked';
  manager.openThread = async () => ({ caption: 'Banjir melanda Bekasi', loaded: true, complete, mine: [...Array.from({ length: existing }, (_, i) => `lama ${i}`), ...sent.filter(x => x.serial === 'phone1' && x.post === current).map(x => x.text)], others: ['orang lain'] });
  manager.generate = async request => { requests.push(request); return { suasana: 'bencana', tone: request.tone, comments: Array.from({ length: request.count }, (_, i) => `Komentar ${requests.length}-${i}`) }; };
  manager.typeComment = async (serial, text) => { submitted.delete(serial); drafts.set(serial, text); if (stopBeforeSend) manager.stopRequested = true; };
  manager.tap = async (serial, node) => {
    if (node['resource-id'] !== SEND) { submitted.delete(serial); return; }
    assert.ok(manager.state.history.at(-1).status === 'sending', 'reserve the attempt before tapping Send');
    if (blockedOn === serial) { submitted.set(serial, 'blocked'); drafts.delete(serial); return; }
    sent.push({ serial, text: drafts.get(serial), post: current }); submitted.set(serial, drafts.get(serial)); drafts.delete(serial);
  };
  manager.ui = async serial => {
    if (submitted.has(serial) && !drafts.has(serial)) {
      const text = submitted.get(serial);
      if (text === 'blocked') return [{ text: 'Coba lagi nanti' }];
      return [{ 'resource-id': COMPOSER, focused: 'true', text: `Comment as ${owner(serial)}…` }, ...(uncertain ? [] : [{ 'content-desc': `${owner(serial)} mengatakan ${text}` }])];
    }
    return [{ 'resource-id': COMPOSER, focused: 'true', text: drafts.get(serial) || `Comment as ${owner(serial)}…` }, { 'resource-id': SEND, enabled: 'true' }];
  };
  return { manager, sent, requests };
}
const jobFor = accounts => ({ logs: [], sent: 0, skipped: 0, failed: 0, accounts: accounts.map(a => ({ ...a, status: 'waiting', sent: 0, skipped: 0, liked: 0, note: '' })) });
const plan = (overrides = {}) => ({ ...entry, target: 'target.one', ...overrides });
test('sends four new comments per post even when three or four older comments exist', async () => {
  const fake = fakeRunner({ existing: 3 }), job = jobFor([plan({ posts: 2, comments: 4 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 8, 'four new comments on each of two posts');
  assert.deepEqual(fake.requests.map(r => r.count), [4, 4]);
  assert.equal(fake.requests[0].hindari.includes('lama 0'), false);
  assert.equal(job.status, 'completed'); assert.equal(job.accounts[0].liked, 2);
  const again = fakeRunner({ existing: 4 }), skipped = jobFor([plan({ comments: 4 })]);
  await again.manager.run(skipped);
  assert.equal(again.sent.length, 4); assert.equal(skipped.skipped, 0);
});
test('one username on two HP shares its per-post count, and other accounts avoid texts already sent', async () => {
  const fake = fakeRunner(), job = jobFor([plan({ comments: 2 }), plan({ serial: 'phone2', comments: 2 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 2); assert.equal(fake.manager.countFor(fake.manager.commentKey(job, 'account.one', 'target.one:index:0')), 2);
  assert.equal(fake.manager.locks.size, 0);
});
test('an uncertain send remains held across new jobs without scanning older comments, and Stop prevents submission before Send', async () => {
  const uncertain = fakeRunner({ uncertain: true }), first = jobFor([plan()]);
  await uncertain.manager.run(first);
  assert.equal(uncertain.manager.state.history[0].status, 'uncertain'); assert.equal(first.accounts[0].status, 'done');
  assert.match(first.accounts[0].note, /pemeriksaan hasil/);
  const readThread = uncertain.manager.openThread;
  uncertain.manager.openThread = async (...args) => ({ ...await readThread(...args), complete: false });
  await uncertain.manager.run(jobFor([plan()]));
  assert.equal(uncertain.sent.length, 1, 'a partly loaded list never proves a comment missing');
  assert.equal(uncertain.manager.state.history[0].status, 'uncertain', 'opening the composer never silently reclassifies an uncertain send');
  const stopped = fakeRunner({ stopBeforeSend: true }), job = jobFor([plan()]);
  await stopped.manager.run(job);
  assert.equal(stopped.sent.length, 0); assert.equal(job.status, 'stopped');
  assert.equal(stopped.manager.countFor(stopped.manager.commentKey(job, 'account.one', 'target.one:index:0')), 0, 'a cancelled attempt releases its reservation');
});
test('a blocked account stops alone while the other HP keeps commenting', async () => {
  const fake = fakeRunner({ blockedOn: 'phone1', owners: { phone2: 'account.two' } }), job = jobFor([plan({ username: 'account.one' }), plan({ serial: 'phone2', username: 'account.two' })]);
  await fake.manager.run(job);
  assert.equal(job.accounts[0].status, 'blocked'); assert.equal(job.accounts[1].status, 'done');
  assert.equal(fake.sent.length, 1); assert.equal(job.status, 'completed_with_errors');
  assert.ok(new BlockedError('x') instanceof Error);
});
test('older single-comment history counts as one existing comment', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'phonefarm-ig-')), statePath = join(dir, 'instagram.json');
  await writeFile(statePath, JSON.stringify({ devices: [], history: [{ key: 'account.one:old-post', username: 'account.one', target: 'target.one', status: 'sent' }, { key: 'account.one:cancelled', status: 'cancelled' }] }));
  const manager = new InstagramManager({ statePath, devices: () => [] });
  await manager.load();
  assert.equal(manager.countFor('account.one:old-post'), 1); assert.equal(manager.countFor('account.one:cancelled'), 0);
  assert.deepEqual(manager.state.plans, {});
  await rm(dir, { recursive: true });
});
test('account scan reads every connected HP at the same time', async () => {
  const serials = ['phone1', 'phone2', 'phone3'];
  const manager = new InstagramManager({ statePath: '/unused', devices: () => serials.map(serial => ({ serial, status: 'device', name: serial })) });
  manager.save = async () => {};
  let active = 0, peak = 0;
  manager.accountSheet = async serial => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; return { current: `${serial}.user`, accounts: [{ username: `${serial}.user`, disabled: false, active: true }] }; };
  const result = await manager.scanAccounts();
  assert.equal(peak, 3); assert.equal(result.devices.length, 3); assert.equal(manager.locks.size, 0);
});
test('Stop interrupts a running check and a scan without touching the HP further', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }, { serial: 'phone2', status: 'device' }] });
  manager.save = async () => {};
  manager.state.devices = [{ serial: 'phone1', accounts: [{ username: 'account.one' }, { username: 'account.two' }] }, { serial: 'phone2', accounts: [{ username: 'account.three' }] }];
  let reads = 0;
  manager.net = { macOnline: async () => true, phoneOnline: async () => true, restoreInternet: async () => ({ online: true }) };
  manager.logs.create = async () => null;
  manager.inspect = async (job, account) => { manager.stop(); await manager.ui(account.serial); reads++; return { ok: true }; };
  const result = await manager.preview({ accounts: [plan(), plan({ username: 'account.two' }), plan({ serial: 'phone2', username: 'account.three' })] });
  assert.equal(result.stopped, true); assert.equal(reads, 0);
  assert.ok(result.results.every(r => !r.ok)); assert.match(result.results[1].error, /dihentikan/);
  assert.equal(manager.abortRequested, false); assert.equal(manager.previewPending, false);
  manager.accountSheet = async serial => { manager.stop(); await manager.ui(serial); return { accounts: [] }; };
  const scan = await manager.scanAccounts();
  assert.equal(scan.stopped, true); assert.deepEqual(scan.devices.find(d => d.serial === 'phone1').accounts.map(a => a.username), ['account.one', 'account.two'], 'a stopped scan keeps the previous account list');
});
test('account scan waits for a half-open sheet and only stops when scrolling adds nobody', async () => {
  const row = (name, top) => `<node clickable="true" content-desc="${name}" bounds="[48,${top}][1032,${top + 190}]"><node text="${name}"/></node>`;
  const half = parseUi(`<hierarchy><node scrollable="true" bounds="[0,1200][1080,1776]">${row('a.one', 1200)}${row('a.two', 1400)}<node text="Add Instagram account"/></node></hierarchy>`);
  const full = parseUi(`<hierarchy><node scrollable="true" bounds="[0,566][1080,1776]">${row('a.one', 614)}${row('a.two', 812)}${row('a.three', 1004)}</node></hierarchy>`);
  const end = parseUi(`<hierarchy><node scrollable="true" bounds="[0,566][1080,1776]">${row('a.three', 614)}${row('a.four', 812)}<node text="Add Instagram account"/></node></hierarchy>`);
  const screens = [half, full, full, end, end];
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.ownProfile = async () => ({ current: 'a.one', title: { bounds: '[0,0][10,10]' } });
  manager.tap = async () => {}; manager.back = async () => {}; manager.swipe = async () => {};
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  const result = await manager.accountSheet('phone1');
  assert.deepEqual(result.accounts.map(a => a.username), ['a.one', 'a.two', 'a.three', 'a.four']);
  assert.equal(result.complete, true);
});
test('start mode: "serentak" starts every HP at once, "bertahap" chains them 6–12 s apart', async () => {
  for (const [startMode, expected] of [['serentak', 0], ['bertahap', 1]]) {
    const fake = fakeRunner({ owners: { phone2: 'account.two' } }), waits = [];
    fake.manager.wait = async ms => { waits.push(ms); };
    const job = { ...jobFor([plan(), plan({ serial: 'phone2', username: 'account.two' })]), startMode };
    await fake.manager.run(job);
    // 6–12 s is the start stagger alone; the comment and post gaps stay below 6 s.
    const startDelays = waits.filter(ms => ms >= 6000);
    assert.equal(startDelays.length, expected, startMode);
    assert.ok(startDelays.every(ms => ms <= 12000));
    assert.equal(fake.sent.length, 2);
  }
  assert.equal(validatePlan({ ...valid, startMode: 'serentak' }, deviceAccounts).startMode, 'serentak');
  assert.equal(validatePlan(valid, deviceAccounts).startMode, 'bertahap');
  assert.throws(() => validatePlan({ ...valid, startMode: 'kilat' }, deviceAccounts));
});
test('a post whose caption is still below the screen edge is nudged up before its identity is checked', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const bar = top => [{ 'resource-id': id('row_feed_photo_profile_name'), text: 'target.one', bounds: '[147,254][948,330]' }, { 'resource-id': id('row_feed_button_comment'), bounds: `[179,${top}][251,${top + 138}]` }];
  const screens = [bar(1638), [...bar(1238), { class: 'com.instagram.ui.widget.textview.IgTextLayoutView', text: 'target.one UPDATE pencarian KM Virgo… selengkapnya', bounds: '[36,1376][1080,1488]' }]];
  let nudges = 0;
  manager.openLockedPost = async () => ({ tile: { bounds: '[0,0][10,10]' } });
  manager.tap = async () => {}; manager.nudge = async () => { nudges++; }; manager.closeSheets = async () => [];
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  const post = await manager.openPost('phone1', 'account.one', 'target.one', { identity: 'postingan ketiga', twin: 1 });
  assert.equal(nudges, 1); assert.equal(typeof post.fingerprint, 'string');
});

test('a slow network retries the step with growing pauses, then the post succeeds', async () => {
  const fake = fakeRunner(), waits = [];
  fake.manager.wait = async ms => { waits.push(ms); };
  const open = fake.manager.openPost; let failures = 2;
  fake.manager.openPost = async (...args) => { if (failures-- > 0) throw new NetworkError('Grid postingan belum termuat.'); return open(...args); };
  const job = jobFor([plan()]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 1); assert.deepEqual(waits.filter(ms => ms === 5000 || ms === 10000), [5000, 10000]);
  assert.ok(job.logs.some(l => /Coba lagi dalam 5 detik \(1\/4\)/.test(l.message)));
});
test('a post that keeps failing is skipped, retried once at the end, and 3 failures in a row pause the account 1 minute', async () => {
  const fake = fakeRunner(), waits = [];
  fake.manager.wait = async ms => { waits.push(ms); };
  const open = fake.manager.openPost, tries = new Map();
  fake.manager.openPost = async (serial, account, target, postRef) => {
    const index = postRef.index;
    tries.set(index, (tries.get(index) || 0) + 1);
    if (index < 3 && tries.get(index) <= 5) throw new NetworkError('Postingan belum termuat.');
    return open(serial, account, target, postRef);
  };
  const job = jobFor([plan({ posts: 4 })]);
  await fake.manager.run(job);
  assert.ok(waits.includes(60000), 'three posts in a row failed, so the account paused one minute');
  assert.deepEqual([...tries.values()], [6, 6, 6, 1], 'posts 1–3 used their 5 tries, then one retry pass each');
  assert.equal(fake.sent.length, 4); assert.equal(job.accounts[0].missed, 0); assert.equal(job.accounts[0].status, 'done');
});
test('when the Mac loses internet every HP pauses, resumes when it returns, and stops after 5 minutes', async () => {
  const back = fakeRunner(); let checks = 0;
  back.manager.net.macOnline = async () => ++checks > 3;
  const open = back.manager.openPost; let fail = true;
  back.manager.openPost = async (...args) => { if (fail) { fail = false; throw new NetworkError('Profil target belum termuat.'); } return open(...args); };
  const job = jobFor([plan()]);
  await back.manager.run(job);
  assert.ok(job.logs.some(l => /Semua HP dijeda/.test(l.message)) && job.logs.some(l => /Internet kembali/.test(l.message)));
  assert.equal(back.sent.length, 1); assert.equal(job.paused, false);
  const down = fakeRunner();
  down.manager.net.macOnline = async () => false;
  const stopped = jobFor([plan()]);
  await down.manager.run(stopped);
  assert.equal(stopped.status, 'stopped'); assert.match(stopped.stopReason, /5 menit/); assert.equal(down.sent.length, 0);
});
test('an HP without internet is reconnected first, and skipped when that fails', async () => {
  const fake = fakeRunner({ owners: { phone2: 'account.two' } });
  fake.manager.net.phoneOnline = async serial => serial === 'phone1';
  fake.manager.net.restoreInternet = async () => ({ online: false });
  const job = jobFor([plan(), plan({ serial: 'phone2', username: 'account.two' })]);
  await fake.manager.run(job);
  assert.equal(job.accounts[0].status, 'done'); assert.equal(job.accounts[1].status, 'deferred'); assert.match(job.accounts[1].note, /koneksi/);
});
test('"Memposting…" is awaited, and "Gagal memposting" releases the count so the gap is filled later', async () => {
  for (const [screens, expected] of [[['posting', 'posting', 'visible'], 'sent'], [['posting', 'failed'], 'failed']]) {
    const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
    manager.deliveryPause = async () => {}; manager.inputPause = async () => {}; manager.imeShown = async () => false; manager.save = async () => {}; manager.readScreen = async () => ''; manager.logs.write = () => {};
    manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() });
    manager.net = { macOnline: async () => true, phoneOnline: async () => true, restoreInternet: async () => ({ online: true }) };
    let typed = '', sent = false;
    manager.tap = async (serial, node) => { if (node['resource-id'] === SEND) sent = true; };
    manager.typeComment = async (serial, text) => { typed = text; };
    manager.ui = async () => {
      if (!sent) return [{ 'resource-id': COMPOSER, focused: 'true', text: typed || 'Tambahkan komentar…' }, ...(typed ? [{ 'resource-id': SEND, enabled: 'true' }] : [])];
      const next = screens.shift() || 'visible';
      const base = [{ 'resource-id': COMPOSER, focused: 'true', text: 'Tambahkan komentar…' }];
      if (next === 'posting') return [...base, { text: 'Memposting…' }];
      if (next === 'failed') return [...base, { text: 'Gagal memposting. Ketuk untuk mencoba lagi.' }];
      return [...base, { 'content-desc': `account.one mengatakan ${typed}` }];
    };
    const entry = { serial: 'phone1', username: 'account.one', target: 'target.one', comments: 2, sent: 0 }, job = { logs: [], sent: 0 };
    if (expected === 'sent') assert.equal(await manager.sendComment(job, entry, 'k', 'Halo semua'), 'sent');
    else await assert.rejects(manager.sendComment(job, entry, 'k', 'Halo semua'), NetworkError);
    assert.equal(manager.state.history[0].status, expected);
    assert.equal(manager.countFor('k'), expected === 'sent' ? 1 : 0);
  }
});
test('legacy unresolved sends hold a new job without changing their status', async () => {
  for (const status of ['sending', 'posting', 'uncertain', 'blocked']) {
    const fake = fakeRunner();
    fake.manager.state.history = [{ key: 'account.one:post-0', text: 'Earlier send', status }];
    const job = jobFor([plan()]);
    await fake.manager.run(job);
    assert.equal(fake.sent.length, 0); assert.equal(job.accounts[0].pending, 1);
    assert.equal(fake.manager.state.history[0].status, status);
  }
});

test('a ready composer can send while the old comment list is still loading', async () => {
  const fake = fakeRunner();
  fake.manager.openThread = async () => ({ caption: 'Full caption' });
  const job = jobFor([plan()]); await fake.manager.run(job);
  assert.equal(fake.sent.length, 1); assert.equal(job.accounts[0].missed, 0);
});

test('process logs are written as text, listed, read back, and deleted after 7 days', async () => {
  const { mkdtemp, rm, utimes } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'phonefarm-logs-'));
  const logs = new JobLogs(dir);
  const created = await logs.create('komen', '1 akun');
  await logs.write(created.file, '10:00:00  HP 01 @account.one · Terkirim');
  const list = await logs.list();
  assert.equal(list.length, 1); assert.equal(list[0].label, 'Auto komen');
  assert.match(await logs.read(created.id), /Terkirim/);
  await assert.rejects(logs.read('../instagram'));
  const old = Date.now() / 1000 - 8 * 86400;
  await utimes(created.file, old, old); await logs.prune();
  assert.equal((await logs.list()).length, 0);
  await rm(dir, { recursive: true });
});

test('the comment count beside the comment button tells an empty thread from one that has not loaded', () => {
  const bar = count => [{ 'resource-id': id('row_feed_button_like'), bounds: '[36,1082][108,1220]' }, { text: '9', bounds: '[120,1082][145,1220]' },
    { 'resource-id': id('row_feed_button_comment'), bounds: '[181,1082][253,1220]' }, ...(count ? [{ text: count, bounds: '[265,1082][290,1220]' }] : []), { text: '1', bounds: '[423,1082][440,1220]' }];
  assert.equal(commentCount(bar('9')), 9, 'the like count on the left and the repost count further right are ignored');
  assert.equal(commentCount(bar('1,2 rb')), 1000);
  assert.equal(commentCount(bar(null)), 0);
});
test('an offline HP never sends; a comment shown while the HP is offline is not counted as sent', async () => {
  const offline = fakeRunner(); let restored = 0;
  offline.manager.net.phoneOnline = async () => false;
  offline.manager.net.restoreInternet = async () => { restored++; return { online: false }; };
  const job = jobFor([plan()]);
  await offline.manager.run(job);
  assert.equal(offline.sent.length, 0); assert.equal(job.accounts[0].status, 'deferred'); assert.ok(restored >= 1);
  const flaky = fakeRunner(); let calls = 0;
  // Online for the start, the post and the pre-send check; offline right after Send.
  flaky.manager.net.phoneOnline = async () => ++calls <= 3;
  const second = jobFor([plan()]);
  await flaky.manager.run(second);
  assert.equal(flaky.sent.length, 1); assert.equal(flaky.manager.state.history[0].status, 'uncertain');
  assert.ok(second.logs.some(l => /belum pasti/.test(l.message)));
});

test('identical captions retain separate quotas and historical counts do not reduce new quotas', async () => {
  const fake = fakeRunner();
  const open = fake.manager.openPost;
  fake.manager.openPost = async (...args) => ({ ...(await open(...args)), fingerprint: 'same-caption' });
  const job = jobFor([plan({ posts: 2 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 2, 'both posts get their comment');
  assert.equal(fake.manager.countFor(fake.manager.commentKey(job, 'account.one', 'target.one:index:0')), 1); assert.equal(fake.manager.countFor(fake.manager.commentKey(job, 'account.one', 'target.one:index:1')), 1);
  assert.ok(job.logs.some(l => /dibedakan sebagai yang ke-2/.test(l.message)));
  const stale = fakeRunner();
  stale.manager.setCount('account.one:post-0', 1);
  const second = jobFor([plan()]);
  await stale.manager.run(second);
  assert.equal(stale.sent.length, 1, 'the old total is ignored for a new job');
  assert.equal(stale.manager.countFor('account.one:post-0'), 1, 'legacy count is left intact');
});

test('a comment sheet left open is closed before the grid, and a tap that lands in a sheet is never used', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const sheet = [{ 'resource-id': id('title_text_view'), text: 'Comments' }, { 'resource-id': COMPOSER, focused: 'true', text: 'Join the conversation…' }];
  let screens = [sheet, sheet, []], backs = 0;
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  manager.back = async () => { backs++; };
  await manager.closeSheets('phone1');
  assert.equal(backs, 2);
  screens = [[], sheet, []];
  manager.openLockedPost = async () => ({ tile: { bounds: '[0,0][10,10]' } });
  manager.tap = async () => {};
  await assert.rejects(manager.openPost('phone1', 'account.one', 'target.one', { identity: null, key: '1:1', twin: 1 }), NetworkError);
});

test('a username on two HP never loses a comment just sent by the other HP when the screen lags behind', async () => {
  const fake = fakeRunner({ owners: { phone2: 'account.one' } });
  // Each HP only sees its own comments, as happens right after sending.
  fake.manager.openThread = async serial => ({ caption: '', loaded: true, complete: true, mine: [], others: [] });
  const job = jobFor([plan({ comments: 3 }), plan({ serial: 'phone2', comments: 3 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 3, 'three comments in total, not three per HP');
  assert.equal(fake.manager.countFor(fake.manager.commentKey(job, 'account.one', 'target.one:index:0')), 3);
});

test('the post list is locked once per account before any like or comment, and only that list is processed', async () => {
  const fake = fakeRunner(), calls = [];
  fake.manager.lockPosts = async (job, entry) => {
    calls.push('lock');
    // The profile only has two usable posts even though 4 were requested.
    return { posts: [{ index: 0, identity: 'Foto A', twin: 1 }, { index: 1, identity: 'Foto B', twin: 1 }], pinned: 1 };
  };
  const open = fake.manager.openPost;
  fake.manager.openPost = async (serial, account, target, postRef) => { calls.push(postRef.identity); return open(serial, account, target, postRef); };
  const job = jobFor([plan({ posts: 4 })]);
  await fake.manager.run(job);
  assert.deepEqual(calls, ['lock', 'Foto A', 'Foto B'], 'the list is locked first, then reused until the end');
  assert.equal(fake.sent.length, 2);
  assert.ok(job.logs.some(l => /Membuka postingan 1\/2\./.test(l.message)));
});

test('lockPosts reads the grid before activity and distinguishes same-day posts by thumbnail', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.save = async () => {}; manager.logs.write = () => {}; manager.logs.create = async () => null;
  manager.closeSheets = async () => {}; manager.openProfileGrid = async () => {}; manager.swipe = async () => {};
  manager.inspectGrid = async (serial, tiles) => ({ pins: new Set(), visuals: new Map(tiles.map(t => [t.key, `image-${t.key}`])) });
  const row = (r, tiles) => `<node resource-id="${id('media_set_row_content_identifier')}">${tiles}</node>`;
  const tile = (r, c, extra = '') => `<node><node resource-id="${id('image_button')}" clickable="true" content-desc="${extra}Foto profil target.one pada 3 Februari 2026, Baris ${r}, Kolom ${c}" bounds="[${(c - 1) * 360},${r * 500}][${c * 360 - 4},${r * 500 + 470}]"/></node>`;
  const header = `<node resource-id="${id('action_bar_title')}" text="target.one"/>`;
  const dump = (...rows) => parseUi(`<hierarchy><node>${header}<node scrollable="true" bounds="[0,300][1080,1776]">${rows.join('')}</node></node></hierarchy>`);
  const first = dump(row(1, tile(1, 1, 'Ikon postingan yang disematkan. ') + tile(1, 2)), row(1, tile(1, 3)));
  const second = dump(row(2, tile(2, 1) + tile(2, 2)));
  const screens = [first, first, second, second];
  manager.ui = async () => screens.length ? screens.shift() : second;
  assert.equal(tileIdentity(gridTiles(first)[1]), 'Foto profil target.one pada 3 Februari 2026', 'the identity keeps the alt text and drops the shifting row/column');
  const { posts, pinned } = await manager.lockPosts({ logs: [] }, { serial: 'phone1', target: 'target.one', posts: 3 }, { serial: 'phone1', username: 'account.one', target: 'target.one' });
  assert.equal(pinned, 1, 'the pinned tile never enters the locked list');
  assert.ok(posts.every(p => p.identity === 'Foto profil target.one pada 3 Februari 2026'));
  assert.deepEqual(posts.map(p => p.visual), ['image-1:2', 'image-1:3', 'image-2:1']);
  assert.ok(Object.isFrozen(posts) && posts.every(Object.isFrozen));
});

test('a locked post is reopened by identity even when new uploads push the grid down', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.save = async () => {}; manager.logs.write = () => {}; manager.logs.create = async () => null;
  manager.openProfileGrid = async () => {}; manager.swipe = async () => {};
  const row = (r, tiles) => `<node resource-id="${id('media_set_row_content_identifier')}">${tiles}</node>`;
  const tile = (r, c, extra = '') => `<node><node resource-id="${id('image_button')}" clickable="true" content-desc="${extra}Baris ${r}, Kolom ${c}" bounds="[${(c - 1) * 360},${r * 500}][${c * 360 - 4},${r * 500 + 470}]"/></node>`;
  const header = `<node resource-id="${id('action_bar_title')}" text="target.one"/>`;
  const dump = (...rows) => parseUi(`<hierarchy><node>${header}<node scrollable="true" bounds="[0,300][1080,1776]">${rows.join('')}</node></node></hierarchy>`);
  manager.ui = async () => dump(row(1, tile(1, 1, 'Unggahan baru hari ini, ') + tile(1, 2, 'Foto lama yang tetap jadi sasaran, ')));
  manager.inspectGrid = async (serial, tiles) => ({ pins: new Set(), visuals: new Map(tiles.map(t => [t.key, tileIdentity(t) === 'Foto lama yang tetap jadi sasaran' ? 'old-image' : 'new-image'])) });
  const post = await manager.openLockedPost('phone1', 'target.one', { identity: 'Foto lama yang tetap jadi sasaran', visual: 'old-image' });
  assert.equal(post.tile.bounds, '[360,500][716,970]', 'the locked post moved to another grid slot but is still found');
  await assert.rejects(manager.openLockedPost('phone1', 'target.one', { identity: 'Foto yang sudah dihapus', visual: 'deleted-image' }), SkipPostError);
});

test('network retries reuse the exact locked references and never collect a replacement list', async () => {
  const fake = fakeRunner(), events = [];
  const refs = Object.freeze([Object.freeze({ identity: 'A', visual: 'image-a' }), Object.freeze({ identity: 'B', visual: 'image-b' })]);
  fake.manager.lockPosts = async () => { events.push('lock'); return { posts: refs, pinned: 0 }; };
  let attempts = 0;
  fake.manager.processPost = async (job, entry, index, ref) => {
    assert.strictEqual(ref, refs[index]);
    events.push(ref.identity);
    if (index === 0 && attempts++ === 0) throw new NetworkError('temporary failure');
  };
  fake.manager.logScreen = async () => {};
  const job = jobFor([plan({ posts: 8 })]);
  await fake.manager.runAccount(job, job.accounts[0]);
  assert.deepEqual(events, ['lock', 'A', 'B', 'A']);
  assert.strictEqual(job.accounts[0].lockedPosts, refs);
  assert.equal(job.accounts[0].status, 'partial', 'the unprocessed requested posts remain visible');
});

test('a queued job reserves its HP during async startup so background recovery cannot take it', async () => {
  const fake = fakeRunner(); fake.manager.state.devices = deviceAccounts;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  fake.manager.net.macOnline = async () => { await pending; return true; };
  fake.manager.start({ accounts: [plan()] });
  assert.equal(fake.manager.locks.size, 0, 'startup has not acquired the execution lock yet');
  assert.equal(fake.manager.busy('phone1'), true, 'background recovery must leave the queued HP alone');
  assert.equal(fake.manager.busy('phone2'), false, 'unselected HP remain available');
  release();
  while (fake.manager.job.status === 'running') await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fake.manager.job.status, 'completed');
  assert.equal(fake.manager.busy('phone1'), false, 'the reservation ends with the job');
});

test('an incomplete historical list cannot reduce or block a new quota', async () => {
  const fake = fakeRunner({ existing: 1, complete: false });
  const job = jobFor([plan({ comments: 2 })]); await fake.manager.run(job);
  assert.equal(fake.sent.length, 2); assert.equal(job.accounts[0].missed, 0);
});

test('resumed execution reuses its frozen references and completed quota without collecting a new list', async () => {
  const fake = fakeRunner({ existing: 2 });
  const refs = Object.freeze([Object.freeze({ index: 0, identity: 'locked-first', visual: 'old-first' }), Object.freeze({ index: 1, identity: 'locked-second', visual: 'old-second' })]);
  fake.manager.lockPosts = async () => { throw Error('Must not select new uploads'); };
  const opened = [], open = fake.manager.openPost;
  fake.manager.openPost = async (...args) => { opened.push(args[3]); return open(...args); };
  const job = jobFor([plan({ posts: 2, comments: 2 })]); job.id = 'resumed'; job.commentRunId = 'original'; job.accounts[0].lockedPosts = refs;
  for (const index of [0, 1]) fake.manager.setCount(fake.manager.commentKey(job, 'account.one', `target.one:index:${index}`), 2);
  await fake.manager.run(job);
  assert.deepEqual(opened, [...refs]); assert.ok(opened.every((r, i) => r === refs[i]));
  assert.equal(fake.sent.length, 0); assert.equal(job.skipped, 2);
  assert.deepEqual(fake.manager.state.resumableJob.accounts[0].lockedPosts, refs);
});

test('restart and repeated resume preserve the original quota; an explicit new start adds the full quota', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'phonefarm-quota-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = fakeRunner({ existing: 99 }), account = plan({ comments: 3 });
  first.manager.statePath = join(dir, 'state.json');
  first.manager.save = InstagramManager.prototype.save;
  first.manager.state.devices = [{ serial: 'phone1', accounts: [{ username: 'account.one' }] }];
  const send = first.manager.sendComment.bind(first.manager);
  first.manager.sendComment = async (...args) => { const result = await send(...args); first.manager.stopRequested = true; return result; };
  const job = jobFor([account]); job.id = 'initial-job';
  await first.manager.run(job);
  assert.equal(first.sent.length, 1); assert.equal(job.status, 'stopped');
  const next = fakeRunner({ existing: 99 });
  next.manager.statePath = first.manager.statePath;
  next.manager.save = InstagramManager.prototype.save;
  await next.manager.load();
  next.manager.lockPosts = async () => assert.fail('resume must use stored targets');
  let task;
  const run = next.manager.run.bind(next.manager);
  next.manager.run = job => (task = run(job));
  next.manager.start({ accounts: [account], resumeJobId: 'initial-job' }); await task;
  assert.equal(next.sent.length, 2, 'only two remain after restart');
  const resumedId = next.manager.job.id;
  next.manager.start({ accounts: [account], resumeJobId: resumedId }); await task;
  assert.equal(next.sent.length, 2, 'resuming a second time does not reset quota');
  next.manager.lockPosts = async () => ({ posts: [{ index: 0, identity: 'post-0' }], pinned: 0 });
  next.manager.start({ accounts: [account] }); await task;
  assert.equal(next.sent.length, 5, 'ordinary start adds three more');
  assert.equal(next.manager.job.sent, 3);
});

test('network retry keeps the same quota even if the opened caption fingerprint changes', async () => {
  const fake = fakeRunner(), job = jobFor([plan({ comments: 3 })]);
  let opens = 0;
  const open = fake.manager.openPost.bind(fake.manager);
  fake.manager.openPost = async (...args) => ({ ...await open(...args), fingerprint: `caption-version-${++opens}` });
  const send = fake.manager.sendComment.bind(fake.manager); let attempts = 0;
  fake.manager.sendComment = async (...args) => {
    if (++attempts === 2) throw new NetworkError('temporary interruption before send');
    return send(...args);
  };
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 3); assert.equal(opens, 2);
  assert.deepEqual(fake.requests.map(r => r.count), [3, 2]);
});

test('unresolved reservations survive history retention and hold new jobs', () => {
  const fake = fakeRunner();
  fake.manager.state.history = [{ key: 'old', postKey: 'account.one:post', status: 'sending' }, ...Array.from({ length: 4999 }, () => ({ key: 'other', status: 'sent' }))];
  fake.manager.reserveComment('unrelated', 'other.account', 'target.one', 'New text');
  assert.equal(fake.manager.state.history.length, 5000);
  assert.equal(fake.manager.pendingRecords('new', 'account.one:post').length, 1);
});

test('a short bank reports confirmed, pending and remaining separately instead of completing the quota', async () => {
  for (const available of [0, 1]) {
    const fake=fakeRunner(),job=jobFor([plan({comments:3})]);
    fake.manager.generate=async()=>({comments:available?['Only one available']:[],suasana:'umum',tone:'positif'});
    await fake.manager.run(job);
    const entry=job.accounts[0];
    assert.equal(entry.status,'partial');assert.equal(job.status,'completed_with_errors');
    assert.equal(entry.confirmed,available);assert.equal(entry.pending,0);assert.equal(entry.remaining,3-available);
    assert.equal(entry.progress[0].reason,'Bank komentar tidak cukup.');
    assert.ok(job.logs.some(l=>l.message.includes(`kurang ${3-available}`)));
  }
});
test('a send interruption followed by retry holds the result rather than duplicating or hiding the shortage',async()=>{
  const fake=fakeRunner(),job=jobFor([plan({comments:3})]);
  const tap=fake.manager.tap.bind(fake.manager);
  fake.manager.tap=async(serial,node)=>{await tap(serial,node);if(node['resource-id']===SEND)throw new Error('ADB response lost');};
  await fake.manager.run(job);
  assert.equal(fake.sent.length,1);assert.equal(job.sent,0);
  assert.equal(job.accounts[0].pending,1);assert.equal(job.accounts[0].remaining,2);
  assert.equal(job.accounts[0].confirmed,0);
  assert.equal(fake.manager.state.history[0].status,'uncertain');
});
test('exhausted loading retries leave a deferred post with a visible remainder and bounded attempts',async()=>{
  const fake=fakeRunner(),job=jobFor([plan({comments:3})]);let opens=0;
  fake.manager.openPost=async()=>{opens++;throw new NetworkError('Loading belum selesai');};
  await fake.manager.run(job);
  assert.equal(opens,10,'five bounded attempts plus one later pass over the same target');
  assert.equal(fake.sent.length,0);assert.equal(job.accounts[0].status,'deferred');
  assert.equal(job.accounts[0].remaining,3);assert.equal(job.accounts[0].missed,1);
  assert.match(job.accounts[0].progress[0].reason,/Loading/);
});
// Bentuk baris aksi dan lembar share diambil dari dump asli Samsung 01 (1080x1920).
const actionBar = ({ save = 'Add to Saved', like = 'Like' } = {}) => [
  { 'resource-id': id('row_feed_button_like'), 'content-desc': like, selected: String(like !== 'Like'), bounds: '[36,1638][108,1776]' },
  { 'resource-id': id('row_feed_button_comment'), 'content-desc': 'Comment', bounds: '[156,1638][228,1776]' },
  { 'resource-id': id('reposts_ufi_icon'), 'content-desc': '', bounds: '[240,1638][372,1776]' },
  { 'resource-id': id('row_feed_button_share'), 'content-desc': 'Send post. Button.', bounds: '[408,1638][480,1776]' },
  { 'resource-id': id('row_feed_button_save'), 'content-desc': save, bounds: '[942,1638][1074,1764]' },
];
const shareTile = (name, { selected = false, bounds = '[0,895][360,1291]' } = {}) => ({ 'resource-id': id('direct_share_sheet_grid_view_pog'), 'content-desc': `${name} Chat ${selected ? '' : 'not '}selected`, clickable: 'true', bounds });
const shareSheet = (...tiles) => [{ 'resource-id': id('direct_private_share_recipients_container'), bounds: '[0,895][1080,1776]' }, ...tiles];
const sendNode = () => ({ 'resource-id': id('direct_send_button_multi_select'), 'content-desc': 'Send', enabled: 'true', bounds: '[48,1576][1032,1708]' });
const snackbar = text => [{ 'resource-id': id('snackbar_message'), text, bounds: '[192,1642][844,1695]' }, { 'resource-id': id('snackbar_text_button'), text: 'Undo', bounds: '[892,1630][1020,1707]' }];
// Dialog konfirmasi repost pertama, disalin dari dump asli Samsung 01.
const repostDialogNodes = () => [
  { 'resource-id': id('igds_promo_dialog_headline'), bounds: '[48,752][1032,1728]' },
  { 'resource-id': id('igds_headline_headline'), text: "You reposted akun.contoh21's reel", bounds: '[144,824][936,1093]' },
  { 'resource-id': id('igds_headline_body'), 'content-desc': 'Your followers might see this in their feeds', bounds: '[144,1117][936,1308]' },
  { 'resource-id': id('igds_headline_primary_action_button'), 'content-desc': 'Close', clickable: 'true', bounds: '[144,1380][936,1512]' },
  { 'resource-id': id('igds_headline_secondary_action_text_button'), 'content-desc': 'Undo', clickable: 'true', bounds: '[144,1524][936,1656]' },
];
// Lembar koleksi yang dibuka Instagram setelah tombol simpan diketuk, disalin dari dump asli.
const savedSheetNodes = () => [
  { 'resource-id': id('layout_container_bottom_sheet'), bounds: '[0,358][1080,1776]' },
  { 'resource-id': id('bottom_sheet_container_view'), bounds: '[0,451][1080,1776]' },
  { 'resource-id': id('pinned_save_row'), clickable: 'true', bounds: '[0,451][1080,667]' },
  { 'resource-id': id('title'), text: 'Saved', bounds: '[252,506][924,560]' },
  { 'resource-id': id('empty_state_title'), text: 'Collect the posts you love', bounds: '[48,1028][1032,1310]' },
  { 'resource-id': id('primary_action_button'), text: 'Start a collection', clickable: 'true', bounds: '[48,1500][1032,1632]' },
];
// Menu tekan-lama, disalin dari dump asli Samsung 09 (1080x1920). Selama menu ini terbuka,
// UI Automator hanya memuat isi menu - bukan halaman postingan di bawahnya.
const contextMenuNodes = () => [
  { 'resource-id': id('context_menu'), bounds: '[371,1016][950,1544]' },
  { 'resource-id': id('context_menu_options_list'), bounds: '[371,1028][950,1532]' },
  { 'resource-id': id('context_menu_item'), 'content-desc': 'Reply', bounds: '[371,1028][950,1196]' },
  { 'resource-id': id('context_menu_item'), 'content-desc': 'View Profile', bounds: '[371,1196][950,1364]' },
  { 'resource-id': id('context_menu_item'), 'content-desc': 'Mute', bounds: '[371,1364][950,1532]' },
];
// Layar "Meta Account", disalin dari dump asli Samsung 05 (15 Okt 2026). Layar ini muncul sendiri
// setelah aplikasi dijalankan dan mengabaikan tombol Kembali.
const metaAccountNodes = () => [
  { 'resource-id': id('action_bar_title'), text: 'Meta Account', bounds: '[48,170][420,278]' },
  { text: 'Your Meta Account is here', bounds: '[48,420][900,480]' },
  { text: 'Account overview', bounds: '[48,700][600,760]' },
  { text: "What's new", bounds: '[48,820][400,880]' },
  { text: 'Enhanced security features', bounds: '[48,940][700,1000]' },
  { text: 'Done', bounds: '[873,170][1080,278]' },
];
function actionManager(screens) {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const taps = [], backs = [];
  manager.actionPause = async () => {};
  manager.tap = async (serial, node) => { taps.push(node); };
  manager.back = async () => { backs.push(1); };
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  return { manager, taps, backs };
}
test('the bookmark reports its own state, and an unreadable label is never tapped', () => {
  assert.equal(saveState(actionBar()).status, 'not_saved');
  assert.equal(saveState(actionBar({ save: 'Remove from saved' })).status, 'saved');
  const odd = actionBar(); odd[4]['content-desc'] = 'Sesuatu';
  assert.equal(saveState(odd).status, 'unknown', 'label yang tidak dikenal tidak pernah diketuk');
  assert.equal(saveState([]).status, 'missing');
  assert.ok(repostButton(actionBar()));
  assert.equal(repostButton([]), undefined);
});
test('repost is confirmed by its own dialog or snackbar, and other dialogs are not repost', () => {
  assert.equal(snackbarMessage(snackbar('Reposted')), 'Reposted');
  assert.equal(repostedNotice(snackbar('Reposted')), true);
  assert.equal(repostedNotice(snackbar('Saved')), false, 'snackbar simpan bukan bukti repost');
  assert.equal(repostedNotice([]), false);
  assert.equal(snackbarMessage([]), '');
  // Dialog konfirmasi repost pertama adalah sinyal sukses yang sah, bukan penghalang biasa.
  assert.equal(repostDialog(repostDialogNodes()).headline, "You reposted akun.contoh21's reel");
  assert.equal(repostConfirmed(repostDialogNodes()), true);
  assert.equal(repostDialog([{ 'resource-id': id('igds_headline_headline'), text: 'Collect the posts you love' }]), null,
    'dialog lain tidak boleh dianggap repost');
  assert.equal(repostConfirmed([]), false);
});
test('share reads contacts in screen order and ignores rows clipped by the sheet edge', () => {
  const nodes = shareSheet(
    shareTile('dpp_perisai', { bounds: '[360,895][720,1291]' }),
    shareTile('akun.contoh107', { bounds: '[0,895][360,1291]' }),
    shareTile('akun.contoh10', { bounds: '[720,895][1080,1291]' }),
    // Baris paling bawah terpotong tepi lembar: titik tengahnya bisa jatuh di tombol Kirim.
    shareTile('Rizky.PRI', { bounds: '[0,1687][360,1776]' }));
  assert.deepEqual(shareContacts(nodes).map(c => c.name), ['akun.contoh107', 'dpp_perisai', 'akun.contoh10']);
  assert.equal(shareContacts(nodes)[0].selected, false);
  assert.equal(shareContacts(shareSheet(shareTile('akun.contoh107', { selected: true })))[0].selected, true);
  assert.deepEqual(shareContacts([]), []);
});
test('save taps only when the bookmark says it is unsaved and verifies the flip', async () => {
  const { manager, taps } = actionManager([actionBar({ save: 'Remove from saved' })]);
  assert.equal((await manager.savePost('phone1', actionBar())).status, 'saved');
  assert.equal(taps.length, 1);
  const again = actionManager([actionBar()]);
  assert.equal((await again.manager.savePost('phone1', actionBar({ save: 'Remove from saved' }))).status, 'already');
  assert.equal(again.taps.length, 0, 'postingan yang sudah tersimpan tidak pernah diketuk lagi');
});
test('repost waits for the Reposted snackbar and an unconfirmed tap is never called success', async () => {
  const { manager, taps } = actionManager([snackbar('Reposted'), actionBar()]);
  assert.equal((await manager.repostPost('phone1', actionBar())).status, 'reposted');
  assert.equal(taps.length, 1);
  const blind = actionManager([actionBar()]);
  assert.equal((await blind.manager.repostPost('phone1', actionBar())).status, 'unverified');
  assert.equal(blind.taps.length, 1, 'dicoba sekali saja, tidak diketuk berulang');
});
test('share picks the first visible contact, verifies the selection and needs the sheet to close', async () => {
  const post = actionBar();
  const sheet = shareSheet(shareTile('dpp_perisai', { bounds: '[360,895][720,1291]' }), shareTile('akun.contoh107', { bounds: '[0,895][360,1291]' }));
  const { manager, taps } = actionManager([sheet, shareSheet(shareTile('akun.contoh107', { selected: true }), sendNode()), post]);
  const result = await manager.sharePost('phone1', post, 'account.one');
  assert.equal(result.status, 'sent');
  assert.equal(result.to, 'akun.contoh107', 'kontak pertama yang terlihat, bukan yang pertama di XML');
  assert.equal(taps[0]['resource-id'], id('row_feed_button_share'));
  assert.equal(taps[1]['content-desc'], 'akun.contoh107 Chat not selected');
  assert.equal(taps[2]['resource-id'], id('direct_send_button_multi_select'));
  assert.equal(taps.length, 3);
  // Kirim yang tidak menutup lembar bukan bukti kiriman.
  const stuck = actionManager([sheet, shareSheet(shareTile('akun.contoh107', { selected: true }), sendNode())]);
  assert.equal((await stuck.manager.sharePost('phone1', post, 'account.one')).status, 'unverified');
});
test('share is skipped, not guessed, when there is no contact or only our own account', async () => {
  const none = actionManager([actionBar()]);
  assert.equal((await none.manager.sharePost('phone1', actionBar(), 'account.one')).status, 'nosheet');
  assert.equal(none.taps.length, 1, 'hanya tombol share yang diketuk');
  const self = actionManager([shareSheet(shareTile('account.one'))]);
  const result = await self.manager.sharePost('phone1', actionBar(), 'account.one');
  assert.equal(result.status, 'self_only');
  assert.equal(result.to, '');
  assert.ok(self.backs.length > 0, 'lembar ditutup, tidak ditinggal terbuka');
});
test('the collection sheet Instagram opens after saving is recognised and not mistaken for another screen', () => {
  assert.equal(savedSheet(savedSheetNodes()), true);
  // Baris "Saved" tanpa lembar koleksi bukan alasan menekan Back: itu bisa halaman lain.
  assert.equal(savedSheet([{ 'resource-id': id('pinned_save_row'), bounds: '[0,0][10,10]' }, { 'resource-id': id('title'), text: 'Saved' }]), false);
  assert.equal(savedSheet(actionBar()), false);
  assert.equal(savedSheet([]), false);
});
test('saving closes the collection sheet before the next action', async () => {
  const { manager, taps, backs } = actionManager([actionBar({ save: 'Remove from saved' }), savedSheetNodes(), actionBar()]);
  assert.equal((await manager.savePost('phone1', actionBar())).status, 'saved');
  assert.equal(taps.length, 1, 'hanya tombol simpan yang diketuk, bukan tombol di lembar koleksi');
  assert.equal(backs.length, 1, 'lembar koleksi ditutup dengan Back');
});
test('the reel-inside-the-feed layout is recognised and a normal post screen is not', () => {
  // Disalin dari dump asli Samsung 06: reel diputar di Home Feed, tanpa baris aksi.
  const inline = [
    { 'resource-id': id('row_feed_photo_profile_name'), text: 'akun.contoh21', bounds: '[147,643][948,719]' },
    { 'resource-id': id('media_group'), clickable: 'true', bounds: '[0,643][1080,1632]' },
    { 'resource-id': id('feed_preview_keep_watching_button'), text: 'Tap to watch more reels', clickable: 'true', bounds: '[275,1191][806,1335]' },
    { 'resource-id': id('feed_tab'), 'content-desc': 'Home', bounds: '[0,1632][216,1776]' },
    { 'resource-id': id('clips_tab'), 'content-desc': 'Reels', bounds: '[216,1632][432,1776]' },
    { 'resource-id': id('direct_tab'), 'content-desc': 'Message', bounds: '[432,1632][648,1776]' },
  ];
  assert.equal(feedPreview(inline), true);
  assert.equal(feedPreview(actionBar()), false, 'postingan dengan baris aksi bukan pemutaran di feed');
  assert.equal(feedPreview([]), false);
  // Nav bar bawah saja bukan bukti pemutaran inline.
  assert.equal(feedPreview([{ 'resource-id': id('feed_tab') }, { 'resource-id': id('clips_tab') }, { 'resource-id': id('direct_tab') }]), false);
});
test('the feed player is left through the post menu, and a menu without that entry is closed again', async () => {
  const option = { 'resource-id': id('media_option_button'), clickable: 'true', bounds: '[948,649][1080,793]' };
  const inline = [option, { 'resource-id': id('media_group'), clickable: 'true', bounds: '[0,643][1080,1632]' },
    { 'resource-id': id('feed_tab'), 'content-desc': 'Home' }, { 'resource-id': id('clips_tab'), 'content-desc': 'Reels' },
    { 'resource-id': id('direct_tab'), 'content-desc': 'Message' }];
  const withEntry = [option, { text: 'Go to post', clickable: 'true', bounds: '[0,1200][1080,1300]' }];
  const opener = actionManager([withEntry]);
  assert.equal(await opener.manager.openFullPostFromFeed('phone1', inline), true);
  assert.equal(opener.taps.at(-1).text, 'Go to post', 'hanya entri berlabel itu yang diketuk');
  // Menu tanpa entri tersebut ditutup lagi, bukan diketuk sembarang.
  const without = actionManager([[{ text: 'Copy link', clickable: 'true', bounds: '[0,1200][1080,1300]' }]]);
  assert.equal(await without.manager.openFullPostFromFeed('phone1', inline), false);
  assert.equal(without.backs.length, 1);
  // Tanpa tombol menu, tidak ada yang dilakukan sama sekali.
  const none = actionManager([[]]);
  assert.equal(await none.manager.openFullPostFromFeed('phone1', inline.filter(n => n['resource-id'] !== id('media_option_button'))), false);
  assert.equal(none.taps.length, 0);
});
test('the long-press menu that hides the opened post is recognised and other screens are not', () => {
  assert.ok(contextMenu(contextMenuNodes()));
  assert.equal(contextMenu(actionBar()), null, 'layar postingan biasa bukan menu');
  assert.equal(contextMenu([]), null);
  assert.equal(contextMenu([{ 'resource-id': id('context_menu_item'), 'content-desc': 'Reply' }]), null,
    'baris item tanpa wadah menu tidak dianggap menu');
});
test('a long-press menu is closed with Back and never tapped through', async () => {
  const { manager, taps, backs } = actionManager([contextMenuNodes(), actionBar()]);
  const settled = await manager.clearActionBlockers('phone1', contextMenuNodes());
  assert.equal(backs.length, 1, 'menu ditutup dengan Back');
  assert.equal(taps.length, 0, 'tidak ada ketukan buta di dalam menu');
  assert.equal(saveState(settled).status, 'not_saved', 'layar setelah menu ditutup yang dipakai, bukan node menu');
  assert.equal(manager.overlaysClosed, 1, 'penutupan menu tercatat untuk pemantauan');
});
test('a post that is already saved is still read from the screen the menu was hiding', async () => {
  const { manager, taps, backs } = actionManager([contextMenuNodes(), actionBar({ save: 'Remove from saved' })]);
  assert.equal((await manager.savePost('phone1', contextMenuNodes())).status, 'already');
  assert.equal(backs.length, 1);
  assert.equal(taps.length, 0, 'simpan tidak diketuk ulang dari layar yang belum terbaca');
});
test('switching accounts is not blocked by a menu left over the post', async () => {
  const { manager, backs } = actionManager([contextMenuNodes(), actionBar()]);
  assert.equal(contextMenu(await manager.closeSheets('phone1')), null);
  assert.equal(backs.length, 1);
});
test('the feed player is left with the menu closed instead of leaving it over the screen', async () => {
  const option = { 'resource-id': id('media_option_button'), clickable: 'true', bounds: '[948,649][1080,793]' };
  const { manager, taps, backs } = actionManager([contextMenuNodes()]);
  assert.equal(await manager.openFullPostFromFeed('phone1', [option]), false);
  assert.equal(backs.length, 1, 'menu tekan-lama yang menggantikan lembar aksi ikut ditutup');
  assert.equal(taps.length, 1, 'hanya tombol "..." yang diketuk');
});
test('blockers are cleared before the next tap, and the dialog Undo is never touched', async () => {
  const { manager } = actionManager([snackbar('Saved'), actionBar()]);
  assert.equal(snackbarMessage(await manager.clearActionBlockers('phone1', snackbar('Saved'))), '');
  const stuck = actionManager([snackbar('Saved')]).manager;
  await assert.rejects(stuck.clearActionBlockers('phone1', snackbar('Saved')), /belum hilang/);
  // Dialog repost menutupi layar; hanya tombol Close yang diketuk, bukan Undo.
  const closed = actionManager([actionBar()]);
  assert.equal(repostDialog(await closed.manager.clearActionBlockers('phone1', repostDialogNodes())), null);
  assert.equal(closed.taps.length, 1);
  assert.equal(closed.taps[0]['content-desc'], 'Close', 'Undo tidak pernah disentuh');
});
test('the Meta account screen is recognised, and it is only that screen', () => {
  assert.ok(metaAccountScreen(metaAccountNodes()));
  assert.equal(metaAccountScreen(actionBar()), false, 'layar postingan biasa bukan layar Meta');
  assert.equal(metaAccountScreen([{ text: 'Meta Account' }]), false, 'judul saja tanpa menu bukan layar itu');
  assert.equal(metaAccountScreen([{ text: 'Account overview' }]), false, 'menu saja tanpa judul bukan layar itu');
  assert.equal(metaAccountScreen(contextMenuNodes().map(n => ({ ...n, text: 'Meta Account' }))), false);
  assert.equal(metaDoneButton(metaAccountNodes()).text, 'Done');
  assert.ok(metaDoneButton([{ text: 'Selesai' }]), 'label Indonesia juga dikenali');
});
test('the Meta account screen is closed with its Done button, not with Back', async () => {
  // Tombol Kembali tidak menutup layar ini (diuji pada Samsung 05, 15 Okt 2026): tanpa
  // mengetuk "Done", pembacaan profil akun gagal berulang kali.
  // Setelah "Done" diketuk, layar berubah menjadi halaman biasa: itulah yang dibaca berikutnya.
  const { manager, taps, backs } = actionManager([actionBar()]);
  const settled = await manager.clearActionBlockers('phone1', metaAccountNodes());
  assert.deepEqual(taps.map(n => n.text), ['Done']);
  assert.equal(backs.length, 0, 'Kembali tidak dipakai untuk layar ini');
  assert.equal(manager.overlaysClosed, 1, 'penutupan layar tercatat untuk pemantauan');
  assert.equal(saveState(settled).status, 'not_saved', 'layar setelah ditutup yang dipakai, bukan node layar Meta');
  // Tanpa tombol Done, tidak ada ketukan buta.
  const blind = actionManager([metaAccountNodes().filter(n => n.text !== 'Done')]);
  assert.equal(await blind.manager.dismissMetaAccount('phone1', metaAccountNodes().filter(n => n.text !== 'Done')), null);
  assert.equal(blind.taps.length, 0);
});
test('a keyboard that needs a second Back is still dismissed, and a stuck one holds the draft', async () => {
  const build = () => {
    const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
    manager.inputPause = async () => {};
    manager.readCommentInput = async () => [{ 'resource-id': id('comment_composer_post_button'), enabled: 'true', bounds: '[900,1600][1000,1700]' }];
    manager.backs = 0;
    manager.back = async () => { manager.backs++; if (manager.imeLeft > 0) manager.imeLeft--; };
    manager.imeShown = async () => manager.imeLeft > 0;
    return manager;
  };
  // Keyboard baru hilang pada Kembali kedua: komentar tetap dikirim, bukan ditinggalkan.
  const twice = build(); twice.imeLeft = 2;
  assert.equal((await twice.prepareCommentSend('phone1', 'halo')).enabled, 'true');
  assert.equal(twice.backs, 2, 'Kembali diulang sampai keyboardnya hilang');
  // Keyboard yang tetap membandel menahan draft, dan tidak ada ketukan Kirim.
  const stuck = build(); stuck.imeLeft = 9;
  await assert.rejects(() => stuck.prepareCommentSend('phone1', 'halo'), /Keyboard masih menutupi/);
  assert.equal(stuck.backs, 3, 'percobaan dibatasi, tidak menekan Kembali tanpa henti');
  // Tanpa keyboard, tidak ada Kembali sama sekali.
  const clean = build(); clean.imeLeft = 0;
  await clean.prepareCommentSend('phone1', 'halo');
  assert.equal(clean.backs, 0);
});
test('the total stop halts every process and clears flags a stopped run left behind', async () => {
  // Penanda yang tersangkut inilah yang membuat pekerjaan baru ditolak dengan pesan
  // "Masih ada proses Instagram yang berjalan" walau tidak ada yang benar-benar berjalan.
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  manager.save = async () => {};
  manager.log = () => {};
  manager.job = { id: 'job1', status: 'running', accounts: [], logs: [] };
  manager.previewPending = true;
  manager.scanPending = Promise.resolve();
  manager.scanActive = true;
  manager.locks.add('phone1');
  assert.deepEqual(manager.blockers(), ['auto komen', 'pemindaian akun', 'pemeriksaan', '1 HP sedang dipakai']);
  assert.throws(() => manager.start({ accounts: [] }), /Masih ada proses Instagram yang berjalan \(auto komen, pemindaian akun, pemeriksaan, 1 HP sedang dipakai\)/);
  const result = await manager.stopEverything({ waitMs: 0 });
  assert.deepEqual(result.stopped, ['auto komen', 'pemindaian akun', 'pemeriksaan', '1 HP sedang dipakai']);
  assert.deepEqual(result.forced.sort(), ['1 kunci HP', 'pemeriksaan', 'pemindaian akun'].sort());
  assert.equal(manager.job.status, 'stopping', 'pekerjaan yang berjalan masuk ke keadaan berhenti');
  assert.equal(manager.previewPending, false);
  assert.equal(manager.scanPending, null);
  assert.equal(manager.scanActive, false);
  assert.equal(manager.locks.size, 0);
  assert.deepEqual(manager.blockers(), ['auto komen'], 'sisa penanda bersih, hanya pekerjaan yang memang sedang berhenti');
});
test('a retried step reopens the post without sending the contact a second message', async () => {
  const fake = fakeRunner(), shares = [];
  fake.manager.savePost = async (serial, nodes) => ({ status: 'saved', nodes });
  fake.manager.repostPost = async (serial, nodes) => ({ status: 'reposted', nodes });
  fake.manager.sharePost = async (serial, nodes, account) => { shares.push(account); return { status: 'sent', to: 'akun.contoh107', nodes }; };
  const thread = fake.manager.openThread;
  let reads = 0;
  fake.manager.openThread = async (...args) => { if (++reads === 1) throw new NetworkError('Temporary offline'); return thread(...args); };
  const job = jobFor([plan()]);
  await fake.manager.run(job);
  assert.equal(shares.length, 1, 'pesan langsung ke kontak tidak boleh terkirim dua kali saat langkah diulang');
  assert.equal(fake.sent.length, 1, 'komentar juga tidak dikirim dua kali');
  assert.equal(job.accounts[0].saved, 1); assert.equal(job.accounts[0].shared, 1);
});
