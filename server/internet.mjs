import { clock } from './joblog.mjs';
import { matchesConnection } from './network-policy.mjs';

// Watches every HP's internet (reverse tethering through the Mac) and reconnects HP that lost it.
// Checks run every 5 minutes, right after the panel starts and whenever an HP (re)appears.
export const CHECK_EVERY = 5 * 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
export class InternetWatch {
  constructor({ devices, net, logs, isBusy = () => false, jobRunning = () => false, onChange = () => {}, interval = CHECK_EVERY, settle = 20000 }) {
    Object.assign(this, { devices, net, logs, isBusy, jobRunning, onChange, interval, settle });
    this.status = new Map(); this.running = null; this.timer = null; this.known = new Set();
  }
  start() {
    this.timer = setInterval(() => this.check().catch(() => {}), this.interval);
    // The relay's health is looked at every minute; a strained relay gets a full check (which restarts it).
    this.relayTimer = setInterval(() => this.watchRelay().catch(() => {}), 60000);
    setTimeout(() => this.check().catch(() => {}), 5000);
  }
  stop() { clearInterval(this.timer); clearInterval(this.relayTimer); }
  async watchRelay() {
    if (!this.running && this.usesRelay() && this.net.relayStrained && await this.net.relayStrained()) await this.check();
  }
  usesRelay() { return !this.net.preference || this.online().some(d => this.net.preference(d.serial)?.method === 'vpn'); }
  snapshot() { return Object.fromEntries([...this.status].map(([serial, s]) => [serial, { ...s }])); }
  set(serial, change) { this.status.set(serial, { ...this.status.get(serial), ...change }); this.onChange(); }
  online() { return this.devices().filter(d => d.status === 'device' && !d.serial.startsWith('emulator-')); }
  // Called after every device scan. An HP that just appeared, or whose USB connection was rebuilt (new adb
  // transport id, e.g. after a USB reset or an adb server restart, which drops the tethering), is checked at once.
  noticeDevices(serverId = null) {
    // A restarted adb server drops every HP's tethering, even when the transport ids come back the same.
    if (serverId && this.serverId && serverId !== this.serverId) this.known = new Set();
    if (serverId) this.serverId = serverId;
    const list = this.online(), now = new Set(list.map(d => `${d.serial}#${d.transportId ?? ''}`));
    const fresh = list.filter(d => !this.known.has(`${d.serial}#${d.transportId ?? ''}`)).map(d => d.serial);
    this.known = now;
    const serials = new Set(list.map(d => d.serial));
    for (const serial of [...this.status.keys()]) if (!serials.has(serial)) this.status.delete(serial);
    for (const serial of fresh) if (this.status.has(serial)) this.set(serial, { state: 'checking', message: 'Sambungan USB baru; memeriksa internet…' });
    if (fresh.length) setTimeout(() => this.check(fresh).catch(() => {}), 3000);
  }
  // One check cycle: every HP is tested; offline HP are reconnected one at a time (one attempt each per cycle).
  check(serials = null, { manual = false, repair = true } = {}) {
    if (this.running) return this.running.then(() => serials || manual ? this.check(serials, { manual, repair }) : undefined);
    this.running = (async () => {
      // A relay that ran out of connection slots fails every HP at once: it is restarted first, even during
      // a job (it is unusable anyway), and the HP get a moment to reconnect before they are checked.
      if (repair && this.usesRelay() && this.net.relayStrained && await this.net.relayStrained()) {
        const log = await this.logs.create('internet', 'Relay di Mac dinyalakan ulang').catch(() => null);
        this.logs.write(log?.file, `${clock(new Date())}  Relay internet di Mac kehabisan slot koneksi; dinyalakan ulang.`);
        await this.net.restartRelay();
        await sleep(this.settle);
      }
      const targets = this.online().filter(d => !serials || serials.includes(d.serial));
      // HP busy with an Instagram process have their own checks; they are left alone.
      const free = targets.filter(d => (manual && !repair) || !this.isBusy(d.serial));
      for (const d of free) this.set(d.serial, { state: 'checking', message: 'Memeriksa internet…' });
      const results = await Promise.all(free.map(async d => [d, await this.net.phoneOnline(d.serial), this.net.connectionInfo ? await this.net.connectionInfo(d.serial) : { wifi: this.net.wifiName ? await this.net.wifiName(d.serial) : null }]));
      const offline = [];
      for (const [d, reachable, info] of results) {
        const preference = this.net.preference?.(d.serial);
        const ok = reachable && matchesConnection(preference, info);
        this.set(d.serial, { ...info, preference: preference || null, reachable });
        if (ok) this.set(d.serial, { state: 'online', checkedAt: new Date().toISOString(), failures: 0, message: '' });
        else {
          this.set(d.serial, { state: 'offline', checkedAt: new Date().toISOString(), message: reachable ? 'Internet tersedia, tetapi jalur aktif belum sesuai pilihan.' : 'Internet belum tersedia.' });
          if (repair && (!this.net.preference || preference)) offline.push(d);
        }
      }
      if (!offline.length) return;
      const log = await this.logs.create('internet', `${offline.length} HP terputus`).catch(() => null);
      const write = line => this.logs.write(log?.file, `${clock(new Date())}  ${line}`);
      let relayRestarted = 0;
      for (const d of offline) {
        const previous = this.status.get(d.serial);
        // After a relay restart most HP reconnect by themselves within seconds; give them that time and
        // check before touching them.
        if (relayRestarted) await sleep(relayRestarted + this.settle - Date.now());
        if (relayRestarted && await this.net.phoneOnline(d.serial, 1) && (!this.net.connectionInfo || matchesConnection(this.net.preference?.(d.serial), await this.net.connectionInfo(d.serial)))) {
          this.set(d.serial, { state: 'online', checkedAt: new Date().toISOString(), failures: 0, message: '' });
          write(`${d.name} tersambung sendiri setelah relay menyala.`);
          continue;
        }
        this.set(d.serial, { state: 'restoring', message: 'Menyambungkan ulang…' });
        write(`${d.name} internet terputus; menyambungkan ulang.`);
        // Restarting the relay drops every HP for a few seconds (they reconnect by themselves), so it is skipped while
        // a job runs (unless the relay is down), done at most once per check (a second restart would cut the HP still
        // reconnecting), and not done for an HP that keeps failing (its cable is the likely cause, not the relay).
        const relayRestart = !this.jobRunning() && !relayRestarted && (previous?.failures || 0) < 2;
        const result = await this.net.restoreInternet(d.serial, { relayRestart }).catch(error => ({ online: false, message: error.message }));
        if (result.relay) relayRestarted = Date.now();
        const failures = result.online ? 0 : (previous?.failures || 0) + 1;
        if (this.net.connectionInfo) this.set(d.serial, await this.net.connectionInfo(d.serial));
        const wifiMode = this.net.preference?.(d.serial)?.method === 'wifi';
        this.set(d.serial, { state: result.online ? 'online' : 'offline', checkedAt: new Date().toISOString(), failures,
          message: result.online ? '' : result.message || (wifiMode ? 'Wi-Fi belum menyediakan internet. Periksa jaringan atau hotspot pilihan.' : failures >= 3 ? `Gagal ${failures} kali berturut-turut. Periksa kabel USB HP ini.` : 'Belum tersambung; dicoba lagi di pengecekan berikutnya.') });
        write(`${d.name} ${result.online ? `terhubung kembali${result.relay ? ' (relay di Mac dinyalakan ulang)' : ' (aplikasi internet HP dinyalakan ulang)'}.` : `belum tersambung (gagal ${failures} kali berturut-turut).`}`);
      }
      // HP still marked offline may have come back on their own meanwhile; look once more, all together.
      const still = offline.filter(d => this.status.get(d.serial)?.state === 'offline');
      if (still.length) {
        await sleep(3000);
        await Promise.all(still.map(async d => {
          if (!await this.net.phoneOnline(d.serial, 1)) return;
          if (this.net.connectionInfo) {
            const info = await this.net.connectionInfo(d.serial); this.set(d.serial, info);
            if (!matchesConnection(this.net.preference?.(d.serial), info)) return;
          }
          this.set(d.serial, { state: 'online', checkedAt: new Date().toISOString(), failures: 0, message: '' });
          write(`${d.name} tersambung kembali saat dicek ulang.`);
        }));
      }
    })().finally(() => { this.running = null; });
    return this.running;
  }
  summary() {
    const list = this.online().map(d => this.status.get(d.serial)?.state);
    return { total: list.length, online: list.filter(s => s === 'online').length, offline: list.filter(s => s === 'offline').length, restoring: list.filter(s => s === 'restoring').length };
  }
}
