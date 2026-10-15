import { adb } from './adb.mjs';
import { InstagramManager, NetworkError, SkipPostError, BlockedError, bankComments } from './instagram.mjs';
import * as tt from './tiktok-core.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_COMMENT = 150;

// Auto comment for TikTok. The shared flow (plan, job quota, internet handling, logs, stop)
// comes from the Instagram manager; this class only replaces the TikTok screens.
export class TikTokManager extends InstagramManager {
  constructor(options) {
    super({ ...options, logPrefix: 'tt' });
    this.nicknames = new Map();
    // TikTok comments are capped at 150 characters.
    this.generate = async request => {
      const result = await bankComments({ ...request, count: Math.min(100, request.count * 2 + 2) });
      return { ...result, comments: result.comments.filter(t => t.length <= MAX_COMMENT).slice(0, request.count) };
    };
  }
  sh(serial, ...args) { return adb(['-s', serial, 'shell', ...args]); }
  async tapAt(serial, x, y) { this.interrupted(serial); await this.sh(serial, 'input', 'tap', String(x), String(y)); }
  // A playing video keeps UI Automator from reading the screen; one tap on the video pauses it. Never tapped
  // while a comment sheet is open (a tap there would land in the sheet).
  // Playing or paused is read from TikTok's audio player ("started" while the video plays). Pixels alone are
  // unreliable: a calm video (people at a table) barely changes, and with the comment field open only a thin
  // strip of video is visible. Without an audio player, two raw screenshots 0.7 s apart are compared.
  async audioPlaying(serial) {
    const pid = (await this.sh(serial, 'pidof', tt.TIKTOK)).trim().split(/\s+/)[0];
    if (!/^\d+$/.test(pid)) return null;
    const players = (await this.sh(serial, `dumpsys audio | grep 'type:android.media.AudioTrack u/pid:[0-9]*/${pid} '`).catch(() => '')).trim();
    return players ? /state:started/.test(players) : null;
  }
  async frame(serial) { return adb(['-s', serial, 'exec-out', 'screencap'], { encoding: 'buffer', timeout: 15000, maxBuffer: 32 * 1024 * 1024 }); }
  async videoMoving(serial) {
    const audio = await this.audioPlaying(serial).catch(() => null);
    if (audio !== null) return audio;
    const a = await this.frame(serial); await pause(700); const b = await this.frame(serial);
    const w = a.readUInt32LE(0), h = a.readUInt32LE(4), header = a.length - w * h * 4;
    if (w <= 0 || header < 0 || b.length !== a.length) return false;
    let diff = 0, total = 0;
    for (let y = 300; y < Math.min(1100, h); y += 8) for (let x = 0; x < w; x += 8) {
      const i = header + (y * w + x) * 4; total++;
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
    }
    return diff / total > 0.02;
  }
  async pauseVideo(serial) {
    for (let i = 0; i < 3; i++) {
      this.interrupted(serial);
      if (!await this.videoMoving(serial)) return true;
      await this.tapAt(serial, 540, 700); await pause(1300);
    }
    return !await this.videoMoving(serial);
  }
  async read(serial, { pauseFirst = false } = {}) {
    if (pauseFirst) await this.pauseVideo(serial);
    return this.ui(serial);
  }
  async imeShown(serial) { return /mInputShown=true/.test(await this.sh(serial, 'dumpsys input_method | grep -m1 mInputShown').catch(() => '')); }
  // Closes the comment sheet without reading the screen (a playing video may block reads), in any theme:
  // hide the keyboard, then tap the video area above the sheet. With the sheet open the tap closes it;
  // on the bare video page it only toggles playback, and pauseVideo runs right after anyway.
  async closeThread(serial) {
    if (await this.imeShown(serial)) { await this.back(serial); await pause(800); }
    await this.tapAt(serial, 540, 330); await pause(1500);
  }
  // Pauses the video, then opens its comment sheet again; returns a readable sheet.
  async reopenThread(serial) {
    if (!await this.pauseVideo(serial)) throw new NetworkError('Video tidak bisa dijeda; layar tidak dapat dibaca.');
    let nodes = await this.ui(serial);
    const button = tt.commentButton(nodes);
    if (!button) throw new NetworkError('Tombol komentar TikTok belum terlihat.');
    await this.tap(serial, button);
    for (let i = 0; i < 5; i++) {
      await pause(1500); nodes = await this.ui(serial);
      if (tt.commentSheetOpen(nodes)) return nodes;
    }
    throw new NetworkError('Lembar komentar TikTok belum terbuka.');
  }
  async clearDraft(serial) {
    await this.sh(serial, 'input', 'keycombination', '113', '29').catch(() => {});
    await this.sh(serial, 'input', 'keyevent', '67').catch(() => {});
    await pause(500);
  }
  async dismissPopups(serial, nodes) {
    for (let i = 0; i < 4; i++) {
      const button = tt.popupButton(nodes);
      if (!button) return nodes;
      await this.tap(serial, button); await pause(1200);
      nodes = await this.read(serial);
    }
    return nodes;
  }
  // Fresh start of the app: a stuck "No internet connection" state only clears on a restart.
  async launch(serial) {
    const installed = await this.sh(serial, 'pm', 'list', 'packages', tt.TIKTOK);
    if (!installed.split(/\r?\n/).includes(`package:${tt.TIKTOK}`)) throw new Error('TikTok belum terpasang di HP ini.');
    await this.sh(serial, 'input', 'keyevent', '224');
    await this.sh(serial, 'am', 'force-stop', tt.TIKTOK);
    await this.sh(serial, 'monkey', '-p', tt.TIKTOK, '-c', 'android.intent.category.LAUNCHER', '1');
    await pause(8000);
    return this.dismissPopups(serial, await this.read(serial, { pauseFirst: true }));
  }
  loginProblem(nodes) {
    const text = nodes.map(n => `${n.text || ''} ${n['content-desc'] || ''}`).join(' | ');
    if (/your account was logged out|akun anda telah keluar|akunmu telah keluar/i.test(text)) return new Error('Akun TikTok di HP ini sudah logout. Login ulang di HP.');
    if (/log into existing account|masuk ke akun yang ada|\| ?(log in|login|masuk) ?\|/i.test(text)) return new Error('TikTok di HP ini belum login.');
    return null;
  }
  async ownProfile(serial, { fresh = false } = {}) {
    if (!fresh) {
      // Already on the own profile? Otherwise restart the app: deep screens (search, videos) hide the tab bar.
      try {
        const nodes = await this.ui(serial, 2), own = tt.ownProfile(nodes);
        if (own && tt.profileTab(nodes)?.selected === 'true') { this.nicknames.set(serial, own.nickname); return { ...own, current: own.username, nodes }; }
      } catch {}
      return this.ownProfile(serial, { fresh: true });
    }
    let nodes = await this.launch(serial);
    for (let i = 0; i < 6; i++) {
      nodes = await this.dismissPopups(serial, nodes);
      const own = tt.ownProfile(nodes);
      if (own && tt.profileTab(nodes)?.selected === 'true') {
        this.nicknames.set(serial, own.nickname);
        return { ...own, current: own.username, nodes };
      }
      const problem = i > 0 && this.loginProblem(nodes);
      if (problem) throw problem;
      const tab = tt.profileTab(nodes);
      if (tab) await this.tap(serial, tab); else await this.back(serial);
      await pause(2500);
      nodes = await this.read(serial);
    }
    throw this.loginProblem(nodes) || new NetworkError('Profil TikTok belum dapat dibaca.');
  }
  // Reads (and optionally switches to) the accounts in the "Switch account" sheet.
  async accountSheet(serial, desired = null) {
    let profile;
    try { profile = await this.ownProfile(serial, { fresh: true }); }
    catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      // Many HP at once can make the first start slow; one more try.
      profile = await this.ownProfile(serial, { fresh: true });
    }
    if (desired && profile.current === desired) {
      this.verifiedAccounts.set(serial, { username: desired, at: Date.now() });
      return { current: desired, accounts: [{ username: desired, disabled: false, active: true }] };
    }
    await this.tap(serial, profile.nameNode); await pause(2500);
    const found = new Map(); let previous = '';
    for (let page = 0; page < 8; page++) {
      const nodes = await this.read(serial), rows = tt.switcherAccounts(nodes);
      if (!rows.length) throw new Error('Daftar akun TikTok belum terbaca.');
      for (const row of rows) found.set(row.username, { username: row.username, disabled: false, active: row.username === profile.current });
      const row = desired && rows.find(r => r.username === desired);
      if (row) {
        await this.tap(serial, row.node); await pause(6000);
        const check = await this.ownProfile(serial, { fresh: true });
        if (check.current !== desired) throw new Error(`Gagal beralih ke @${desired}.`);
        this.verifiedAccounts.set(serial, { username: desired, at: Date.now() });
        return { current: desired, accounts: [...found.values()] };
      }
      const signature = rows.map(r => r.username).join('|');
      if (signature === previous) break;
      previous = signature;
      await this.swipe(serial, nodes.find(n => n.scrollable === 'true' && n.class?.includes('RecyclerView')) || { bounds: '[0,1300][1080,1700]' });
    }
    await this.back(serial);
    if (desired) throw new Error(`@${desired} tidak lagi login di TikTok HP ini.`);
    return { current: profile.current, accounts: [...found.values()], complete: true };
  }
  // Opens the target profile through the in-app search (TikTok ignores profile deep links).
  async openTarget(serial, target) {
    let nodes = await this.read(serial, { pauseFirst: true });
    const home = tt.homeTab(nodes);
    if (home) { await this.tap(serial, home); await pause(2000); }
    nodes = await this.dismissPopups(serial, await this.read(serial, { pauseFirst: true }));
    let search = tt.searchButton(nodes);
    // Not on the home feed (e.g. a video page restored on launch): start the app again.
    if (!search) { nodes = await this.launch(serial); search = tt.searchButton(nodes); }
    if (!search) throw new NetworkError('Tombol Search TikTok belum terlihat.');
    await this.tap(serial, search); await pause(2500);
    nodes = await this.read(serial);
    const field = tt.searchField(nodes);
    if (!field) throw new NetworkError('Kolom pencarian TikTok belum terbuka.');
    await this.tap(serial, field); await pause(500);
    await this.sh(serial, 'input', 'keycombination', '113', '29');
    await this.typeComment(serial, target); await pause(600);
    nodes = await this.read(serial);
    const go = nodes.find(n => /^(Search|Cari)$/i.test((n.text || '').trim()) && n.clickable === 'true');
    if (go) await this.tap(serial, go); else await this.sh(serial, 'input', 'keyevent', '66');
    for (let i = 0; i < 6; i++) {
      await pause(2500);
      nodes = await this.read(serial);
      if (tt.offlineNotice(nodes)) throw new NetworkError('TikTok menampilkan masalah koneksi.');
      const result = tt.userResult(nodes, target);
      if (result) { await this.tap(serial, result); break; }
      if (i === 5) throw new NetworkError(`Akun @${target} belum muncul di hasil pencarian.`);
    }
    for (let i = 0; i < 6; i++) {
      await pause(2500);
      nodes = await this.read(serial);
      if (tt.offlineNotice(nodes)) throw new NetworkError('Profil target belum termuat.');
      const handle = nodes.find(n => (n.text || '').trim().toLowerCase() === `@${target}`);
      if (handle && tt.gridTiles(nodes).length) return nodes;
      if (nodes.some(n => /no content|belum ada konten|this account is private|akun ini privat|couldn't find this account|tidak dapat menemukan akun/i.test(n.text || ''))) throw new Error(`Profil @${target} tidak dapat diakses atau belum punya video.`);
    }
    throw new NetworkError('Profil target belum termuat.');
  }
  // TikTok keeps positional opening: the player is walked from the first tile, and pinned
  // videos are counted when each one opens. The locked list only records the positions.
  async lockPosts(job, entry) {
    return { posts: Array.from({ length: entry.posts }, (_, index) => ({ index, identity: null, twin: 1 })), pinned: 0 };
  }
  // Opens the index-th newest video that is not pinned: the first tile, then swipe up through the
  // owner's videos (the player keeps grid order).
  async openPost(serial, account, target, postRef) {
    const index = postRef.index;
    if (this.verifiedAccounts.has(serial)) {
      const profile = await this.ownProfile(serial);
      if (profile.current !== account) throw new Error('Akun aktif di HP berubah. Pilih ulang akun sebelum melanjutkan.');
      this.verifiedAccounts.set(serial, { username: account, at: Date.now() });
    }
    const profileNodes = await this.openTarget(serial, target);
    const tiles = tt.gridTiles(profileNodes);
    const pinned = tiles.filter(t => t.pinned).length;
    await this.tap(serial, tiles[0].node); await pause(3500);
    for (let step = 0; step < index + pinned; step++) {
      await this.sh(serial, 'input', 'swipe', '540', '1400', '540', '350', '300'); await pause(3000);
    }
    // The video must be paused before its comment sheet opens: the sheet keeps it playing otherwise.
    if (!await this.pauseVideo(serial)) throw new NetworkError('Video tidak bisa dijeda; layar tidak dapat dibaca.');
    let nodes = await this.ui(serial);
    let info = tt.videoInfo(nodes, target);
    if (!info.owner) throw new SkipPostError(`Video ke-${index + 1} @${target} belum tersedia atau bukan milik target.`, { end: true });
    const fingerprint = tt.videoFingerprint(info, target);
    if (info.more) {
      await this.tap(serial, info.captionNode); await pause(1200);
      const after = await this.read(serial), full = tt.videoInfo(after, target);
      if (full.owner && full.caption.length >= info.caption.length) { nodes = after; info = full; }
    }
    return { nodes, caption: info.caption, fingerprint, pinned };
  }
  async likePost(serial, nodes) {
    const state = tt.likeState(nodes);
    if (state.status !== 'not_liked') return state.status;
    await this.tap(serial, state.node);
    for (let i = 0; i < 5; i++) {
      await pause(900);
      const after = await this.read(serial);
      if (tt.blockedNotice(after)) throw new BlockedError('TikTok membatasi akun ini (like ditolak). Akun dihentikan.');
      if (tt.likeState(after).status === 'already') return 'liked';
    }
    return 'unverified';
  }
  // Opens only the comment composer; no scan or count of older comments.
  async openThread(serial, account, target, postNodes, postText = '') {
    const button = tt.commentButton(postNodes);
    if (!button) throw new NetworkError('Tombol komentar TikTok belum terlihat.');
    // Liking makes the video play again; a video playing behind the sheet blocks screen reads once the comment
    // field is focused (the sheet then shrinks), so it is paused first.
    await this.pauseVideo(serial);
    await this.tap(serial, button);
    let nodes;
    for (let i = 0; i < 5; i++) { await pause(1500); nodes = await this.read(serial); if (tt.commentSheetOpen(nodes)) break; }
    if (!tt.commentSheetOpen(nodes)) throw new NetworkError('Lembar komentar TikTok belum terbuka.');
    const draft = tt.composer(nodes).draft;
    if (draft) throw new Error('Kolom komentar TikTok berisi draft lama. Proses dihentikan supaya draft tidak terkirim.');
    if (tt.offlineNotice(nodes)) throw new NetworkError('TikTok di HP sedang offline; komentar tidak dikirim.');
    if (this.verifiedAccounts.get(serial)?.username !== account) throw new Error('Akun aktif di HP belum terverifikasi. Proses dihentikan.');
    return { caption: postText };
  }
  async closeSheets(serial) {
    for (let i = 0; i < 4; i++) {
      let nodes = null;
      try { nodes = await this.ui(serial, 2); } catch {}
      if (nodes && !tt.commentSheetOpen(nodes) && !await this.imeShown(serial)) return nodes;
      await this.closeThread(serial);
    }
    return [];
  }
  // Each comment uses a freshly opened sheet over a paused video: after a send TikTok resumes the video,
  // which blocks screen reads. Counted before Send; a failed attempt clears its draft.
  async sendComment(job, entry, key, text) {
    const { serial, username: account, target } = entry, meta = { serial, username: account, target };
    let nodes = null;
    try { nodes = await this.ui(serial, 2); if (!tt.commentSheetOpen(nodes)) nodes = null; } catch {}
    // The video may have resumed behind the sheet (it does after a send); typing over a playing video leaves the
    // screen unreadable, so the sheet is reopened with the video paused.
    if (nodes && await this.videoMoving(serial)) nodes = null;
    if (!nodes) { await this.closeThread(serial); nodes = await this.reopenThread(serial); }
    let comp = tt.composer(nodes);
    if (!comp.field) throw new NetworkError('Kolom komentar TikTok belum terlihat.');
    if (comp.draft) throw new Error('Kolom komentar TikTok berisi draft lama. Proses dihentikan.');
    if (this.verifiedAccounts.get(serial)?.username !== account) throw new Error('Akun aktif di HP belum terverifikasi. Proses dihentikan.');
    if (tt.postFailedNotice(nodes) || tt.postingNotice(nodes)) throw new NetworkError('Layar masih menunjukkan kiriman sebelumnya; tunggu pemeriksaan sebelum mengirim.');
    if (!await this.net.phoneOnline(serial)) throw new NetworkError('HP tidak terhubung ke internet; komentar tidak dikirim.');
    if (this.holdPending(job, entry, key)) return 'uncertain';
    if (this.countFor(key) >= entry.comments) return 'full';
    const record = this.reserveComment(key, account, target, text, entry, job);
    await this.checkpointJob(job);
    const release = async status => { this.setCount(key, Math.max(0, this.countFor(key) - 1)); record.status = status; await this.save(); };
    let send;
    try {
      this.assertRunning();
      await this.tap(serial, comp.field); await pause(900);
      await this.typeComment(serial, text); await pause(800);
      // Every typed space is also a SPACE key, which is TikTok's play/pause key: after an odd number of spaces the
      // video plays behind the field and the screen cannot be read. One more space (toggles it back) and a delete
      // (does not toggle) pause it again without changing the draft, which is checked below.
      for (let i = 0; i < 2 && await this.videoMoving(serial); i++) {
        await this.sh(serial, 'input', 'text', '%s'); await this.sh(serial, 'input', 'keyevent', '67'); await pause(1000);
      }
      // The blinking cursor keeps UI Automator from reading the screen; Escape stops it (the draft stays).
      await this.sh(serial, 'input', 'keyevent', '111'); await pause(1200);
      try { nodes = await this.ui(serial, 4); }
      catch {
        if (await this.imeShown(serial)) { await this.back(serial); await pause(1200); }
        nodes = await this.ui(serial, 4);
      }
      comp = tt.composer(nodes);
      if (comp.draft !== text) throw new Error('Isi komentar pada HP tidak cocok. Tidak dikirim.');
      send = tt.sendButton(nodes, comp.field);
      if (!send) throw new Error('Tombol kirim komentar TikTok belum ditemukan. Tidak dikirim.');
      this.assertRunning();
    } catch (error) {
      await this.clearDraft(serial);
      await release('cancelled');
      throw error instanceof Error && /tidak dapat dibaca/.test(error.message) ? new NetworkError(error.message) : error;
    }
    record.phase = 'send_requested'; await this.save();
    let status = 'uncertain';
    this.confirming.add(serial);
    try { await this.tap(serial, send); status = await this.checkDelivery(entry, text); }
    catch { record.error = 'Pemeriksaan kiriman terputus; hasil belum pasti.'; }
    finally { this.confirming.delete(serial); }
    if (status === 'blocked') { record.status = 'blocked'; await this.save(); throw new BlockedError('TikTok menolak komentar dari akun ini. Akun dihentikan.'); }
    if (status === 'failed') {
      await release('failed');
      this.log(job, 'TikTok gagal mengirim komentar ini; hitungan dibatalkan dan akan diisi ulang.', { ...meta, status: 'failed' });
      throw new NetworkError('TikTok gagal mengirim komentar.');
    }
    record.status = status; record.at = new Date().toISOString();
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
    this.log(job, 'Status kiriman belum pasti; pengiriman berikutnya ditahan sampai hasil diperiksa.', { ...meta, status });
    await this.logScreen(job, meta);
    return status;
  }
  async deliveryUi(serial) {
    let nodes = await this.ui(serial, 2);
    if (!tt.commentSheetOpen(nodes)) { await this.closeThread(serial); nodes = await this.reopenThread(serial); }
    return nodes;
  }
  deliveryObservation(serial, account, target, text, nodes) {
    const nickname = this.nicknames.get(serial);
    return { blocked: tt.blockedNotice(nodes), offline: tt.offlineNotice(nodes), failed: tt.postFailedNotice(nodes), posting: tt.postingNotice(nodes),
      accountMatches: this.verifiedAccounts.get(serial)?.username === account && Boolean(tt.composer(nodes).field),
      visible: Boolean(nickname && tt.threadComments(nodes).some(c => c.author === nickname && c.text === text)) };
  }
  async inspect(job, account) {
    const { serial, username: name, target } = account, meta = { serial, username: name, target };
    await this.prepareDevice(serial);
    await this.accountSheet(serial, name);
    const { post, screen, thread } = await this.patient(job, meta, 'Buka video 1', async () => {
      const post = await this.openPost(serial, name, target, 0);
      const screen = await this.readScreen(serial);
      return { post, screen, thread: await this.openThread(serial, name, target, post.nodes, post.caption) };
    });
    const key = `${name}:${post.fingerprint}`, uncertain = this.pendingRecords(key, key, key).length > 0;
    const generated = await this.generate({ caption: post.caption, konteks: screen, count: 3, tone: account.tone, hindari: (this.state.recent[name] || []).slice(-40) });
    await this.closeSheets(serial).catch(() => {});
    const liked = tt.likeState(post.nodes).status;
    this.log(job, `Caption "${post.caption.slice(0, 120)}" · suasana ${generated.suasana} · like ${liked} · ${account.comments} komentar baru per postingan${uncertain ? ' (ditahan: kiriman belum pasti)' : ''}.`, meta);
    return { serial, username: name, target, ok: true, caption: post.caption.slice(0, 300), suasana: generated.suasana, tone: generated.tone, liked, commentMode: 'new-per-job', uncertain, need: uncertain ? 0 : account.comments, pinned: post.pinned, samples: generated.comments };
  }
}
