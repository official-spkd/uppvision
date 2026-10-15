import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Link2, Copy, Check, RefreshCw, AlertTriangle, Smartphone } from 'lucide-react';
import { MAX_LINKS } from './instagram-target.mjs';

// Menu "Ambil link postingan": membaca beberapa postingan terbaru sebuah channel lalu menyalin
// tautannya supaya bisa ditempel ke kolom target Auto komen. Menu ini tidak menyukai, menyimpan,
// membagikan, atau mengomentari apa pun - hanya membaca dan menyalin.
export default function InstagramLinks({ api, state, devices, busy, onBack, onError, notify, stop }) {
  const [serial, setSerial] = useState('');
  const [target, setTarget] = useState('');
  const [count, setCount] = useState('6');
  const [periksa, setPeriksa] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [disalin, setDisalin] = useState(false);
  const terhubung = useMemo(() => (devices || []).filter(d => d.status === 'device' && !d.serial.startsWith('emulator-')), [devices]);
  useEffect(() => { if (!terhubung.some(d => d.serial === serial)) setSerial(terhubung[0]?.serial || ''); }, [terhubung, serial]);
  const hp = terhubung.find(d => d.serial === serial) || null;
  const terpindai = (state.devices || []).find(d => d.serial === serial) || null;
  const akun = terpindai?.current || (terpindai?.accounts || []).find(a => a.active)?.username || '';
  const links = result?.links || [], dibuang = result?.dropped || [];
  const teks = links.join('\n');
  const jumlah = Number(count);
  const siap = Boolean(serial && target.trim() && Number.isInteger(jumlah) && jumlah >= 1 && jumlah <= MAX_LINKS && !running);

  const ambil = async () => {
    setError(''); setResult(null); setDisalin(false); setRunning(true);
    try { setResult(await api('/api/ig/links', { method: 'POST', body: JSON.stringify({ serial, target: target.trim(), count: jumlah, verify: periksa }) })); }
    catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };
  const salin = async () => {
    try { await navigator.clipboard.writeText(teks); setDisalin(true); notify(`${links.length} link disalin. Tempel di kolom target Auto komen.`); }
    catch { setError('Tidak bisa menyalin otomatis. Pilih teksnya lalu salin manual.'); }
  };

  return <div className="ig-comment">
    <div className="ig-subheading"><button className="text-link" onClick={onBack}><ArrowLeft size={15} /> Kembali ke Instagram</button><span className="tiny-badge">AMBIL LINK</span></div>
    <section className="settings-card">
      <span className="ig-icon"><Link2 size={26} /></span>
      <h2>Ambil link postingan terbaru</h2>
      <p className="ig-upload-note">Script membuka profil channel target di HP yang kamu pilih, melewati postingan yang disematkan, lalu menyalin tautan sejumlah postingan terbaru. Hasilnya tinggal disalin ke kolom target Auto komen. Menu ini tidak mengirim like, simpan, repost, share, atau komentar.</p>
      <div className="ig-plan-fields">
        <label>HP yang dipakai<select value={serial} onChange={e => setSerial(e.target.value)} disabled={busy || running} aria-label="HP pengambil link">{terhubung.length ? terhubung.map(d => <option key={d.serial} value={d.serial}>{d.name || d.serial}</option>) : <option value="">Tidak ada HP terhubung</option>}</select></label>
        <label>Channel target<input value={target} onChange={e => setTarget(e.target.value)} placeholder="@username_channel" disabled={busy || running} aria-label="Channel target" /><span className="ig-hint">{akun ? `Membaca profil memakai akun @${akun} yang sedang login di HP ini.` : 'Belum ada akun Instagram yang terbaca di HP ini; pindai akun dulu.'}</span></label>
        <label>Berapa link<input type="number" min={1} max={MAX_LINKS} value={count} onChange={e => setCount(e.target.value)} disabled={busy || running} aria-label="Jumlah link" /><span className="ig-hint">Postingan terbaru non-pin, maksimal {MAX_LINKS}.</span></label>
      </div>
      <label className="ig-check"><input type="checkbox" checked={periksa} onChange={e => setPeriksa(e.target.checked)} disabled={busy || running} /><span>Tiap link dibuka sekali lagi untuk memastikan cocok dengan postingan yang dimaksud. Lebih lambat, tapi tautan yang bergeser tidak lolos.</span></label>
      <div className="ig-actions">
        <button type="button" className="button primary" disabled={busy || running || !siap} onClick={ambil}>{running ? <><RefreshCw size={14} className="spin" /> Mengambil link…</> : <><Link2 size={14} /> Ambil link</>}</button>
        {running && <span className="ig-hint">Satu postingan butuh belasan detik: dibuka, disalin, lalu diperiksa. Jangan tinggalkan halaman ini.</span>}
      </div>
      {error && <span className="ig-error" role="alert">{error}</span>}
    </section>
    {(links.length > 0 || dibuang.length > 0) && <section className="settings-card">
      <h3>{links.length} link siap dipakai</h3>
      {dibuang.length > 0 && <p className="ig-warning" role="alert"><AlertTriangle size={14} /> {dibuang.length} link dibuang karena tidak cocok dengan postingan yang dimaksud (urutan ke-{dibuang.map(d => d.index + 1).join(', ')}). Jalankan sekali lagi bila perlu.</p>}
      {links.length > 0 && <>
        <textarea className="ig-links" value={teks} readOnly rows={Math.min(20, links.length)} aria-label="Daftar link" onFocus={e => e.target.select()} />
        <div className="ig-actions">
          <button type="button" className="button primary" onClick={salin}>{disalin ? <><Check size={14} /> Tersalin</> : <><Copy size={14} /> Salin semua</>}</button>
          <span className="ig-hint"><Smartphone size={13} /> Tempel satu link per baris di kolom target Auto komen.</span>
        </div>
      </>}
    </section>}
  </div>;
}
