// An old successful probe is evidence about that time, not the current route.
export function connectionStatus(info, now = Date.now()) {
  const checked = Date.parse(info?.checkedAt);
  const valid = Number.isFinite(checked) && checked <= now;
  const minutes = valid ? Math.floor((now - checked) / 60000) : null;
  const stale = !valid || now - checked >= 5 * 60000;
  const age = !valid ? 'Waktu pemeriksaan belum tersedia' : minutes < 1 ? 'Diperiksa kurang dari 1 menit lalu' : `Diperiksa ${minutes} menit lalu`;
  let message = 'Internet belum diperiksa';
  if (info?.state === 'checking') message = 'Memeriksa internet…';
  else if (info?.state === 'restoring') message = 'Menerapkan / memulihkan koneksi…';
  else if (info?.state === 'online') message = valid ? 'Internet tersedia saat pemeriksaan terakhir' : 'Hasil internet belum bertanggal';
  else if (info?.state === 'offline') message = info.message || 'Internet tidak tersedia saat pemeriksaan terakhir';
  return { message, age, stale, warning: stale && !['checking', 'restoring'].includes(info?.state) ? 'Perlu pemeriksaan baru' : '' };
}
