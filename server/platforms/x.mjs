const invalid = () => new Error('Gunakan @username X atau URL profil x.com/twitter.com, bukan tautan postingan.');
export function normalizeTarget(value) {
  if (typeof value !== 'string') throw invalid();
  let name = value.trim();
  if (/\s|\\/.test(name)) throw invalid();
  if (/^(https?:\/\/|(?:www\.|mobile\.)?(?:x|twitter)\.com\/)/i.test(name)) {
    const source = /^https?:\/\//i.test(name) ? name : `https://${name}`;
    // Validate the unparsed path: URL() otherwise collapses traversal segments.
    const match = source.match(/^https?:\/\/[^/?#]+(\/[^?#]*)(?:[?#].*)?$/i);
    if (!match || !/^\/@?[a-z0-9_]{1,15}\/?$/i.test(match[1])) throw invalid();
    let url;
    try { url = new URL(source); } catch { throw invalid(); }
    if (!['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) throw invalid();
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) throw invalid();
    name = parts[0];
  }
  name = name.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(name) || ['home', 'explore', 'search', 'settings', 'notifications', 'messages', 'compose', 'i', 'intent', 'login', 'signup'].includes(name.toLowerCase())) throw invalid();
  return name.toLowerCase();
}
export function createFixtures(target) {
  const name = normalizeTarget(target);
  return [
    ['Panduan kegiatan komunitas (contoh disematkan).', true, true, 0, false],
    ['Kegiatan membaca bersama di perpustakaan lingkungan.', false, true, 1, true],
    ['Kelas memasak memperkenalkan resep masakan rumahan.', false, true, 0, false],
    ['Pengumuman jadwal latihan musik (balasan ditutup).', false, false, 0, false],
    ['Pameran karya seni dari peserta kelas menggambar.', false, true, 0, false],
    ['Tips merawat tanaman di halaman rumah.', false, true, 2, true],
    ['Lokakarya fotografi untuk pemula akhir pekan ini.', false, true, 0, false],
  ].map(([caption, pinned, commentsEnabled, existing, liked], index) => ({ id: `x:${name}:demo-${index + 1}`, caption: `[SIMULASI] ${caption}`, pinned, commentsEnabled, existing, liked }));
}
export default {
  id: 'x', name: 'X', item: 'postingan', action: 'balasan', targetHint: '@username atau URL profil X',
  normalizeTarget, createFixtures, liveSupported: false,
  sampleAccounts: [{ username: 'demo_x_satu', displayName: 'Akun contoh X 1' }, { username: 'demo_x_dua', displayName: 'Akun contoh X 2' }],
  liveChecklist: ['Baca akun aktif dan pemilih akun di aplikasi X pada HP.', 'Verifikasi profil target, identitas postingan, dan penanda pin.', 'Verifikasi tombol suka, kolom balasan, serta batas balasan pada akun uji.', 'Uji draft tanpa kirim, lalu uji kiriman berizin dan cocokkan hasilnya.'],
};
