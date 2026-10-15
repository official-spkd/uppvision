import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adb, adbPath, adbEnv } from './adb.mjs';
import { shellQuote } from './core.mjs';
import { byId, switcherAccounts, accountSheetViewport } from './instagram-core.mjs';
import { validateLogin, loginFields, loginButton, loginProblem, loginCandidates, loginNavigation, savedPasswordPrompt, saveLoginDismiss } from './instagram-login-core.mjs';

// The secret travels through stdin, never process arguments, a file, or an error message.
export function credentialCommands(value) {
  return value.split(/(%)/).filter(Boolean).map(part => `input text ${shellQuote(part.replaceAll(' ', '%s'))}`).join('\n') + '\n';
}
export async function typeCredential(serial, value) {
  await new Promise((resolve, reject) => {
    const child = spawn(adbPath, ['-s', serial, 'shell'], { env: adbEnv, stdio: ['pipe', 'ignore', 'ignore'] });
    const fail = () => reject(new Error('Input login ke HP gagal.'));
    const timer = setTimeout(() => { child.kill(); fail(); }, 15000);
    child.on('error', () => { clearTimeout(timer); fail(); });
    child.stdin.on('error', fail);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : fail(); });
    child.stdin.end(credentialCommands(value));
  });
}

export class InstagramLogin {
  constructor(manager) { this.manager = manager; this.job = null; this.cancelled = false; }
  get busy() { return ['scanning', 'running', 'stopping'].includes(this.job?.status); }
  snapshot() { const job = this.job || this.manager.state.lastLogin; return job ? structuredClone(job) : null; }
  start(body) {
    const m = this.manager;
    if (m.duplicates?.busy) throw new Error('Tunggu proses akun duplikat selesai.');
    if (this.busy || m.scanPending || m.previewPending || m.locks.size || ['running', 'stopping'].includes(m.job?.status)) throw new Error('Tunggu proses HP selesai sebelum Auto login.');
    if (!m.devices().some(d => d.status === 'device' && !d.serial.startsWith('emulator-'))) throw new Error('Belum ada HP yang terhubung.');
    const credentials = validateLogin(body);
    this.cancelled = false; m.stopRequested = false; m.abortRequested = false;
    this.job = { id: randomUUID(), status: 'scanning', startedAt: new Date().toISOString(), finishedAt: null, note: 'Memindai jumlah akun di semua HP…', accounts: credentials.map(a => ({ username: a.username, status: 'waiting', serial: null, deviceName: null, note: 'Menunggu pemindaian HP.' })) };
    this.task = this.run(credentials);
    return m.snapshot();
  }
  stop() { if (this.busy) { this.cancelled = true; this.job.status = 'stopping'; this.manager.abortRequested = true; } }
  check() { if (this.cancelled) throw new Error('Proses dihentikan.'); }
  async run(credentials) {
    const m = this.manager, job = this.job, excluded = new Set(Object.keys(m.state.loginAttention || {})), release = m.stayAwake();
    try {
      await m.scanAccounts({ forLogin: true });
      this.check();
      job.status = 'running'; job.note = 'Memilih HP dengan jumlah akun paling sedikit.';
      for (let i = 0; i < credentials.length; i++) {
        this.check();
        const credential = credentials[i], entry = job.accounts[i];
        const candidates = loginCandidates(m.state.devices, m.devices(), excluded);
        // An unusable/offline phone can still hold this account. Never turn a failed
        // verification into a new login on a different phone later in the batch.
        const existing = candidates.find(d => d.accounts.some(a => a.username === credential.username))
          || m.state.devices.find(d => d.accounts.some(a => a.username === credential.username));
        if (existing) {
          const disabled = existing.accounts.find(a => a.username === credential.username).disabled;
          Object.assign(entry, { serial: existing.serial, deviceName: existing.name, status: 'running', note: 'Memverifikasi akun yang sudah ada di HP.' });
          try {
            if (disabled) throw new Error('disabled');
            if (excluded.has(existing.serial)) throw new Error('device needs attention');
            await m.locked(existing.serial, async () => {
              await m.accountSheet(existing.serial, credential.username);
              Object.assign(entry, { status: 'already', note: 'Sudah login; username profil diverifikasi tanpa menambahkan ulang.' });
              // Switching profiles can change the available account list. Refresh it
              // before assigning the next account, including after an existing login.
              existing.complete = false;
              try {
                Object.assign(existing, await m.accountSheet(existing.serial), { error: null, scannedAt: new Date().toISOString() });
                await m.save();
              } catch { excluded.add(existing.serial); }
            });
          } catch {
            Object.assign(entry, { status: this.cancelled ? 'stopped' : 'needs_action', note: disabled ? 'Akun sudah tercatat tetapi nonaktif di Instagram.' : 'Akun tercatat di HP tetapi profil belum bisa diverifikasi. Periksa layar HP.' });
            if (!disabled) excluded.add(existing.serial);
          }
          credential.password = ''; continue;
        }
        const target = candidates[0];
        if (!target) { entry.status = 'not_attempted'; entry.note = 'Belum dicoba: tidak ada HP dengan jumlah akun terverifikasi yang siap dipakai.'; credential.password = ''; continue; }
        Object.assign(entry, { serial: target.serial, deviceName: target.name, status: 'running', before: target.accounts.length, note: `Login ke ${target.name} (${target.accounts.length} akun).` });
        try {
          await m.locked(target.serial, async () => {
            if (!await m.ensurePhoneInternet({ logs: [] }, target.serial, entry.username)) throw new Error('Internet HP tidak tersedia.');
            this.check();
            const outcome = await this.loginOne(target.serial, credential);
            Object.assign(entry, outcome);
            if (outcome.status === 'success') {
              // Verify account identity before changing inventory, then refresh the entire switcher.
              target.accounts = [...target.accounts.filter(a => a.username !== entry.username).map(a => ({ ...a, active: false })), { username: entry.username, active: true, disabled: false }];
              target.current = entry.username; target.scannedAt = new Date().toISOString(); target.error = null; target.complete = false;
              try { Object.assign(target, await m.accountSheet(target.serial)); } catch { /* Verified login remains valid; incomplete counts are excluded from subsequent allocation. */ }
              entry.after = target.accounts.length;
              await m.save();
            } else if ((outcome.status === 'failed' || outcome.recoverable) && !this.cancelled) {
              // A rejected password belongs to this account, not to every future
              // account assigned to the phone. Restore and verify its old sessions.
              try { Object.assign(target, await m.accountSheet(target.serial)); await m.save(); }
              catch { excluded.add(target.serial); }
            } else {
              excluded.add(target.serial);
              m.state.loginAttention ||= {};
              m.state.loginAttention[target.serial] = { username: entry.username, note: entry.note, at: new Date().toISOString() };
              await m.save();
            }
          });
        } catch {
          entry.status = this.cancelled ? 'stopped' : 'failed';
          entry.note = this.cancelled ? 'Proses dihentikan; periksa layar HP sebelum mencoba lagi.' : 'Login belum terverifikasi. Periksa koneksi dan layar HP sebelum mencoba lagi.';
          excluded.add(target.serial);
        } finally { credential.password = ''; }
      }
      this.check();
      job.status = job.accounts.every(a => ['success', 'already'].includes(a.status)) ? 'completed' : 'partial';
      job.note = `${job.accounts.filter(a => a.status === 'success').length} berhasil login, ${job.accounts.filter(a => a.status === 'already').length} sudah login, ${job.accounts.filter(a => !['success', 'already'].includes(a.status)).length} perlu diperiksa.`;
    } catch {
      job.status = this.cancelled ? 'stopped' : 'failed';
      job.note = this.cancelled ? 'Auto login dihentikan.' : 'Pemindaian/login belum selesai. Periksa HP lalu coba lagi.';
    } finally {
      for (const credential of credentials) credential.password = '';
      credentials.length = 0;
      for (const entry of job.accounts) if (['waiting', 'running'].includes(entry.status)) { entry.status = this.cancelled ? 'stopped' : 'failed'; entry.note = job.note; }
      job.finishedAt = new Date().toISOString(); m.abortRequested = false; release();
      m.state.lastLogin = structuredClone(job);
      await m.save().catch(() => {});
    }
  }
  async fill(serial, field, value) {
    this.check(); await this.manager.tap(serial, field);
    await adb(['-s', serial, 'shell', 'input keycombination 113 29; input keyevent 67']);
    this.check(); await typeCredential(serial, value);
  }
  async loginOne(serial, credential) {
    const m = this.manager;
    await m.prepareDevice(serial);
    await adb(['-s', serial, 'shell', 'monkey', '-p', 'com.instagram.android', '-c', 'android.intent.category.LAUNCHER', '1']);
    let submitted = false, profileOpened = false;
    for (let step = 0; step < 35; step++) {
      this.check();
      let nodes;
      try { nodes = await m.ui(serial); }
      catch (error) {
        if (!submitted) throw error;
        const dismiss = saveLoginDismiss(await m.reader.readBoxes(serial), credential.username);
        if (!dismiss) throw error;
        this.check(); await m.tap(serial, dismiss); continue;
      }
      const fields = loginFields(nodes), problem = loginProblem(nodes);
      if (savedPasswordPrompt(nodes)) { await m.back(serial); continue; }
      const profile = byId(nodes, 'profile_tab');
      if (!profile && problem) return problem;
      if (profile) {
        if (submitted) {
          const own = await m.ownProfile(serial);
          return own.current === credential.username ? { status: 'success', note: 'Login berhasil; username profil sudah diverifikasi.' } : { status: 'failed', note: 'Username profil berbeda; login belum terverifikasi.' };
        }
        if (!profileOpened) { const own = await m.ownProfile(serial); await m.tap(serial, own.title); profileOpened = true; continue; }
      }
      if (fields.password && !submitted) {
        if (!fields.user) return { status: 'needs_action', note: 'Form login tidak lengkap. Buka kolom username dan password di HP.' };
        await this.fill(serial, fields.user, credential.username);
        // Re-read coordinates after the keyboard appears; never retain a screenshot or dump.
        const fresh = loginFields(await m.ui(serial));
        if (!fresh.password) throw new Error('Form login berubah.');
        await this.fill(serial, fresh.password, credential.password);
        await m.back(serial);
        const ready = await m.ui(serial), button = loginButton(ready, /^(log in|login|masuk)$/i);
        if (!button) return { status: 'failed', note: 'Tombol login belum terbaca.' };
        this.check(); await m.tap(serial, button); submitted = true; credential.password = '';
        await m.wait(3500); continue;
      }
      const dismiss = loginButton(nodes, /^(not now|nanti saja|lain kali|skip|lewati)$/i);
      if (submitted && dismiss) { await m.tap(serial, dismiss); continue; }
      const action = !submitted && loginNavigation(nodes);
      if (action) { await m.tap(serial, action); continue; }
      if (!submitted && switcherAccounts(nodes).length) {
        await m.swipe(serial, accountSheetViewport(nodes), 'up', 700); continue;
      }
      await m.wait(1500);
    }
    return { status: 'needs_action', note: 'Login belum terverifikasi dalam batas waktu. Periksa layar HP; tidak dicoba ulang otomatis.' };
  }
}
