import { createHash } from 'node:crypto';

const channelId = /^UC[A-Za-z0-9_-]{22}$/;
const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const channelTabs = new Set(['featured', 'videos', 'shorts', 'streams', 'playlists', 'community', 'posts', 'about']);
const targetError = () => new Error('Target YouTube harus @handle atau URL channel YouTube; URL video dan playlist tidak didukung.');

function normalizeHandle(value) {
  const handle = value.replace(/^@/, '').normalize('NFC').toLowerCase();
  const length = [...handle].length;
  // Syntax checks only. Existence and script eligibility require live verification.
  // https://support.google.com/youtube/answer/11585688
  const hanOrHangul = /^[\p{Script=Han}\p{Script=Hangul}]+$/u.test(handle);
  const shortScript = /^[\p{Script=Ethiopic}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(handle);
  const min = hanOrHangul ? 1 : shortScript ? 2 : 3;
  const max = hanOrHangul ? 10 : shortScript ? 20 : 30;
  if (length < min || length > max || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}_.·-]*[\p{L}\p{M}\p{N}]$|^[\p{L}\p{N}]$/u.test(handle)) {
    throw new Error('Handle YouTube tidak valid. Gunakan @handle berisi huruf/angka dan pemisah . _ - atau · di bagian tengah.');
  }
  return `@${handle}`;
}

export function normalizeTarget(input) {
  if (typeof input !== 'string' || !input.trim()) throw targetError();
  const target = input.trim();
  if (/\s|\\/.test(target)) throw targetError();
  if (channelId.test(target)) return target;
  if (target.startsWith('@')) return normalizeHandle(target);

  const looksLikeUrl = target.includes('/') || /^[a-z][a-z\d+.-]*:/i.test(target) || /^(?:www\.|m\.)?youtube\.com(?:[?#]|$)/i.test(target);
  if (!looksLikeUrl) {
    if (target.startsWith('UC')) throw new Error('ID channel YouTube tidak valid: gunakan UC diikuti 22 karakter ID, atau masukkan @handle.');
    return normalizeHandle(target);
  }

  const source = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  // Inspect the original path before URL() can collapse literal or encoded dots.
  const match = source.match(/^https?:\/\/[^/?#]+(\/[^?#]*)(?:[?#].*)?$/i);
  if (!match || /%2f|%5c/i.test(match[1])) throw targetError();
  let decodedPath;
  try { decodedPath = decodeURIComponent(match[1]); }
  catch { throw targetError(); }
  if (/\\|\s|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(decodedPath)) throw targetError();
  let url;
  try { url = new URL(source); }
  catch { throw targetError(); }
  if (!['http:', 'https:'].includes(url.protocol) || !hosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new Error('Gunakan URL channel dari youtube.com, www.youtube.com, atau m.youtube.com.');
  }
  if (url.searchParams.has('v') || url.searchParams.has('list')) throw targetError();
  const path = decodedPath.replace(/\/$/, '').split('/').slice(1);
  if (path[0]?.startsWith('@') && (path.length === 1 || path.length === 2 && channelTabs.has(path[1]))) {
    return normalizeHandle(path[0]);
  }
  if (path[0] === 'channel' && (path.length === 2 || path.length === 3 && channelTabs.has(path[2]))) {
    if (!channelId.test(path[1])) throw new Error('ID channel YouTube tidak valid: gunakan UC diikuti 22 karakter ID.');
    return path[1];
  }
  throw targetError();
}

export function createFixtures(target) {
  const canonical = normalizeTarget(target);
  const key = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const captions = [
    'Simulasi: video prioritas untuk menguji aturan lewati pin (bukan hasil pembacaan YouTube).',
    'Simulasi: merawat tanaman dalam pot di rumah.',
    'Simulasi: menata meja kerja sederhana.',
    'Simulasi: video contoh dengan komentar dinonaktifkan.',
    'Simulasi: membuat sarapan dan menyusun daftar belanja.',
    'Simulasi: dokumentasi jalan pagi di taman.',
    'Simulasi: merapikan koleksi buku di rak.',
    'Simulasi: catatan kegiatan berkebun akhir pekan.',
  ];
  return captions.map((caption, index) => ({
    id: `youtube-demo-${key}-${index + 1}`,
    caption,
    // This flag exercises the shared skip rule; no YouTube pin UI is assumed.
    pinned: index === 0,
    commentsEnabled: index !== 3,
    existing: [0, 1, 0, 0, 2, 0, 1, 0][index],
    liked: index === 2 || index === 4,
  }));
}

export default {
  id: 'youtube',
  name: 'YouTube',
  item: 'video',
  action: 'komentar',
  targetHint: '@handle atau URL channel YouTube',
  normalizeTarget,
  createFixtures,
  sampleAccounts: [
    { username: 'demo_youtube_satu', displayName: 'Demo YouTube Satu (fiktif)' },
    { username: 'demo_youtube_dua', displayName: 'Demo YouTube Dua (fiktif)' },
  ],
  liveSupported: false,
  liveChecklist: [
    'Verifikasi akun Google/channel yang aktif dan perpindahan channel di aplikasi YouTube pada HP asli.',
    'Cocokkan @handle atau ID channel dengan channel tujuan serta identitas video sebelum bertindak.',
    'Verifikasi urutan video, Shorts, dan live; aturan pin di simulasi belum membuktikan dukungan pin pada profil YouTube.',
    'Baca status komentar dinonaktifkan, pembatasan video, dan status suka dari layar aplikasi yang sebenarnya.',
    'Uji pengetikan komentar, pengiriman, dan kemunculan komentar milik akun aktif tanpa menghitung status yang belum pasti sebagai berhasil.',
    'Uji tombol Stop, koneksi terputus, dan pencegahan komentar ganda pada satu HP sebelum uji perangkat lainnya.',
  ],
};
