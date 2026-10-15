import { verifyDelivery, associatedFailure } from './comment-delivery.mjs';
import { CommentRecovery } from './comment-recovery.mjs';
import { updateProgress } from './comment-progress.mjs';
import { NetworkError, BlockedError, ManualActionError } from './comment-errors.mjs';
export { NetworkError, BlockedError } from './comment-errors.mjs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adb, input } from './adb.mjs';
import { loggedOutScreen, loggedOutDialog, loginButton, loginProblem } from './instagram-login-core.mjs';
import { accountSheetViewport } from './instagram-core.mjs';
import { parseUi, byId, center, switcherAccounts, gridTiles, composerAccount, postFingerprint, validUsername, validatePlan, blockedNotice, sendButton, likeState, commentButton, captionMore, commentList, threadComments, threadCaption, postCaption, offlineNotice, postingNotice, postFailedNotice, tileIdentity, saveState, repostButton, repostConfirmed, repostDialog, savedSheet, snackbarMessage, shareButton, shareContacts, shareSheetOpen, shareSendButton, contextMenu, clipsViewerActive, validateLinkRequest, metaAccountScreen, metaDoneButton } from './instagram-core.mjs';
import { JobLogs, clock } from './joblog.mjs';
import { visualPinnedKeys } from './instagram-pins.mjs';
import { pinnedBadge } from './instagram-core.mjs';
import { thumbnailIdentities, gridSignature, sameLockedPost } from './instagram-posts.mjs';
import { ScreenReader } from './ocr.mjs';
import { InstagramLogout } from './instagram-logout.mjs';
import { InstagramDuplicates } from './instagram-duplicates.mjs';
import { instagramChallengeActive, instagramChallengeError } from './instagram-security.mjs';
import { instagramTargets, targetLabel } from '../src/instagram-target.mjs';
import { openLinkedPost } from './instagram-links.mjs';
import { copyOpenPostLink } from './instagram-link-copy.mjs';
import { macOnline, phoneOnline, restoreInternet, setRelayLog } from './network.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const PACKAGE = 'com.instagram.android';
const BANK = join(dirname(fileURLToPath(import.meta.url)), 'komentar', 'buat.py');
// How long the "this phone is still on this account" mark stays valid. It only ever backs the
// composer hint that names the post owner instead of the logged-in author.
const PROOF_TTL_MS = 5 * 60000;
// Hasil aksi tambahan per postingan, ditulis apa adanya supaya keadaan "belum
// terverifikasi" tidak pernah tampil sebagai berhasil di log maupun laporan.
const SAVE_LABEL = { saved: 'tersimpan', already: 'sudah tersimpan', unverified: 'diketuk, belum terverifikasi' };
const REPOST_LABEL = { reposted: 'berhasil', unverified: 'diketuk, belum terverifikasi', missing: 'tombol belum terbaca' };
const SHARE_LABEL = { sent: 'terkirim', unverified: 'diketuk, belum terverifikasi', nocontact: 'tidak ada kontak, dilewati',
  self_only: 'hanya akun sendiri, dilewati', nosheet: 'lembar share belum terbuka', nosend: 'tombol kirim belum terbaca, dibatalkan',
  unselected: 'kontak tidak terpilih, dibatalkan', missing: 'tombol belum terbaca' };
