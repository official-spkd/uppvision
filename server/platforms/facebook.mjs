import { createHash } from 'node:crypto';

const origin = 'https://www.facebook.com';
const hosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com']);
const reserved = new Set(['groups', 'posts', 'reel', 'reels', 'watch', 'videos', 'photo', 'photos', 'photo.php', 'story.php', 'share', 'sharer', 'sharer.php', 'events', 'marketplace', 'gaming', 'login', 'login.php', 'home.php', 'pages', 'people', 'settings', 'search', 'help']);
const tracking = key => ['ref', 'refid', 'mibextid', 'locale', 'sk', 'fref'].includes(key) || /^utm_[a-z_]+$/.test(key);

/** Local validation only: syntax only; a URL cannot prove Page type. Live inspection must verify explicit Page metadata. */
export function normalizeTarget(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Isi username Halaman atau URL Halaman Facebook.');
  let value = input.trim();
  if (/\s|\\/.test(value)) throw new Error('Target Facebook tidak boleh berisi spasi atau garis miring terbalik.');
  if (value.startsWith('@')) value = value.slice(1);
  if (/^(?:(?:www|m|mbasic)\.)?facebook\.com(?:\/|$)/i.test(value)) value = `https://${value}`;
  else if (/^profile\.php(?:\?|$)/i.test(value)) value = `${origin}/${value}`;
  else if (!value.includes('/') && !value.includes(':') && !/[?#]/.test(value)) value = `${origin}/${value}`;

  let url;
  try { url = new URL(value); } catch { throw new Error('Format target Facebook tidak valid. Gunakan username Halaman atau URL Halaman.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new Error('Gunakan URL Halaman pada domain facebook.com; profil pribadi tidak didukung.');
  }
  // Reject ambiguous encoded paths and path traversal before URL normalization can hide them.
  const rawPath = value.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0];
  if (/%|(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) throw new Error('Path target Facebook tidak valid.');
  const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (path.toLowerCase() === 'profile.php') {
    const ids = url.searchParams.getAll('id');
    if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) throw new Error('URL profile.php harus berisi satu id Facebook berupa angka positif.');
    if ([...url.searchParams.keys()].some(key => key !== 'id' && !tracking(key))) throw new Error('Gunakan URL Halaman Facebook, bukan profil pribadi, postingan atau komentar.');
    return `${origin}/profile.php?id=${ids[0]}`;
  }
  if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(path) || reserved.has(path.toLowerCase())) {
    throw new Error('Gunakan username Halaman atau URL Halaman Facebook; profil pribadi, grup dan tautan postingan belum didukung.');
  }
  if ([...url.searchParams.keys()].some(key => !tracking(key))) throw new Error('Gunakan URL Halaman Facebook tanpa parameter postingan.');
  return `${origin}/${path.toLowerCase()}`;
}

export function createFixtures(target) {
  const canonical = normalizeTarget(target);
  const prefix = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const captions = [
    'Simulasi: pengumuman jadwal kegiatan komunitas minggu ini.',
    'Simulasi: tips merawat tanaman di halaman rumah.',
    'Simulasi: dokumentasi kegiatan membaca bersama.',
    'Simulasi: album perjalanan singkat ke taman kota.',
    'Simulasi: berbagi ide menu sarapan sederhana.',
    'Simulasi: rangkuman kegiatan lokakarya kerajinan.',
    'Simulasi: persiapan acara berbagi buku akhir pekan.',
    'Simulasi: catatan pengalaman menanam sayuran.',
  ];
  return captions.map((caption, index) => ({
    id: `facebook-demo-${prefix}-${index + 1}`,
    caption,
    pinned: index === 0,
    commentsEnabled: index !== 3,
    existing: [0, 1, 2, 0, 0, 3, 1, 0][index],
    liked: index === 2 || index === 5,
  }));
}

export default {
  id: 'facebook',
  name: 'Facebook',
  item: 'postingan',
  action: 'komentar',
  targetHint: 'Username atau URL Halaman Facebook (bukan profil pribadi)',
  targetType: 'page',
  requiresLivePageVerification: true,
  normalizeTarget,
  createFixtures,
  sampleAccounts: [
    { username: 'demo.facebook.satu', displayName: 'Demo Facebook Satu' },
    { username: 'demo.facebook.dua', displayName: 'Demo Facebook Dua' },
  ],
  liveSupported: false,
  liveChecklist: [
    'Pastikan aplikasi Facebook terpasang dan akun yang dipilih benar pada satu HP uji.',
    'Buktikan target merupakan Halaman melalui metadata Page di layar asli; format URL saja tidak membuktikan jenis akun.',
    'Periksa pembacaan postingan, caption, postingan pin, dan status komentar yang dinonaktifkan.',
    'Periksa jumlah komentar baru per pekerjaan tanpa menghitung komentar lama; retry hanya melanjutkan sisa kuota pekerjaan yang sama.',
    'Periksa status suka, pengisian komentar, serta bukti kiriman muncul pada postingan yang benar.',
    'Uji Stop, putus sambungan, pemulihan proses, dan pergantian akun tanpa kiriman ganda.',
  ],
};
