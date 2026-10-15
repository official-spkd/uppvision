import test from 'node:test';
import assert from 'node:assert/strict';
import { accountReport, jobReport } from '../src/activity-report.mjs';
import { connectionStatus } from '../src/connection-status.mjs';

test('a finished account with zero confirmed and three uncertain results is never presented as success', () => {
  const account = Object.freeze({ status: 'done', sent: 0, pending: 3, missed: 0 });
  const r = accountReport(account);
  assert.equal(r.label, 'Hasil belum pasti');
  assert.equal(r.tone, 'review');
  assert.equal(r.sent, 0);
  assert.equal(r.pending, 3);
  assert.equal(r.needsReview, true);
});

test('audit-sized mixed results preserve uncertainty and separate missed posts from quota skips', () => {
  const accounts = [
    ...Array.from({ length: 8 }, () => ({ status: 'done', sent: 9 })),
    ...Array.from({ length: 2 }, () => ({ status: 'done', sent: 0, pending: 3 })),
    ...Array.from({ length: 9 }, () => ({ status: 'done', sent: 3, pending: 2 })),
    ...Array.from({ length: 2 }, () => ({ status: 'done', sent: 6, pending: 1 })),
    ...Array.from({ length: 3 }, () => ({ status: 'failed', sent: 0 })),
    ...Array.from({ length: 3 }, () => ({ status: 'failed', sent: 6 })),
    { status: 'running', missed: 1 },
  ].map(Object.freeze);
  const job = Object.freeze({ status: 'running', sent: 129, failed: 6, skipped: 0, accounts: Object.freeze(accounts) });
  const before = JSON.stringify(job), r = jobReport(job);
  assert.equal(r.label, 'Berjalan');
  assert.equal(r.sent, 129); assert.equal(r.failed, 6);
  assert.equal(r.pending, 26); assert.equal(r.pendingAccounts, 13);
  assert.equal(r.missed, 1); assert.equal(r.skipped, 0); assert.equal(r.reviewAccounts, 20);
  assert.equal(JSON.stringify(job), before);
});

test('completed, stopped and still-running jobs retain their different lifecycle states', () => {
  const accounts = [{ status: 'done', pending: 1 }];
  assert.equal(jobReport({ status: 'completed', accounts }).label, 'Berakhir; perlu pemeriksaan');
  assert.equal(jobReport({ status: 'completed', accounts: [] }).label, 'Pemrosesan berakhir');
  assert.equal(jobReport({ status: 'stopped', accounts }).label, 'Dihentikan');
  assert.equal(jobReport({ status: 'stopping', accounts }).label, 'Menghentikan…');
  assert.equal(accountReport({ status: 'running', missed: 1 }).label, 'Berjalan');
  assert.equal(accountReport({ status: 'done', missed: 2 }).label, 'Perlu pemeriksaan');
  assert.equal(accountReport({ status: 'done', skipped: 3 }).label, 'Pemrosesan berakhir');
});

test('ambiguous legacy errors retain original evidence without asserting logout, a draft or network failure', () => {
  for (const [note, phrase] of [
    ['@example tidak lagi login di HP ini.', 'Status logout atau banned belum terbukti'],
    ['Akun pada kolom komentar tidak cocok atau sudah ada draft. Proses dihentikan.', 'belum membedakan penyebabnya'],
    ['Kolom komentar belum termuat.', 'Penyebabnya belum dipastikan'],
    ['2 postingan terlewat karena jaringan · 1 komentar menunggu dicocokkan ulang', 'penyebab belum dipastikan'],
  ]) {
    const r = accountReport({ status: 'failed', note });
    assert.equal(r.originalNote, note); assert.ok(r.explanation.includes(phrase));
  }
  assert.equal(accountReport({ status: 'blocked', note: 'Dibatasi platform.' }).explanation, 'Dibatasi platform.');
});

test('missing legacy fields and invalid counters cannot produce NaN or negative totals', () => {
  assert.equal(jobReport(null).label, 'Belum berjalan');
  const r = jobReport({ status: 'completed', accounts: [{ status: 'network', sent: 2 }, { status: 'done', pending: -2, missed: NaN }] });
  assert.equal(r.sent, 2); assert.equal(r.failed, 1); assert.equal(r.pending, 0); assert.equal(r.missed, 0);
  assert.equal(r.label, 'Berakhir; perlu pemeriksaan');
});

const now = Date.parse('2026-10-12T02:30:00Z');
const probe = (minutes, state = 'online') => ({ state, checkedAt: new Date(now - minutes * 60000).toISOString() });
test('an old online probe is explicitly stale and never presented as current connectivity', () => {
  const r = connectionStatus(probe(36), now);
  assert.equal(r.message, 'Internet tersedia saat pemeriksaan terakhir');
  assert.equal(r.age, 'Diperiksa 36 menit lalu'); assert.equal(r.stale, true);
  assert.equal(r.warning, 'Perlu pemeriksaan baru');
  assert.equal(connectionStatus(probe(4), now).stale, false);
  assert.equal(connectionStatus(probe(5), now).stale, true);
});

test('missing, malformed and future probe timestamps do not become fresh successful checks', () => {
  for (const checkedAt of [undefined, 'invalid', new Date(now + 60000).toISOString()]) {
    const r = connectionStatus({ state: 'online', checkedAt }, now);
    assert.equal(r.stale, true); assert.equal(r.age, 'Waktu pemeriksaan belum tersedia');
    assert.equal(r.message, 'Hasil internet belum bertanggal');
  }
  assert.equal(connectionStatus(undefined, now).message, 'Internet belum diperiksa');
});

test('an active check or recovery does not show an obsolete online state', () => {
  assert.equal(connectionStatus(probe(10, 'checking'), now).message, 'Memeriksa internet…');
  const r = connectionStatus(probe(10, 'restoring'), now);
  assert.equal(r.message, 'Menerapkan / memulihkan koneksi…'); assert.equal(r.warning, '');
  assert.equal(connectionStatus(probe(0, 'offline'), now).message, 'Internet tidak tersedia saat pemeriksaan terakhir');
});

test('a short quota and deferred loading are never presented as a completed quota',()=>{
  const account={status:'partial',sent:1,confirmed:1,requested:3,remaining:2,pending:0};
  const report=accountReport(account);
  assert.equal(report.label,'Kuota belum terpenuhi');assert.equal(report.remaining,2);assert.equal(report.needsReview,true);
  const job=jobReport({status:'completed',accounts:[account]});
  assert.equal(job.label,'Berakhir; perlu pemeriksaan');assert.equal(job.confirmed,1);assert.equal(job.requested,3);
  assert.equal(accountReport({...account,status:'deferred'}).label,'Tertunda karena koneksi/loading');
});
