import { username, byId, center, validUsername } from './instagram-core.mjs';

export function validateLogin(body) {
  if (!Array.isArray(body?.accounts) || !body.accounts.length || body.accounts.length > 100) throw new Error('Isi 1–100 akun untuk login.');
  const seen = new Set();
  return body.accounts.map(account => {
    const name = username(account?.username);
    if (seen.has(name)) throw new Error('Ada username duplikat dalam daftar login.');
    seen.add(name);
    if (typeof account.password !== 'string' || !account.password.length || account.password.length > 128 || /[^\x20-\x7e]/.test(account.password)) throw new Error('Password harus berisi 1–128 karakter Latin, angka, atau simbol.');
    return { username: name, password: account.password };
  });
}

const label = n => `${n.text || ''} ${n['content-desc'] || ''}`.trim();
export function savedPasswordPrompt(nodes) {
  const text = nodes.map(label).join(' ').replace(/\s+/g, ' ');
  return /sign in to Instagram with your saved password/i.test(text) && /cancel/i.test(text);
}
// OCR fallback is restricted to declining the known post-login save prompt.
// It never types credentials, accepts permissions, or completes verification.
export function saveLoginDismiss(frame, expectedUsername) {
  if (!frame?.width || !frame?.height || !Array.isArray(frame.nodes) || !validUsername(expectedUsername)) return null;
  const nodes = frame.nodes.filter(n => n.confidence >= .85);
  const text = nodes.map(label).join(' ').toLowerCase();
  const names = text.match(/[a-z0-9_][a-z0-9_.]*/g) || [];
  if (!names.some(n => n.replace(/\.+$/, '') === expectedUsername.toLowerCase()) || loginProblem(frame.nodes)) return null;
  const title = nodes.find(n => /^save your login info\s*\??$/i.test(n.text.trim()));
  const save = nodes.find(n => /^save$/i.test(n.text.trim()));
  const dismiss = nodes.find(n => /^not now$/i.test(n.text.trim()));
  if (!title || !save || !dismiss) return null;
  try {
    const [x,y] = center(dismiss), [,saveY] = center(save), [,titleY] = center(title);
    return titleY < frame.height*.4 && saveY > frame.height*.6 && y > saveY && y < frame.height && Math.abs(x-frame.width/2) < frame.width*.2 ? dismiss : null;
  } catch { return null; }
}
export const loginButton = (nodes, expression) => nodes.find(n => n.enabled !== 'false' && (expression.test(n.text || '') || expression.test(n['content-desc'] || '')));export function loginNavigation(nodes) {
  const existing = loginButton(nodes, /^(log into existing account|log in to existing account|login ke akun yang sudah ada|masuk ke akun yang (?:sudah )?ada)$/i);
  const other = loginButton(nodes, /^(use another (?:account|profile)|gunakan (?:akun|profil) lain|log into another account|log in to another account|login ke akun lain|switch accounts|beralih akun)$/i);
  const enter = loginButton(nodes, /^(log in|login|masuk)$/i);
  const add = loginButton(nodes, /^(add (?:Instagram(?: account)?|account)|tambahkan akun(?: Instagram)?|tambah akun(?: Instagram)?)$/i);
  return existing || other || enter || add;
}
export function loginFields(nodes) {
  const fields = nodes.filter(n => /EditText$/.test(n.class || ''));
  const password = fields.find(n => n.password === 'true' || /password|kata sandi/i.test(`${n['resource-id']} ${label(n)}`));
  const user = fields.find(n => n !== password && /username|email|phone|pengguna|telepon|ponsel/i.test(`${n['resource-id']} ${label(n)}`)) || (password ? fields.find(n => n !== password) : null);
  return { user, password };
}
export function loggedOutScreen(nodes) {
  if (byId(nodes, 'profile_tab') || loginButton(nodes, /^(dismiss|tutup)$/i)) return false;
  const fields = loginFields(nodes);
  return Boolean(fields.password || loginButton(nodes, /^(log in|login|masuk|use another account|gunakan akun lain|log into another account|login ke akun lain)$/i));
}
// Instagram menampilkan dialog "Error: You've been logged out of <akun>" saat sebuah akun ter-log out.
// Dialog ini MEMBLOKIR pemilih akun, jadi dibiarkan satu akun bisa menjatuhkan SEMUA akun di HP itu.
// Hanya tombol utama (OK) yang dipakai untuk menutupnya.
const LOGGED_OUT_BODY = /(?:you'?ve been logged out of|you are logged out of|you'?ve been logged out|anda (?:telah )?keluar dari akun)\s+@?([a-zA-Z0-9_.]+)/i;
export function loggedOutDialog(nodes) {
  const body = nodes.find(n => /(?:^|\/)igds_headline_body$/.test(n['resource-id'] || '') && LOGGED_OUT_BODY.test(n.text || ''));
  if (!body) return null;
  // Kalimatnya berakhir dengan titik ("logged out of tv.nalarberita."), dan titik itu ikut
  // tertangkap karena titik adalah karakter sah pada username. Buang titik di ujungnya.
  const name = (body.text || '').match(LOGGED_OUT_BODY)?.[1]?.replace(/\.+$/, '');
  const dismiss = nodes.find(n => /(?:^|\/)primary_button$/.test(n['resource-id'] || '') && /^(?:ok|oke|tutup|close)$/i.test((n.text || n['content-desc'] || '').trim()));
  return { username: name && validUsername(name) ? name.toLowerCase() : null, dismiss: dismiss || null };
}
export function loginProblem(nodes) {
  // Do not echo screen text: it may contain a credential or recovery information.
  const text = nodes.filter(n => !/EditText$/.test(n.class || '')).map(label).join('\n');
  if (/scheduled to be deleted|cancel the deletion|reactivate|dijadwalkan.*dihapus|aktifkan kembali/i.test(text)) return { status: 'needs_action', note: 'Instagram meminta reaktivasi akun. Pengaktifan kembali dapat membatalkan penghapusan; perlu keputusan pemilik akun.' };
  if (/recover your account|login info is no longer connected to an account|pulihkan akun/i.test(text)) return { status: 'needs_action', recoverable: true, note: 'Instagram meminta pemulihan akun karena informasi login tidak lagi terhubung. Periksa akun secara manual.' };
  if (/incorrect password|wrong password|password (?:you entered|was incorrect)|kata sandi (?:salah|yang .*salah)|password salah/i.test(text)) return { status: 'failed', note: 'Password ditolak Instagram. Tidak dicoba ulang otomatis.' };
  if (/couldn['’]t find (?:your|an) account|can['’]t find (?:an )?account|could not find.*account|found one that closely matches|username.*doesn't belong|akun.*tidak ditemukan/i.test(text)) return { status: 'failed', note: 'Akun tidak ditemukan oleh Instagram. Saran username lain tidak dipilih otomatis.' };
  if (/suspended|disabled your account|account.*disabled|akun.*ditangguhkan|akun.*dinonaktifkan/i.test(text)) return { status: 'needs_action', note: 'Instagram menampilkan akun ditangguhkan/nonaktif. Periksa di HP.' };
  if (/enter the characters you see|real human behind this login|captcha/i.test(text)) return { status: 'needs_action', note: 'Instagram meminta CAPTCHA. Selesaikan secara manual di HP, lalu pindai akun lagi.' };
  if (/security code|authentication code|login code|confirmation code|two.factor|6.digit code|check your (?:email|notifications)|approve.*login|confirm.*(?:identity|it.s you|your account)|kode (?:keamanan|autentikasi|konfirmasi|login)|autentikasi dua|periksa (?:email|notifikasi)|konfirmasi.*(?:identitas|ini Anda|akun)|video selfie/i.test(text)) return { status: 'needs_action', note: 'Instagram meminta verifikasi. Selesaikan di HP, lalu pindai akun lagi.' };
  if (/try again later|please wait a few minutes|too many attempts|coba lagi nanti|tunggu beberapa menit/i.test(text)) return { status: 'needs_action', note: 'Instagram membatasi percobaan login. Proses akun ini dihentikan.' };
  return null;
}

export function loginCandidates(inventory, live, excluded = new Set()) {
  const online = new Set(live.filter(d => d.status === 'device' && !d.serial.startsWith('emulator-')).map(d => d.serial));
  return inventory.filter(d => online.has(d.serial) && !excluded.has(d.serial) && !d.error && d.complete === true)
    .sort((a, b) => a.accounts.length - b.accounts.length || a.name.localeCompare(b.name) || a.serial.localeCompare(b.serial));
}
