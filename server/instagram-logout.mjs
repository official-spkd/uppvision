import { randomUUID } from 'node:crypto';
import { username, byId } from './instagram-core.mjs';
import { loginButton, loggedOutScreen, loginProblem } from './instagram-login-core.mjs';

const labels = nodes => nodes.map(n => n.text || n['content-desc'] || '').join(' ');
const exactName = (text, name) => text.toLowerCase().split(/[^a-z0-9_.]+/).some(t => t.replace(/\.+$/, '') === name);
export function logoutConfirmation(nodes, name, verifiedUsername = null) {
  const text = labels(nodes);
  if (/all accounts|semua akun/i.test(text)) return null;
  if (nodes.some(n => n.checkable === 'true' || /CheckBox|Switch$/.test(n.class || ''))) return null;
  if (!/log out|logout|keluar/i.test(text)) return null;
  // Instagram also uses a generic native dialog. Accept it only within the
  // uninterrupted settings flow opened from this exact, verified profile.
  if (!exactName(text, name)) {
    const headline = byId(nodes, 'igds_headline_headline');
    const confirm = byId(nodes, 'primary_button');
    const cancel = byId(nodes, 'negative_button');
    return verifiedUsername === name && headline?.text === 'Log out of your account?' && confirm?.text === 'Log out' && cancel?.text === 'Cancel' ? confirm : null;
  }
  return loginButton(nodes, /^(log out|logout|keluar)$/i) || loginButton(nodes, new RegExp(`^(?:log out|keluar) @?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
}

export class InstagramLogout {
  constructor(manager) { this.manager = manager; this.job = null; }
  get busy() { return this.job?.status === 'running'; }
  snapshot() { return structuredClone(this.job || this.manager.state.lastLogout || null); }
  start(body, { forDuplicates = false } = {}) {
    const m = this.manager, name = username(body?.username), serial = body?.serial;
    if (m.duplicates?.busy && !forDuplicates) throw new Error('Tunggu proses akun duplikat selesai.');
    if (this.busy || m.login?.busy || m.scanPending || m.previewPending || m.locks.size || ['running', 'stopping'].includes(m.job?.status)) throw new Error('Tunggu proses HP selesai sebelum log out.');
    const device = m.state.devices.find(d => d.serial === serial);
    if (!device?.accounts.some(a => a.username === name)) throw new Error('Akun tidak tercatat pada HP yang dipilih. Pindai ulang akun.');
    if (m.state.loginAttention?.[serial]) throw new Error('Selesaikan proses yang tertunda di HP ini terlebih dahulu.');
    m.checkDevice(serial); m.abortRequested = false; m.stopRequested = false;
    this.job = { id: randomUUID(), serial, username: name, deviceName: device.name, verifyStableInventory: forDuplicates, status: 'running', note: 'Memeriksa akun sebelum log out…', startedAt: new Date().toISOString() };
    this.task = this.run(device, name);
    return m.snapshot();
  }
  async run(device, name) {
    const m = this.manager, job = this.job, serial = device.serial, release = m.stayAwake();
    try {
      await m.locked(serial, async () => {
        const before = await m.accountSheet(serial);
        job.verification = { before: before.accounts.map(a => a.username) };
        if (!before.complete || !before.accounts.some(a => a.username === name)) throw new Error('Identitas atau daftar akun belum bisa dipastikan. Log out dibatalkan.');
        job.note = `Memilih @${name} untuk log out…`;
        await m.accountSheet(serial, name);
        if (job.verifyStableInventory) {
          const selected = await m.accountSheet(serial);
          if (!selected.complete || selected.accounts.length !== before.accounts.length || before.accounts.some(a => !selected.accounts.some(b => b.username === a.username && Boolean(b.disabled) === Boolean(a.disabled)))) throw new Error(`Daftar akun ${device.name} berubah ketika profil aktif diganti. Prioritas jumlah akun belum pasti; logout ditahan.`);
        }
        job.note = `Membuka pengaturan log out @${name}…`;
        await this.navigate(serial, name);
        job.note = 'Memeriksa bahwa akun sudah keluar…';
        let after;
        try { after = await m.accountSheet(serial); }
        catch (error) {
          if (error.code !== 'IG_LOGGED_OUT') throw error;
          after = { accounts: [], current: null, complete: true, loggedOut: true };
        }
        // Linked profiles can expose a different switcher list. Compare from
        // the same surviving profile that supplied the original inventory.
        if (before.current && before.current !== name && after.current && after.current !== before.current) {
          await m.accountSheet(serial, before.current);
          after = await m.accountSheet(serial);
        }
        Object.assign(device, after, { scannedAt: new Date().toISOString(), error: null });
        job.verification.after = after.accounts.map(a => a.username);
        if (!after.complete || after.accounts.some(a => a.username === name)) throw new Error('Log out belum terverifikasi. Periksa layar HP sebelum mencoba lagi.');
        if (before.accounts.some(a => a.username !== name && !after.accounts.some(b => b.username === a.username))) throw new Error('Daftar akun lain berubah. Periksa sesi Instagram pada HP ini.');
        delete m.state.plans?.[`${serial}:${name}`];
        m.verifiedAccounts.delete(serial);
        job.status = 'success'; job.note = `@${name} sudah log out dari ${device.name}. Daftar akun diperbarui.`;
      });
    } catch (error) {
      job.status = error.code === 'IG_AUTH_CHALLENGE' ? 'needs_action' : 'failed'; job.note = error.message;
      if (error.code === 'IG_AUTH_CHALLENGE') {
        job.code = error.code;
        m.state.loginAttention ||= {};
        m.state.loginAttention[serial] = { username: name, note: error.message, at: new Date().toISOString() };
      }
      device.complete = false;
    } finally {
      job.finishedAt = new Date().toISOString(); release();
      m.state.lastLogout = structuredClone(job); await m.save().catch(() => {});
    }
  }
  async navigate(serial, name) {
    const m = this.manager;
    const own = await m.ownProfile(serial);
    if (own.current !== name) throw new Error('Akun aktif berubah. Log out dibatalkan.');
    const menu = loginButton(own.nodes, /^(options|opsi|menu|more options|opsi lainnya)$/i) || byId(own.nodes, 'action_bar_overflow_icon');
    if (!menu) throw new Error('Menu profil belum terbaca. Buka HP untuk memeriksa.');
    await m.tap(serial, menu);
    let opened = false;
    for (let page = 0; page < 20; page++) {
      const nodes = await m.ui(serial);
      const settings = loginButton(nodes, /^(settings and (?:activity|privacy)|pengaturan dan (?:aktivitas|privasi))$/i);
      const action = loginButton(nodes, new RegExp(`^(?:log out|keluar) @?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) || loginButton(nodes, /^(log out|logout|keluar)$/i);
      if (action && settings) { await m.tap(serial, action); opened = true; break; }
      if (settings?.clickable === 'true' && !nodes.some(n => n.scrollable === 'true')) await m.tap(serial, settings);
      else {
        const viewport = nodes.find(n => n.scrollable === 'true');
        if (viewport) await m.swipe(serial, viewport, 'up', 500);
        else await m.wait(800);
      }
    }
    if (!opened) throw new Error('Pilihan log out akun ini tidak ditemukan. Periksa melalui Lihat HP.');
    let confirmed = false;
    for (let step = 0; step < 8; step++) {
      const nodes = await m.ui(serial);
      await m.assertNoChallenge(serial);
      if (byId(nodes, 'profile_tab') || loggedOutScreen(nodes)) return;
      const text = labels(nodes);
      if (/save (?:your )?login|remember.*login|simpan.*(?:login|masuk)/i.test(text)) {
        if (!exactName(text, name)) throw new Error('Identitas pada konfirmasi penyimpanan login berbeda atau belum terbaca. Log out dibatalkan.');
        const skip = loginButton(nodes, /^(not now|nanti saja|lain kali)$/i);
        if (skip) { await m.tap(serial, skip); continue; }
      }
      const confirm = !confirmed && logoutConfirmation(nodes, name, own.current);
      if (confirm) { await m.tap(serial, confirm); confirmed = true; await m.wait(1500); continue; }
      if (loginProblem(nodes) || /all accounts|semua akun/i.test(text) || nodes.some(n => n.checkable === 'true')) throw new Error('Instagram meminta pilihan tambahan. Periksa Lihat HP; akun lain belum dikeluarkan oleh panel.');
      await m.wait(800);
    }
    throw new Error('Konfirmasi log out belum bisa dipastikan. Periksa Lihat HP.');
  }
}
