import React, { useState } from 'react';
import { ArrowLeft, LogIn, Plus, Trash2, Square, Eye, Smartphone } from 'lucide-react';

const empty = () => ({ username: '', password: '' });
const labels = { waiting: 'Menunggu', running: 'Login…', success: 'Berhasil', already: 'Sudah login', needs_action: 'Perlu tindakan', failed: 'Belum berhasil', not_attempted: 'Belum dicoba', stopped: 'Dihentikan' };
export default function InstagramLogin({ api, state, setState, devices, busy, bridgeOnline, onBack, onError, openDevice, stop }) {
  const [rows, setRows] = useState([empty()]), [starting, setStarting] = useState(false);
  const job = state.loginJob, running = ['scanning', 'running', 'stopping'].includes(job?.status);
  const finished = job?.accounts.filter(a => !['waiting', 'running', 'stopped', 'not_attempted'].includes(a.status)).length || 0;
  const successful = job?.accounts.filter(a => ['success', 'already'].includes(a.status)).length || 0;
  const disabled = busy || starting || running;
  const update = (index, key, value) => setRows(old => old.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const start = async event => {
    event.preventDefault(); setStarting(true);
    const accounts = rows.map(row => ({ username: row.username.trim(), password: row.password }));
    try { setState(await api('/api/ig/login/start', { method: 'POST', body: JSON.stringify({ accounts }) })); }
    catch (error) { onError(error); }
    finally { accounts.forEach(a => { a.password = ''; }); setRows(old => old.map(row => ({ ...row, password: '' }))); setStarting(false); }
  };
  const online = devices.filter(d => d.status === 'device' && !d.serial.startsWith('emulator-'));
  const inventory = online.map(d => ({ ...d, scan: state.devices.find(s => s.serial === d.serial) })).sort((a, b) => (a.scan?.loginAttention || a.scan?.error || a.scan?.complete !== true ? Infinity : a.scan.accounts.length) - (b.scan?.loginAttention || b.scan?.error || b.scan?.complete !== true ? Infinity : b.scan.accounts.length));
  return <div className="ig-comment ig-login">
    <div className="ig-subheading"><button className="text-link" onClick={onBack}><ArrowLeft size={15} /> Kembali ke ig</button><span className="tiny-badge">AUTO LOGIN</span></div>
    <div className="ig-editor-grid">
      <form className="settings-card ig-form" onSubmit={start} autoComplete="off">
        <h2>Login akun Instagram</h2><p>Isi akun yang ingin ditambahkan. Panel memindai ulang HP, lalu memilih perangkat dengan akun paling sedikit. HP tanpa akun didahulukan.</p>
        {rows.map((row, index) => <div className="ig-login-row" key={index}>
          <label>Username<input aria-label={`Username akun ${index + 1}`} value={row.username} onChange={e => update(index, 'username', e.target.value)} placeholder="nama.akun" autoCapitalize="none" spellCheck={false} required disabled={disabled} /></label>
          <label>Password<input aria-label={`Password akun ${index + 1}`} type="password" autoComplete="new-password" value={row.password} onChange={e => update(index, 'password', e.target.value)} required maxLength={128} disabled={disabled} /></label>
          <button type="button" className="text-link" aria-label={`Hapus akun ${index + 1}`} disabled={disabled || rows.length === 1} onClick={() => setRows(old => old.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
        </div>)}
        <button type="button" className="text-link" disabled={disabled || rows.length >= 100} onClick={() => setRows(old => [...old, empty()])}><Plus size={15} /> Tambah akun</button>
        <p className="muted">Password dipakai selama proses ini, tidak disimpan ke file atau log. Jika muncul kode verifikasi, selesaikan lewat “Lihat HP”.</p>
        <button type="submit" className="button primary" disabled={disabled || !bridgeOnline || !online.length}><LogIn size={16} />{starting ? 'Memulai…' : `Login ${rows.length} akun`}</button>
      </form>
      <section className="settings-card ig-accounts"><h2>Prioritas HP</h2><p>Jumlah dari pemindaian terakhir. Jumlah terbaru diperiksa otomatis sebelum login.</p>
        {!inventory.length && <p className="muted">Belum ada HP terhubung.</p>}
        <div className="ig-login-device-list">{inventory.map(d => <div className="ig-login-device" key={d.serial}><Smartphone size={17} /><strong>{d.name}</strong><span>{d.scan?.loginAttention ? 'Menunggu tindakan di HP' : d.scan && !d.scan.error && d.scan.complete === true ? `${d.scan.accounts.length} akun` : 'Perlu dipindai'}</span><button className="text-link" onClick={() => openDevice(d.serial)}><Eye size={14} /> Lihat HP</button></div>)}</div>
      </section>
    </div>
    {job && <section className="settings-card"><div className="ig-section-heading"><div><h2>Hasil Auto login</h2><p role="status">{job.note}</p><p>{finished} / {job.accounts.length} akun memiliki hasil · {successful} terverifikasi · {finished - successful} perlu diperiksa</p><progress aria-label="Kemajuan Auto login" max={job.accounts.length} value={finished} /></div>{running && <button className="button stop-button" disabled={job.status === 'stopping'} onClick={stop}><Square size={14} />{job.status === 'stopping' ? 'Menghentikan…' : 'Hentikan'}</button>}</div>
      <div className="ig-job-accounts">{job.accounts.map(a => <div className={`ig-job-account ${['success', 'already'].includes(a.status) ? 'success' : ''}`} key={a.username}><strong>@{a.username}</strong><span>{a.deviceName || 'HP belum dipilih'}</span><span className="status-pill">{labels[a.status]}</span><small>{a.note}</small>{a.serial && <button className="text-link" onClick={() => openDevice(a.serial)}><Eye size={14} /> Lihat HP</button>}</div>)}</div>
    </section>}
  </div>;
}
