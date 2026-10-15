import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi } from '../server/instagram-core.mjs';
import * as tt from '../server/tiktok-core.mjs';

const ui = xml => parseUi(`<hierarchy>${xml}</hierarchy>`);
test('like state: "Like video" is not liked, "Video liked" or a selected heart is liked, anything else is never tapped', () => {
  assert.equal(tt.likeState(ui('<node content-desc="Like video. 0 likes" selected="false" bounds="[918,839][1080,1001]"><node content-desc="Like" selected="false" bounds="[934,839][1069,967]"/></node>')).status, 'not_liked');
  assert.equal(tt.likeState(ui('<node content-desc="Video liked" selected="false" bounds="[918,839][1080,1001]"><node content-desc="Like" selected="true" bounds="[934,839][1069,967]"/></node>')).status, 'already');
  assert.equal(tt.likeState(ui('<node content-desc="Like video. 5 likes" selected="false" bounds="[918,839][1080,1001]"><node content-desc="Like" selected="true" bounds="[934,839][1069,967]"/></node>')).status, 'already');
  assert.equal(tt.likeState(ui('<node content-desc="Unlike video. 5 likes" bounds="[918,839][1080,1001]"/>')).status, 'already');
  assert.equal(tt.likeState(ui('<node content-desc="Share video" bounds="[918,839][1080,1001]"/>')).status, 'missing');
});
test('comment rows are read by display name; the send button sits on the composer tool row, never a video button', () => {
  const nodes = ui(`<node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" bounds="[0,757][1080,1475]">
    <node bounds="[0,900][1080,1100]"><node class="android.widget.Button" text="DPD PRI ACEH" bounds="[192,907][406,955]"/><node class="android.widget.TextView" text="Semoga lancar" bounds="[192,961][1044,1030]"/>
      <node bounds="[192,1036][444,1090]"><node class="android.widget.TextView" text="2d" bounds="[192,1042][243,1087]"/><node class="android.widget.Button" text="Reply" bounds="[291,1039][399,1087]"/></node></node></node>
    <node content-desc="Like video. 0 likes" clickable="true" bounds="[918,839][1080,1001]"/>
    <node class="android.widget.EditText" text="Halo semua" focused="true" bounds="[216,652][1002,813]"/>
    <node content-desc="Stickers" clickable="true" bounds="[150,876][258,984]"/><node content-desc="Send Gift" clickable="true" bounds="[510,876][618,984]"/>
    <node class="android.widget.Button" content-desc="@2131888286" clickable="true" bounds="[888,876][1044,972]"/>`);
  assert.deepEqual(tt.threadComments(nodes), [{ author: 'DPD PRI ACEH', text: 'Semoga lancar' }]);
  const comp = tt.composer(nodes);
  assert.equal(comp.draft, 'Halo semua');
  assert.equal(tt.sendButton(nodes, comp.field).bounds, '[888,876][1044,972]');
  assert.equal(tt.composer(ui('<node class="android.widget.EditText" text="Add comment..." bounds="[216,1620][558,1713]"/>')).placeholder, true);
});
test('video identity uses owner, date and caption; the account switcher ignores Close', () => {
  const nodes = ui(`<node class="android.widget.Button" text="akun.contoh70" bounds="[36,1373][352,1439]"/><node text="· 09-14" bounds="[364,1380][515,1437]"/>
    <node text="DPR setujui anggaran Kemenkeu.…more" clickable="true" bounds="[36,1457][840,1565]"/>
    <node content-desc="Read or add comments. Add 1st comments" bounds="[918,1001][1080,1163]"/>`);
  const info = tt.videoInfo(nodes, 'akun.contoh70');
  assert.equal(info.date, '09-14'); assert.equal(info.caption, 'DPR setujui anggaran Kemenkeu'); assert.equal(info.more, true);
  assert.equal(tt.commentCount(nodes), 0);
  assert.throws(() => tt.videoFingerprint(tt.videoInfo(nodes, 'someone.else'), 'someone.else'));
  const sheet = ui(`<node text="Switch account" bounds="[350,1185][730,1251]"/><node content-desc="Close" clickable="true" bounds="[936,1152][1056,1284]"/>
    <node content-desc="akun.contoh96" clickable="true" selected="true" bounds="[0,1320][1080,1536]"/><node content-desc="Add account" clickable="true" bounds="[0,1536][1080,1752]"/>`);
  assert.deepEqual(tt.switcherAccounts(sheet).map(a => a.username), ['akun.contoh96']);
});
import { TikTokManager } from '../server/tiktok.mjs';
test('TikTok uses job quotas and holds unresolved sends without scanning history on the HP', () => {
  const m = new TikTokManager({ statePath: '/unused', devices: () => [] });
  m.logs.write = () => {};
  m.state.history = [{ key: 'old', postKey: 'acct:post', status: 'uncertain' }];
  const key = m.commentKey({ id: 'new' }, 'acct', 'post');
  m.setCount(key, 0, { postKey: 'acct:post' });
  assert.equal(m.holdPending({ logs: [] }, {}, key), true);
  assert.equal(m.countFor(key), 0);
  assert.equal(m.state.history[0].status, 'uncertain');
});

