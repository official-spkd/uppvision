import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramTarget, instagramTargets, isInstagramPostTarget, targetLabel, effectivePostCount, validCommentSettings } from '../src/instagram-target.mjs';
import { validatePlan, postFingerprint } from '../server/instagram-core.mjs';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
import { TikTokManager } from '../server/tiktok.mjs';

const URL = 'https://www.instagram.com/p/DeYYk_yNvkE/';
const entry = { serial: 'phone1', username: 'account.one', target: URL, posts: 10, comments: 2, tone: 'positif' };
const devices = [{ serial: 'phone1', accounts: [{ username: 'account.one' }] }];
const id = suffix => `com.instagram.android:id/${suffix}`;
const feed = owner => [
  { 'resource-id': id('row_feed_photo_profile_name'), text: owner },
  { 'resource-id': id('row_feed_button_comment'), bounds: '[0,600][100,680]' },
  { 'resource-id': id('row_feed_button_share'), bounds: '[120,600][200,680]' },
  { 'resource-id': id('row_feed_photo_imageview'), 'content-desc': `Photo by ${owner}. Landscape.`, bounds: '[0,0][1000,500]' },
  { text: `${owner} Kabut asap Palangka Raya`, class: 'IgTextLayoutView', bounds: '[0,700][1000,800]' },
];
// Menu tekan-lama, disalin dari dump asli Samsung 09: selama menu ini terbuka, UI Automator
// hanya memuat isi menu, bukan halaman postingan di bawahnya.
const longPressMenu = () => [
  { 'resource-id': id('context_menu'), bounds: '[371,1016][950,1544]' },
  { 'resource-id': id('context_menu_options_list'), bounds: '[371,1028][950,1532]' },
  { 'resource-id': id('context_menu_item'), 'content-desc': 'Reply', bounds: '[371,1028][950,1196]' },
  { 'resource-id': id('context_menu_item'), 'content-desc': 'Mute', bounds: '[371,1364][950,1532]' },
];
function setup({ owner = 'target.one', pinned = false } = {}) {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const events = [];
  const nodes = [...feed(owner), ...(pinned ? [{ 'content-desc': 'Pinned' }] : [])];
  manager.openPostUrl = async (serial, url) => { events.push(['open', url]); };
  manager.closeSheets = async () => {};
  manager.ui = async () => nodes;
  manager.tap = async () => assert.fail('opening a link must not tap the post directly');
  manager.back = async () => { events.push(['back']); };
  manager.ownProfile = async () => assert.fail('link processing must not navigate back to profile');
  manager.verifiedAccounts.set(entry.serial, { username: entry.username, at: Date.now() });
  manager.wait = async () => {};
  manager.expandCaption = async (serial, after) => ({ nodes: after, caption: 'Kabut asap Palangka Raya' });
  manager.log = (job, message) => { events.push(['log', message]); };
  manager.net.phoneOnline = async () => true;
  manager.likePost = async () => { events.push(['like']); return 'already'; };
  // Simpan, repost, dan share hanya dicatat sebagai peristiwa di berkas ini; berkas ini
  // menjaga perilaku mode link, sedangkan alur aksi punya test tersendiri.
  manager.savePost = async (serial, nodes) => { events.push(['save']); return { status: 'unverified', nodes }; };
  manager.repostPost = async (serial, nodes) => { events.push(['repost']); return { status: 'unverified', nodes }; };
  manager.sharePost = async (serial, nodes) => { events.push(['share']); return { status: 'unverified', to: '', nodes }; };
  manager.generate = async ({ count }) => ({ comments: Array.from({ length: count }, (_, i) => `New ${i}`) });
  manager.sendComment = async (job, entry, key) => { events.push(['send']); manager.setCount(key, manager.countFor(key) + 1); entry.sent = (entry.sent || 0) + 1; job.sent = (job.sent || 0) + 1; return 'sent'; };
  return { manager, events, nodes };
}
test('direct URL canonicalization retains shortcode case, strips tracking and rejects foreign or malformed targets', () => {
  assert.deepEqual(instagramTarget('@Target.One'), { kind: 'profile', target: 'target.one' });
  assert.deepEqual(instagramTarget(`${URL}?igsh=abc#part`), { kind: 'post', shortcode: 'DeYYk_yNvkE', target: URL });
  assert.equal(instagramTarget('https://m.instagram.com/reel/DeYYk_yNvkE').shortcode, 'DeYYk_yNvkE');
  for (const value of ['https://instagram.com.evil.test/p/DeYYk_yNvkE/', 'https://evil.test/p/DeYYk_yNvkE/', 'https://user:pass@instagram.com/p/DeYYk_yNvkE/', 'http://instagram.com/p/DeYYk_yNvkE/', 'https://instagram.com:444/p/DeYYk_yNvkE/', 'https://instagram.com/stories/DeYYk_yNvkE/', 'https://instagram.com/p/DeYYk_yNvkE/more', 'https://instagram.com/p/a/', 'https://instagram.com\\@evil.test/p/DeYYk_yNvkE/', 'https://instagram.com/p/DeYYk_yNvkE/\nnext']) assert.throws(() => instagramTarget(value), value);
  assert.equal(isInstagramPostTarget(URL), true);
  assert.equal(isInstagramPostTarget('invalid target'), false);
  assert.equal(targetLabel(URL), URL);
});
test('a pasted link that carries the profile name in front of the post type is accepted and canonicalised', () => {
  // The form Instagram's own app puts on the clipboard; it used to be rejected outright.
  assert.deepEqual(instagramTarget('https://www.instagram.com/akun.contoh21/reel/Dee3DCPhqe-/'), { kind: 'post', shortcode: 'Dee3DCPhqe-', target: 'https://www.instagram.com/reel/Dee3DCPhqe-/' });
  assert.deepEqual(instagramTarget('https://www.instagram.com/akun.contoh21/p/DeYYk_yNvkE/'), { kind: 'post', shortcode: 'DeYYk_yNvkE', target: URL });
  assert.equal(instagramTarget('https://instagram.com/some.one/reel/DeYYk_yNvkE?igsh=x').shortcode, 'DeYYk_yNvkE');
  const both = instagramTargets(`https://www.instagram.com/akun.contoh21/reel/DeYYk_yNvkE/\nhttps://www.instagram.com/p/DeYYk_yNvkE/`);
  assert.equal(both.targets.length, 1, 'the same post pasted in both shapes must count once');
  assert.equal(effectivePostCount({ target: 'https://www.instagram.com/akun.contoh21/reel/Dee3DCPhqe-/', posts: 9 }), 1);
  for (const value of ['https://instagram.com/akun.contoh21/stories/DeYYk_yNvkE/', 'https://evil.test/akun.contoh21/reel/DeYYk_yNvkE/', 'https://instagram.com/../p/DeYYk_yNvkE/x/']) assert.throws(() => instagramTarget(value), value);
  assert.equal(isInstagramPostTarget(URL), true);
  assert.equal(isInstagramPostTarget('invalid target'), false);
  assert.equal(targetLabel(URL), URL);
});
test('a URL plan always has exactly one post; inherited TikTok endpoints still reject it', () => {
  assert.equal(validatePlan({ accounts: [entry] }, devices).accounts[0].posts, 1);
  assert.throws(() => validatePlan({ accounts: [entry] }, devices, { allowPostLinks: false }));
  const manager = new TikTokManager({ statePath: '/unused', devices: () => [] });
  manager.state.devices = devices;
  assert.throws(() => manager.start({ accounts: [entry] }), /username/);
});
test('panel counts and validates the effective one-post setting after a profile or bulk setting becomes a link', () => {
  const oldProfile = { ...entry, target: 'target.one', posts: 10, comments: 2 };
  const linked = { ...oldProfile, target: URL };
  assert.equal(effectivePostCount(oldProfile) * oldProfile.comments, 20);
  assert.equal(effectivePostCount(linked) * linked.comments, 2);
  assert.equal(effectivePostCount({ ...linked, posts: '' }), 1);
  assert.equal(validCommentSettings(linked), true);
  assert.equal(validCommentSettings({ ...linked, comments: 0 }), false);
  assert.equal(validCommentSettings({ ...oldProfile, posts: '' }), false);
  assert.equal(validCommentSettings({ ...linked, target: 'https://evil.test/p/DeYYk_yNvkE/' }), false);
  assert.equal(validCommentSettings(linked, 'tt'), false);
  assert.equal(effectivePostCount(oldProfile, 'tt'), 10);
});
test('explicit URL locks without navigation, opens once even if pinned and reuses profile history', async () => {
  const { manager, events, nodes } = setup({ pinned: true });
  const result = await manager.lockPosts({ logs: [] }, entry, {});
  assert.equal(result.posts.length, 1); assert.equal(result.pinned, 0);
  assert.equal(Object.isFrozen(result.posts), true); assert.equal(Object.isFrozen(result.posts[0]), true);
  assert.equal(result.posts[0].url, URL);
  assert.equal(events.some(e => e[0] === 'open'), false, 'locking the input URL does not open the post');
  const post = await manager.openPost(entry.serial, entry.username, entry.target, result.posts[0]);
  assert.equal(post.fingerprint, postFingerprint(nodes, 'target.one'));
  assert.equal(post.owner, 'target.one');
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
  assert.equal(events.some(e => ['like', 'send'].includes(e[0])), false);
  assert.equal(events.filter(e => e[0] === 'back').length, 0);
});
test('a tall linked video reveals its caption in place even if the owner header scrolls away', async () => {
  const { manager, nodes, events } = setup();
  nodes.splice(0, nodes.length, { 'resource-id': id('row_feed_photo_profile_name'), text: 'target.one' },
    { 'resource-id': id('row_feed_button_comment'), bounds: '[200,1760][272,1776]' },
    { 'resource-id': id('row_feed_button_share'), bounds: '[500,1760][574,1776]' });
  manager.nudge = async () => { events.push(['nudge']); nodes.splice(0, nodes.length, ...feed('target.one').filter(n => n['resource-id'] !== id('row_feed_photo_profile_name'))); };
  const post = await manager.openPost(entry.serial, entry.username, entry.target, { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE' });
  assert.equal(post.owner, 'target.one');
  assert.equal(events.filter(e => e[0] === 'nudge').length, 1);
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
  assert.equal(events.filter(e => e[0] === 'back').length, 0);
});
test('a long-press menu over the opened post is closed instead of reported as an unopened post', async () => {
  const { manager, events, nodes } = setup();
  const screens = [longPressMenu(), nodes];
  manager.actionPause = async () => {};
  manager.ui = async () => (screens.length > 1 ? screens.shift() : screens[0]);
  manager.back = async () => { events.push(['back']); };
  const post = await manager.openPost(entry.serial, entry.username, entry.target, { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE' });
  assert.equal(post.owner, 'target.one', 'halaman di bawah menu tetap dipakai');
  assert.equal(post.fingerprint, postFingerprint(nodes, 'target.one'));
  assert.equal(events.filter(e => e[0] === 'back').length, 1, 'menu ditutup sekali dengan Back');
  assert.equal(events.filter(e => e[0] === 'open').length, 1, 'tautan tidak dibuka ulang');
  assert.equal(manager.overlaysClosed, 1);
});
test('a menu that will not close stops the opening instead of reopening the link forever', async () => {
  const { manager, events } = setup();
  manager.actionPause = async () => {};
  manager.ui = async () => longPressMenu();
  manager.back = async () => { events.push(['back']); };
  await assert.rejects(manager.openPost(entry.serial, entry.username, entry.target, { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE' }), /belum terbuka/);
  assert.equal(events.filter(e => e[0] === 'back').length, 3, 'penutupan menu dibatasi, tidak mengulang tanpa henti');
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
});
test('a link that opens as a reel inside the feed is marked for manual action instead of retried', async () => {
  const { manager, events, nodes } = setup();
  // Salinan keadaan nyata Samsung 05/06/10: pemilik terbaca, nav bawah ada, tetapi baris aksi tidak
  // ada dan menu "..." hanya memuat entri lain (tidak ada "Go to post").
  const inline = [
    { 'resource-id': id('row_feed_photo_profile_name'), text: 'target.one', bounds: '[147,643][948,719]' },
    { 'resource-id': id('media_option_button'), clickable: 'true', bounds: '[948,649][1080,793]' },
    { 'resource-id': id('media_group'), clickable: 'true', bounds: '[0,643][1080,1632]' },
    { 'resource-id': id('feed_tab'), 'content-desc': 'Home', bounds: '[0,1632][216,1776]' },
    { 'resource-id': id('clips_tab'), 'content-desc': 'Reels', bounds: '[216,1632][432,1776]' },
    { 'resource-id': id('direct_tab'), 'content-desc': 'Message', bounds: '[432,1632][648,1776]' },
  ];
  manager.ui = async () => inline;
  manager.tap = async () => {};
  manager.actionPause = async () => {};
  manager.prepareDevice = async () => {};
  manager.accountSheet = async () => {};
  manager.save = async () => {};
  manager.readScreen = async () => '';
  manager.logScreen = async () => {};
  manager.net.macOnline = async () => true;
  const account = { ...entry, posts: 1, comments: 1, liked: 0, skipped: 0, sent: 0 };
  const job = { id: 'feed-reel', logs: [], accounts: [account], sent: 0, skipped: 0, failed: 0 };
  await manager.runAccount(job, account);
  assert.equal(account.status, 'needs_action');
  assert.match(account.note, /perlu dikerjakan manual di HP/);
  assert.equal(events.filter(e => e[0] === 'open').length, 1, 'tautan tidak dibuka ulang berkali-kali');
  assert.equal(events.some(e => e[0] === 'send'), false);
  assert.equal(job.failed, 0, 'keadaan ini bukan kegagalan script');
});
test('own post and changed known owner still stop before any like/send', async () => {
  for (const config of [{ owner: 'account.one' }, { owner: 'other.owner' }]) {
    const { manager, events } = setup(config);
    const ref = { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE', owner: 'target.one' };
    await assert.rejects(manager.processPost({ logs: [] }, { ...entry }, 0, ref, {}), /sendiri|Pemilik/);
    assert.equal(events.some(e => ['like', 'send'].includes(e[0])), false);
  }
});
test('URL sending uses the resolved owner and ignores prior profile counts', async () => {
  const { manager, nodes, events } = setup();
  const key = `account.one:${postFingerprint(nodes, 'target.one')}`;
  manager.state.counts[key] = { count: 2 };
  manager.save = async () => {}; manager.readScreen = async () => '';
  manager.openThread = async (serial, account, target) => {
    assert.equal(target, 'target.one');
    return { caption: 'Kabut asap Palangka Raya', loaded: true, complete: false, mine: ['existing one'], others: [] };
  };
  const job = { logs: [], skipped: 0 }, account = { ...entry, liked: 0, skipped: 0 };
  await manager.processPost(job, account, 0, { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE', owner: 'target.one' }, {});
  assert.equal(account.targetOwner, 'target.one');
  assert.equal(job.skipped, 0); assert.equal(events.filter(e => e[0] === 'send').length, entry.comments);
});
test('partial URL thread does not block the new-comment quota', async () => {
  const { manager, events } = setup();
  manager.save = async () => {}; manager.readScreen = async () => '';
  manager.openThread = async () => ({ loaded: true, complete: false, mine: [], others: ['other comment'] });
  await manager.processPost({ logs: [] }, { ...entry, liked: 0 }, 0, { kind: 'post', url: URL, shortcode: 'DeYYk_yNvkE', owner: 'target.one' }, {});
  assert.equal(events.filter(e => e[0] === 'send').length, entry.comments);
});

function runningLink() {
  const fixture = setup(), { manager, events } = fixture;
  const account = { ...entry, posts: 1, comments: 3, liked: 0, skipped: 0, sent: 0 };
  const job = { id: 'link-run', logs: [], accounts: [account], sent: 0, skipped: 0, failed: 0 };
  manager.prepareDevice = async () => {};
  manager.accountSheet = async () => { events.push(['account']); };
  manager.save = async () => {};
  manager.readScreen = async () => '';
  manager.logScreen = async () => {};
  manager.net.macOnline = async () => true;
  manager.openThread = async (serial, username, owner) => {
    assert.equal(owner, 'target.one', 'thread must use the owner from the first opening, not the input URL');
    events.push(['comments']);
    return { caption: 'Kabut asap Palangka Raya', loaded: true, complete: true, mine: ['Existing one', 'Existing two'], others: [] };
  };
  manager.generate = async ({ count }) => {
    assert.equal(count, 3, 'send three new comments regardless of older comments');
    return { comments: ['New one', 'New two', 'New three'], suasana: 'bencana', tone: 'positif' };
  };
  return { ...fixture, account, job };
}
test('a complete link flow opens, acts, re-verifies the post, then sends new comments without profile detours', async () => {
  const { manager, events, account, job } = runningLink();
  await manager.runAccount(job, account);
  assert.equal(account.status, 'done');
  assert.equal(job.failed, 0);
  // Pembukaan kedua sebelum 'comments' adalah verifikasi identitas tepat sebelum komentar:
  // kolom komentar pernah terbuka untuk postingan sebelumnya di uji 3 postingan 14 Okt 2026.
  assert.deepEqual(events.filter(e => e[0] !== 'log').map(e => e[0]), ['account', 'open', 'like', 'save', 'repost', 'share', 'open', 'comments', 'send', 'send', 'send']);
  assert.equal(events.filter(e => e[0] === 'open').length, 2);
  assert.equal(account.targetOwner, 'target.one');
  assert.equal(manager.state.resumableJob.accounts[0].lockedPosts[0].owner, 'target.one');
  assert.equal(manager.state.resumableJob.accounts[0].lockedPosts[0].url, URL);
  assert.ok(Object.isFrozen(account.lockedPosts[0]));
  assert.ok(events.findIndex(e => e[0] === 'log' && /dikunci/.test(e[1])) < events.findIndex(e => e[0] === 'like'));
});
test('a link network retry reopens only the original URL without another account selection', async () => {
  const { manager, events, account, job } = runningLink();
  let attempts = 0;
  manager.likePost = async () => {
    if (++attempts === 1) throw new NetworkError('Temporary offline');
    events.push(['like']); return 'already';
  };
  await manager.runAccount(job, account);
  assert.equal(account.status, 'done');
  assert.deepEqual([...new Set(events.filter(e => e[0] === 'open').map(e => e[1]))], [URL], 'hanya tautan postingan asli yang dibuka, termasuk saat memverifikasi ulang sebelum komentar');
  assert.equal(events.filter(e => e[0] === 'account').length, 1);
  assert.equal(events.filter(e => e[0] === 'send').length, 3);
});
test('a post whose identity changes before the comment step never receives a comment', async () => {
  const { manager, nodes, events, account, job } = runningLink();
  let opens = 0;
  // Sidik jari berbeda setiap pembukaan: layar tidak lagi membuktikan postingan yang sama.
  manager.openPost = async () => ({ nodes, owner: 'target.one', caption: 'Kabut asap Palangka Raya', fingerprint: `sidik-${++opens}` });
  await manager.runAccount(job, account);
  assert.equal(events.some(e => e[0] === 'send'), false, 'komentar tidak dikirim saat identitas postingan tidak terbukti');
  assert.match(account.progress[0].reason, /berubah sebelum komentar/);
  assert.equal(account.status, 'deferred');
});
test('a link retry rejects a changed owner observed after a failed first attempt', async () => {
  const { manager, nodes, events, account, job } = runningLink();
  manager.likePost = async () => {
    nodes.splice(0, nodes.length, ...feed('other.owner'));
    throw new NetworkError('Temporary offline');
  };
  await manager.runAccount(job, account);
  assert.equal(account.status, 'failed');
  assert.match(account.note, /Pemilik/);
  assert.equal(events.some(e => e[0] === 'send'), false);
});
test('link preview opens once and remains read-only', async () => {
  const { manager, events, account } = runningLink();
  manager.generate = async () => ({ comments: ['Draft only'], suasana: 'bencana', tone: 'positif' });
  manager.likePost = manager.sendComment = async () => assert.fail('preview cannot like or send');
  const before = JSON.stringify(manager.state);
  const result = await manager.inspect({ logs: [] }, account);
  assert.equal(result.existing, undefined); assert.equal(result.need, 3);
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
  assert.equal(events.filter(e => e[0] === 'account').length, 1);
  assert.equal(JSON.stringify(manager.state), before);
});
test('profile mode still checks the active account before reopening its locked post', async () => {
  const { manager, events } = setup();
  manager.ownProfile = async () => { events.push(['profile']); return { current: 'changed.account' }; };
  await assert.rejects(manager.openPost(entry.serial, entry.username, 'target.one', { key: '1:3' }), /Akun aktif/);
  assert.deepEqual(events, [['profile']]);
});

test('a link that is still loading uses bounded network retries, while an incorrect owner remains a hard stop',async()=>{
  const {manager,nodes,events,account,job}=runningLink();let reads=0;
  // Stay unloaded for the whole in-place window (12 UI dumps) so the outer retry has to take over.
  manager.ui=async()=>++reads<=12?[]:nodes;
  await manager.runAccount(job,account);
  // 2 pembukaan: percobaan pertama yang belum termuat + percobaan ulang, lalu 1 pembukaan
  // verifikasi identitas tepat sebelum komentar.
  assert.equal(account.status,'done');assert.equal(events.filter(e=>e[0]==='open').length,3);
  assert.equal(events.filter(e=>e[0]==='send').length,3);
  const wrong=runningLink();wrong.nodes.splice(0,wrong.nodes.length,...feed('wrong.owner'));
  wrong.account.lockedPosts=[{kind:'post',url:URL,shortcode:'DeYYk_yNvkE',owner:'target.one'}];
  await wrong.manager.runAccount(wrong.job,wrong.account);
  assert.equal(wrong.account.status,'failed');assert.equal(wrong.events.filter(e=>e[0]==='open').length,1);
  assert.equal(wrong.events.filter(e=>e[0]==='send').length,0);
});
