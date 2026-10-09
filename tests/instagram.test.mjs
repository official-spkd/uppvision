import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, switcherAccounts, gridPosts, gridTiles, composerAccount, validatePlan, postFingerprint, likeState, threadComments, postCaption } from '../server/instagram-core.mjs';
import { InstagramManager, BlockedError } from '../server/instagram.mjs';

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
function fakeRunner({ existing = 0, uncertain = false, stopBeforeSend = false, blockedOn = null, devices = ['phone1', 'phone2'], owners = {} } = {}) {
  const owner = serial => owners[serial] || 'account.one';
  const manager = new InstagramManager({ statePath: '/unused', devices: () => devices.map(serial => ({ serial, status: 'device' })) });
  const drafts = new Map(), submitted = new Map(), sent = [], requests = [];
  manager.save = async () => {}; manager.back = async () => {}; manager.wait = async () => {};
  manager.accountSheet = async () => {};
  manager.openPost = async (serial, account, target, index) => ({ nodes: [], pinned: 0, fingerprint: `post-${index}` });
  manager.likePost = async () => 'liked';
  manager.openThread = async () => ({ caption: 'Banjir melanda Bekasi', mine: Array.from({ length: existing }, (_, i) => `lama ${i}`), others: ['orang lain'] });
  manager.generate = async request => { requests.push(request); return { suasana: 'bencana', tone: request.tone, comments: Array.from({ length: request.count }, (_, i) => `Komentar ${requests.length}-${i}`) }; };
  manager.typeComment = async (serial, text) => { drafts.set(serial, text); if (stopBeforeSend) manager.stopRequested = true; };
  manager.tap = async (serial, node) => {
    if (node['resource-id'] !== SEND) return;
    assert.ok(manager.state.history.at(-1).status === 'sending', 'reserve the attempt before tapping Send');
    if (blockedOn === serial) { submitted.set(serial, 'blocked'); return; }
    sent.push({ serial, text: drafts.get(serial) }); submitted.set(serial, drafts.get(serial)); drafts.delete(serial);
  };
  manager.ui = async serial => {
    if (submitted.has(serial)) {
      const text = submitted.get(serial); submitted.delete(serial);
      if (text === 'blocked') return [{ text: 'Coba lagi nanti' }];
      return [{ 'resource-id': COMPOSER, text: `Comment as ${owner(serial)}…` }, ...(uncertain ? [] : [{ 'content-desc': `${owner(serial)} mengatakan ${text}` }])];
    }
    return [{ 'resource-id': COMPOSER, text: drafts.get(serial) || `Comment as ${owner(serial)}…` }, { 'resource-id': SEND, enabled: 'true' }];
  };
  return { manager, sent, requests };
}
const jobFor = accounts => ({ logs: [], sent: 0, skipped: 0, failed: 0, accounts: accounts.map(a => ({ ...a, status: 'waiting', sent: 0, skipped: 0, liked: 0, note: '' })) });
const plan = (overrides = {}) => ({ ...entry, target: 'target.one', ...overrides });
test('tops up to the comment target: 3 existing and a target of 4 sends exactly 1', async () => {
  const fake = fakeRunner({ existing: 3 }), job = jobFor([plan({ posts: 2, comments: 4 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 2, 'one comment on each of the two posts');
  assert.deepEqual(fake.requests.map(r => r.count), [1, 1]);
  assert.ok(fake.requests[0].hindari.includes('orang lain') && fake.requests[0].hindari.includes('lama 0'));
  assert.equal(job.status, 'completed'); assert.equal(job.accounts[0].liked, 2);
  const again = fakeRunner({ existing: 4 }), skipped = jobFor([plan({ comments: 4 })]);
  await again.manager.run(skipped);
  assert.equal(again.sent.length, 0); assert.equal(skipped.skipped, 1);
});
test('one username on two HP shares its per-post count, and other accounts avoid texts already sent', async () => {
  const fake = fakeRunner(), job = jobFor([plan({ comments: 2 }), plan({ serial: 'phone2', comments: 2 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 2); assert.equal(fake.manager.countFor('account.one:post-0'), 2);
  assert.equal(fake.manager.locks.size, 0);
});
test('does not retry an uncertain send, and Stop prevents submission before Send', async () => {
  const uncertain = fakeRunner({ uncertain: true }), first = jobFor([plan()]);
  await uncertain.manager.run(first);
  assert.equal(uncertain.manager.state.history[0].status, 'uncertain'); assert.equal(first.accounts[0].status, 'failed');
  await uncertain.manager.run(jobFor([plan()]));
  assert.equal(uncertain.sent.length, 1);
  const stopped = fakeRunner({ stopBeforeSend: true }), job = jobFor([plan()]);
  await stopped.manager.run(job);
  assert.equal(stopped.sent.length, 0); assert.equal(job.status, 'stopped');
  assert.equal(stopped.manager.countFor('account.one:post-0'), 0, 'a cancelled attempt releases its reservation');
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
  manager.inspect = async account => { manager.stop(); await manager.ui(account.serial); reads++; return { ok: true }; };
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
test('start mode: "serentak" starts every HP at once, "bertahap" chains them 10–20 s apart', async () => {
  for (const [startMode, expected] of [['serentak', 0], ['bertahap', 1]]) {
    const fake = fakeRunner({ owners: { phone2: 'account.two' } }), waits = [];
    fake.manager.wait = async ms => { waits.push(ms); };
    const job = { ...jobFor([plan(), plan({ serial: 'phone2', username: 'account.two' })]), startMode };
    await fake.manager.run(job);
    const startDelays = waits.filter(ms => ms >= 10000);
    assert.equal(startDelays.length, expected, startMode);
    assert.ok(startDelays.every(ms => ms <= 20000));
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
  manager.gridTile = async () => ({ tile: { bounds: '[0,0][10,10]' }, pinned: 0 });
  manager.tap = async () => {}; manager.nudge = async () => { nudges++; };
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  const post = await manager.openPost('phone1', 'account.one', 'target.one', 2);
  assert.equal(nudges, 1); assert.equal(typeof post.fingerprint, 'string');
});