test('the newer comment sheet is recognised while it loads, and its send arrow is found next to Mention', () => {
  const loading = ui(`<node content-desc="Read or add comments. 2 comments" bounds="[918,1100][1080,1260]"/>
    <node class="android.widget.EditText" text="Add comment..." bounds="[260,2050][1010,2160]"/>
    <node content-desc="Sort" clickable="true" bounds="[860,1040][960,1130]"/><node content-desc="Close" clickable="true" bounds="[960,1040][1060,1130]"/>`);
  assert.equal(tt.commentSheetOpen(loading), true);
  assert.equal(tt.commentSheetOpen(ui('<node content-desc="Read or add comments. 2 comments" bounds="[918,1100][1080,1260]"/>')), false, 'the bare video page is not the sheet');
  const typing = ui(`<node class="android.widget.EditText" text="Halo semua" focused="true" bounds="[216,800][1270,1010]"/>
    <node content-desc="Add a photo to your comment" clickable="true" bounds="[60,1060][170,1160]"/><node content-desc="Emoji" clickable="true" bounds="[220,1060][330,1160]"/>
    <node content-desc="Mention someone" clickable="true" bounds="[370,1060][480,1160]"/><node class="android.widget.Button" clickable="true" bounds="[1100,1060][1220,1160]"/>`);
  assert.equal(tt.sendButton(typing, tt.composer(typing).field).bounds, '[1100,1060][1220,1160]');
});
test('playback is read from TikTok\'s own audio player; other apps and missing players do not count', async () => {
  const { TikTokManager } = await import('../server/tiktok.mjs');
  const m = Object.create(TikTokManager.prototype);
  let players = '';
  m.sh = async (serial, ...args) => args[0] === 'pidof' ? '20490\n' : players;
  players = '  AudioPlaybackConfiguration piid:487 type:android.media.AudioTrack u/pid:10333/20490 state:started attr:x\n  AudioPlaybackConfiguration piid:495 type:android.media.AudioTrack u/pid:10333/20490 state:paused attr:x';
  assert.equal(await m.audioPlaying('s'), true);
  players = '  AudioPlaybackConfiguration piid:495 type:android.media.AudioTrack u/pid:10333/20490 state:paused attr:x';
  assert.equal(await m.audioPlaying('s'), false);
  players = '';
  assert.equal(await m.audioPlaying('s'), null, 'no player: fall back to screenshots');
});
test('a video without a caption does not take the Share button label as its caption', () => {
  const nodes = ui(`<node class="android.widget.Button" text="akun.contoh70" bounds="[36,1500][352,1566]"/><node text="· 09-12" bounds="[364,1507][515,1564]"/>
    <node text="Share" bounds="[930,1580][1060,1630]"/><node text="12" bounds="[960,1640][1030,1690]"/>`);
  const info = tt.videoInfo(nodes, 'akun.contoh70');
  assert.equal(info.caption, ''); assert.equal(info.date, '09-12');
});
