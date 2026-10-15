import { updateProgress } from './comment-progress.mjs';
import { randomUUID } from 'node:crypto';
const unresolved = record => ['sending', 'posting', 'uncertain', 'blocked'].includes(record.status);

export class CommentRecovery {
  constructor(manager) { this.m = manager; }
  records() { return this.m.state.history.filter(unresolved); }
  summary() {
    const m = this.m, saved = m.state.resumableJob;
    const available = m.logPrefix !== 'tt' && saved?.commentMode === 'new-per-job' && saved.commentRunId && saved.accounts.every(a => a.lockedPosts?.length);
    const held = available && (saved.accounts.some(a => Object.values(a.progress || {}).some(p => p.held)) || this.records().some(r => r.commentRunId === saved.commentRunId));
    return {
      pending: this.records().map(r => ({ id: r.id, serial: r.serial, username: r.username, target: r.target, text: r.text, at: r.at, status: r.status, note: r.reviewNote || '',
        reviewable: Boolean(m.logPrefix !== 'tt' && r.serial && r.postRef && r.targetInput && r.fingerprint) })),
      resume: available ? { id: saved.id, blocked: Boolean(held), accounts: saved.accounts.length, remaining: saved.accounts.reduce((n, a) => n + (a.remaining || 0), 0),
        targets: saved.accounts.map(a => ({ username: a.username, serial: a.serial, target: a.target, comments: a.comments, posts: a.posts })) } : null,
    };
  }
  assertIdle() {
    const m = this.m;
    if (m.duplicates?.busy || m.logout?.busy || m.login?.busy || m.previewPending || m.scanPending || m.locks.size || ['running', 'stopping'].includes(m.job?.status)) throw new Error('Tunggu pekerjaan yang berjalan selesai sebelum memeriksa atau melanjutkan.');
  }
  resume(body) {
    this.assertIdle();
    const m = this.m, saved = m.state.resumableJob, summary = this.summary().resume;
    if (!summary || body?.resumeJobId !== saved.id) throw new Error('Pekerjaan tersimpan ini tidak tersedia untuk dilanjutkan.');
    if (summary.blocked) throw new Error('Periksa hasil kiriman belum pasti sebelum melanjutkan pekerjaan ini.');
    return m.start({ resumeJobId: saved.id, accounts: saved.accounts.map(({ serial, username, target, posts, comments, tone }) => ({ serial, username, target, posts, comments, tone })) });
  }
  async review(body) {
    this.assertIdle();
    const m = this.m, record = m.state.history.find(r => r.id === body?.recordId);
    if (!record || !unresolved(record)) throw new Error('Kiriman belum pasti ini tidak tersedia atau sudah diperiksa.');
    if (m.logPrefix === 'tt' || !record.serial || !record.postRef || !record.targetInput || !record.fingerprint) throw new Error('Catatan ini belum memiliki referensi target yang cukup untuk pemeriksaan otomatis. Pengiriman tetap ditahan.');
    m.checkDevice(record.serial);
    m.previewPending = true; m.abortRequested = false;
    const job = { logs: [] };
    try {
      await m.locked(record.serial, async () => {
        await m.prepareDevice(record.serial);
        await m.accountSheet(record.serial, record.username);
        const entry = { serial: record.serial, username: record.username, target: record.targetInput, targetOwner: record.target };
        const post = await m.patient(job, entry, 'Periksa sasaran kiriman', () => m.openPost(record.serial, record.username, record.targetInput, record.postRef));
        if (post.fingerprint !== record.fingerprint || (post.owner && post.owner !== record.target)) throw new Error('Identitas postingan tidak cocok dengan kiriman tersimpan; status tetap ditahan.');
        await m.openThread(record.serial, record.username, record.target, post.nodes, post.caption, { readOnlyText: record.text });
        // No like, typing, Send, or automatic resume is allowed in this operation.
        const status = await m.checkDelivery(entry, record.text, { recovery: true });
        const beforeRecord = structuredClone(record), beforeCount = structuredClone(m.state.counts[record.key]);
        if (status === 'sent' || status === 'failed') {
          record.status = status; record.reviewedAt = new Date().toISOString(); record.evidence = 'ui-recheck';
          if (status === 'failed') m.setCount(record.key, Math.max(0, m.countFor(record.key) - 1));
          record.reviewNote = status === 'sent' ? 'Akun dan teks cocok pada dua pemeriksaan online; tercatat terkirim.' : 'Indikator gagal melekat pada komentar ini; kuota dilepas.';
        } else record.reviewNote = 'Belum ada bukti yang cukup. Tidak terlihat bukan berarti gagal; pengiriman tetap ditahan.';
        try { await m.save(); }
        catch (error) {
          Object.keys(record).forEach(k => delete record[k]); Object.assign(record, beforeRecord);
          if (beforeCount) m.state.counts[record.key] = beforeCount; else delete m.state.counts[record.key];
          throw error;
        }
        this.hydrateSaved();
        for (const entry of m.job?.accounts || []) {
          if (!Object.values(entry.progress || {}).some(p => p.key === record.key)) continue;
          updateProgress(m, entry);
          if (['done', 'partial', 'stopped'].includes(entry.status)) {
            entry.note = `${entry.confirmed}/${entry.requested} terverifikasi; ${entry.pending} menunggu pemeriksaan hasil; ${entry.remaining} belum dikerjakan.`;
            if (entry.status !== 'stopped') entry.status = entry.remaining && !entry.pending ? 'partial' : 'done';
          }
        }
        if (m.job) await m.checkpointJob(m.job); else await m.save();
        await m.closeSheets(record.serial).catch(() => {});
      });
      return { ...m.snapshot(), checking: false, message: record.reviewNote };
    } finally { m.previewPending = false; m.abortRequested = false; }
  }
  hydrateSaved() {
    const m = this.m, saved = m.state.resumableJob;
    if (!saved?.commentRunId || saved.commentMode !== 'new-per-job') return;
    for (const entry of saved.accounts) {
      entry.progress ||= {};
      for (let index = 0; index < entry.posts; index++) {
        const ref = entry.lockedPosts?.[index];
        const key = ref ? m.commentKey(saved, entry.username, ref.shortcode || `${entry.target}:index:${index}`) : undefined;
        entry.progress[index] ||= { index, requested: entry.comments, key, reason: 'Belum dikerjakan.' };
      }
      updateProgress(m, entry);
    }
  }
  migrate() {
    const m = this.m;
    this.hydrateSaved();
    for (const record of this.records()) {
      record.id ||= randomUUID();
      if (record.postRef || m.logPrefix === 'tt') continue;
      const candidates = (m.state.resumableJob?.accounts || []).flatMap(entry => Object.values(entry.progress || {}).filter(p =>
        p.key === record.key || m.state.counts[p.key]?.legacyKey === record.key
      ).map(p => ({ entry, index: p.index, key: p.key })));
      if (candidates.length !== 1) continue;
      const { entry, index, key } = candidates[0], ref = entry.lockedPosts?.[index];
      const legacyKey = record.legacyKey || m.state.counts[key]?.legacyKey;
      const fingerprint = legacyKey?.match(/:([a-f0-9]{64})(?:#\d+)?$/)?.[1];
      if (ref && fingerprint) Object.assign(record, { serial: entry.serial, targetInput: entry.target, postRef: structuredClone(ref), fingerprint });
    }
  }
}
