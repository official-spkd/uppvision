// Offline-only examples. These records are never observations of a real account.
const targetError = () => new Error('Target Threads harus berupa @username atau URL profil threads.net/@username / threads.com/@username. URL postingan tidak didukung.');

export function normalizeTarget(input) {
  if (typeof input !== 'string') throw targetError();
  let value = input.trim();
  if (!value) throw targetError();

  if (/^(?:www\.)?threads\.(?:net|com)\//i.test(value)) value = `https://${value}`;
  if (/^https?:\/\//i.test(value)) {
    // Match the original path, before URL parsing can collapse traversal segments.
    const match = value.match(/^https?:\/\/(?:www\.)?threads\.(?:net|com)\/(@[a-z0-9_.]+)\/?(?:[?#][^\s]*)?$/i);
    if (!match) throw targetError();
    value = match[1];
  }

  const username = value.replace(/^@/, '');
  if (!/^[a-z0-9_.]+$/i.test(username) || !/[a-z0-9_]/i.test(username)) throw targetError();
  return username.toLowerCase();
}

export function createFixtures(target) {
  const username = normalizeTarget(target);
  return [
    { caption: '[SIMULASI] Catatan pengantar yang disematkan.', pinned: true, commentsEnabled: true, existing: 0, liked: false },
    { caption: '[SIMULASI] Merapikan meja kerja untuk akhir pekan.', pinned: false, commentsEnabled: true, existing: 0, liked: false },
    { caption: '[SIMULASI] Catatan membaca buku hari ini.', pinned: false, commentsEnabled: true, existing: 1, liked: true },
    { caption: '[SIMULASI] Foto tanaman di dekat jendela; balasan dinonaktifkan.', pinned: false, commentsEnabled: false, existing: 0, liked: false },
    { caption: '[SIMULASI] Berbagi ide menu sarapan sederhana.', pinned: false, commentsEnabled: true, existing: 2, liked: false },
    { caption: '[SIMULASI] Menyusun daftar kegiatan akhir pekan.', pinned: false, commentsEnabled: true, existing: 0, liked: true },
    { caption: '[SIMULASI] Hasil latihan menggambar bentuk sederhana.', pinned: false, commentsEnabled: true, existing: 0, liked: false },
    { caption: '[SIMULASI] Catatan perjalanan singkat ke taman.', pinned: false, commentsEnabled: true, existing: 1, liked: false },
  ].map((post, index) => ({ id: `threads:sim:${username}:${index + 1}`, ...post }));
}

export const liveChecklist = [
  'Sambungkan satu HP uji dan pastikan Threads dapat dibuka serta akun aktif dibaca dari layar aplikasi.',
  'Periksa navigasi ke profil target dan identitas postingan menggunakan tampilan Threads di HP tersebut.',
  'Buktikan deteksi postingan disematkan dan pembatasan balasan sebelum memilih postingan.',
  'Buktikan jumlah balasan baru per pekerjaan tanpa menghitung balasan lama; status suka yang sudah aktif tetap dipertahankan.',
  'Uji satu balasan pada target uji yang diizinkan, lalu pastikan balasan tampil kembali setelah pemuatan ulang; pengetikan atau ketukan kirim belum membuktikan keberhasilan.',
  'Uji tombol Stop, pergantian akun, koneksi terputus, dan kelanjutan proses tanpa menggandakan balasan.',
];

export default {
  id: 'threads',
  name: 'Threads',
  item: 'postingan',
  action: 'balasan',
  targetHint: '@username atau URL profil Threads',
  normalizeTarget,
  createFixtures,
  sampleAccounts: [
    { username: 'demo_threads_satu', displayName: 'Demo Threads Satu (fiktif)' },
    { username: 'demo_threads_dua', displayName: 'Demo Threads Dua (fiktif)' },
  ],
  liveSupported: false,
  liveChecklist,
};
