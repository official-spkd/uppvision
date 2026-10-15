import test from 'node:test';
import assert from 'node:assert/strict';
import { copyLinkButton, shareSearchField, shareClearButton, shareButton, clipsViewerActive, validateLinkRequest } from '../server/instagram-core.mjs';
import { copyOpenPostLink } from '../server/instagram-link-copy.mjs';
import { MAX_LINKS } from '../src/instagram-target.mjs';

const id = suffix => `com.instagram.android:id/${suffix}`;
const POST = [
  { 'resource-id': id('clips_author_username'), text: 'target.one', bounds: '[156,1356][490,1413]' },
  { 'resource-id': id('direct_share_button'), 'content-desc': 'Share', bounds: '[924,977][1056,1109]' },
];
const SHEET = label => [
  { 'resource-id': id('direct_private_share_recipients_container'), bounds: '[0,700][1080,1776]' },
  { 'resource-id': id('search_edit_text'), class: 'android.widget.EditText', bounds: '[192,763][852,895]' },
  { text: label, 'content-desc': label, bounds: '[279,1459][435,1615]' },
];
const PASTED = (value, label) => SHEET(label).map(n => n['resource-id']?.endsWith('search_edit_text') ? { ...n, text: value } : n).concat([{ 'content-desc': 'Clear', bounds: '[798,254][900,356]' }]);

// Papan palsu: layar berpindah mengikuti ketukan, jadi urutan aksi bisa diperiksa.
function setup({ label = 'Copy link', url = 'https://www.instagram.com/reel/Dee1i94uTmb/?vrfl=bTFnZDhrOWllMmV6', sheetHasCopy = true, page = POST } = {}) {
  const events = [];
  const state = { sheet: false, pasted: false };
  const sheet = sheetHasCopy ? SHEET(label) : [{ 'resource-id': id('direct_private_share_recipients_container'), bounds: '[0,700][1080,1776]' }];
  const manager = {
    async ui() { return state.sheet ? (state.pasted ? PASTED(url, label) : sheet) : page; },
    async tap(serial, node) {
      const field = node['resource-id']?.endsWith('search_edit_text');
      const text = (node.text || node['content-desc'] || (field ? 'Search' : '')).trim();
      events.push(['tap', text]);
      if (text === 'Share') state.sheet = true;
      // Di HP, mengetuk "Salin tautan" menutup lembar dan kembali ke halaman postingan.
      if (text === label) { state.sheet = false; events.push(['copied']); }
      if (field) state.field = true;
      if (text === 'Clear') state.pasted = false;
    },
    async paste() { events.push(['paste']); state.pasted = true; },
    async closeShareSheet() { events.push(['closeSheet']); state.sheet = false; return POST; },
    async wait() {},
  };
  return { manager, events, state };
}

test('the link menu copies the opened post link and never likes, saves, or sends anything', async () => {
  const { manager, events } = setup();
  const link = await copyOpenPostLink(manager, 'phone1');
  assert.equal(link.kind, 'post');
  assert.equal(link.shortcode, 'Dee1i94uTmb');
  assert.equal(link.target, 'https://www.instagram.com/reel/Dee1i94uTmb/', 'alamat disimpan tanpa penanda pelacakan');
  assert.deepEqual(events, [['closeSheet'], ['tap', 'Share'], ['tap', 'Copy link'], ['copied'], ['tap', 'Share'], ['tap', 'Search'], ['paste'], ['tap', 'Clear'], ['closeSheet']]);
  assert.equal(events.some(([kind]) => ['like', 'save', 'send', 'comment'].includes(kind)), false);
});

test('the Indonesian share sheet label works the same way', async () => {
  const { manager } = setup({ label: 'Salin tautan' });
  assert.equal((await copyOpenPostLink(manager, 'phone1')).shortcode, 'Dee1i94uTmb');
});

