import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUi } from '../server/instagram-core.mjs';
import { screenBlocker, verificationError, youtubePackage } from '../server/live/youtube-core.mjs';
import { YouTubeAdapter } from '../server/live/youtube.mjs';

const ui = body => parseUi(`<hierarchy>${body}</hierarchy>`);
const node = (id, text, pkg = youtubePackage) => `<node package="${pkg}" resource-id="${id}" text="${text}" bounds="[100,100][600,200]"/>`;

test('YouTube observed sign-in modal blocks verification with concrete screen evidence', () => {
  const nodes = ui(node('android:id/message', 'There was a problem signing in to your account') + node('android:id/button1', 'Sign In'));
  assert.equal(screenBlocker(nodes).code, 'YOUTUBE_SIGNIN_BLOCKED');
  assert.deepEqual(screenBlocker(nodes).evidence, [{ text: 'There was a problem signing in to your account', resourceId: 'android:id/message' }]);
  assert.equal(verificationError(nodes).code, 'YOUTUBE_SIGNIN_BLOCKED');
});

test('YouTube blocked home distinguishes account failure and standalone connection failure', () => {
  const offline = node(`${youtubePackage}:id/text`, 'No connection');
  const home = ui(node(`${youtubePackage}:id/error_title`, "We couldn't sign you in") + node(`${youtubePackage}:id/error_message_text`, 'Try updating the app') + offline);
  assert.equal(screenBlocker(home).code, 'YOUTUBE_SIGNIN_BLOCKED');
  assert.equal(screenBlocker(home).evidence.length, 3);
  assert.equal(screenBlocker(ui(offline)).code, 'YOUTUBE_OFFLINE');
});

test('YouTube text from another app, unrelated content, and absent blockers never imply a verified account', () => {
  const other = ui(node('android:id/message', 'There was a problem signing in to your account', 'com.other.app'));
  const videoTitle = ui(node(`${youtubePackage}:id/video_title`, 'No connection'));
  for (const nodes of [other, videoTitle, []]) {
    assert.equal(screenBlocker(nodes), null);
    assert.equal(verificationError(nodes).code, 'YOUTUBE_UI_UNVERIFIED');
  }
});

test('YouTube detects the observed create-channel account page without inferring a username', () => {
  const create = `<node package="${youtubePackage}" content-desc="Create a channel" resource-id=""/>`;
  const accounts = `<node package="${youtubePackage}" content-desc="Accounts" resource-id=""/>`;
  assert.equal(screenBlocker(ui(create + accounts)).code, 'YOUTUBE_CHANNEL_REQUIRED');
  assert.equal(screenBlocker(ui(create)), null, 'an unrelated label alone is insufficient');
});

test('YouTube adapter reports incomplete discovery and refuses forged draft proof without tapping', async () => {
  const adapter = new YouTubeAdapter({ serial: 'test-youtube' });
  let taps = 0;
  adapter.launch = async () => {};
  adapter.read = async () => ui(node(`${youtubePackage}:id/text`, 'No connection'));
  adapter.tap = async () => { taps++; };
  const scan = await adapter.scan();
  assert.equal(scan.complete, false);
  assert.equal(scan.current, null);
  assert.deepEqual(scan.accounts, []);
  assert.equal(scan.code, 'YOUTUBE_OFFLINE');
  const inspected = await adapter.inspect({ target: '@demo' });
  assert.equal(inspected.verified, false);
  assert.deepEqual(inspected.posts, []);
  assert.equal(inspected.account, null);
  await assert.rejects(adapter.prepare({ target: '@demo', text: 'test' }), { code: 'YOUTUBE_OFFLINE' });
  await assert.rejects(adapter.submit({ verified: true, text: 'test', postId: 'forged' }), { code: 'YOUTUBE_OFFLINE' });
  assert.equal((await adapter.clearDraft()).cleared, false);
  assert.equal(taps, 0);
  adapter.read = async () => [];
  await assert.rejects(adapter.submit({ verified: true }), { code: 'YOUTUBE_UI_UNVERIFIED' });
});
