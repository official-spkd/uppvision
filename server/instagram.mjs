import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adb, input } from './adb.mjs';
import { parseUi, byId, center, switcherAccounts, gridTiles, composerAccount, postFingerprint, validUsername, validatePlan, blockedNotice, sendButton, likeState, commentButton, captionMore, commentList, threadComments, threadCaption, postCaption } from './instagram-core.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const PACKAGE = 'com.instagram.android';
const BANK = join(dirname(fileURLToPath(import.meta.url)), 'komentar', 'buat.py');
export class BlockedError extends Error {}
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
    let lastError = new Error('Tombol komentar postingan belum ditemukan.');
    for (let i = 0; i < 6; i++) {
      const nodes = await this.ui(serial);
      const comment = commentButton(nodes);
      const bounds = comment?.bounds?.match(/\d+/g)?.map(Number);
      if (comment && bounds && bounds[3] - bounds[1] >= 45) {
        let fingerprint;
        try { fingerprint = postFingerprint(nodes, target); }
        catch (error) {
          // The action bar can sit at the screen edge with the caption still below it; nudge it up a little.
          lastError = error;
          await this.nudge(serial, bounds[1]);
          continue;
        }
        // The fingerprint uses the collapsed caption; comments are written from the full one.
        const expanded = await this.expandCaption(serial, nodes, target);
        return { ...expanded, pinned, fingerprint };
      }
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
    let verified = false, atTop = false, previous = '';
    const order = [], pinnedKeys = new Set();
    for (let i = 0; i < 40; i++) {
      const nodes = await this.ui(serial);
      verified ||= nodes.some(n => (n.text || '').toLowerCase() === target && /action_bar|username/.test(n['resource-id'] || ''));
      if (nodes.some(n => /^(this account is private|akun ini bersifat pribadi|user not found|pengguna tidak ditemukan)$/i.test(n.text || ''))) throw new Error(`Profil @${target} tidak dapat diakses dari akun ini.`);
      if (byId(nodes, 'profile_header_post_count_front_familiar')?.['content-desc']?.match(/^0\s*(?:post|postingan)/i)) throw new Error(`@${target} belum punya postingan.`);
      const tiles = gridTiles(nodes), list = nodes.find(n => n.scrollable === 'true');
      if (!verified || !tiles.length) { await this.swipe(serial, list); continue; }
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
      if (signature === previous) throw new Error(`Postingan ke-${index + 1} @${target} belum tersedia.`);
      previous = signature;
      await this.swipe(serial, list);
    }
    throw new Error(`Postingan @${target} belum dapat dibaca. Periksa jaringan HP.`);
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
  // Opens the comment sheet and reads the caption plus visible comments while scrolling.
  async openThread(serial, account, target, postNodes, postText = '') {
    await this.tap(serial, commentButton(postNodes));
    let nodes;
    for (let i = 0; i < 4; i++) {
      await pause(600);
      nodes = await this.ui(serial);
      if (composerAccount(nodes).field) break;
    }
    if (!this.composerMatches(serial, account, target, composerAccount(nodes))) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    const seen = new Map();
    let caption = postText || threadCaption(nodes, target) || postCaption(postNodes, target), previous = '';
    for (let i = 0; i < 6; i++) {
      for (const c of threadComments(nodes, target)) seen.set(`${c.author}\n${c.text}`, c);
      caption ||= threadCaption(nodes, target);
      const list = commentList(nodes), signature = [...seen.keys()].join('|');
      if (!list || signature === previous) break;
      previous = signature;
      await this.swipe(serial, list);
      nodes = await this.ui(serial);
    }
    const comments = [...seen.values()];
    return { caption, mine: comments.filter(c => c.author === account).map(c => c.text), others: comments.filter(c => c.author !== account).map(c => c.text) };
  }
  countFor(key) { return this.state.counts[key]?.count || 0; }
  setCount(key, count, extra = {}) { this.state.counts[key] = { ...this.state.counts[key], ...extra, count, at: new Date().toISOString() }; }
  // The comment is counted before Send; an interrupted or unconfirmed send is never retried.
  async sendComment(job, entry, key, text) {
    const { serial, username: account, target } = entry;
    let nodes = await this.ui(serial);
    const composer = composerAccount(nodes);
    if (!this.composerMatches(serial, account, target, composer)) throw new Error('Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.');
    if (this.countFor(key) >= entry.comments) return false;
    const record = { key, username: account, target, at: new Date().toISOString(), status: 'sending' };
    this.setCount(key, this.countFor(key) + 1, { username: account, target });
    this.state.history.push(record); if (this.state.history.length > 5000) this.state.history.shift();
    await this.save();
    const release = async () => { this.setCount(key, Math.max(0, this.countFor(key) - 1)); record.status = 'cancelled'; await this.save(); };
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
    } catch (error) { await release(); throw error; }
    await this.tap(serial, send);
    let confirmed = false;
    this.confirming.add(serial);
    try {
      for (let check = 0; check < 3; check++) {
        const after = await this.ui(serial);
        if (blockedNotice(after)) { record.status = 'blocked'; await this.save(); throw new BlockedError('Instagram menolak komentar dari akun ini. Akun dihentikan.'); }
        const placeholder = composerAccount(after);
        if (this.composerMatches(serial, account, target, placeholder) && (threadComments(after, target).some(c => c.author === account && c.text === text) || after.some(n => n.text === text && n !== placeholder.field))) { confirmed = true; break; }
      }
    } finally { this.confirming.delete(serial); }
    record.status = confirmed ? 'sent' : 'uncertain';
    const recent = this.state.recent[account] ||= [];
    recent.push(text); if (recent.length > 300) recent.splice(0, recent.length - 300);
    this.sentTexts.push(text);
    await this.save();
    if (!confirmed) throw new Error('Status kirim belum dapat dipastikan. Periksa HP; komentar ini tidak akan dikirim ulang otomatis.');
    entry.sent++; job.sent++;
    this.log(job, `Terkirim (total @${account}: ${this.countFor(key)}).`, { serial, username: account, target, status: 'sent' });
    return true;
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
  // Read-only check of every selected account: no like and no comment is sent.
  async preview(body) {
    const plan = validatePlan(body, this.state.devices);
    if (this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Tunggu proses Instagram yang berjalan selesai.');
    for (const account of plan.accounts) this.checkDevice(account.serial);
    this.previewPending = true; this.abortRequested = false;
    try {
      await this.rememberPlans(plan);
      const results = new Map();
      await Promise.all(this.groupBySerial(plan.accounts).map(async ([serial, accounts]) => {
        for (const account of accounts) {
          const key = `${serial}:${account.username}`;
          if (this.abortRequested) { results.set(key, { serial, username: account.username, target: account.target, ok: false, error: 'Pemeriksaan dihentikan sebelum akun ini diperiksa.' }); continue; }
          try { results.set(key, await this.locked(serial, () => this.inspect(account))); }
          catch (error) { results.set(key, { serial, username: account.username, target: account.target, ok: false, error: error.message }); }
        }
      }));
      const ordered = plan.accounts.map(a => results.get(`${a.serial}:${a.username}`));
      const ok = ordered.filter(r => r.ok).length;
      if (this.abortRequested) return { results: ordered, stopped: true, message: `Pemeriksaan dihentikan; ${ok} dari ${ordered.length} akun sempat diperiksa. Tidak ada like atau komentar yang dikirim.` };
      return { results: ordered, message: `${ok} dari ${ordered.length} akun berhasil diperiksa. Tidak ada like atau komentar yang dikirim.` };
    } finally { this.previewPending = false; this.abortRequested = false; }
  }
  async inspect(account) {
    const { serial, username: name, target } = account;
    await this.accountSheet(serial, name);
    const post = await this.openPost(serial, name, target, 0);
    const liked = likeState(post.nodes).status;
    const thread = await this.openThread(serial, name, target, post.nodes, post.caption);
    const key = `${name}:${post.fingerprint}`, existing = Math.max(thread.mine.length, this.countFor(key));
    const generated = await this.generate({ caption: thread.caption, count: 3, tone: account.tone, hindari: [...thread.mine, ...thread.others, ...(this.state.recent[name] || []).slice(-40)] });
    await this.back(serial); await this.back(serial);
    return { serial, username: name, target, ok: true, caption: thread.caption.slice(0, 300), suasana: generated.suasana, tone: generated.tone, liked, existing, need: Math.max(0, account.comments - existing), pinned: post.pinned, samples: generated.comments };
  }
  log(job, message, extra = {}) {
    job.logs.push({ at: new Date().toISOString(), message, ...extra });
    if (job.logs.length > 500) job.logs.shift();
  }
  start(body) {
    if (this.previewPending || this.scanPending || this.locks.size || (this.job && ['running', 'stopping'].includes(this.job.status))) throw new Error('Masih ada proses Instagram yang berjalan.');
    const plan = validatePlan(body, this.state.devices);
    for (const account of plan.accounts) this.checkDevice(account.serial);
    const job = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString(), finishedAt: null, sent: 0, skipped: 0, failed: 0, startMode: plan.startMode,
      total: plan.accounts.reduce((n, a) => n + a.posts * a.comments, 0), logs: [],
      accounts: plan.accounts.map(a => ({ ...a, status: 'waiting', sent: 0, skipped: 0, liked: 0, note: '' })) };
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
    const groups = this.groupBySerial(job.accounts);
    this.log(job, `Auto komen dimulai di ${groups.length} HP${groups.length > 1 ? (job.startMode === 'serentak' ? ', semua serentak' : ', bertahap 10–20 detik') : ''}.`);
    let offset = 0;
    await Promise.all(groups.map(([serial, entries], i) => {
      if (i && job.startMode !== 'serentak') offset += Math.round(rand(10000, 20000));
      const delay = offset;
      return (async () => {
        if (delay) { this.log(job, `Mulai dalam ${Math.round(delay / 1000)} detik.`, { serial, username: entries[0].username }); await this.wait(delay); }
        for (const entry of entries) {
          if (this.stopRequested) { entry.status = 'stopped'; continue; }
          await this.runAccount(job, entry);
        }
      })();
    }));
    job.status = this.stopRequested ? 'stopped' : job.failed ? 'completed_with_errors' : 'completed';
    job.finishedAt = new Date().toISOString(); this.log(job, this.stopRequested ? 'Proses berhenti.' : 'Proses selesai.');
    this.stopRequested = false;
  }
  async runAccount(job, entry) {
    const { serial, username: account, target } = entry, meta = { serial, username: account, target };
    entry.status = 'running';
    try {
      await this.locked(serial, async () => {
        this.log(job, `Memilih @${account}.`, meta);
        await this.accountSheet(serial, account);
        for (let index = 0; index < entry.posts; index++) {
          this.assertRunning();
          this.log(job, `Membuka postingan ${index + 1}/${entry.posts} @${target}.`, meta);
          const post = await this.openPost(serial, account, target, index);
          if (index === 0 && post.pinned) this.log(job, `Melewati ${post.pinned} postingan yang disematkan.`, meta);
          const like = await this.likePost(serial, post.nodes);
          if (like === 'liked') entry.liked++;
          this.log(job, { liked: 'Like: OK.', already: 'Like: sudah disukai sebelumnya.', unverified: 'Like diketuk, status belum terverifikasi.' }[like] || 'Like: tombol belum terbaca, dilewati.', meta);
          const thread = await this.openThread(serial, account, target, post.nodes, post.caption);
          const key = `${account}:${post.fingerprint}`;
          if (thread.mine.length > this.countFor(key)) { this.setCount(key, thread.mine.length, { username: account, target }); await this.save(); }
          const existing = this.countFor(key), need = entry.comments - existing;
          this.log(job, `@${account} sudah ${existing} komentar di sini (target ${entry.comments}).`, meta);
          if (need <= 0) {
            entry.skipped++; job.skipped++;
            this.log(job, 'Sudah mencapai target, lewati.', { ...meta, status: 'skipped' });
          } else {
            const generated = await this.generate({ caption: thread.caption, count: need, tone: entry.tone, hindari: [...thread.mine, ...thread.others, ...this.sentTexts, ...(this.state.recent[account] || []).slice(-40)] });
            this.log(job, `Perlu ${need} komentar lagi · suasana ${generated.suasana} · nada ${generated.tone}.`, meta);
            if (!generated.comments.length) throw new Error('Bank komentar tidak menghasilkan komentar.');
            for (let i = 0; i < generated.comments.length; i++) {
              this.assertRunning();
              this.log(job, `Komentar #${i + 1}: ${generated.comments[i]}`, meta);
              if (!await this.sendComment(job, entry, key, generated.comments[i])) break;
              if (i < generated.comments.length - 1) await this.wait(rand(3000, 6000));
            }
          }
          await this.back(serial);
          if (index < entry.posts - 1) await this.wait(rand(5000, 12000));
        }
      });
      entry.status = this.stopRequested ? 'stopped' : 'done';
    } catch (error) {
      if (this.stopRequested) { entry.status = 'stopped'; return; }
      job.failed++;
      entry.status = error instanceof BlockedError ? 'blocked' : 'failed'; entry.note = error.message;
      this.log(job, error.message, { ...meta, status: entry.status });
    }
  }
}