test('a share sheet without the copy row closes itself instead of pasting anything', async () => {
  const { manager, events } = setup({ sheetHasCopy: false });
  await assert.rejects(() => copyOpenPostLink(manager, 'phone1'), /Salin tautan/);
  assert.equal(events.some(([kind]) => kind === 'paste'), false, 'tanpa baris salin tidak ada yang ditempel');
  assert.equal(events.at(-1)[0], 'closeSheet');
});

test('a post whose share button cannot be read is refused', async () => {
  const { manager } = setup({ page: [{ 'resource-id': id('clips_author_username'), text: 'target.one' }] });
  await assert.rejects(() => copyOpenPostLink(manager, 'phone1'), /Tombol bagikan/);
});

test('the share button is recognised on the post page, on the feed, and in the newer viewer', () => {
  assert.ok(shareButton([{ 'resource-id': id('row_feed_button_share'), bounds: '[120,600][200,680]' }]));
  assert.ok(shareButton([{ 'resource-id': id('clips_viewer_share_component'), bounds: '[924,977][1056,1109]' }]));
  assert.ok(shareButton([{ 'resource-id': id('direct_share_button'), 'content-desc': 'Share', bounds: '[924,977][1056,1109]' }]));
});

test('the share sheet parts are recognised by label and by field, in both languages', () => {
  assert.ok(copyLinkButton([{ text: 'Copy link' }]));
  assert.ok(copyLinkButton([{ 'content-desc': 'Salin tautan' }]));
  assert.equal(copyLinkButton([{ text: 'Add to story' }, { 'content-desc': 'Share' }]), null);
  assert.ok(shareSearchField(SHEET('Copy link')));
  assert.ok(shareClearButton([{ 'content-desc': 'Clear' }]));
  assert.ok(shareClearButton([{ text: 'Hapus' }]));
  assert.equal(shareClearButton([{ text: 'Send' }]), null);
});

test('the full-screen reel player from a link is recognised from the running activity', () => {
  assert.equal(clipsViewerActive('topResumedActivity=ActivityRecord{c73ca07 u0 com.instagram.android/com.instagram.urlhandlers.clips.ClipsUrlHandlerActivity t176}'), true);
  assert.equal(clipsViewerActive('topResumedActivity=ActivityRecord{71fc0a7 u0 com.instagram.android/.activity.MainTabActivity t364}'), false);
  assert.equal(clipsViewerActive(''), false);
});

test('the link request needs one connected phone, one username, and 1 to 20 links', () => {
  const devices = [{ serial: 'phone1', current: 'account.one', accounts: [{ username: 'account.one' }] }];
  assert.deepEqual(validateLinkRequest({ serial: 'phone1', target: '@Channel.One', count: 6 }, devices),
    { serial: 'phone1', target: 'channel.one', count: 6, account: 'account.one', verify: true });
  assert.equal(validateLinkRequest({ serial: 'phone1', target: 'channel.one', count: 6, verify: false }, devices).verify, false);
  assert.throws(() => validateLinkRequest({ serial: 'phone9', target: 'channel.one', count: 6 }, devices), /belum terhubung/);
  assert.throws(() => validateLinkRequest({ serial: 'phone1', target: 'https://www.instagram.com/reel/Dee1i94uTmb/', count: 6 }, devices), /username channel/);
  assert.throws(() => validateLinkRequest({ serial: 'phone1', target: 'channel.one', count: 0 }, devices), /1-20/);
  assert.throws(() => validateLinkRequest({ serial: 'phone1', target: 'channel.one', count: MAX_LINKS + 1 }, devices), /1-20/);
  assert.throws(() => validateLinkRequest({ serial: 'phone1', target: 'channel.one', count: 2.5 }, devices), /1-20/);
  assert.throws(() => validateLinkRequest({ serial: 'phone1', target: 'channel.one', count: 6 }, [{ serial: 'phone1', accounts: [] }]), /login/);
});
