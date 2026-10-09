import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi, switcherAccounts, gridPosts, gridTiles, composerAccount, validatePlan, postFingerprint, likeState, threadComments, postCaption, commentCount } from '../server/instagram-core.mjs';
import { InstagramManager, BlockedError, NetworkError } from '../server/instagram.mjs';
import { JobLogs } from '../server/joblog.mjs';

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
function fakeRunner({ existing = 0, uncertain = false, stopBeforeSend = false, blockedOn = null, devices = ['phone1', 'phone2'], owners = {}, complete = true } = {}) {
  const owner = serial => owners[serial] || 'account.one';
  const manager = new InstagramManager({ statePath: '/unused', devices: () => devices.map(serial => ({ serial, status: 'device' })) });
  const drafts = new Map(), submitted = new Map(), sent = [], requests = [];
  manager.save = async () => {}; manager.back = async () => {}; manager.wait = async () => {};
  manager.readScreen = async () => ''; manager.logs.write = () => {}; manager.logs.create = async () => null;
  manager.net = { macOnline: async () => true, phoneOnline: async () => true, restoreInternet: async () => ({ online: true }) };
  manager.accountSheet = async () => {};
  let current = 0;
  manager.openPost = async (serial, account, target, index) => { current = index; return { nodes: [], pinned: 0, fingerprint: `post-${index}` }; };
  manager.likePost = async () => 'liked';
  manager.openThread = async () => ({ caption: 'Banjir melanda Bekasi', loaded: true, complete, mine: [...Array.from({ length: existing }, (_, i) => `lama ${i}`), ...sent.filter(x => x.serial === 'phone1' && x.post === current).map(x => x.text)], others: ['orang lain'] });
  manager.generate = async request => { requests.push(request); return { suasana: 'bencana', tone: request.tone, comments: Array.from({ length: request.count }, (_, i) => `Komentar ${requests.length}-${i}`) }; };
  manager.typeComment = async (serial, text) => { drafts.set(serial, text); if (stopBeforeSend) manager.stopRequested = true; };
  manager.tap = async (serial, node) => {
    if (node['resource-id'] !== SEND) return;
    assert.ok(manager.state.history.at(-1).status === 'sending', 'reserve the attempt before tapping Send');
    if (blockedOn === serial) { submitted.set(serial, 'blocked'); return; }
    sent.push({ serial, text: drafts.get(serial), post: current }); submitted.set(serial, drafts.get(serial)); drafts.delete(serial);
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
test('an uncertain send is not resent until the screen proves it missing, and Stop prevents submission before Send', async () => {
  const uncertain = fakeRunner({ uncertain: true, complete: false }), first = jobFor([plan()]);
  await uncertain.manager.run(first);
  assert.equal(uncertain.manager.state.history[0].status, 'uncertain'); assert.equal(first.accounts[0].status, 'done');
  assert.match(first.accounts[0].note, /dicocokkan ulang/);
  await uncertain.manager.run(jobFor([plan()]));
  assert.equal(uncertain.sent.length, 1, 'a partly loaded list never proves a comment missing');
  assert.equal(uncertain.manager.state.history[0].status, 'sent', 'the earlier text is now visible, so it is reconciled as sent');
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
  fake.manager.openPost = async (serial, account, target, index) => {
    tries.set(index, (tries.get(index) || 0) + 1);
    if (index < 3 && tries.get(index) <= 5) throw new NetworkError('Postingan belum termuat.');
    return open(serial, account, target, index);
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
  assert.equal(job.accounts[0].status, 'done'); assert.equal(job.accounts[1].status, 'failed'); assert.match(job.accounts[1].note, /internet/);
});
test('"Memposting…" is awaited, and "Gagal memposting" releases the count so the gap is filled later', async () => {
  for (const [screens, expected] of [[['posting', 'posting', 'visible'], 'sent'], [['posting', 'failed'], 'failed']]) {
    const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
    manager.save = async () => {}; manager.readScreen = async () => ''; manager.logs.write = () => {};
    manager.verifiedAccounts.set('phone1', { username: 'account.one', at: Date.now() });
    manager.net = { macOnline: async () => true, phoneOnline: async () => true, restoreInternet: async () => ({ online: true }) };
    let typed = '', sent = false;
    manager.tap = async (serial, node) => { if (node['resource-id'] === SEND) sent = true; };
    manager.typeComment = async (serial, text) => { typed = text; };
    manager.ui = async () => {
      if (!sent) return [{ 'resource-id': COMPOSER, text: typed || 'Tambahkan komentar…' }, ...(typed ? [{ 'resource-id': SEND, enabled: 'true' }] : [])];
      const next = screens.shift() || 'visible';
      const base = [{ 'resource-id': COMPOSER, text: 'Tambahkan komentar…' }];
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
test('reconciliation: a pending comment found on screen becomes sent; missing from a full list becomes failed', () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [] });
  manager.logs.write = () => {};
  manager.state.history = [{ key: 'k', text: 'Ada di layar', status: 'posting' }, { key: 'k', text: 'Tidak ada', status: 'uncertain' }, { key: 'k', text: 'Sudah', status: 'sent' }];
  manager.setCount('k', 3);
  const job = { logs: [] };
  manager.reconcile(job, {}, 'k', { mine: ['Ada di layar', 'Sudah'], complete: false });
  assert.deepEqual(manager.state.history.map(r => r.status), ['sent', 'uncertain', 'sent'], 'a partly loaded list proves nothing missing');
  manager.reconcile(job, {}, 'k', { mine: ['Ada di layar', 'Sudah'], complete: true });
  assert.equal(manager.state.history[1].status, 'failed'); assert.equal(manager.countFor('k'), 2);
});
test('a comment list that has not loaded is skipped instead of guessed, unless a count is already stored', async () => {
  const fake = fakeRunner();
  fake.manager.openThread = async () => ({ caption: '', loaded: false, complete: false, mine: [], others: [] });
  const job = jobFor([plan()]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 0); assert.equal(job.accounts[0].missed, 1);
  assert.ok(job.logs.some(l => /supaya tidak mengirim berlebih/.test(l.message)));
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
  assert.equal(offline.sent.length, 0); assert.equal(job.accounts[0].status, 'failed'); assert.ok(restored >= 1);
  const flaky = fakeRunner({ complete: false }); let calls = 0;
  // Online for the start, the post and the pre-send check; offline right after Send.
  flaky.manager.net.phoneOnline = async () => ++calls <= 3;
  const second = jobFor([plan()]);
  await flaky.manager.run(second);
  assert.equal(flaky.sent.length, 1); assert.equal(flaky.manager.state.history[0].status, 'uncertain');
  assert.ok(second.logs.some(l => /HP sedang offline/.test(l.message)));
});

test('posts with identical captions are told apart by grid order, and a fully read list corrects the stored count', async () => {
  const fake = fakeRunner();
  const open = fake.manager.openPost;
  fake.manager.openPost = async (...args) => ({ ...(await open(...args)), fingerprint: 'same-caption' });
  const job = jobFor([plan({ posts: 2 })]);
  await fake.manager.run(job);
  assert.equal(fake.sent.length, 2, 'both posts get their comment');
  assert.equal(fake.manager.countFor('account.one:same-caption'), 1); assert.equal(fake.manager.countFor('account.one:same-caption#2'), 1);
  assert.ok(job.logs.some(l => /dibedakan sebagai yang ke-2/.test(l.message)));
  const stale = fakeRunner();
  stale.manager.setCount('account.one:post-0', 1);
  const second = jobFor([plan()]);
  await stale.manager.run(second);
  assert.equal(stale.sent.length, 1, 'the stored 1 is not on screen in a complete list, so the comment is sent');
  assert.ok(second.logs.some(l => /mengikuti layar/.test(l.message)));
});
