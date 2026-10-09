import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adb, input } from './adb.mjs';
import { parseUi, byId, center, switcherAccounts, gridTiles, composerAccount, postFingerprint, validUsername, validatePlan, blockedNotice, sendButton, likeState, commentButton, captionMore, commentList, threadComments, threadCaption, postCaption, offlineNotice, postingNotice, postFailedNotice, emptyThread, commentCount } from './instagram-core.mjs';
import { JobLogs, clock } from './joblog.mjs';
import { ScreenReader } from './ocr.mjs';
import { macOnline, phoneOnline, restoreInternet } from './network.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const PACKAGE = 'com.instagram.android';
const BANK = join(dirname(fileURLToPath(import.meta.url)), 'komentar', 'buat.py');
export class BlockedError extends Error {}
// A step that failed because Instagram could not load; retried, then the post is skipped for now.
export class NetworkError extends Error {}
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
  constructor({ statePath, devices }) {
    this.statePath = statePath; this.devices = devices; this.state = { devices: [], history: [], counts: {}, recent: {}, plans: {} };
    this.generate = bankComments; this.sentTexts = [];
    const dataDir = dirname(statePath);
    this.logs = new JobLogs(join(dataDir, 'logs')); this.reader = new ScreenReader(dataDir);
    this.net = { macOnline, phoneOnline, restoreInternet };
    this.previewPending = false; this.abortRequested = false; this.confirming = new Set();
    this.locks = new Set(); this.verifiedAccounts = new Map(); this.scanPending = null; this.job = null; this.saving = Promise.resolve();
  }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (Array.isArray(data.devices) && Array.isArray(data.history)) this.state = { counts: {}, recent: {}, plans: {}, ...data };
    } catch {}
    // Older history entries recorded one comment per account and post.
    for (const record of this.state.history) if (['sending', 'sent', 'uncertain'].includes(record.status) && !this.state.counts[record.key]) this.state.counts[record.key] = { count: 1, username: record.username, target: record.target, at: record.at };
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
    return { devices: this.state.devices.filter(d => !d.serial.startsWith('emulator-')).map(d => ({ ...d, online: online.has(d.serial), busy: this.locks.has(d.serial) })), scanning: Boolean(this.scanActive), checking: this.previewPending, stopping: this.abortRequested, plans: this.state.plans, job: this.job ? { ...this.job, accounts: this.job.accounts.map(a => ({ ...a })), logs: [...this.job.logs] } : null };
  }
  busy(serial) { return this.locks.has(serial); }
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
  async ui(serial) {
    this.checkDevice(serial); this.interrupted(serial);
    const path = `/data/local/tmp/phonefarm-ig-${randomUUID()}.xml`;
    try {
      await adb(['-s', serial, 'shell', 'uiautomator', 'dump', path], { timeout: 15000 });
      return parseUi(await adb(['-s', serial, 'exec-out', 'cat', path]));
    } finally { await adb(['-s', serial, 'shell', 'rm', path]).catch(() => {}); }
  }
  async tap(serial, node) {
    this.interrupted(serial);
    const [x, y] = center(node);
    await adb(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);
  }
  async back(serial) { await adb(['-s', serial, 'shell', 'input', 'keyevent', '4']); }
  async typeComment(serial, text) { await input(serial, { type: 'text', text }); }
  async nudge(serial, fromY) {
    this.interrupted(serial);
    const start = Math.min(Math.max(fromY, 700), 1500);
    await adb(['-s', serial, 'shell', 'input', 'swipe', '540', String(start), '540', String(start - 400), '400']);
  }
  async swipe(serial, node, direction = 'up') {
    this.interrupted(serial);
    const root = node || { bounds: '[0,0][1080,1920]' };
    const b = root.bounds.match(/\d+/g).map(Number);
    const x = Math.round((b[0] + b[2]) / 2), top = Math.round(b[1] + (b[3] - b[1]) * .33), bottom = Math.round(b[1] + (b[3] - b[1]) * .8);
    await adb(['-s', serial, 'shell', 'input', 'swipe', String(x), String(direction === 'up' ? bottom : top), String(x), String(direction === 'up' ? top : bottom), '350']);
  }
  async ownProfile(serial) {
    const installed = await adb(['-s', serial, 'shell', 'pm', 'list', 'packages', PACKAGE]);
    if (!installed.split(/\r?\n/).includes(`package:${PACKAGE}`)) throw new Error('Instagram belum terpasang di HP ini.');
    await adb(['-s', serial, 'shell', 'input', 'keyevent', '224']);
    await adb(['-s', serial, 'shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
    let nodes;
    for (let i = 0; i < 8; i++) {
      nodes = await this.ui(serial);
      const profile = byId(nodes, 'profile_tab');
      if (profile) {
        await this.tap(serial, profile); nodes = await this.ui(serial);
        const title = byId(nodes, 'action_bar_title');
        if (title && validUsername(title.text) && byId(nodes, 'profile_tab')) return { nodes, current: title.text.toLowerCase(), title };
      }
      if (nodes.some(n => /^(log in|login|masuk)$/i.test(n.text || '') && n['resource-id']?.startsWith(PACKAGE))) throw new Error('Instagram di HP ini perlu login.');
      await this.back(serial);
    }
    throw new Error('Profil Instagram belum dapat dibaca. Buka profil lewat layar HP lalu pindai lagi.');
  }
  async accountSheet(serial, desired = null) {
    const profile = await this.ownProfile(serial);
    await this.tap(serial, profile.title);
    let opened = true;
    const found = new Map(); let previous = '';
    try {
      for (let page = 0; page < 15; page++) {
        const nodes = page ? await this.ui(serial) : await this.settledSheet(serial), rows = switcherAccounts(nodes);
        if (!rows.length) throw new Error('Daftar akun belum terbaca. Pastikan pemilih akun Instagram bisa dibuka.');
        for (const row of rows) found.set(row.username, { username: row.username, disabled: row.disabled, active: row.username === profile.current });
        if (desired) {
          const row = rows.find(a => a.username === desired);
          if (row) {
            if (row.disabled) throw new Error(`@${desired} sedang dinonaktifkan.`);
            if (desired !== profile.current) { await this.tap(serial, row.node); opened = false; }
            else { await this.back(serial); opened = false; }
            const check = await this.ownProfile(serial);
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
        const signature = rows.map(r => r.username).join('|');
        // The list is complete only when scrolling reveals no new account; a half-open sheet already shows "Add account".
        if (signature === previous) {
          if (desired) throw new Error(`@${desired} tidak lagi login di HP ini.`);
          return { current: profile.current, accounts: [...found.values()], complete: true };
        }
        previous = signature;
        const sheet = nodes.find(n => n.scrollable === 'true' && rows.some(row => { let p = row.node; while (p) { if (p === n) return true; p = p.parent; } return false; }));
        await this.swipe(serial, sheet || { bounds: `[48,${Math.min(...rows.map(r => Number(r.node.bounds.match(/\d+/g)[1])))}][1032,1776]` });
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
  async scanAccounts() {
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
        try {
          const result = await this.locked(device.serial, () => this.accountSheet(device.serial));
          return { serial: device.serial, name: device.name, ...result, scannedAt: new Date().toISOString(), error: null };
        } catch (error) {
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
  // Opens the index-th newest post that is not pinned, then waits for its action bar.
  async openPost(serial, account, target, index) {
    if (this.verifiedAccounts.has(serial)) {
      const profile = await this.ownProfile(serial);
      if (profile.current !== account) throw new Error('Akun aktif di HP berubah. Pilih ulang akun sebelum melanjutkan.');
      this.verifiedAccounts.set(serial, { username: account, at: Date.now() });
    }
    const { tile, pinned } = await this.gridTile(serial, target, index);
    await this.tap(serial, tile);
    let lastError = new NetworkError('Postingan belum termuat.');
    for (let i = 0; i < 6; i++) {
      const nodes = await this.ui(serial);
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
        return { ...expanded, pinned, fingerprint };
      }
      if (offlineNotice(nodes)) lastError = new NetworkError('Instagram di HP menampilkan masalah koneksi.');
      await this.swipe(serial, nodes.find(n => n.scrollable === 'true'));
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
  // Walks the profile grid from the top; pinned tiles come first and are skipped.
  async gridTile(serial, target, index) {
    await adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `https://www.instagram.com/${target}/`, '-p', PACKAGE]);
    let verified = false, atTop = false, previous = '', waiting = 0;
    const order = [], pinnedKeys = new Set();
    for (let i = 0; i < 40; i++) {
      const nodes = await this.ui(serial);
      verified ||= nodes.some(n => (n.text || '').toLowerCase() === target && /action_bar|username/.test(n['resource-id'] || ''));
      if (nodes.some(n => /^(this account is private|akun ini bersifat pribadi|user not found|pengguna tidak ditemukan)$/i.test(n.text || ''))) throw new Error(`Profil @${target} tidak dapat diakses dari akun ini.`);
      if (byId(nodes, 'profile_header_post_count_front_familiar')?.['content-desc']?.match(/^0\s*(?:post|postingan)/i)) throw new Error(`@${target} belum punya postingan.`);
      const tiles = gridTiles(nodes), list = nodes.find(n => n.scrollable === 'true');
      if (!verified || !tiles.length) {
        if (offlineNotice(nodes) || ++waiting >= 8) throw new NetworkError(verified ? 'Grid postingan belum termuat.' : 'Profil target belum termuat.');
        if (verified) await this.swipe(serial, list); else await pause(1000);
        continue;
      }
      if (!atTop) {
        // Deep links can restore an old scroll position; start from row 1.
        if (tiles.some(t => t.row && t.row > 1) && !tiles.some(t => t.row === 1)) { await this.swipe(serial, list, 'down'); continue; }
        atTop = true;
      }
      for (const t of tiles) {
        if (!order.includes(t.key)) order.push(t.key);
        if (t.pinned) pinnedKeys.add(t.key);
      }
      const wanted = order.filter(key => !pinnedKeys.has(key))[index];
      const visible = wanted && tiles.find(t => t.key === wanted && t.complete);
      if (visible) return { tile: visible.node, pinned: pinnedKeys.size };
      const signature = tiles.map(t => t.key).join('|');
      if (signature === previous) throw new SkipPostError(`Postingan ke-${index + 1} @${target} belum tersedia.`, { end: true });
      previous = signature;
      await this.swipe(serial, list);
    }
    throw new NetworkError(`Postingan @${target} belum dapat dibaca.`);
  }
  // Likes only when the button clearly reads "not liked", so an unknown state never unlikes.
  async likePost(serial, nodes) {
    const state = likeState(nodes);
    if (state.status !== 'not_liked') return state.status;
    await this.tap(serial, state.node);
    for (let i = 0; i < 6; i++) {
      await pause(800);
      const after = await this.ui(serial);
      if (blockedNotice(after)) throw new BlockedError('Instagram membatasi akun ini (like ditolak). Akun dihentikan.');
      if (likeState(after).status === 'already') return 'liked';
    }
    return 'unverified';
  }
  // Opens the comment sheet, waits until the list has loaded, then reads the caption and comments while scrolling.
  async openThread(serial, account, target, postNodes, postText = '') {
    await this.tap(serial, commentButton(postNodes));
    let nodes, composer;
    for (let i = 0; i < 6; i++) {
      await pause(700);
      nodes = await this.ui(serial); composer = composerAccount(nodes);
      if (composer.field) break;
    }
    if (!composer.field) throw new NetworkError('Kolom komentar belum termuat.');
    if (!this.composerMatches(serial, account, target, composer)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    let loaded = false, empty = false;
    for (let i = 0; i < 5; i++) {
      if (threadComments(nodes, target).length) { loaded = true; break; }
      if (emptyThread(nodes)) { loaded = empty = true; break; }
      if (offlineNotice(nodes)) break;
      await pause(1200); nodes = await this.ui(serial);
    }
    // Cached posts open offline and the list can stay blank for a while: treat it as empty only when the
    // post itself shows no comment count.
    if (!loaded && !offlineNotice(nodes) && commentCount(postNodes) === 0) loaded = empty = true;
    const seen = new Map();
    let caption = postText || threadCaption(nodes, target) || postCaption(postNodes, target), previous = '', complete = empty;
    if (loaded && !empty) {
      for (let i = 0; i < 6; i++) {
        for (const c of threadComments(nodes, target)) seen.set(`${c.author}\n${c.text}`, c);
        caption ||= threadCaption(nodes, target);
        const list = commentList(nodes), signature = [...seen.keys()].join('|');
        if (!list || signature === previous) { complete = true; break; }
        previous = signature;
        await this.swipe(serial, list);
        nodes = await this.ui(serial);
      }
    }
    const comments = [...seen.values()];
    return { caption, loaded, complete, mine: comments.filter(c => c.author === account).map(c => c.text), others: comments.filter(c => c.author !== account).map(c => c.text) };
  }
  countFor(key) { return this.state.counts[key]?.count || 0; }
  setCount(key, count, extra = {}) { this.state.counts[key] = { ...this.state.counts[key], ...extra, count, at: new Date().toISOString() }; }
  // Comments still "posting" or "uncertain" are checked against the screen: found means sent;
  // missing from a fully loaded list means failed, so the gap is filled again.
  reconcile(job, meta, key, thread) {
    for (const record of this.state.history) {
      if (record.key !== key || !record.text || !['posting', 'uncertain'].includes(record.status)) continue;
      const short = record.text.length > 60 ? `${record.text.slice(0, 57)}…` : record.text;
      if (thread.mine.includes(record.text)) { record.status = 'sent'; this.log(job, `Dicocokkan ulang: "${short}" ternyata terkirim.`, meta); }
      else if (thread.complete) {
        record.status = 'failed'; this.setCount(key, Math.max(0, this.countFor(key) - 1));
        this.log(job, `Dicocokkan ulang: "${short}" tidak ada di daftar komentar, dihitung gagal dan akan diisi ulang.`, meta);
      }
    }
  }
  // The comment is counted before Send. "Posting…" is awaited; a clear "couldn't post" releases the count.
  async sendComment(job, entry, key, text) {
    const { serial, username: account, target } = entry, meta = { serial, username: account, target };
    let nodes = await this.ui(serial);
    const composer = composerAccount(nodes);
    if (!this.composerMatches(serial, account, target, composer)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    if (this.countFor(key) >= entry.comments) return 'full';
    if (!await this.net.phoneOnline(serial)) throw new NetworkError('HP tidak terhubung ke internet; komentar tidak dikirim.');
    const record = { key, username: account, target, text, at: new Date().toISOString(), status: 'sending' };
    this.setCount(key, this.countFor(key) + 1, { username: account, target });
    this.state.history.push(record); if (this.state.history.length > 5000) this.state.history.shift();
    await this.save();
    const release = async status => { this.setCount(key, Math.max(0, this.countFor(key) - 1)); record.status = status; await this.save(); };
    let send;
    try {
      this.assertRunning();
      await this.tap(serial, composer.field);
      await this.typeComment(serial, text);
      nodes = await this.ui(serial);
      if (composerAccount(nodes).field?.text !== text) throw new Error('Isi komentar pada HP tidak cocok. Tidak dikirim; periksa draft di layar HP.');
      send = sendButton(nodes);
      if (!send) throw new Error('Tombol kirim komentar belum ditemukan. Draft ditinggalkan di HP.');
      this.assertRunning();
    } catch (error) { await release('cancelled'); throw error; }
    await this.tap(serial, send);
    let status = 'uncertain', checks = 0;
    const deadline = Date.now() + 30000;
    this.confirming.add(serial);
    try {
      while (Date.now() < deadline) {
        const after = await this.ui(serial);
        if (blockedNotice(after)) { record.status = 'blocked'; await this.save(); throw new BlockedError('Instagram menolak komentar dari akun ini. Akun dihentikan.'); }
        const placeholder = composerAccount(after);
        if (threadComments(after, target).some(c => c.author === account && c.text === text) || after.some(n => n.text === text && n !== placeholder.field)) { status = 'sent'; break; }
        if (postFailedNotice(after)) { status = 'failed'; break; }
        if (postingNotice(after)) { status = 'posting'; await pause(1500); continue; }
        if (++checks >= 3 && status !== 'posting') break;
        await pause(800);
      }
    } finally { this.confirming.delete(serial); }
    // Instagram shows a new comment right away, even before it reaches the server.
    if (status === 'sent' && !await this.net.phoneOnline(serial)) {
      status = 'uncertain';
      this.log(job, 'Komentar terlihat di layar, tetapi HP sedang offline; belum dianggap terkirim.', { ...meta, status });
    }
    if (status === 'failed') {
      await release('failed');
      this.log(job, 'Instagram gagal memposting komentar ini; hitungan dibatalkan dan akan diisi ulang.', { ...meta, status: 'failed' });
      throw new NetworkError('Instagram gagal memposting komentar.');
    }
    record.status = status; record.at = new Date().toISOString();
    const recent = this.state.recent[account] ||= [];
    recent.push(text); if (recent.length > 300) recent.splice(0, recent.length - 300);
    this.sentTexts.push(text);
    await this.save();
    if (status === 'sent') {
      entry.sent++; job.sent++;
      this.log(job, `Terkirim (total @${account}: ${this.countFor(key)}).`, { ...meta, status: 'sent' });
      return 'sent';
    }
    entry.pending = (entry.pending || 0) + 1;
    this.log(job, `${status === 'posting' ? 'Instagram masih memposting' : 'Status kiriman belum pasti'}; tidak dikirim ulang dan akan dicocokkan ulang nanti.`, { ...meta, status });
    await this.logScreen(job, meta);
    return status;
  }
  composerMatches(serial, account, target, composer) {
    if (!composer.field) return false;
    if (composer.username) return composer.username === account;
    // "Add a comment for X" names the post owner, not the logged-in author.
    // In that UI variant, require the own-profile check from this locked operation.
    const proof = this.verifiedAccounts.get(serial);
    return proof?.username === account && Date.now() - proof.at < 5 * 60000 &&
      (composer.target === target || composer.genericPlaceholder);
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
    this.logs.write(job.logFile, `${clock(at)}  ${who ? `${who}${extra.target ? ` → @${extra.target}` : ''} · ` : ''}${message}`);
  }
  async openLog(job, kind, title, lines = []) {
    const created = await this.logs.create(kind, title).catch(() => null);
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
  async preview(body) {
    const plan = validatePlan(body, this.state.devices);
    if (this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Tunggu proses Instagram yang berjalan selesai.');
    for (const account of plan.accounts) this.checkDevice(account.serial);
    this.previewPending = true; this.abortRequested = false;
    const job = { logs: [] };
    try {
      await this.rememberPlans(plan);
      await this.openLog(job, 'cek', `${plan.accounts.length} akun · tidak mengirim apa pun`);
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
  async inspect(job, account) {
    const { serial, username: name, target } = account, meta = { serial, username: name, target };
    await this.accountSheet(serial, name);
    const opened = await this.patient(job, meta, 'Buka postingan 1', async () => {
      const post = await this.openPost(serial, name, target, 0);
      const screen = await this.readScreen(serial);
      return { post, screen, thread: await this.openThread(serial, name, target, post.nodes, post.caption) };
    });
    const { post, screen, thread } = opened;
    const key = `${name}:${post.fingerprint}`, existing = Math.max(thread.mine.length, this.countFor(key));
    const generated = await this.generate({ caption: thread.caption, konteks: screen, count: 3, tone: account.tone, hindari: [...thread.mine, ...thread.others, ...(this.state.recent[name] || []).slice(-40)] });
    await this.back(serial); await this.back(serial);
    const liked = likeState(post.nodes).status;
    this.log(job, `Caption "${(thread.caption || '').slice(0, 120)}" · suasana ${generated.suasana} · like ${liked} · sudah ${existing} komentar${thread.loaded ? '' : ' (daftar belum termuat)'}.`, meta);
    return { serial, username: name, target, ok: true, caption: (thread.caption || '').slice(0, 300), suasana: generated.suasana, tone: generated.tone, liked, existing, need: Math.max(0, account.comments - existing), pinned: post.pinned, samples: generated.comments };
  }
  start(body) {
    if (this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Masih ada proses Instagram yang berjalan.');
    const plan = validatePlan(body, this.state.devices);
    for (const account of plan.accounts) this.checkDevice(account.serial);
    const job = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString(), finishedAt: null, sent: 0, skipped: 0, failed: 0, startMode: plan.startMode, paused: false, stopReason: null,
      total: plan.accounts.reduce((n, a) => n + a.posts * a.comments, 0), logs: [],
      accounts: plan.accounts.map(a => ({ ...a, status: 'waiting', sent: 0, skipped: 0, liked: 0, missed: 0, pending: 0, note: '' })) };
    this.job = job; this.stopRequested = false; this.sentTexts = [];
    this.rememberPlans(plan).catch(() => {});
    this.run(job).catch(error => { job.status = 'failed'; job.finishedAt = new Date().toISOString(); this.log(job, error.message, { status: 'failed' }); });
    return this.snapshot();
  }
  stop() {
    if (this.job?.status === 'running') { this.stopRequested = true; this.job.status = 'stopping'; this.log(this.job, 'Menghentikan semua HP; komentar yang sudah dikirim tetap ada.'); }
    if (this.previewPending || this.scanActive) this.abortRequested = true;
    return this.snapshot();
  }
  assertRunning() { if (this.stopRequested) throw new Error('Proses dihentikan.'); }
  async wait(ms) { const end = Date.now() + ms; while (Date.now() < end && !this.stopRequested) await pause(Math.min(250, end - Date.now())); }
  // Every HP runs its own queue; in "bertahap" mode HP start times are chained 10–20 s apart.
  async run(job) {
    await this.openLog(job, 'komen', `${job.accounts.length} akun · mulai ${job.startMode}`, job.accounts.map(a => `  @${a.username} (${this.deviceName(a.serial)}) → @${a.target} · ${a.posts} postingan × ${a.comments} komentar · ${a.tone}`));
    let groups = this.groupBySerial(job.accounts);
    this.log(job, `Auto komen dimulai di ${groups.length} HP${groups.length > 1 ? (job.startMode === 'serentak' ? ', semua serentak' : ', bertahap 10–20 detik') : ''}.`);
    if (!await this.net.macOnline()) await this.internetOutage(job);
    const ready = await Promise.all(groups.map(async ([serial, entries]) => {
      if (this.stopRequested || await this.ensurePhoneInternet(job, serial, entries[0].username)) return true;
      for (const entry of entries) { entry.status = 'failed'; entry.note = 'HP tidak punya internet.'; job.failed++; }
      return false;
    }));
    groups = groups.filter((group, i) => ready[i]);
    let offset = 0;
    await Promise.all(groups.map(([serial, entries], i) => {
      if (i && job.startMode !== 'serentak') offset += Math.round(rand(10000, 20000));
      const delay = offset;
      return (async () => {
        if (delay) { this.log(job, `Mulai dalam ${Math.round(delay / 1000)} detik.`, { serial, username: entries[0].username }); await this.wait(delay); }
        for (const entry of entries) {
          if (this.stopRequested) { entry.status = 'stopped'; entry.note ||= job.stopReason || ''; continue; }
          await this.runAccount(job, entry);
        }
      })();
    }));
    job.status = this.stopRequested ? 'stopped' : job.failed ? 'completed_with_errors' : 'completed';
    job.finishedAt = new Date().toISOString();
    this.log(job, `${this.stopRequested ? 'Proses berhenti' : 'Proses selesai'}: ${job.sent} terkirim, ${job.skipped} postingan sudah penuh, ${job.failed} akun terkendala.`);
    this.stopRequested = false;
  }
  // One post: open it, like it, read its comments, then send only what is missing.
  async processPost(job, entry, index, meta, seen = new Map()) {
    const { serial, username: account, target } = entry;
    const { post, screen, like, thread } = await this.patient(job, meta, `Postingan ${index + 1}`, async () => {
      // Instagram shows cached posts offline, so the HP's internet is checked directly.
      if (!await this.net.phoneOnline(serial)) throw new NetworkError('HP tidak terhubung ke internet.');
      const post = await this.openPost(serial, account, target, index);
      const screen = await this.readScreen(serial);
      const like = await this.likePost(serial, post.nodes);
      return { post, screen, like, thread: await this.openThread(serial, account, target, post.nodes, post.caption) };
    });
    if (index === 0 && post.pinned) this.log(job, `Melewati ${post.pinned} postingan yang disematkan.`, meta);
    if (like === 'liked') entry.liked++;
    const caption = post.caption || thread.caption || '';
    this.log(job, `Postingan terbuka · ${caption ? `caption "${caption.slice(0, 120)}${caption.length > 120 ? '…' : ''}"` : 'tanpa caption'} · ${{ liked: 'like OK', already: 'sudah disukai', unverified: 'like diketuk, belum terverifikasi' }[like] || 'tombol like belum terbaca, tidak diketuk'}.`, meta);
    if (screen) this.log(job, `Teks di layar: ${screen.replace(/\s*\n\s*/g, ' / ').slice(0, 300)}`, meta);
    // Media accounts repost with identical captions; the n-th post sharing a caption (in grid order) gets "#n".
    seen.set(index, post.fingerprint);
    const twin = [...seen].filter(([other, fingerprint]) => other < index && fingerprint === post.fingerprint).length + 1;
    if (twin > 1) this.log(job, `Caption sama dengan ${twin - 1} postingan sebelumnya; dibedakan sebagai yang ke-${twin}.`, meta);
    const key = `${account}:${post.fingerprint}${twin > 1 ? `#${twin}` : ''}`;
    this.reconcile(job, meta, key, thread);
    this.log(job, thread.loaded ? `Daftar komentar: ${thread.mine.length + thread.others.length} terbaca, ${thread.mine.length} milik @${account}${thread.complete ? '' : ' (belum semua termuat)'}.` : 'Daftar komentar belum termuat.', meta);
    if (!thread.loaded) {
      if (!this.countFor(key)) throw new NetworkError('Daftar komentar belum termuat; postingan dilewati supaya tidak mengirim berlebih.');
    } else if (thread.mine.length > this.countFor(key) || (thread.complete && thread.mine.length < this.countFor(key))) {
      // A fully read list is the truth: own comments are always visible to their author.
      if (thread.mine.length < this.countFor(key)) this.log(job, `Catatan menyebut ${this.countFor(key)} komentar, di layar ada ${thread.mine.length}; mengikuti layar.`, meta);
      this.setCount(key, thread.mine.length, { username: account, target });
    }
    await this.save();
    const existing = this.countFor(key), need = entry.comments - existing;
    this.log(job, `@${account} sudah ${existing} komentar di sini (target ${entry.comments}).`, meta);
    if (need <= 0) {
      entry.skipped++; job.skipped++;
      this.log(job, 'Sudah mencapai target, lewati.', { ...meta, status: 'skipped' });
    } else {
      const generated = await this.generate({ caption: thread.caption, konteks: screen, count: need, tone: entry.tone, hindari: [...thread.mine, ...thread.others, ...this.sentTexts, ...(this.state.recent[account] || []).slice(-40)] });
      this.log(job, `Perlu ${need} komentar lagi · suasana ${generated.suasana} · nada ${generated.tone}.`, meta);
      if (!generated.comments.length) throw new Error('Bank komentar tidak menghasilkan komentar.');
      for (let i = 0; i < generated.comments.length; i++) {
        this.assertRunning();
        this.log(job, `Komentar #${i + 1}: ${generated.comments[i]}`, meta);
        if (await this.sendComment(job, entry, key, generated.comments[i]) !== 'sent') break;
        if (i < generated.comments.length - 1) await this.wait(rand(3000, 6000));
      }
    }
    await this.back(serial);
  }
  async runAccount(job, entry) {
    const { serial, username: account, target } = entry, meta = { serial, username: account, target };
    entry.status = 'running'; entry.missed ||= 0; entry.pending ||= 0;
    let streak = 0;
    const seen = new Map();
    // Returns "ok", "end" (no more posts) or "network" (skipped for now).
    const attempt = async index => {
      try { await this.processPost(job, entry, index, meta, seen); streak = 0; return 'ok'; }
      catch (error) {
        if (this.stopRequested) throw error;
        if (error instanceof SkipPostError) { this.log(job, error.message, { ...meta, status: 'skipped' }); await this.back(serial).catch(() => {}); return error.end ? 'end' : 'ok'; }
        if (!(error instanceof NetworkError)) throw error;
        this.log(job, `Postingan ${index + 1} dilewati sementara: ${error.message}`, { ...meta, status: 'network' });
        await this.checkInternet(job, meta);
        await this.logScreen(job, meta);
        await this.back(serial).catch(() => {});
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
        await this.accountSheet(serial, account);
        const missed = [];
        for (let index = 0; index < entry.posts; index++) {
          this.assertRunning();
          this.log(job, `Membuka postingan ${index + 1}/${entry.posts}.`, meta);
          const result = await attempt(index);
          if (result === 'end') break;
          if (result === 'network') missed.push(index);
          if (index < entry.posts - 1) await this.wait(rand(5000, 12000));
        }
        for (const index of missed) {
          this.assertRunning();
          this.log(job, `Mencoba ulang postingan ${index + 1} yang tadi terlewat.`, meta);
          if (await attempt(index) === 'network') { entry.missed++; this.log(job, `Postingan ${index + 1} terlewat karena jaringan.`, { ...meta, status: 'network' }); }
        }
      });
      entry.status = this.stopRequested ? 'stopped' : 'done';
      entry.note = [entry.missed && `${entry.missed} postingan terlewat karena jaringan`, entry.pending && `${entry.pending} komentar menunggu dicocokkan ulang`, this.stopRequested && job.stopReason].filter(Boolean).join(' · ');
    } catch (error) {
      if (this.stopRequested) { entry.status = 'stopped'; entry.note = job.stopReason || ''; return; }
      job.failed++;
      entry.status = error instanceof BlockedError ? 'blocked' : error instanceof NetworkError ? 'network' : 'failed'; entry.note = error.message;
      this.log(job, error.message, { ...meta, status: entry.status });
      await this.logScreen(job, meta, 'Layar saat berhenti');
    }
  }
}