// Ringkasan lapisan yang mungkin menutupi baris aksi saat sebuah aksi belum pasti. Log yang
// menyebut lapisannya jauh lebih berguna daripada log yang hanya bilang "belum terverifikasi".
const LAYER = /dialog|sheet|snackbar|promo|collection|bottomsheet/i;
const overlay = nodes => [...new Set((nodes || []).map(n => (n['resource-id'] || '').split('/').pop()).filter(id => LAYER.test(id)))].join(', ') || 'tidak ada lapisan';
// A step that failed because Instagram could not load; retried, then the post is skipped for now.
// The post cannot be handled safely (or the grid has no more posts); it is skipped without retrying.
export class SkipPostError extends Error { constructor(message, { end = false } = {}) { super(message); this.end = end; } }
// Builds comments with the igexe bank (Python, copied unchanged) for one post.
export function bankComments(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_PATH || 'python3', ['-I', BANK], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Bank komentar tidak merespons.')); }, 20000);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' ? 'Python 3 belum tersedia untuk bank komentar.' : 'Bank komentar gagal dijalankan.')); });
    child.on('close', code => {
      clearTimeout(timer);
      try { if (code !== 0) throw new Error(err); resolve(JSON.parse(out)); }
      catch { reject(new Error('Bank komentar gagal menyusun komentar.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
export class InstagramManager {
  constructor({ statePath, devices, locks = null, logPrefix = '' }) {
    this.statePath = statePath; this.devices = devices; this.state = { devices: [], history: [], counts: {}, recent: {}, plans: {} };
    this.generate = bankComments; this.sentTexts = []; this.deliveryPause = pause;
    this.recovery = new CommentRecovery(this);
    const dataDir = dirname(statePath);
    this.logs = new JobLogs(join(dataDir, 'logs')); this.reader = new ScreenReader(dataDir); setRelayLog(join(dataDir, 'relay.log'));
    this.net = { macOnline, phoneOnline, restoreInternet };
    this.previewPending = false; this.abortRequested = false; this.confirming = new Set(); this.prepared = new Set();
    // Locks can be shared between platforms so one HP never runs Instagram and TikTok at once.
    this.locks = locks || new Set(); this.logPrefix = logPrefix; this.verifiedAccounts = new Map(); this.scanPending = null; this.job = null; this.saving = Promise.resolve();
    this.logout = new InstagramLogout(this);
    this.duplicates = new InstagramDuplicates(this);
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (Array.isArray(data.devices) && Array.isArray(data.history)) this.state = { counts: {}, recent: {}, plans: {}, ...data };
    } catch {}
    // Older history entries recorded one comment per account and post.
    for (const record of this.state.history) if (['sending', 'sent', 'uncertain'].includes(record.status) && !this.state.counts[record.key]) this.state.counts[record.key] = { count: 1, username: record.username, target: record.target, at: record.at };
    this.recovery.migrate();
    if (this.state.lastCommentJob?.commentMode === 'new-per-job') {
      this.job = structuredClone(this.state.lastCommentJob);
      if (['running', 'stopping'].includes(this.job.status)) {
        this.job.status = 'stopped'; this.job.stopReason = 'Layanan sempat berhenti. Periksa hasil, lalu lanjutkan pekerjaan tersimpan.';
        for (const entry of this.job.accounts) if (['running', 'waiting', 'paused'].includes(entry.status)) entry.status = 'stopped';
      }
      for (const entry of this.job.accounts) updateProgress(this, entry);
    }
    await this.logs.prune().catch(() => {});
  }
  save() {
    this.saving = this.saving.catch(() => {}).then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const temp = this.statePath + '.tmp';
      await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); await rename(temp, this.statePath);
    });
    return this.saving;
  }
  snapshot() {
    const online = new Set(this.devices().filter(d => d.status === 'device').map(d => d.serial));
    return { recovery: this.recovery.summary(), devices: this.state.devices.filter(d => !d.serial.startsWith('emulator-')).map(d => ({ ...d, online: online.has(d.serial), busy: this.locks.has(d.serial), loginAttention: this.state.loginAttention?.[d.serial] || null })), scanning: Boolean(this.scanActive), checking: this.previewPending, stopping: this.abortRequested, plans: this.state.plans, loginJob: this.login?.snapshot() || null, logoutJob: this.logout.snapshot(), duplicateJob: this.duplicates.snapshot(), job: this.job ? { ...this.job, accounts: this.job.accounts.map(a => ({ ...a })), logs: [...this.job.logs] } : null };
  }
  busy(serial) {
    return this.locks.has(serial) || (['running', 'stopping'].includes(this.job?.status) &&
      this.job.accounts.some(a => a.serial === serial && ['waiting', 'running', 'paused'].includes(a.status)));
  }
  checkDevice(serial) {
    if (!this.devices().some(d => d.serial === serial && d.status === 'device')) throw new Error('HP terputus atau belum mendapat izin ADB.');
  }
  async locked(serial, operation) {
    this.checkDevice(serial);
    if (this.locks.has(serial)) throw new Error('HP sedang digunakan proses Instagram.');
    this.locks.add(serial);
    try { return await operation(); } finally { this.locks.delete(serial); }
  }
  // Stop takes effect at the next screen read or tap, except while a sent comment is being confirmed.
  interrupted(serial) {
    if (!this.confirming.has(serial) && (this.abortRequested || this.stopRequested)) throw new Error('Proses dihentikan.');
  }
  // A failed dump ("could not get idle state" while a video animates) is retried, never read as an empty screen.
  async ui(serial, attempts = 8) {
    this.checkDevice(serial); this.interrupted(serial);
    // UI Automator says "could not get idle state" when something on screen never stops moving.
    // That message means repeating the dump cannot help - the video will not pause by itself -
    // so a couple of them in a row end the loop and hand over to the recovery steps below.
    // The message arrives on stderr, so stderr is folded into stdout first; otherwise the dump
    // looks like an ordinary empty read and the loop keeps waiting for a screen that never settles
    // (measured: eight futile rounds cost about two minutes).
    let animating = 0;
    const read = async (timeout = 14000) => {
      const path = `/data/local/tmp/phonefarm-ig-${randomUUID()}.xml`;
      try {
        const out = await adb(['-s', serial, 'shell', `uiautomator dump ${path} 2>&1`], { timeout });
        if (!/ERROR|could not get idle/i.test(out)) {
          const nodes = parseUi(await adb(['-s', serial, 'exec-out', 'cat', path]));
          if (nodes.length > 1) { animating = 0; return nodes; }
        } else if (/could not get idle/i.test(out)) animating++;
      } catch {} finally { await adb(['-s', serial, 'shell', 'rm', '-f', path]).catch(() => {}); }
      return null;
    };
    // A quick re-check after a recovery step: enough for a screen that has just become idle.
    const peek = () => read(6000);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const nodes = await read();
      if (nodes) return nodes;
      if (animating >= 2) break;
      await pause(600 + attempt * 300);
      this.interrupted(serial);
    }
    // Video yang sedang diputar membuat UI Automator tidak pernah melihat layar diam, sehingga
    // dump selalu gagal. Pemulihan dicoba berurutan, masing-masing sekali:
    // 1. tombol jeda media (pemutar biasa menurutinya),
    // 2. ketukan di area video (pemutar reels yang dibuka dari sebuah LINK diam pada tombol jeda
    //    media, tetapi MENJEDA saat areanya diketuk - terbukti pada Samsung 01 dan 12, 15 Okt 2026),
    //    atau menekan tab Home di nav bawah untuk layar Reels biasa (terbukti pada Samsung 16),
    // 3. tahap kedua dari pilihan di atas,
    // 4. tombol Kembali,
    // 5. tombol Home HP lalu tutup paksa + buka ulang Instagram. Tahap terakhir ini perlu karena
    //    pemutar reels dari link berjalan di activity sendiri dengan nav bawah tersembunyi: tombol
    //    jeda media, tab Home, DAN tombol Kembali semuanya tidak berefek, dan membuka ulang
    //    aplikasi tetap masuk ke pemutar yang sama.
    // Pemulihan ini hanya dijalankan pada pembacaan penuh (8 percobaan). Pembacaan pendek seperti
    // pemeriksaan kiriman tidak boleh menekan apa pun, supaya hasil kiriman tidak dipindahkan.
    await adb(['-s', serial, 'shell', 'input', 'keyevent', '127']).catch(() => {});
    await pause(800);
    let nodes = await peek();
    if (nodes) return nodes;
    if (attempts >= 8) {
      const size = (await adb(['-s', serial, 'shell', 'wm', 'size']).catch(() => '')) || '';
      const match = /(\d+)x(\d+)/.exec(size);
      const width = Number(match?.[1]) || 1080, height = Number(match?.[2]) || 1920;
      // Urutan dua tahap berikut mengikuti activity yang sedang terbuka, bukan tebakan. Ketukan
      // pada posisi video hanya dipakai di activity pemutar reels dari link, karena di halaman
      // lain ketukan di situ bisa membuka hal lain (dan dua ketukan cepat pada foto berarti suka).
      const activities = await adb(['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']).catch(() => '');
      const tapVideo = () => this.tapAt(serial, width / 2, height * .33);
      const tapHomeTab = () => this.tapAt(serial, width * .1, height - 216);
      for (const stage of clipsViewerActive(activities) ? [tapVideo, tapHomeTab] : [tapHomeTab, tapVideo]) {
        await stage();
        await pause(1400);
        nodes = await peek();
        if (nodes) return nodes;
      }
      await adb(['-s', serial, 'shell', 'input', 'keyevent', '4']).catch(() => {});
      await pause(1200);
      nodes = await peek();
      if (nodes) return nodes;
      await adb(['-s', serial, 'shell', 'input', 'keyevent', '3']).catch(() => {});
      await pause(600);
      await adb(['-s', serial, 'shell', 'am', 'force-stop', PACKAGE]).catch(() => {});
      await pause(1200);
      await adb(['-s', serial, 'shell', 'input', 'keyevent', '224']).catch(() => {});
      await adb(['-s', serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']).catch(() => {});
      await pause(6000);
      // Deciding to close the app is heavy, so this last check waits as long as a normal read.
      nodes = await read();
      if (nodes) return nodes;
    }
    throw new NetworkError('Layar HP tidak dapat dibaca (animasi terus berjalan).');
  }
  // System animations keep UI Automator from reading the screen while reels play, so they are switched off.
  async prepareDevice(serial) {
    if (this.prepared.has(serial)) return;
    const current = await adb(['-s', serial, 'shell', 'settings get global animator_duration_scale; settings get global window_animation_scale; settings get global transition_animation_scale']).catch(() => '');
    if (!current.trim().split(/\s+/).every(v => Number(v) === 0)) {
      await adb(['-s', serial, 'shell', 'settings put global animator_duration_scale 0; settings put global window_animation_scale 0; settings put global transition_animation_scale 0']);
    }
    // Portrait only: apps such as TikTok otherwise rotate and every tap position moves.
    await adb(['-s', serial, 'shell', 'settings put system accelerometer_rotation 0; settings put system user_rotation 0']).catch(() => {});
    this.prepared.add(serial);
  }
  async tap(serial, node) {
    this.interrupted(serial);
    const [x, y] = center(node);
    await adb(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);
  }
  // Ketukan pada koordinat. Hanya dipakai pemulihan layar, di mana tidak ada node yang bisa
  // dipercaya karena layarnya memang tidak terbaca; alur biasa selalu mengetuk node hasil bacaan.
  async tapAt(serial, x, y) {
    await adb(['-s', serial, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]).catch(() => {});
  }
  async back(serial) { await adb(['-s', serial, 'shell', 'input', 'keyevent', '4']); }
  // Menempelkan isi papan klip HP ke kolom teks yang sedang fokus. Dipakai menu "Ambil link
  // postingan": tidak ada cara membaca papan klip langsung lewat ADB, jadi isinya dibaca dengan
  // menempelkannya ke kolom pencarian milik Instagram lalu membaca layarnya.
  async paste(serial) { await adb(['-s', serial, 'shell', 'input', 'keyevent', '279']); }
  async typeComment(serial, text) { await input(serial, { type: 'text', text }); }
  async inputPause(ms) { await pause(ms); }
  // Jeda "HP sedang sibuk" untuk aksi simpan/repost/share; test menggantinya agar tidak menunggu.
  async actionPause(ms) { await pause(ms); }
  async imeShown(serial) {
    const state = await adb(['-s', serial, 'shell', 'dumpsys', 'input_method']);
    const shown = state.match(/\bmInputShown=(true|false)\b/);
    if (!shown) throw new NetworkError('Status keyboard belum dapat dibaca; tombol Kirim tidak diketuk.');
    return shown[1] === 'true';
  }
  async focusCommentInput(serial, account, target) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.assertRunning();
      let nodes = await this.ui(serial), composer = composerAccount(nodes);
      if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; komentar tidak diketik.');
      if (!composer.field) throw new NetworkError('Kolom komentar tidak ditemukan sebelum mengetik.');
      if (!this.composerMatches(serial, account, target, composer)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
      await this.tap(serial, composer.field);
      await this.inputPause(300);
      nodes = await this.ui(serial); composer = composerAccount(nodes);
      if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; komentar tidak diketik.');
      if (composer.field && !this.composerMatches(serial, account, target, composer)) throw new Error('Akun atau draft berubah saat memilih kolom komentar. Tidak diketik.');
      if (composer.field?.focused === 'true') return composer;
    }
    throw new NetworkError('Kolom komentar belum mendapat fokus setelah 3 percobaan; teks belum dimasukkan.');
  }
  async readCommentInput(serial, text) {
    for (let attempt = 0; attempt < 4; attempt++) {
      this.assertRunning();
      const nodes = await this.ui(serial), composer = composerAccount(nodes);
      if (composer.field?.text === text) return nodes;
      // Wait for the UI to expose the typed text, but never type it twice.
      if (composer.field?.text && !composer.genericPlaceholder && !composer.username && !composer.target) break;
      await this.inputPause(300);
    }
    throw new Error('Teks komentar belum masuk utuh atau tidak cocok. Tidak dikirim dan tidak diketik ulang; periksa draft di HP.');
  }
  async prepareCommentSend(serial, text) {
    let nodes = await this.readCommentInput(serial, text);
    // GenFarmer can cover the entire composer row without changing its XML bounds.
    // Hide only a positively detected keyboard, then read the moved controls again.
    if (await this.imeShown(serial)) {
      // Samsung can expose the final XML before the composer is painted again, and satu keyboard
      // kadang baru hilang pada Kembali kedua (Samsung 14, 15 Okt 2026). Keyboardnya diperiksa
      // ulang sebelum setiap Kembali berikutnya, jadi tidak ada Kembali tambahan yang bisa menutup
      // lembar komentar saat keyboard sudah hilang.
      let hidden = false;
      for (let attempt = 0; attempt < 3 && !hidden; attempt++) {
        await this.back(serial);
        await this.inputPause(2000 + attempt * 700);
        hidden = !await this.imeShown(serial);
      }
      if (!hidden) throw new Error('Keyboard masih menutupi kolom komentar. Draft ditahan; tombol Kirim tidak diketuk.');
      nodes = await this.readCommentInput(serial, text);
    }
    if (offlineNotice(nodes) || postFailedNotice(nodes) || postingNotice(nodes)) throw new Error('Layar belum siap mengirim. Draft ditahan untuk diperiksa.');
    const send = sendButton(nodes);
    if (!send) throw new Error('Tombol kirim komentar belum ditemukan pada kolom yang sama. Draft ditinggalkan di HP.');
    return send;
  }
  // Closes the comment sheet and keyboard. A sheet left open covers the profile grid on the next deep link,
  // so a tap meant for a grid tile would land inside the sheet.
  // Menu tekan-lama yang menutupi halaman postingan/reel. Ditutup dari layar yang sudah dibaca
  // (jadi tidak ada ketukan buta), lalu layarnya dibaca ulang. Tanpa ini, satu menu yang muncul
  // membuat postingan terbaca "belum terbuka" sampai percobaan habis DAN tetap menutupi layar
  // untuk akun-akun berikutnya di HP yang sama.
  async dismissContextMenu(serial, nodes) {
    if (!contextMenu(nodes)) return nodes;
    await this.back(serial);
    await this.actionPause(500);
    this.overlaysClosed = (this.overlaysClosed || 0) + 1;
    return await this.ui(serial);
  }
  async closeSheets(serial) {
    for (let i = 0; i < 5; i++) {
      const nodes = await this.ui(serial);
      const sheet = composerAccount(nodes).field || contextMenu(nodes) || nodes.some(n => n['resource-id'] === 'com.instagram.android:id/title_text_view' && /^(comments|komentar)$/i.test(n.text || ''));
      if (!sheet) return nodes;
      await this.back(serial); await pause(500);
      if (contextMenu(nodes)) this.overlaysClosed = (this.overlaysClosed || 0) + 1;
    }
    throw new NetworkError('Lembar komentar tidak bisa ditutup.');
  }
  async nudge(serial, fromY) {
    this.interrupted(serial);
    const start = Math.min(Math.max(fromY, 700), 1500);
    // Gerakan ini HARUS terbaca sebagai geseran. `input swipe` menahan sentuhan di titik awal
    // selama durasinya; pada HP yang sedang sibuk jeda itu bisa melewati ambang tekan-lama
    // Instagram, dan menu tekan-lama yang muncul menutupi seluruh halaman. Durasi pendek
    // membuat jendela itu sesingkat mungkin tanpa mengubah jaraknya.
    await adb(['-s', serial, 'shell', 'input', 'swipe', '540', String(start), '540', String(start - 400), '220']);
  }
  async swipe(serial, node, direction = 'up', duration = 350) {
    this.interrupted(serial);
    const root = node || { bounds: '[0,0][1080,1920]' };
    const b = root.bounds.match(/\d+/g).map(Number);
    const x = Math.round((b[0] + b[2]) / 2), top = Math.round(b[1] + (b[3] - b[1]) * .33), bottom = Math.round(b[1] + (b[3] - b[1]) * .8);
    await adb(['-s', serial, 'shell', 'input', 'swipe', String(x), String(direction === 'up' ? bottom : top), String(x), String(direction === 'up' ? top : bottom), String(duration)]);
  }
  async assertNoChallenge(serial) {
    const activities = await adb(['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']);
    if (instagramChallengeActive(activities)) throw instagramChallengeError();
  }
  async ownProfile(serial, { settling = false } = {}) {
    await this.assertNoChallenge(serial);
    const installed = await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', PACKAGE]);
    if (!installed.split(/\r?\n/).includes(`package:${PACKAGE}`)) throw new Error('Instagram belum terpasang di HP ini.');
    await adb(['-s', serial, 'shell', 'input', 'keyevent', '224']);
    if (!settling) await adb(['-s', serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
    return this.waitForOwnProfile(serial);
  }
  async waitForOwnProfile(serial) {
    let nodes, loggedOut = false;
    for (let i = 0; i < 16; i++) {
      nodes = await this.ui(serial);
      await this.assertNoChallenge(serial);
      const profile = byId(nodes, 'profile_tab');
      if (profile) {
        await this.tap(serial, profile); nodes = await this.ui(serial);
        const title = byId(nodes, 'action_bar_title');
        if (title && validUsername(title.text) && byId(nodes, 'profile_tab')) return { nodes, current: title.text.toLowerCase(), title };
      }
      // Instagram menampilkan dialog "Error: You've been logged out of <akun>" yang MEMBLOKIR
      // pemilih akun. Dibiarkan, satu akun yang ter-log out membuat semua akun di HP itu gagal,
      // bukan hanya akun itu. Dialog ditutup dari layar yang sudah dibaca di sini, jadi tidak ada
      // pembacaan tambahan; akun yang ter-log out nanti gagal sendiri saat tidak ditemukan lagi.
      // Instagram kadang membuka layar "Meta Account" saat aplikasi dijalankan. Layar itu
      // ditutup lewat tombol "Done"-nya, bukan lewat Kembali.
      if (await this.dismissMetaAccount(serial, nodes)) continue;
      const notice = await this.dismissLoggedOutNotice(serial, nodes);
      if (notice) {
        if (loggedOut) throw new Error(`Instagram menampilkan "You've been logged out of ${notice.username || 'sebuah akun'}" berulang kali. HP ini ditahan sampai akun itu ditangani.`);
        loggedOut = true;
        continue;
      }
      if (loggedOutScreen(nodes)) { const error = new Error('Instagram di HP ini perlu login.'); error.code = 'IG_LOGGED_OUT'; throw error; }
      const problem = loginProblem(nodes);
      if (problem) throw new Error(problem.note);
      // Switching accounts restarts Instagram and briefly leaves a blank
      // activity. Back during that transition can dismiss the app to Home.
      const readable = nodes.some(n => n.package === PACKAGE && (n.text || n['content-desc']) && !/ProgressBar$/.test(n.class || ''));
      if (readable && !profile) await this.back(serial);
      else await this.wait(800);
    }
    throw new Error('Profil Instagram belum dapat dibaca. Buka profil lewat layar HP lalu pindai lagi.');
  }
  // Hanya tombol OK pada dialog "sudah keluar" yang dipakai. Pemanggilnya sudah memegang layar
  // ini, jadi tidak ada pembacaan tambahan yang dibayar dan tidak ada ketukan buta.
  async dismissLoggedOutNotice(serial, nodes) {
    const notice = loggedOutDialog(nodes);
    if (!notice) return null;
    if (notice.dismiss) await this.tap(serial, notice.dismiss);
    else await this.back(serial);
    await this.actionPause(600);
    return notice;
  }
  // Instagram kadang memutar reel dari sebuah link DI DALAM Home Feed, dan layar itu tidak punya
  // baris aksi. Menu "More actions for this post" pada postingan itu memuat entri "Go to post"
  // yang membuka postingan penuh; hanya entri berlabel itu yang diketuk. Bila entrinya tidak ada,
  // menunya ditutup lagi dan pemanggilnya berhenti dengan status apa adanya - bukan menebak.
  async openFullPostFromFeed(serial, nodes) {
    const trigger = nodes.find(n => n['resource-id'] === 'com.instagram.android:id/media_option_button');
    if (!trigger) return false;
    await this.tap(serial, trigger);
    for (let i = 0; i < 6; i++) {
      await this.actionPause(i ? 500 : 400);
      const menu = await this.ui(serial);
      const entry = menu.find(n => /^(?:go to post|buka postingan|lihat postingan)$/i.test((n.text || n['content-desc'] || '').trim()));
      if (entry) { await this.tap(serial, entry); return true; }
      // Menu tekan-lama bisa menggantikan lembar aksi di sini; ditutup dulu supaya layar tidak
      // ditinggal tertutup menu saat tidak ada entri yang bisa dipakai.
      if (contextMenu(menu)) { await this.back(serial); await this.actionPause(400); return false; }
    }
    await this.back(serial);
    await this.actionPause(400);
    return false;
  }
  async accountSheet(serial, desired = null) {
    const profile = await this.ownProfile(serial);
    await this.tap(serial, profile.title);
    let opened = true;
    const found = new Map();
    let footerSignature = '', settledFooter = 0;
    try {
      for (let page = 0; page < 15; page++) {
        const nodes = page ? await this.ui(serial) : await this.settledSheet(serial), rows = switcherAccounts(nodes);
        const endVisible = loginButton(nodes, /^(add (?:Instagram(?: account)?|account)|tambahkan akun(?: Instagram)?|tambah akun(?: Instagram)?)$/i);
        // Lembar pemilih akun kadang masih kosong saat pertama dibaca (layar hampir kosong di
        // Samsung 13). Akun yang sebenarnya ada tidak boleh gagal hanya karena lambat, jadi
        // menunggu dulu beberapa kali sebelum menyimpulkan.
        if (!rows.length && !(endVisible && found.size)) {
          if (page < 3) { await this.wait(1200); continue; }
          throw new Error('Daftar akun belum terbaca. Pastikan pemilih akun Instagram bisa dibuka.');
        }
        for (const row of rows) found.set(row.username, { username: row.username, disabled: row.disabled, active: row.username === profile.current });
        // Some account switchers end at Accounts Center without Add Instagram.
        // Require two swipes that leave that footer and the visible rows unchanged.
        const footer = loginButton(nodes, /^(go to accounts cent(?:er|re)|buka pusat akun)$/i);
        const signature = footer && rows.length ? JSON.stringify([footer.bounds, rows.map(row => [row.username, row.node.bounds])]) : '';
        settledFooter = signature && signature === footerSignature ? settledFooter + 1 : 0;
        footerSignature = signature;
        if (desired) {
          const row = rows.find(a => a.username === desired);
          if (row) {
            if (row.disabled) throw new Error(`@${desired} sedang dinonaktifkan.`);
            if (desired !== profile.current) { await this.tap(serial, row.node); opened = false; }
            else { await this.back(serial); opened = false; }
            const check = await this.ownProfile(serial, { settling: true });
            if (check.current !== desired) throw new Error(`Gagal beralih ke @${desired}.`);
            this.verifiedAccounts.set(serial, { username: desired, at: Date.now() });
            const saved = this.state.devices.find(device => device.serial === serial);
            if (saved) {
              saved.current = desired;
              saved.accounts = saved.accounts.map(account => ({ ...account, active: account.username === desired }));
              await this.save();
            }
            return { current: desired, accounts: [...found.values()] };
          }
        }
        // Add Instagram ends the Instagram section; Meta's other services follow it.
        // A repeated half-open viewport alone is not evidence that all accounts were read.
        if (endVisible || settledFooter >= 2) {
          if (desired) throw new Error(`@${desired} tidak lagi login di HP ini.`);
          return { current: profile.current, accounts: [...found.values()], complete: true };
        }
        await this.swipe(serial, accountSheetViewport(nodes, rows), 'up', 700);
      }
      if (desired) throw new Error('Akun yang dipilih belum ditemukan dalam daftar.');
      return { current: profile.current, accounts: [...found.values()], complete: false };
    } finally { if (opened) await this.back(serial).catch(() => {}); }
  }
  // The account sheet animates open (and loads badges online); read it once two dumps agree.
  async settledSheet(serial) {
    let nodes = await this.ui(serial), last = '';
    for (let i = 0; i < 5; i++) {
      const signature = switcherAccounts(nodes).map(r => `${r.username}@${r.node.bounds}`).join('|');
      if (signature && signature === last) return nodes;
      last = signature;
      await pause(700);
      nodes = await this.ui(serial);
    }
    return nodes;
  }
  async scanAccounts({ forLogin = false, forDuplicates = false } = {}) {
    if (this.duplicates?.busy && !forDuplicates) throw new Error('Tunggu proses akun duplikat selesai.');
    if (this.login?.busy && !forLogin) throw new Error('Tunggu Auto login selesai.');
    if (this.scanPending) return this.scanPending;
    if (this.previewPending || this.locks.size) throw new Error('Tunggu pemeriksaan atau proses Instagram selesai.');
    if (this.job && ['running', 'stopping'].includes(this.job.status)) throw new Error('Hentikan Auto komen sebelum memindai akun.');
    this.abortRequested = false; this.scanActive = true;
    this.scanPending = (async () => {
      const devices = this.devices().filter(d => d.status === 'device');
      if (!devices.length) throw new Error('Belum ada HP yang terhubung.');
      const job = { logs: [] };
      await this.openLog(job, 'pindai', `${devices.length} HP`);
      // Every HP has its own UI Automator, so all of them are read at the same time.
      const entries = await Promise.all(devices.map(async device => {
        const old = this.state.devices.find(d => d.serial === device.serial);
        // Preserve pending verification screens during subsequent login batches.
        if (forLogin && this.state.loginAttention?.[device.serial]) return old || { serial: device.serial, name: device.name, accounts: [], complete: false, error: 'Selesaikan verifikasi login di HP.' };
        try {
          const result = await this.locked(device.serial, async () => { await this.prepareDevice(device.serial); return this.accountSheet(device.serial); });
          if (!forLogin && result.complete && this.state.loginAttention) delete this.state.loginAttention[device.serial];
          return { serial: device.serial, name: device.name, ...result, scannedAt: new Date().toISOString(), error: null };
        } catch (error) {
          if (error.code === 'IG_LOGGED_OUT') return { serial: device.serial, name: device.name, accounts: [], current: null, complete: true, loggedOut: true, scannedAt: new Date().toISOString(), error: null };
          if (this.abortRequested && old) return old;
          return { ...old, serial: device.serial, name: device.name, accounts: old?.accounts || [], error: this.abortRequested ? 'Pemindaian dihentikan sebelum HP ini selesai dibaca.' : error.message };
        }
      }));
      for (const entry of entries) this.log(job, entry.error ? `Gagal dibaca: ${entry.error}` : `${entry.accounts.length} akun: ${entry.accounts.map(a => `@${a.username}${a.disabled ? ' (nonaktif)' : ''}`).join(', ')}`, { serial: entry.serial });
      const scanned = new Set(entries.map(e => e.serial));
      this.state.devices = [...this.state.devices.filter(d => !scanned.has(d.serial)), ...entries];
      const stopped = this.abortRequested;
      await this.save(); return { ...this.snapshot(), scanning: false, stopped };
    })().finally(() => { this.scanPending = null; this.scanActive = false; this.abortRequested = false; });
    return this.scanPending;
  }
  // Opens one post from the locked list. The post is found by its identity, not its position,
  // so uploads appearing mid-run can never shift which post gets the like and comments.
  async openPost(serial, account, target, postRef) {
    // accountSheet verified the account at job start. Direct links stay on the
    // opened post; composer checks still guard the account before sending.
    if (postRef?.kind === 'post') {
      await this.closeSheets(serial);
      // One turn can outlast the proof lifetime: four links x three comments passes five minutes
      // easily, and link mode never returns to the account switcher, so nothing here can change the
      // active account. Renew the mark for this post so the composer hint that only names the post
      // owner ("Add a comment for ...") keeps working instead of stopping the account mid-turn.
      const proof = this.verifiedAccounts.get(serial);
      if (proof?.username === account) this.verifiedAccounts.set(serial, { username: account, at: Date.now() });
      return openLinkedPost(this, serial, account, postRef);
    }
    if (this.verifiedAccounts.has(serial)) {
      const profile = await this.ownProfile(serial);
      if (profile.current !== account) throw new Error('Akun aktif di HP berubah. Pilih ulang akun sebelum melanjutkan.');
      this.verifiedAccounts.set(serial, { username: account, at: Date.now() });
    }
    await this.closeSheets(serial);
    const { tile } = await this.openLockedPost(serial, target, postRef);
    await this.tap(serial, tile);
    let lastError = new NetworkError('Postingan belum termuat.');
    for (let i = 0; i < 6; i++) {
      const nodes = await this.ui(serial);
      if (composerAccount(nodes).field) {
        // The tap landed in a comment sheet instead of the grid: never use the post behind it.
        await this.closeSheets(serial);
        throw new NetworkError('Ketukan grid mengenai lembar komentar yang masih terbuka; diulang.');
      }
      if (nodes.some(pinnedBadge)) throw new SkipPostError('Postingan yang disematkan terdeteksi setelah dibuka; dilewati tanpa like atau komentar.');
      const comment = commentButton(nodes);
      const bounds = comment?.bounds?.match(/\d+/g)?.map(Number);
      if (comment && bounds && bounds[3] - bounds[1] >= 45) {
        let fingerprint;
        try { fingerprint = postFingerprint(nodes, target); }
        catch (error) {
          // The action bar can sit at the screen edge with the caption still below it; nudge it up a little.
          lastError = new SkipPostError(`${error.message} Postingan dilewati.`);
          await this.nudge(serial, bounds[1]);
          continue;
        }
        // The fingerprint uses the collapsed caption; comments are written from the full one.
        const expanded = await this.expandCaption(serial, nodes, target);
        return { ...expanded, fingerprint };
      }
      if (offlineNotice(nodes)) lastError = new NetworkError('Instagram di HP menampilkan masalah koneksi.');
      // Small steps only: a full swipe can push the opened post away and bring the next post's buttons up.
      await this.nudge(serial, 1500);
    }
    throw lastError;
  }
  async expandCaption(serial, nodes, target) {
    const more = captionMore(nodes), short = postCaption(nodes, target);
    if (!more) return { nodes, caption: short };
    await this.tap(serial, more); await pause(600);
    const after = await this.ui(serial), full = postCaption(after, target);
    // Keep the original screen if expanding moved the post's action bar away.
    return commentButton(after) && full.length >= short.length ? { nodes: after, caption: full } : { nodes, caption: short };
  }
  async openProfileGrid(serial, target) {
    await adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `https://www.instagram.com/${target}/`, '-p', PACKAGE]);
  }
  async openPostUrl(serial, url) {
    await adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, '-p', PACKAGE]);
  }
  async inspectGrid(serial, tiles) {
    try {
      const screen = await adb(['-s', serial, 'exec-out', 'screencap'], { encoding: 'buffer', timeout: 12000, maxBuffer: 32 * 1024 * 1024 });
      return { pins: visualPinnedKeys(screen, tiles), visuals: thumbnailIdentities(screen, tiles) };
    } catch {
      // Never interpret a failed screenshot as "no pins".
      throw new NetworkError('Thumbnail dan ikon pin belum dapat diperiksa dari layar HP; pemilihan postingan ditunda.');
    }
  }
  // Steps 1–3 of Auto komen: open the target's profile once, read its newest posts while
  // skipping pinned ones, and lock the list before any like or comment happens. The rest of
  // the run only uses this list, so new uploads cannot shift the targets anymore.
  async lockPosts(job, entry, meta) {
    const { serial, target } = entry, want = entry.posts;
    const parsedTarget = instagramTargets(target);
    if (parsedTarget.kind === 'posts') {
      const posts = Object.freeze(parsedTarget.targets.map(p => Object.freeze({ kind: 'post', url: p.target, shortcode: p.shortcode })));
      this.log(job, `${posts.length} link dikunci dari input: ${posts.map(p => p.shortcode).join(', ')}. Postingan dibuka berurutan tanpa kembali ke profil; retry tetap memakai daftar ini.`, meta);
      return { posts, pinned: 0 };
    }
    await this.closeSheets(serial);
    await this.openProfileGrid(serial, target);
    let verified = false, atTop = false, previous = '', waiting = 0;
    const order = [], identities = new Map(), pinnedKeys = new Set();
    for (let i = 0; i < 40; i++) {
      const nodes = await this.ui(serial);
      verified ||= nodes.some(n => (n.text || '').toLowerCase() === target && /action_bar|username/.test(n['resource-id'] || ''));
      if (nodes.some(n => /^(this account is private|akun ini bersifat pribadi|user not found|pengguna tidak ditemukan)$/i.test(n.text || ''))) throw new Error(`Profil @${target} tidak dapat diakses dari akun ini.`);
      if (byId(nodes, 'profile_header_post_count_front_familiar')?.['content-desc']?.match(/^0\s*(?:post|postingan)/i)) throw new Error(`@${target} belum punya postingan.`);
      const tiles = gridTiles(nodes), list = nodes.find(n => n.scrollable === 'true');
      if (!verified || !tiles.length) {
        if (offlineNotice(nodes) || ++waiting >= 8) throw new NetworkError(verified ? 'Grid postingan belum termuat.' : 'Profil target belum termuat.');
        if (verified) await this.swipe(serial, list, 'up', 700); else await pause(1000);
        continue;
      }
      if (!atTop) {
        // Deep links can restore an old scroll position; start from row 1.
        if (tiles.some(t => t.row && t.row > 1) && !tiles.some(t => t.row === 1)) { await this.swipe(serial, list, 'down', 700); continue; }
        atTop = true;
      }
      let inspection = await this.inspectGrid(serial, tiles);
      const visualPins = new Set(inspection.pins);
      // Instagram can draw the pin badges after the thumbnails; on the first screen,
      // and whenever a scan sees no pin at all, sample once more before trusting it.
      if (!order.length || !visualPins.size) {
        await pause(1200);
        inspection = await this.inspectGrid(serial, tiles);
        for (const key of inspection.pins) visualPins.add(key);
      }
      // Layout can settle while the screenshot is captured. Only use coordinates
      // that still match a fresh grid read; otherwise inspect the new layout.
      const fresh = gridTiles(await this.ui(serial));
      if (gridSignature(fresh) !== gridSignature(tiles)) continue;
      for (const t of tiles) {
        if (t.pinned || visualPins.has(t.key) || fresh.find(f => f.key === t.key)?.pinned) { pinnedKeys.add(t.key); continue; }
        const visual = inspection.visuals.get(t.key);
        if (!visual) {
          const [left, top, right, bottom] = t.node.bounds.match(/\d+/g).map(Number);
          if (t.complete && bottom - top >= (right - left) * .95) throw new NetworkError('Thumbnail postingan belum termuat; daftar akan dibaca ulang sebelum aktivitas dimulai.');
          continue;
        }
        const ref = { key: t.key, identity: tileIdentity(t), visual };
        const prior = identities.get(t.key);
        if (prior && (prior.visual !== ref.visual || prior.identity !== ref.identity)) throw new NetworkError('Grid berubah saat dibaca; daftar postingan akan dibaca ulang sebelum aktivitas dimulai.');
        if (!prior) { order.push(t.key); identities.set(t.key, ref); }
      }
      if (order.filter(key => !pinnedKeys.has(key)).length >= want) break;
      const signature = gridSignature(tiles);
      if (signature === previous) break; // The grid ended; lock whatever has been read.
      previous = signature;
      await this.swipe(serial, list, 'up', 700);
    }
    const chosen = order.filter(key => !pinnedKeys.has(key)).slice(0, want).map(key => identities.get(key));
    // Every slot before the last chosen post must be accounted for: clipped
    // rows can be skipped by fling inertia, and older posts must not fill gaps.
    const lastSlot = chosen.at(-1)?.key.match(/^(\d+):(\d+)$/);
    if (lastSlot) {
      const end = (Number(lastSlot[1]) - 1) * 3 + Number(lastSlot[2]);
      for (let slot = 1; slot <= end; slot++) {
        const key = `${Math.floor((slot - 1) / 3) + 1}:${(slot - 1) % 3 + 1}`;
        if (!identities.has(key) && !pinnedKeys.has(key)) throw new NetworkError('Ada bagian grid terbaru yang terlewat saat scroll; daftar akan dibaca ulang sebelum aktivitas dimulai.');
      }
    }
    for (const ref of chosen) {
      ref.ambiguous = [...identities.values()].some(other => other.key !== ref.key && other.identity === ref.identity && other.visual === ref.visual);
      Object.freeze(ref);
    }
    Object.freeze(chosen);
    if (!chosen.length) throw new SkipPostError(`Tidak ada postingan @${target} yang dapat dipakai.`, { end: true });
    this.log(job, `Daftar ${chosen.length === want ? want : `${chosen.length} dari ${want}`} postingan terbaru @${target} dikunci${pinnedKeys.size ? `, ${pinnedKeys.size} postingan disematkan dilewati` : ''}. Like dan komentar memakai daftar tetap ini sampai selesai.`, meta);
    return { posts: chosen, pinned: pinnedKeys.size };
  }
  // Match the locked description AND thumbnail. Missing/changed/ambiguous posts
  // are skipped; neither a grid position nor a same-day occurrence is a fallback.
  async openLockedPost(serial, target, postRef) {
    if (!postRef.visual || postRef.ambiguous) throw new SkipPostError('Identitas postingan dalam daftar tidak dapat dibedakan; dilewati tanpa mengganti sasaran.');
    await this.openProfileGrid(serial, target);
    let verified = false, atTop = false, previous = '', waiting = 0;
    for (let i = 0; i < 40; i++) {
      const nodes = await this.ui(serial);
      verified ||= nodes.some(n => (n.text || '').toLowerCase() === target && /action_bar|username/.test(n['resource-id'] || ''));
      const tiles = gridTiles(nodes), list = nodes.find(n => n.scrollable === 'true');
      if (!verified || !tiles.length) {
        if (offlineNotice(nodes) || ++waiting >= 8) throw new NetworkError(verified ? 'Grid postingan belum termuat.' : 'Profil target belum termuat.');
        if (verified) await this.swipe(serial, list, 'up', 700); else await pause(1000);
        continue;
      }
      if (!atTop) {
        if (tiles.some(t => t.row && t.row > 1) && !tiles.some(t => t.row === 1)) { await this.swipe(serial, list, 'down', 700); continue; }
        atTop = true;
      }
      const inspection = await this.inspectGrid(serial, tiles);
      const fresh = gridTiles(await this.ui(serial));
      if (gridSignature(fresh) !== gridSignature(tiles)) continue;
      const matches = fresh.filter(t => sameLockedPost(postRef, t, inspection.visuals, tileIdentity(t)));
      if (matches.length > 1) throw new SkipPostError('Ada beberapa postingan dengan identitas yang sama; dilewati tanpa mengganti sasaran.');
      if (matches.length) {
        const match = matches[0];
        if (match.pinned || inspection.pins.has(match.key)) throw new SkipPostError('Postingan dalam daftar kini disematkan; dilewati tanpa mengganti sasaran.');
        return { tile: match.node };
      }
      const signature = gridSignature(tiles);
      if (signature === previous) break;
      previous = signature;
      await this.swipe(serial, list, 'up', 700);
    }
    throw new SkipPostError(`Postingan dalam daftar terkunci tidak ada lagi di grid @${target}; dilewati.`);
  }
  // Likes only when the button clearly reads "not liked", so an unknown state never unlikes.
  async likePost(serial, nodes) {
    if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; like belum diverifikasi.');
    const state = likeState(nodes);
    if (state.status !== 'not_liked') return state.status;
    await this.tap(serial, state.node);
    // Berhenti segera setelah status terbaca: menunggu lebar tetap membuat setiap
    // like berbiaya satu setengah detik walau Instagram sudah selesai jauh lebih awal.
    for (let i = 0; i < 6; i++) {
      await pause(i ? 600 : 400);
      const after = await this.ui(serial);
      if (blockedNotice(after)) throw new BlockedError('Instagram membatasi akun ini (like ditolak). Akun dihentikan.');
      if (offlineNotice(after)) throw new NetworkError('Instagram di HP sedang offline; like belum diverifikasi.');
      if (likeState(after).status === 'already') return 'liked';
    }
    return 'unverified';
  }
  // Dua hal memblokir ketukan berikutnya di baris aksi: snackbar (tombol "Undo"-nya memakai
  // x 892-1020, tepat di kolom tombol simpan x 942-1074) dan lembar koleksi simpan yang menutupi
  // baris aksi. Keduanya dibersihkan sebelum aksi berikutnya, dan tombol "Undo" TIDAK pernah
  // disentuh. Menu tekan-lama diperlakukan sama: selama terbuka, layar di bawahnya tidak terbaca.
  // Bila ketiganya tidak terlihat pada node yang dipegang, tidak ada pembacaan tambahan.
  // Layar "Meta Account" hanya bisa ditutup lewat tombol "Done"/"Selesai"-nya: tombol Kembali
  // diabaikan, sedangkan pembersih penghalang aksi yang ada hanya menekan Kembali. Bila layar ini
  // tidak ditutup, pembacaan profil akun gagal berulang kali dan seluruh HP dilaporkan gagal.
  async dismissMetaAccount(serial, nodes) {
    if (!metaAccountScreen(nodes)) return null;
    const done = metaDoneButton(nodes);
    if (!done) return null;
    await this.tap(serial, done);
    await this.actionPause(900);
    this.overlaysClosed = (this.overlaysClosed || 0) + 1;
    return 'meta';
  }
  async clearActionBlockers(serial, nodes) {
    let last = nodes;
    for (let i = 0; i < 10; i++) {
      if (await this.dismissMetaAccount(serial, last)) {
        last = await this.ui(serial);
        continue;
      }
      const dialog = repostDialog(last);
      if (dialog) {
        if (dialog.close) await this.tap(serial, dialog.close);
        else await this.back(serial);
      } else if (savedSheet(last) || snackbarMessage(last)) {
        await this.back(serial);
      } else if (contextMenu(last)) {
        // Menu tekan-lama diperiksa lagi pada pembacaan baru sebelum Back: node yang dipegang
        // bisa berasal dari layar sebelumnya, sementara satu Back yang tidak perlu akan
        // meninggalkan halaman postingan.
        const fresh = await this.ui(serial);
        if (!contextMenu(fresh)) return fresh;
        this.overlaysClosed = (this.overlaysClosed || 0) + 1;
        await this.back(serial);
      } else return last;
      await this.actionPause(600);
      last = await this.ui(serial);
    }
    throw new NetworkError('Notifikasi Instagram belum hilang; ketukan berikutnya ditahan.');
  }
  // Menyimpan membuka lembar koleksi yang menutupi baris aksi. Lembar itu baru muncul sesaat
  // setelah label simpan berubah, jadi satu pembacaan bersih tambahan dibayar di sini: tanpa itu
  // ketukan repost/share/komentar berikutnya mendarat di lembar tersebut.
  async dismissSavedSheet(serial, nodes) {
    let last = nodes;
    for (let i = 0; i < 8; i++) {
      if (savedSheet(last)) {
        await this.back(serial);
        await this.actionPause(500);
      } else if (i > 0) return last;
      else await this.actionPause(400);
      last = await this.ui(serial);
    }
    if (savedSheet(last)) throw new NetworkError('Lembar koleksi simpan belum bisa ditutup; langkah berikutnya ditahan.');
    return last;
  }
  // Simpan hanya diketuk saat label jelas menyatakan belum tersimpan.
  async savePost(serial, nodes) {
    if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; simpan belum diverifikasi.');
    const state = saveState(await this.clearActionBlockers(serial, nodes));
    if (state.status === 'saved') return { status: 'already', nodes };
    if (state.status !== 'not_saved') return { status: 'unverified', nodes };
    await this.tap(serial, state.node);
    let last = nodes;
    for (let i = 0; i < 6; i++) {
      await this.actionPause(i ? 600 : 400);
      last = await this.ui(serial);
      if (blockedNotice(last)) throw new BlockedError('Instagram membatasi akun ini (simpan ditolak). Akun dihentikan.');
      if (offlineNotice(last)) throw new NetworkError('Instagram di HP sedang offline; simpan belum diverifikasi.');
      if (saveState(last).status === 'saved') return { status: 'saved', nodes: await this.dismissSavedSheet(serial, last) };
    }
    return { status: 'unverified', nodes: last };
  }
  // Repost terbit ke profil akun sendiri. Dua sinyal suksesnya: dialog "You reposted …"
  // (harus ditutup, karena memblokir layar) atau snackbar "Reposted". Mengetuk ulang tidak
  // memunculkan apa pun, jadi percobaan ulang tidak bisa menghasilkan repost ganda.
  async repostPost(serial, nodes) {
    const before = await this.clearActionBlockers(serial, nodes);
    const button = repostButton(before);
    if (!button) return { status: 'missing', nodes: before, at: '-' };
    await this.tap(serial, button);
    let last = before;
    for (let i = 0; i < 10; i++) {
      await this.actionPause(i ? 500 : 300);
      last = await this.ui(serial);
      if (blockedNotice(last)) throw new BlockedError('Instagram membatasi akun ini (repost ditolak). Akun dihentikan.');
      if (offlineNotice(last)) throw new NetworkError('Instagram di HP sedang offline; repost belum diverifikasi.');
      if (repostConfirmed(last)) return { status: 'reposted', nodes: await this.clearActionBlockers(serial, last), at: button.bounds };
    }
    return { status: 'unverified', nodes: last, at: button.bounds };
  }
  // Komentar adalah langkah terakhir dan paling berbahaya: kolom komentar yang terbuka bisa masih
  // milik postingan SEBELUMNYA, dan dua postingan dari pemilik yang sama tidak bisa dibedakan dari
  // petunjuk kolomnya ("Add a comment for <pemilik>"). Di uji 3 postingan 14 Okt 2026 komentar
  // postingan ke-2 mendarat di postingan ke-1 dengan log yang tampak bersih. Jadi postingan dibuka
  // ulang dan diverifikasi tepat sebelum kolom komentar dipakai; identitas yang tidak cocok menahan
  // komentar, bukan menebak.
  async verifyBeforeComment(serial, account, target, ref, fingerprint) {
    const again = await this.openPost(serial, account, target, ref);
    if (again.owner !== target) throw new NetworkError('Pemilik postingan berubah sebelum komentar; komentar ditahan.');
    if (again.fingerprint !== fingerprint) throw new NetworkError('Postingan berubah sebelum komentar; komentar ditahan.');
    return again.nodes;
  }
  async closeShareSheet(serial) {
    for (let i = 0; i < 4; i++) {
      const nodes = await this.ui(serial);
      if (!shareSheetOpen(nodes)) return nodes;
      await this.back(serial); await this.actionPause(600);
    }
    return await this.ui(serial);
  }
  // Share mengirim pesan langsung ke kontak pertama yang muncul di lembar share.
  // Urutan kontak mengikuti percakapan terakhir, jadi kontak dibaca dari lembar yang
  // sedang terbuka, bukan dari daftar yang disimpan sebelumnya.
  async sharePost(serial, nodes, account) {
    const before = await this.clearActionBlockers(serial, nodes);
    const button = shareButton(before);
    if (!button) return { status: 'missing', to: '', nodes: before, at: '-' };
    await this.tap(serial, button);
    let last = before, contacts = [], opened = false;
    for (let i = 0; i < 10; i++) {
      await this.actionPause(i ? 700 : 400);
      last = await this.ui(serial);
      if (offlineNotice(last)) throw new NetworkError('Instagram di HP sedang offline; share belum dikirim.');
      opened ||= shareSheetOpen(last);
      contacts = shareContacts(last);
      if (contacts.length) break;
    }
    const contact = contacts.find(c => c.name.toLowerCase() !== account);
    if (!contact) {
      const settled = opened ? await this.closeShareSheet(serial) : last;
      return { status: contacts.length ? 'self_only' : opened ? 'nocontact' : 'nosheet', to: '', nodes: settled, at: button.bounds };
    }
    await this.tap(serial, contact.node);
    let ready = false;
    for (let i = 0; i < 8 && !ready; i++) {
      await this.actionPause(i ? 500 : 300);
      last = await this.ui(serial);
      ready = Boolean(shareContacts(last).find(c => c.name === contact.name)?.selected);
    }
    if (!ready) return { status: 'unselected', to: contact.name, nodes: await this.closeShareSheet(serial), at: button.bounds };
    const send = shareSendButton(last);
    if (!send) return { status: 'nosend', to: contact.name, nodes: await this.closeShareSheet(serial), at: button.bounds };
    await this.tap(serial, send);
    for (let i = 0; i < 10; i++) {
      await this.actionPause(i ? 600 : 400);
      last = await this.ui(serial);
      // Lembar yang menutup sendiri adalah satu-satunya bukti kiriman yang terlihat.
      if (!shareSheetOpen(last)) return { status: 'sent', to: contact.name, nodes: last, at: button.bounds };
      if (blockedNotice(last)) throw new BlockedError('Instagram membatasi akun ini (share ditolak). Akun dihentikan.');
    }
    return { status: 'unverified', to: contact.name, nodes: last, at: button.bounds };
  }
  // Open only the composer. Existing comments never determine this job's quota.
  async openThread(serial, account, target, postNodes, postText = '', { readOnlyText } = {}) {
    // Node yang dipegang bisa berasal dari sebelum baris aksi bergeser. Bila tombolnya tidak
    // terlihat di situ, layar dibaca ulang sekali sebelum menyimpulkan gagal: satu pembacaan
    // lebih murah daripada satu percobaan ulang seluruh postingan.
    const button = commentButton(postNodes) || commentButton(await this.ui(serial));
    if (!button) throw new NetworkError('Tombol komentar belum terlihat.');
    await this.tap(serial, button);
    let nodes = [], composer;
    for (let i = 0; i < 6; i++) {
      await pause(i ? 500 : 350);
      nodes = await this.ui(serial);
      if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; komentar tidak dikirim.');
      composer = composerAccount(nodes);
      if (composer.field) break;
    }
    if (!composer?.field) throw new NetworkError('Kolom komentar belum termuat.');
    if (!this.composerMatches(serial, account, target, composer) && !(readOnlyText && composer.field?.text === readOnlyText && this.verifiedAccounts.get(serial)?.username === account)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    return { caption: postText || threadCaption(nodes, target) || postCaption(postNodes, target) };
  }
  countFor(key) { return this.state.counts[key]?.count || 0; }
  setCount(key, count, extra = {}) { this.state.counts[key] = { ...this.state.counts[key], ...extra, count, at: new Date().toISOString() }; }
  commentKey(job, account, postKey) {
    job.commentRunId ||= job.id || randomUUID();
    return `new-comments:${job.commentRunId}:${account}:${postKey}`;
  }
  pendingRecords(key, postKey = this.state.counts[key]?.postKey, legacyKey = this.state.counts[key]?.legacyKey) {
    return this.state.history.filter(r => ['sending', 'posting', 'uncertain', 'blocked'].includes(r.status) &&
      (r.key === key || (postKey && r.postKey === postKey) || (legacyKey && (r.key === legacyKey || r.legacyKey === legacyKey))));
  }
  holdPending(job, entry, key) {
    const pending = this.pendingRecords(key);
    if (!pending.length) return false;
    for (const record of pending) {
      record.id ||= randomUUID();
      if (!record.postRef && entry.currentPost && this.logPrefix !== 'tt') Object.assign(record, {
        serial: entry.serial, postRef: structuredClone(entry.currentPost.ref), targetInput: entry.target,
        fingerprint: entry.currentPost.fingerprint,
      });
    }
    entry.pendingPosts ||= {};
    entry.pendingPosts[key] = pending.length;
    entry.pending = Object.values(entry.pendingPosts).reduce((sum, count) => sum + count, 0);
    this.log(job, 'Kiriman sebelumnya belum pasti; pengiriman pada postingan ini ditahan. Periksa hasilnya sebelum melanjutkan.', { serial: entry.serial, username: entry.username, target: entry.targetOwner || entry.target, status: 'uncertain' });
    return true;
  }
  reserveComment(key, account, target, text, entry = null, job = null) {
    const { postKey, legacyKey } = this.state.counts[key] || {};
    const record = { id: randomUUID(), key, postKey, legacyKey, username: account, target, text, at: new Date().toISOString(), status: 'sending', phase: 'prepared',
      serial: entry?.serial, commentRunId: job?.commentRunId, targetInput: entry?.target, postRef: entry?.currentPost?.ref ? structuredClone(entry.currentPost.ref) : null, fingerprint: entry?.currentPost?.fingerprint };
    this.setCount(key, this.countFor(key) + 1, { username: account, target });
    this.state.history.push(record);
    // Never discard unresolved sends: they also hold a later, new job.
    if (this.state.history.length > 5000) {
      const removable = this.state.history.findIndex(r => ['sent', 'failed', 'cancelled'].includes(r.status));
      if (removable >= 0) this.state.history.splice(removable, 1);
    }
    return record;
  }
  // The comment is counted before Send. "Posting…" is awaited; a clear "couldn't post" releases the count.
  async sendComment(job, entry, key, text) {
    const { serial, username: account } = entry, target = entry.targetOwner || entry.target, meta = { serial, username: account, target };
    let nodes = await this.ui(serial);
    const composer = composerAccount(nodes);
    if (offlineNotice(nodes)) throw new NetworkError('Instagram di HP sedang offline; komentar tidak dikirim.');
    if (!composer.field) throw new NetworkError('Kolom komentar tertutup atau belum termuat; postingan akan dibuka ulang.');
    if (!this.composerMatches(serial, account, target, composer)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    if (postFailedNotice(nodes) || postingNotice(nodes)) throw new NetworkError('Layar masih menunjukkan kiriman sebelumnya; tunggu pemeriksaan sebelum mengirim.');
    if (!await this.net.phoneOnline(serial)) throw new NetworkError('HP tidak terhubung ke internet; komentar tidak dikirim.');
    // Recheck after the asynchronous network check, then reserve synchronously.
    if (this.holdPending(job, entry, key)) return 'uncertain';
    if (this.countFor(key) >= entry.comments) return 'full';
    const record = this.reserveComment(key, account, target, text, entry, job);
    await this.checkpointJob(job);
    const release = async status => { this.setCount(key, Math.max(0, this.countFor(key) - 1)); record.status = status; await this.save(); };
    let send;
    try {
      this.assertRunning();
      await this.focusCommentInput(serial, account, target);
      await this.typeComment(serial, text);
      send = await this.prepareCommentSend(serial, text);
      this.assertRunning();
    } catch (error) { await release('cancelled'); throw error; }
    // Journal the ambiguous boundary before the tap; a crash here must never auto-resend.
    record.phase = 'send_requested'; await this.save();
    let status = 'uncertain';
    this.confirming.add(serial);
    try { await this.tap(serial, send); status = await this.checkDelivery(entry, text); }
    catch (error) { record.error = 'Pemeriksaan kiriman terputus; hasil belum pasti.'; }
    finally { this.confirming.delete(serial); }
    if (status === 'blocked') { record.status = 'blocked'; await this.save(); throw new BlockedError('Instagram menolak komentar dari akun ini. Akun dihentikan.'); }
    if (status === 'failed') {
      await release('failed');
      this.log(job, 'Instagram gagal memposting komentar ini; hitungan dibatalkan dan akan diisi ulang.', { ...meta, status: 'failed' });
      throw new NetworkError('Instagram gagal memposting komentar.');
    }
    record.status = status; record.at = new Date().toISOString(); record.phase = 'checked';
    const recent = this.state.recent[account] ||= [];
    recent.push(text); if (recent.length > 300) recent.splice(0, recent.length - 300);
    this.sentTexts.push(text);
    await this.save();
    if (status === 'sent') {
      entry.sent++; job.sent++;
      this.log(job, `Terkirim dalam pekerjaan ini: ${this.countFor(key)}/${entry.comments}.`, { ...meta, status: 'sent' });
      return 'sent';
    }
    this.holdPending(job, entry, key);
    this.log(job, `${status === 'posting' ? 'Instagram masih memposting' : 'Status kiriman belum pasti'}; pengiriman berikutnya ditahan sampai hasil diperiksa.`, { ...meta, status });
    await this.logScreen(job, meta);
    return status;
  }
  deliveryObservation(serial, account, target, text, nodes) {
    const composer = composerAccount(nodes);
    const matches = node => threadComments([node], target).some(c => c.author === account && c.text === text);
    return { blocked: blockedNotice(nodes), offline: offlineNotice(nodes), failed: postFailedNotice(nodes), posting: postingNotice(nodes),
      accountMatches: this.composerMatches(serial, account, target, composer) || (composer.field?.text === text && this.verifiedAccounts.get(serial)?.username === account),
      visible: composer.field?.text !== text && nodes.some(matches), scopedFailure: associatedFailure(nodes, matches, postFailedNotice) };
  }
  async deliveryUi(serial) { return this.ui(serial, 2); }
  async checkDelivery(entry, text, options = {}) {
    return verifyDelivery({ observe: async () => this.deliveryObservation(entry.serial, entry.username, entry.targetOwner || entry.target, text, await this.deliveryUi(entry.serial)),
      online: () => this.net.phoneOnline(entry.serial), pause: this.deliveryPause, ...options });
  }
  async checkpointJob(job) {
    if (!job?.accounts) { await this.save(); return; }
    for (const entry of job.accounts) if (entry.progress) updateProgress(this, entry);
    this.state.lastCommentJob = structuredClone(job);
    const saved = this.state.resumableJob;
    if (saved && saved.commentRunId === job.commentRunId) {
      for (const [index, entry] of job.accounts.entries()) Object.assign(saved.accounts[index], { progress: structuredClone(entry.progress || {}), remaining: entry.remaining });
    }
    await this.save();
  }
  composerMatches(serial, account, target, composer) {
    if (!composer.field) return false;
    if (composer.username) {
      if (composer.username !== account) return false;
      // The composer naming the account is fresh evidence that it still owns this column,
      // so renew the mark instead of letting a long turn expire it.
      this.verifiedAccounts.set(serial, { username: account, at: Date.now() });
      return true;
    }
    // "Add a comment for X" names the post owner, not the logged-in author.
    // In that UI variant, fall back to the mark left by this operation's account check.
    const proof = this.verifiedAccounts.get(serial);
    // Instagram clips a long owner name in the hint ("Add a comment for akun.contoh104.offi…").
    // Only trust the prefix when the UI itself marked it truncated, so a shorter real name never matches by accident.
    const ownerMatches = composer.target === target || Boolean(composer.targetTruncated && composer.target && target.startsWith(composer.target));
    return proof?.username === account && Date.now() - proof.at < PROOF_TTL_MS &&
      (ownerMatches || composer.genericPlaceholder);
  }
  rememberPlans(plan) {
    for (const a of plan.accounts) this.state.plans[`${a.serial}:${a.username}`] = { target: a.target, posts: a.posts, comments: a.comments, tone: a.tone };
    return this.save();
  }
  groupBySerial(accounts) {
    const groups = new Map();
    for (const account of accounts) { if (!groups.has(account.serial)) groups.set(account.serial, []); groups.get(account.serial).push(account); }
    return [...groups];
  }
  // ---- Logs, screen text and internet ----
  deviceName(serial) { return this.devices().find(d => d.serial === serial)?.name || serial || ''; }
  log(job, message, extra = {}) {
    const at = new Date();
    job.logs.push({ at: at.toISOString(), message, ...extra });
    if (job.logs.length > 500) job.logs.shift();
    const who = [extra.serial && this.deviceName(extra.serial), extra.username && `@${extra.username}`].filter(Boolean).join(' ');
    this.logs.write(job.logFile, `${clock(at)}  ${who ? `${who}${extra.target ? ` → ${targetLabel(extra.target)}` : ''} · ` : ''}${message}`);
  }
  async openLog(job, kind, title, lines = []) {
    const created = await this.logs.create(`${this.logPrefix}${kind}`, title).catch(() => null);
    job.logId = created?.id || null; job.logFile = created?.file || null;
    for (const line of lines) this.logs.write(job.logFile, line);
  }
  async readScreen(serial) { return (await this.reader.read(serial)) || ''; }
  async logScreen(job, meta, label = 'Teks di layar') {
    const text = (await this.readScreen(meta.serial).catch(() => '')).replace(/\s*\n\s*/g, ' / ');
    if (text) this.log(job, `${label}: ${text.length > 400 ? `${text.slice(0, 397)}…` : text}`, meta);
  }
  listLogs() { return this.logs.list(); }
  readLog(id) { return this.logs.read(id); }
  // A network problem waits with growing pauses (about one minute in total) before giving up the step.
  async patient(job, meta, label, step) {
    const delays = [5000, 10000, 20000, 25000];
    for (let attempt = 0; ; attempt++) {
      try { return await step(); }
      catch (error) {
        if (!(error instanceof NetworkError) || this.stopRequested || attempt >= delays.length) throw error;
        await this.checkInternet(job, meta);
        this.assertRunning();
        this.log(job, `${label}: ${error.message} Coba lagi dalam ${delays[attempt] / 1000} detik (${attempt + 1}/${delays.length}).`, { ...meta, status: 'network' });
        await this.wait(delays[attempt]);
        this.assertRunning();
      }
    }
  }
  async checkInternet(job, meta) {
    if (!await this.net.macOnline()) return this.internetOutage(job);
    if (!meta.serial || await this.net.phoneOnline(meta.serial)) return;
    this.log(job, 'Internet HP terputus; menyalakan ulang koneksi HP.', meta);
    const result = await this.net.restoreInternet(meta.serial);
    this.log(job, result.online ? `Internet HP kembali${result.relay ? ' (relay di Mac dinyalakan ulang)' : ''}.` : 'Internet HP belum kembali.', meta);
  }
  // Mac offline: every HP waits here; checked every 15 s, stopped after 5 minutes.
  internetOutage(job) {
    this.outage ||= (async () => {
      job.paused = true;
      this.log(job, 'Internet Mac terputus. Semua HP dijeda; dicek setiap 15 detik, maksimal 5 menit.', { status: 'paused' });
      for (let check = 0; check < 20 && !this.stopRequested; check++) {
        await this.wait(15000);
        if (await this.net.macOnline()) { job.paused = false; this.log(job, 'Internet kembali. Semua HP lanjut.'); return; }
      }
      job.paused = false;
      if (!this.stopRequested) {
        job.stopReason = 'Internet putus lebih dari 5 menit; proses dihentikan.';
        this.stopRequested = true; if (job.status === 'running') job.status = 'stopping';
        this.log(job, job.stopReason, { status: 'stopped' });
      }
    })().finally(() => { this.outage = null; });
    return this.outage;
  }
  async ensurePhoneInternet(job, serial, username) {
    if (await this.net.phoneOnline(serial)) return true;
    this.log(job, 'HP belum punya internet; mencoba menyalakan koneksi.', { serial, username });
    const result = await this.net.restoreInternet(serial);
    this.log(job, result.online ? 'Internet HP tersambung.' : 'HP tetap tidak punya internet.', { serial, username });
    return result.online;
  }
  // Read-only check of every selected account: no like and no comment is sent.
  // Menu "Ambil link postingan": membaca N postingan terbaru sebuah channel lalu menyalin
  // tautannya supaya bisa ditempel ke kolom target Auto komen. Tidak menyukai, menyimpan,
  // membagikan, atau mengomentari apa pun; yang dikerjakan hanya membaca dan menyalin.
  async collectLinks(body) {
    if (this.duplicates?.busy || this.logout?.busy || this.login?.busy || this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Tunggu proses Instagram yang berjalan selesai.');
    const request = validateLinkRequest(body, this.state.devices);
    this.checkDevice(request.serial);
    this.previewPending = true; this.abortRequested = false;
    const job = { logs: [] };
    try {
      await this.openLog(job, 'link', `${request.count} link terbaru @${request.target} · tidak mengirim apa pun`);
      this.log(job, `Mengambil ${request.count} link postingan terbaru @${request.target} memakai akun @${request.account}. Tidak ada like, simpan, repost, share, atau komentar.`);
      const collected = await this.locked(request.serial, async () => {
        await this.prepareDevice(request.serial);
        const entry = { serial: request.serial, username: request.account, target: request.target, posts: request.count };
        const { posts, pinned } = await this.patient(job, entry, 'Daftar postingan', () => this.lockPosts(job, entry, entry));
        const found = [];
        for (const [index, ref] of posts.entries()) {
          if (this.abortRequested) break;
          try {
            const post = await this.patient(job, entry, `Buka postingan ${index + 1}`, () => this.openPost(request.serial, request.account, request.target, ref));
            await this.closeShareSheet(request.serial).catch(() => {});
            const link = await this.patient(job, entry, `Salin link ${index + 1}`, () => copyOpenPostLink(this, request.serial));
            found.push({ index, url: link.target, shortcode: link.shortcode, caption: post.caption || '' });
            this.log(job, `Link ${index + 1}/${posts.length} terbaca: ${link.target}`, entry);
          } catch (error) {
            this.log(job, `Postingan ${index + 1}/${posts.length} dilewati: ${error.message}`, { ...entry, status: 'deferred' });
            await this.closeSheets(request.serial).catch(() => {});
          }
        }
        // Dua tautan yang sama tidak mungkin berasal dari dua postingan berbeda: itu tanda
        // salinan tertinggal (papan klip masih berisi tautan sebelumnya), jadi dibuang.
        const links = [], seen = new Set();
        for (const item of found) {
          if (seen.has(item.shortcode)) { this.log(job, `Link ${item.index + 1} sama dengan link yang sudah terbaca; dibuang supaya tidak ada yang dobel.`, entry); continue; }
          seen.add(item.shortcode);
          links.push(item);
        }
        // Tiap tautan dibuka sekali lagi dan dibandingkan dengan postingan dari daftar terkunci.
        // Tanpa langkah ini, salinan yang bergeser satu langkah tidak bisa dibedakan: tautannya
        // tetap berbeda satu sama lain, hanya bukan milik postingan yang dimaksud.
        //
        // Pembandingnya CAPTION, bukan sidik jari: jalur grid dan jalur link membaca pemilik
        // dengan cara berbeda sehingga sidik jarinya berbeda untuk postingan yang sama (diuji
        // 15 Okt 2026 - caption identik, sidik jari berbeda), sementara caption terbaca sama dari
        // kedua jalur. Postingan tanpa caption tidak bisa dipastikan, jadi linknya dibuang.
        if (request.verify) {
          for (const item of links) {
            const ref = { kind: 'post', url: item.url, shortcode: item.shortcode, owner: request.target };
            try {
              const again = await this.patient(job, entry, `Periksa link ${item.index + 1}`, () => this.openPost(request.serial, request.account, request.target, ref));
              item.verified = Boolean(item.caption) && again.owner === request.target && again.caption === item.caption;
              if (!item.caption) this.log(job, `Postingan urutan ke-${item.index + 1} tanpa caption, jadi linknya tidak bisa dipastikan.`, { ...entry, status: 'deferred' });
            } catch (error) {
              item.verified = false;
              this.log(job, `Link ${item.index + 1} belum bisa dipastikan: ${error.message}`, { ...entry, status: 'deferred' });
            }
            if (item.verified === false) this.log(job, `Link ${item.index + 1} tidak cocok dengan postingan urutan ke-${item.index + 1}; dikeluarkan dari daftar.`, { ...entry, status: 'deferred' });
            await this.closeSheets(request.serial).catch(() => {});
          }
        }
        return { wanted: posts.length, pinned, links };
      });
      const good = collected.links.filter(link => link.verified !== false);
      const dropped = collected.links.filter(link => link.verified === false);
      const urls = good.map(link => link.url);
      await this.closeSheets(request.serial).catch(() => {});
      const message = urls.length
        ? `${urls.length} dari ${collected.wanted} link siap. Salin lalu tempel satu link per baris di kolom target Auto komen.${dropped.length ? ` ${dropped.length} link dibuang karena tidak cocok.` : ''}${request.verify ? '' : ' Pemeriksaan tiap link dilewati.'}`
        : `Tidak ada link yang bisa dipakai dari ${collected.wanted} postingan terbaru @${request.target}.`;
      this.log(job, message);
      return { ...this.snapshot(), checking: false, links: urls, dropped: dropped.map(link => ({ index: link.index, url: link.url })), pinned: collected.pinned, message, logId: job.logId };
    } finally { this.previewPending = false; this.abortRequested = false; }
  }
  async preview(body) {
    const plan = validatePlan(body, this.state.devices, { allowPostLinks: this.logPrefix !== 'tt' });
    if (this.duplicates?.busy || this.logout?.busy || this.login?.busy || this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Tunggu proses Instagram yang berjalan selesai.');
    const resumed = this.resumeFor(body, plan);
    for (const account of plan.accounts) this.checkDevice(account.serial);
    this.previewPending = true; this.abortRequested = false;
    const job = { logs: [] };
    try {
      await this.rememberPlans(plan);
      await this.openLog(job, 'cek', `${plan.accounts.length} akun · tidak mengirim apa pun`);
      if (resumed) {
        const results = [];
        for (let accountIndex = 0; accountIndex < plan.accounts.length; accountIndex++) {
          const account = plan.accounts[accountIndex], refs = Object.freeze(structuredClone(resumed.accounts[accountIndex].lockedPosts).map(Object.freeze));
          if (!await this.ensurePhoneInternet(job, account.serial, account.username)) throw new Error('HP belum punya internet.');
          await this.locked(account.serial, async () => {
            for (let index = 0; index < refs.length; index++) {
              if (this.abortRequested) break;
              this.log(job, `Periksa daftar terkunci ${index + 1}/${refs.length} tanpa like atau kiriman.`, account);
              try {
                const result = { index, postRef: refs[index], ...await this.inspect(job, account, refs[index]) };
                results.push(result);
                this.log(job, `Pratinjau daftar terkunci: ${JSON.stringify(result)}`, account);
              }
              catch (error) { results.push({ index, postRef: refs[index], serial: account.serial, username: account.username, target: account.target, ok: false, error: error.message }); }
            }
          });
        }
        return { results, stopped: this.abortRequested || undefined, message: 'Pemeriksaan daftar terkunci selesai tanpa like atau kiriman.', logId: job.logId };
      }
      const results = new Map();
      await Promise.all(this.groupBySerial(plan.accounts).map(async ([serial, accounts]) => {
        const online = await this.ensurePhoneInternet(job, serial, accounts[0].username);
        for (const account of accounts) {
          const key = `${serial}:${account.username}`, meta = { serial, username: account.username, target: account.target };
          if (this.abortRequested) { results.set(key, { ...meta, ok: false, error: 'Pemeriksaan dihentikan sebelum akun ini diperiksa.' }); continue; }
          if (!online) { results.set(key, { ...meta, ok: false, error: 'HP tidak punya internet.' }); continue; }
          try { results.set(key, await this.locked(serial, () => this.inspect(job, account))); }
          catch (error) { results.set(key, { ...meta, ok: false, error: error.message }); this.log(job, `Gagal diperiksa: ${error.message}`, meta); }
        }
      }));
      const ordered = plan.accounts.map(a => results.get(`${a.serial}:${a.username}`));
      const ok = ordered.filter(r => r.ok).length;
      const message = this.abortRequested
        ? `Pemeriksaan dihentikan; ${ok} dari ${ordered.length} akun sempat diperiksa. Tidak ada like atau komentar yang dikirim.`
        : `${ok} dari ${ordered.length} akun berhasil diperiksa. Tidak ada like atau komentar yang dikirim.`;
      this.log(job, message);
      return { results: ordered, stopped: this.abortRequested || undefined, message, logId: job.logId };
    } finally { this.previewPending = false; this.abortRequested = false; }
  }
  async inspect(job, account, lockedRef = null, accountReady = false) {
    const { serial, username: name, target } = account, meta = { serial, username: name, target };
    if (!accountReady) { await this.prepareDevice(serial); await this.accountSheet(serial, name); }
    const { posts, pinned } = lockedRef ? { posts: [lockedRef], pinned: 0 } : await this.patient(job, meta, 'Daftar postingan', () => this.lockPosts(job, { ...account, posts: 1 }, meta));
    if (!lockedRef && posts.length > 1 && posts.every(ref => ref.kind === 'post')) {
      const results = [];
      for (const [index, ref] of posts.entries()) {
        if (this.abortRequested) break;
        this.log(job, `Preview link ${index + 1}/${posts.length}: ${ref.url}`, meta);
        try { results.push({ url: ref.url, ...await this.inspect(job, account, ref, true) }); }
        catch (error) {
          results.push({ url: ref.url, ok: false, error: error.message });
          // Without this line a link that fails leaves nothing behind but a missing caption.
          this.log(job, `Link ${index + 1}/${posts.length} belum bisa diperiksa: ${error.message}`, meta);
        }
      }
      return { serial, username: name, target, ok: results.length === posts.length && results.every(r => r.ok), posts: results, error: results.some(r => !r.ok) ? 'Ada link yang belum bisa diperiksa.' : undefined };
    }
    const opened = await this.patient(job, meta, 'Buka postingan 1', async () => {
      const post = await this.openPost(serial, name, target, posts[0]);
      const screen = await this.readScreen(serial);
      return { post, screen, thread: await this.openThread(serial, name, post.owner || target, post.nodes, post.caption) };
    });
    const { post, screen, thread } = opened;
    const postKey = `${name}:${posts[0]?.shortcode || post.fingerprint}`;
    const uncertain = this.pendingRecords('', postKey, `${name}:${post.fingerprint}`).length > 0;
    const generated = await this.generate({ caption: thread.caption, konteks: screen, count: 3, tone: account.tone, hindari: (this.state.recent[name] || []).slice(-40) });
    await this.back(serial); await this.back(serial);
    const liked = likeState(post.nodes).status;
    this.log(job, `Caption "${(thread.caption || '').slice(0, 120)}" · suasana ${generated.suasana} · like ${liked} · ${account.comments} komentar baru per postingan${uncertain ? ' (ditahan: kiriman belum pasti)' : ''}.`, meta);
    return { serial, username: name, target, ok: true, caption: lockedRef ? (thread.caption || '') : (thread.caption || '').slice(0, 300), fullCaption: thread.caption || '', commentMode: 'new-per-job', ...(lockedRef ? { context: screen } : {}), suasana: generated.suasana, tone: generated.tone, liked, uncertain, need: uncertain ? 0 : account.comments, pinned, samples: generated.comments };
  }
  // Persist only references collected by the running script, never a caller's
  // requested grid positions. A later resume uses these identities unchanged.
  async rememberLockedJob(job) {
    this.state.resumableJob = {
      id: job.id, commentMode: 'new-per-job', commentRunId: job.commentRunId ||= job.id || randomUUID(),
      accounts: job.accounts.map(({ serial, username, target, posts, comments, tone, lockedPosts, progress, remaining }) =>
        ({ serial, username, target, posts, comments, tone, progress: structuredClone(progress || {}), remaining, lockedPosts: lockedPosts ? structuredClone(lockedPosts) : null })),
    };
    await this.save();
  }
  resumeFor(body, plan) {

    if (body.resumeJobId !== undefined) {
      const saved = this.state.resumableJob;
      if (this.logPrefix === 'tt' || !saved || saved.id !== body.resumeJobId) throw new Error('Daftar terkunci untuk proses ini tidak tersedia.');
      if (saved.commentMode !== 'new-per-job' || !saved.commentRunId) throw new Error('Proses lama memakai target total. Tidak bisa dilanjutkan dengan kuota baru; mulai pekerjaan baru secara eksplisit.');
      const settings = ({ serial, username, target, posts, comments, tone }) => ({ serial, username, target, posts, comments, tone });
      if (JSON.stringify(plan.accounts.map(settings)) !== JSON.stringify(saved.accounts.map(settings))) throw new Error('Akun, HP, target, jumlah, dan nada harus sama dengan proses yang dilanjutkan.');
      if (saved.accounts.some(a => !Array.isArray(a.lockedPosts) || !a.lockedPosts.length)) throw new Error('Proses sebelumnya belum selesai mengunci seluruh daftar postingan.');
      return saved;
    }
    return null;
  }
  // Proses yang sedang berjalan di manager ini. Dipakai penjaga start() supaya pesannya menyebut
  // proses mana yang menghalangi, dan oleh Stop total supaya tahu apa yang harus dihentikan.
  blockers() {
    const list = [];
    if (this.job && ['running', 'stopping'].includes(this.job.status)) list.push('auto komen');
    if (this.login?.busy) list.push('auto login');
    if (this.logout?.busy) list.push('log out');
    if (this.duplicates?.busy) list.push('rapikan akun duplikat');
    if (this.scanPending) list.push('pemindaian akun');
    if (this.previewPending) list.push('pemeriksaan');
    if (this.locks.size) list.push(`${this.locks.size} HP sedang dipakai`);
    return list;
  }
  // Tombol "Stop total": menghentikan SEMUA proses sekaligus - auto komen, auto login, log out,
  // rapikan akun duplikat, pemindaian akun, dan pemeriksaan - lalu membersihkan penanda yang
  // tersangkut. Penanda itulah yang membuat pekerjaan baru ditolak dengan "Masih ada proses
  // Instagram yang berjalan" walau tidak ada yang benar-benar berjalan.
  async stopEverything({ waitMs = 4000 } = {}) {
    const stopped = this.blockers();
    this.abortRequested = true;
    this.duplicates?.stop?.();
    this.logout?.stop?.();
    this.login?.stop?.();
    if (this.job?.status === 'running') {
      this.stopRequested = true; this.job.status = 'stopping';
      this.log(this.job, 'Dihentikan lewat Stop total; komentar yang sudah terkirim tetap tercatat.');
    }
    // Operasi yang sedang berjalan diberi kesempatan keluar sendiri dulu. Sisa penanda setelah
    // batas waktu berarti operasinya berhenti tanpa membersihkannya, dan itulah yang membuat
    // pekerjaan berikutnya ditolak terus.
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && (this.scanPending || this.previewPending || this.locks.size)) await pause(200);
    const forced = [];
    if (this.scanPending) { this.scanPending = null; this.scanActive = false; forced.push('pemindaian akun'); }
    if (this.previewPending) { this.previewPending = false; forced.push('pemeriksaan'); }
    if (this.locks.size) { forced.push(`${this.locks.size} kunci HP`); this.locks.clear(); }
    await this.save().catch(() => {});
    return { stopped, forced, job: this.job?.status || null };
  }
  start(body) {
    const blockers = this.blockers();
    if (blockers.length) throw new Error(`Masih ada proses Instagram yang berjalan (${blockers.join(', ')}). Tekan Stop total untuk menghentikannya, lalu jalankan lagi.`);
    const plan = validatePlan(body, this.state.devices, { allowPostLinks: this.logPrefix !== 'tt' });
    const resumed = this.resumeFor(body, plan);
    for (const account of plan.accounts) this.checkDevice(account.serial);
    const job = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString(), finishedAt: null, sent: 0, skipped: 0, failed: 0, startMode: plan.startMode, paused: false, stopReason: null,
      total: plan.accounts.reduce((n, a) => n + a.posts * a.comments, 0), logs: [],
      accounts: plan.accounts.map((a, index) => ({ ...a, ...(resumed ? { lockedPosts: Object.freeze(structuredClone(resumed.accounts[index].lockedPosts).map(Object.freeze)), progress: structuredClone(resumed.accounts[index].progress || {}) } : {}), status: 'waiting', sent: 0, skipped: 0, liked: 0, missed: 0, pending: 0, note: '' })) };
    job.commentMode = 'new-per-job'; job.commentRunId = resumed?.commentRunId || job.id;
    if (resumed) job.resumedFrom = resumed.id;
    this.job = job; this.stopRequested = false; this.sentTexts = [];
    this.rememberPlans(plan).catch(() => {});
    this.run(job).catch(error => { job.status = 'failed'; job.finishedAt = new Date().toISOString(); this.log(job, error.message, { status: 'failed' }); this.checkpointJob(job).catch(() => {}); });
    return this.snapshot();
  }
  stop() {
    this.duplicates?.stop();
    this.login?.stop();
    if (this.job?.status === 'running') { this.stopRequested = true; this.job.status = 'stopping'; this.log(this.job, 'Menghentikan semua HP; komentar yang sudah dikirim tetap ada.'); }
    if (this.previewPending || this.scanActive) this.abortRequested = true;
    return this.snapshot();
  }
  assertRunning() { if (this.stopRequested) throw new Error('Proses dihentikan.'); }
  async wait(ms) { const end = Date.now() + ms; while (Date.now() < end && !this.stopRequested) await pause(Math.min(250, end - Date.now())); }
  // Every HP runs its own queue; in "bertahap" mode HP start times are chained 10–20 s apart.
  // Keeps the Mac awake while a job runs; a sleeping Mac drops USB and the phones' internet.
  stayAwake() {
    if (process.platform !== 'darwin' || this.awake) return () => {};
    try {
      const child = spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
      child.on('error', () => {});
      this.awake = child;
      return () => { child.kill(); this.awake = null; };
    } catch { return () => {}; }
  }
  async run(job) {
    const release = this.stayAwake();
    try { await this.runJob(job); } finally { release(); }
  }
  async runJob(job) {
    await this.openLog(job, 'komen', `${job.accounts.length} akun · mulai ${job.startMode}`, job.accounts.map(a => `  @${a.username} (${this.deviceName(a.serial)}) → ${targetLabel(a.target)} · ${a.posts} postingan × ${a.comments} komentar · ${a.tone}`));
    let groups = this.groupBySerial(job.accounts);
    this.log(job, `Auto komen dimulai di ${groups.length} HP${groups.length > 1 ? (job.startMode === 'serentak' ? ', semua serentak' : ', bertahap 6–12 detik') : ''}.`);
    if (!await this.net.macOnline()) await this.internetOutage(job);
    const ready = await Promise.all(groups.map(async ([serial, entries]) => {
      if (this.stopRequested || await this.ensurePhoneInternet(job, serial, entries[0].username)) return true;
      for (const entry of entries) { entry.status = 'deferred'; entry.note = 'Tertunda karena koneksi HP belum tersedia.'; updateProgress(this, entry); }
      return false;
    }));
    groups = groups.filter((group, i) => ready[i]);
    let offset = 0;
    await Promise.all(groups.map(([serial, entries], i) => {
      if (i && job.startMode !== 'serentak') offset += Math.round(rand(6000, 12000));
      const delay = offset;
      return (async () => {
        if (delay) { this.log(job, `Mulai dalam ${Math.round(delay / 1000)} detik.`, { serial, username: entries[0].username }); await this.wait(delay); }
        for (const entry of entries) {
          if (this.stopRequested) { entry.status = 'stopped'; entry.note ||= job.stopReason || ''; continue; }
          await this.runAccount(job, entry);
        }
      })();
    }));
    job.status = this.stopRequested ? 'stopped' : job.failed || job.accounts.some(a => a.remaining || a.pending) ? 'completed_with_errors' : 'completed';
    job.finishedAt = new Date().toISOString();
    this.log(job, `${this.stopRequested ? 'Proses berhenti' : 'Proses selesai'}: ${job.sent} terkirim, ${job.skipped} postingan sudah memenuhi kuota pekerjaan ini, ${job.failed} akun terkendala.`);
    await this.checkpointJob(job);
    this.stopRequested = false;
  }
  // One post from the locked list: open it, like it, open the composer, then send this job’s remaining new comments.
  async processPost(job, entry, index, postRef, meta, seen = new Map()) {
    const { serial, username: account } = entry;
    entry.progress ||= {};
    const progress = entry.progress[index] ||= { index, requested: entry.comments, confirmed: 0, pending: 0, remaining: entry.comments };
    let target = postRef?.owner || entry.target;
    if (postRef?.owner) entry.targetOwner = postRef.owner;
    // Kunci pekerjaan ini tidak bergantung pada pemeriksaan isi postingan, jadi sudah
    // bisa dipakai untuk mencatat aksi yang selesai sebelum langkah ini dicoba ulang.
    const quotaIdentity = postRef?.shortcode || `${entry.target}:index:${index}`;
    const key = this.commentKey(job, account, quotaIdentity);
    const menusBefore = this.overlaysClosed || 0;
    const { post, screen, like, save, repost, share, thread } = await this.patient(job, meta, `Postingan ${index + 1}`, async () => {
      // Instagram shows cached posts offline, so the HP's internet is checked directly.
      if (!await this.net.phoneOnline(serial)) throw new NetworkError('HP tidak terhubung ke internet.');
      const ref = postRef?.kind === 'post' ? (entry.lockedPosts?.[index] || { ...postRef, owner: postRef.owner || entry.targetOwner }) : postRef;
      const post = await this.openPost(serial, account, target, ref);
      if (ref?.kind === 'post') {
        target = post.owner;
        entry.targetOwner = target;
        // Record the owner observed on the first opening without navigating
        // away. Subsequent retries/resumes keep this owner and the same URL.
        if (entry.lockedPosts && !ref.owner) {
          entry.lockedPosts = Object.freeze(entry.lockedPosts.map((item, i) => i === index ? Object.freeze({ ...item, owner: target }) : item));
          await this.rememberLockedJob(job);
        }
      }
      const screen = await this.readScreen(serial);
      const like = await this.likePost(serial, post.nodes);
      // Like, simpan, repost, dan share dikerjakan lebih dulu, komentar paling akhir.
      // Jadi komentar yang ditahan karena hasilnya belum pasti tetap berarti postingan
      // ini sudah disukai, disimpan, di-repost, dan dibagikan ke satu kontak.
      // Baris aksi bergeser setelah like, jadi layar dibaca ulang - tetapi hanya bila
      // salah satu tombolnya memang ada, supaya postingan tanpa tombol itu tidak
      // membayar pembacaan yang tidak dipakai.
      const actionBar = saveState(post.nodes).node || repostButton(post.nodes) || shareButton(post.nodes);
      const current = actionBar ? await this.ui(serial) : post.nodes;
      // Aksi yang sudah tercatat selesai pada pekerjaan ini tidak diulang ketika langkah
      // ini dicoba ulang karena gangguan jaringan, dan catatannya ikut tersimpan sehingga
      // melanjutkan pekerjaan pun tidak mengirim pesan kedua ke kontak yang sama.
      const once = async (name, nodes, step) => {
        const done = this.state.counts[key]?.actions?.[name];
        if (done) return { ...done, nodes };
        const result = await step(nodes);
        this.setCount(key, this.countFor(key), { actions: { ...this.state.counts[key]?.actions, [name]: { status: result.status, ...(result.to ? { to: result.to } : {}) } } });
        return result;
      };
      const save = await once('save', current, nodes => this.savePost(serial, nodes));
      const repost = await once('repost', save.nodes, nodes => this.repostPost(serial, nodes));
      const share = await once('share', repost.nodes, nodes => this.sharePost(serial, nodes, account));
      const verified = ref?.kind === 'post' ? await this.verifyBeforeComment(serial, account, target, ref, post.fingerprint) : share.nodes;
      return { post, screen, like, save, repost, share, thread: await this.openThread(serial, account, target, verified, post.caption) };
    });
    if ((this.overlaysClosed || 0) > menusBefore) this.log(job, `Menu tekan-lama Instagram muncul ${(this.overlaysClosed || 0) - menusBefore} kali dan sudah ditutup; halaman dibaca ulang dan langkah ini diteruskan.`, meta);
    if (like === 'liked') entry.liked++;
    if (save.status === 'saved') entry.saved = (entry.saved || 0) + 1;
    if (repost.status === 'reposted') entry.reposted = (entry.reposted || 0) + 1;
    if (share.status === 'sent') entry.shared = (entry.shared || 0) + 1;
    const caption = post.caption || thread.caption || '';
    this.log(job, `Postingan terbuka · ${caption ? `caption "${caption.slice(0, 120)}${caption.length > 120 ? '…' : ''}"` : 'tanpa caption'} · ${{ liked: 'like OK', already: 'sudah disukai', unverified: 'like diketuk, belum terverifikasi' }[like] || 'tombol like belum terbaca, tidak diketuk'}.`, meta);
    this.log(job, `Simpan: ${SAVE_LABEL[save.status] || save.status} · repost: ${REPOST_LABEL[repost.status] || repost.status}${repost.status === 'reposted' ? '' : ` [ketuk ${repost.at || '-'} · ${overlay(repost.nodes)}]`} · share: ${SHARE_LABEL[share.status] || share.status}${share.status === 'sent' ? '' : ` [ketuk ${share.at || '-'} · ${overlay(share.nodes)}]`}${share.to ? ` ke ${share.to}` : ''}.`, meta);
    if (screen) this.log(job, `Teks di layar: ${screen.replace(/\s*\n\s*/g, ' / ').slice(0, 300)}`, meta);
    // Media accounts repost with identical captions; the n-th post sharing a caption (in grid order) gets "#n".
    seen.set(index, post.fingerprint);
    const twin = [...seen].filter(([other, fingerprint]) => other < index && fingerprint === post.fingerprint).length + 1;
    if (twin > 1) this.log(job, `Caption sama dengan ${twin - 1} postingan sebelumnya; dibedakan sebagai yang ke-${twin}.`, meta);
    const legacyKey = `${account}:${post.fingerprint}${twin > 1 ? `#${twin}` : ''}`;
    const identity = postRef?.shortcode || `${post.fingerprint}${twin > 1 ? `#${twin}` : ''}`;
    entry.currentPost = { ref: entry.lockedPosts?.[index] || postRef, fingerprint: post.fingerprint };
    progress.key = key; progress.reason = '';
    this.setCount(key, this.countFor(key), { postKey: `${account}:${identity}`, legacyKey, username: account, target });
    if (this.holdPending(job, entry, key)) { await this.checkpointJob(job); await this.closeSheets(serial); return; }
    const completed = this.countFor(key), need = entry.comments - completed;
    this.log(job, `Kuota pekerjaan ini: ${completed}/${entry.comments} komentar baru; komentar lama tidak dihitung.`, meta);
    if (need <= 0) {
      entry.skipped++; job.skipped++;
      this.log(job, 'Kuota pekerjaan ini sudah terpenuhi, lewati.', { ...meta, status: 'skipped' });
    } else {
      const generated = await this.generate({ caption, konteks: screen, count: need, tone: entry.tone, hindari: [...this.sentTexts, ...(this.state.recent[account] || []).slice(-40)] });
      this.log(job, `Sisa ${need} komentar baru dalam pekerjaan ini · suasana ${generated.suasana} · nada ${generated.tone}.`, meta);
      if (!Array.isArray(generated.comments)) throw new Error('Bank komentar memberikan hasil yang tidak valid.');
      generated.comments = [...new Set(generated.comments.filter(text => typeof text === 'string' && text.trim()))].slice(0, need);
      if (generated.comments.length < need) progress.reason = 'Bank komentar tidak cukup.';
      for (let i = 0; i < Math.min(need, generated.comments.length); i++) {
        this.assertRunning();
        this.log(job, `Komentar #${i + 1}: ${generated.comments[i]}`, meta);
        const status = await this.sendComment(job, entry, key, generated.comments[i]);
        await this.checkpointJob(job);
        if (status !== 'sent') break;
        if (i < generated.comments.length - 1) await this.wait(rand(1500, 3000));
      }
    }
    updateProgress(this, entry);
    if (progress.remaining && !progress.held) this.log(job, `${progress.confirmed}/${entry.comments} terkirim, kurang ${progress.remaining}. ${progress.reason || 'Belum dikerjakan.'}`, { ...meta, status: 'partial' });
    await this.checkpointJob(job);
    await this.closeSheets(serial);
  }
  async runAccount(job, entry) {
    const { serial, username: account, target } = entry, meta = { serial, username: account, target };
    entry.status = 'running'; entry.missed ||= 0; entry.pending ||= 0; entry.progress ||= {};
    for (let index = 0; index < entry.posts; index++) entry.progress[index] ||= { index, requested: entry.comments, confirmed: 0, pending: 0, remaining: entry.comments, reason: 'Belum dikerjakan.' };
    let streak = 0;
    const seen = new Map();
    // Returns "ok", "end" (no more posts) or "network" (skipped for now).
    const attempt = async (index, postRef) => {
      const menusBefore = this.overlaysClosed || 0;
      try { await this.processPost(job, entry, index, postRef, meta, seen); streak = 0; return 'ok'; }
      catch (error) {
        if (this.stopRequested) throw error;
        if (error instanceof SkipPostError) { entry.progress[index].reason = error.message; this.log(job, error.message, { ...meta, status: 'skipped' }); await this.closeSheets(serial).catch(() => {}); return error.end ? 'end' : 'ok'; }
        if (!(error instanceof NetworkError)) throw error;
        entry.progress[index].reason = `Tertunda karena koneksi atau loading: ${error.message}`;
        this.log(job, `Postingan ${index + 1} ditunda: ${error.message}`, { ...meta, status: 'network' });
        await this.checkInternet(job, meta);
        await this.logScreen(job, meta);
        await this.closeSheets(serial).catch(() => {});
        if ((this.overlaysClosed || 0) > menusBefore) this.log(job, 'Menu tekan-lama Instagram ikut ditutup; layar ditinggalkan bersih untuk akun berikutnya.', { ...meta, status: 'skipped' });
        if (++streak >= 3) {
          entry.status = 'paused';
          this.log(job, '3 postingan berturut-turut terkendala jaringan. Akun dijeda 1 menit.', { ...meta, status: 'paused' });
          await this.wait(60000);
          entry.status = 'running'; streak = 0;
        }
        return 'network';
      }
    };
    try {
      await this.locked(serial, async () => {
        this.log(job, `Memilih @${account}.`, meta);
        await this.prepareDevice(serial);
        await this.accountSheet(serial, account);
        // Lock the list of newest posts once (pins skipped) before any like or comment;
        // the loops below only reopen posts from this fixed list.
        let posts = entry.lockedPosts;
        if (posts) this.log(job, `Melanjutkan daftar terkunci ${posts.length} postingan dari proses sebelumnya; tidak memilih unggahan baru.`, meta);
        else ({ posts } = await this.patient(job, meta, 'Daftar postingan', () => this.lockPosts(job, entry, meta)));
        entry.lockedPosts = posts;
        await this.rememberLockedJob(job);
        const missed = [];
        for (let index = 0; index < posts.length; index++) {
          this.assertRunning();
          this.log(job, `Membuka postingan ${index + 1}/${posts.length}.`, meta);
          const result = await attempt(index, posts[index]);
          if (result === 'end') break;
          if (result === 'network') missed.push(index);
          if (index < posts.length - 1) await this.wait(rand(3000, 6000));
        }
        for (const index of missed) {
          this.assertRunning();
          this.log(job, `Mencoba ulang postingan ${index + 1} yang tadi terlewat.`, meta);
          if (await attempt(index, posts[index]) === 'network') { entry.missed++; this.log(job, `Postingan ${index + 1} terlewat karena jaringan.`, { ...meta, status: 'network' }); }
        }
      });
      updateProgress(this, entry);
      entry.status = this.stopRequested ? 'stopped' : entry.missed ? 'deferred' : entry.remaining && !entry.pending ? 'partial' : 'done';
      entry.note = [entry.missed && `${entry.missed} postingan tertunda karena koneksi atau loading`, entry.remaining && `${entry.confirmed}/${entry.requested} terkirim dalam pekerjaan ini; ${entry.remaining} belum dikerjakan`, entry.pending && `${entry.pending} komentar menunggu pemeriksaan hasil`, this.stopRequested && job.stopReason].filter(Boolean).join(' · ');
    } catch (error) {
      if (this.stopRequested) { entry.status = 'stopped'; entry.note = job.stopReason || ''; return; }
      // Keadaan yang hanya bisa dibereskan manusia di HP: tandai, jangan dihitung sebagai kegagalan
      // script, dan jangan ulangi percobaan untuk postingan lain di akun ini.
      if (error instanceof ManualActionError) {
        entry.status = 'needs_action';
        entry.note = error.message;
        for (const progress of Object.values(entry.progress || {})) if (progress.remaining) progress.reason = entry.note;
        this.log(job, error.message, { ...meta, status: 'needs_action' });
        await this.logScreen(job, meta, 'Layar saat berhenti');
        await this.closeSheets(serial).catch(() => {});
        return;
      }
      if (!(error instanceof NetworkError)) job.failed++;
      entry.status = error instanceof BlockedError ? 'blocked' : error instanceof NetworkError ? 'deferred' : 'failed';
      entry.note = error instanceof NetworkError ? `Tertunda karena koneksi atau loading: ${error.message}` : error.message;
      for (const progress of Object.values(entry.progress || {})) if (progress.remaining) progress.reason = entry.note;
      this.log(job, error.message, { ...meta, status: entry.status });
      await this.logScreen(job, meta, 'Layar saat berhenti');
    } finally { await this.checkpointJob(job); }
  }
}
