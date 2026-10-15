import { randomUUID } from 'node:crypto';
import { duplicateAccountPlan } from '../src/instagram-duplicates.mjs';
export class InstagramDuplicates {
  constructor(manager) { this.manager = manager; this.job = null; this.cancelled = false; }
  get busy() { return ['scanning', 'running', 'stopping'].includes(this.job?.status); }
  snapshot() { return structuredClone(this.job || this.manager.state.lastDuplicates || null); }
  start() {
    const m = this.manager;
    if (this.busy || m.logout.busy || m.login?.busy || m.scanPending || m.previewPending || m.locks.size || ['running', 'stopping'].includes(m.job?.status)) throw new Error('Tunggu proses HP selesai sebelum merapikan akun duplikat.');
    this.cancelled = false; m.abortRequested = false; m.stopRequested = false;
    this.job = { id: randomUUID(), status: 'scanning', startedAt: new Date().toISOString(), note: 'Membaca ulang akun di semua HP…', removed: [], blocked: [], logs: [] };
    this.task = this.run();
    return m.snapshot();
  }
  stop() { if (this.busy) { this.cancelled = true; this.job.status = 'stopping'; this.job.note = 'Menyelesaikan verifikasi logout yang sedang berlangsung, lalu berhenti.'; } }
  async run() {
    const m = this.manager, job = this.job, release = m.stayAwake();
    try {
      await m.openLog(job, 'duplikat', 'Rapikan akun duplikat');
      await m.scanAccounts({ forDuplicates: true });
      job.status = this.cancelled ? 'stopping' : 'running';
      for (let step = 0; step < 300 && !this.cancelled; step++) {
        const plan = duplicateAccountPlan(m.snapshot().devices);
        job.blocked = plan.blocked; job.remaining = plan.candidates.length;
        const action = plan.candidates[0];
        if (!action) { job.status = plan.blocked.length ? 'completed_with_errors' : 'completed'; break; }
        job.current = action;
        job.note = `@${action.username}: log out ${action.name} (${action.count} akun), pertahankan ${action.keepName} (${action.keepCount} akun).`;
        m.log(job, job.note, { serial: action.serial, username: action.username });
        // Prove a working copy remains before touching the duplicate.
        const keeper = m.state.devices.find(d => d.serial === action.keepSerial);
        await m.locked(action.keepSerial, async () => {
          const fresh = await m.accountSheet(action.keepSerial);
          if (!fresh.complete || !fresh.accounts.some(a => a.username === action.username && !a.disabled)) throw new Error(`Salinan @${action.username} di ${action.keepName} belum terverifikasi; logout ditahan.`);
          Object.assign(keeper, fresh, { scannedAt: new Date().toISOString(), error: null });
          // A switcher entry can survive logout. Prove this copy still opens
          // as the exact account before removing its copy on another HP.
          const selected = await m.accountSheet(action.keepSerial, action.username);
          if (selected?.current !== action.username) throw new Error(`Sesi @${action.username} di ${action.keepName} belum terverifikasi; logout ditahan.`);
          const selectedInventory = await m.accountSheet(action.keepSerial);
          if (!selectedInventory.complete || selectedInventory.accounts.length !== fresh.accounts.length || fresh.accounts.some(a => !selectedInventory.accounts.some(b => b.username === a.username && Boolean(b.disabled) === Boolean(a.disabled)))) {
            keeper.complete = false;
            throw new Error(`Daftar akun ${action.keepName} berubah ketika profil aktif diganti. Prioritas jumlah akun belum pasti; logout ditahan.`);
          }
        });
        if (this.cancelled) break;
        // Fresh keeper counts can change the selected keeper or logout order.
        const updated = duplicateAccountPlan(m.snapshot().devices).candidates[0];
        if (!updated || updated.serial !== action.serial || updated.username !== action.username || updated.keepSerial !== action.keepSerial) continue;
        m.logout.start({ serial: action.serial, username: action.username }, { forDuplicates: true });
        await m.logout.task;
        if (m.logout.job.status !== 'success') throw new Error(m.logout.job.note);
        const result = { ...action, at: new Date().toISOString(), verification: structuredClone(m.logout.job.verification) };
        job.removed.push(result);
        m.log(job, `Terverifikasi: @${action.username} keluar dari ${action.name}; tetap di ${action.keepName}.`, { serial: action.serial, username: action.username });
        await m.save();
      }
      if (this.cancelled) job.status = 'stopped';
      else if (job.status === 'running') throw new Error('Batas langkah tercapai; periksa perubahan daftar akun.');
      job.note = `${job.removed.length} logout terverifikasi; ${job.blocked.length} salinan/kondisi perlu pemeriksaan.${this.cancelled ? ' Proses dihentikan.' : ''}`;
    } catch (error) { job.status = this.cancelled ? 'stopped' : 'failed'; job.note = error.message; m.log(job, job.note, { status: job.status }); }
    finally { job.current = null; job.finishedAt = new Date().toISOString(); m.state.lastDuplicates = structuredClone(job); await m.save().catch(() => {}); release(); }
  }
}
