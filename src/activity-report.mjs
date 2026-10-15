// Presentation only: never changes the job, delivery history, or retry policy.
const count = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const failedStates = new Set(['failed', 'blocked', 'network']);

export function accountReport(account = {}) {
  const pending = count(account.pending), missed = count(account.missed), remaining = count(account.remaining);
  const failed = failedStates.has(account.status);
  const needsReview = failed || pending > 0 || missed > 0 || remaining > 0;
  let label = ({ waiting: 'Menunggu giliran', running: 'Berjalan', paused: 'Dijeda',
    done: 'Pemrosesan berakhir', stopped: 'Dihentikan', blocked: 'Dibatasi platform',
    network: 'Perlu pemeriksaan', deferred: 'Tertunda karena koneksi/loading', partial: 'Kuota belum terpenuhi', failed: 'Terkendala',
    needs_action: 'Perlu tindakan manual di HP' })[account.status] || 'Status belum diketahui';
  if (account.status === 'done' && needsReview) label = pending ? 'Hasil belum pasti' : 'Perlu pemeriksaan';
  const originalNote = account.note || '';
  let explanation = originalNote;
  if (/tidak lagi login di HP ini/.test(originalNote)) explanation = 'Akun belum ditemukan oleh pemeriksaan. Status logout atau banned belum terbukti.';
  else if (/Akun pada kolom komentar tidak cocok atau sudah ada draft/.test(originalNote)) explanation = 'Identitas akun atau keadaan kolom komentar belum terverifikasi. Pesan lama belum membedakan penyebabnya.';
  else if (/Kolom komentar belum termuat/.test(originalNote)) explanation = 'Kolom masukan komentar belum terdeteksi. Penyebabnya belum dipastikan.';
  else if (/postingan terlewat karena jaringan/.test(originalNote)) explanation = originalNote.replace(/postingan terlewat karena jaringan/g, 'postingan tidak diproses; penyebab belum dipastikan');
  return { pending, missed, remaining, requested: count(account.requested), confirmed: count(account.confirmed), failed, needsReview, label, explanation, originalNote,
    sent: count(account.sent), skipped: count(account.skipped), liked: count(account.liked),
    saved: count(account.saved), reposted: count(account.reposted), shared: count(account.shared),
    saved: count(account.saved), reposted: count(account.reposted), shared: count(account.shared),
    tone: needsReview ? 'review' : ['done', 'stopped'].includes(account.status) ? 'ended' : account.status };
}

export function jobReport(job) {
  if (!job) return { label: 'Belum berjalan', sent: 0, skipped: 0, missed: 0, pending: 0, remaining: 0, requested: 0, confirmed: 0, failed: 0, reviewAccounts: 0, pendingAccounts: 0 };
  const reports = (job.accounts || []).map(accountReport);
  const sum = key => reports.reduce((n, r) => n + r[key], 0);
  const failed = Math.max(count(job.failed), reports.filter(r => r.failed).length);
  const pending = sum('pending'), missed = sum('missed'), remaining = sum('remaining');
  let label = ({ running: 'Berjalan', stopping: 'Menghentikan…', stopped: 'Dihentikan', completed: 'Pemrosesan berakhir', completed_with_errors: 'Berakhir dengan kendala', failed: 'Gagal' })[job.status] || 'Status belum diketahui';
  if (['completed', 'completed_with_errors'].includes(job.status) && (failed || pending || missed || remaining)) label = 'Berakhir; perlu pemeriksaan';
  return { label, sent: Number.isFinite(job.sent) ? count(job.sent) : sum('sent'),
    skipped: Number.isFinite(job.skipped) ? count(job.skipped) : sum('skipped'),
    missed, pending, remaining, requested: sum('requested'), confirmed: sum('confirmed'), failed, reviewAccounts: reports.filter(r => r.needsReview).length,
    pendingAccounts: reports.filter(r => r.pending > 0).length };
}
