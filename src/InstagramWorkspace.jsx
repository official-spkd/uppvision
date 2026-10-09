import React, { useEffect, useState } from 'react';
import { Camera as Instagram, MessageCircle, Upload, ArrowRight, ArrowLeft, RefreshCw, Smartphone, Check, Play, Square, Eye, Users, Clock, ListChecks, Heart, AlertTriangle } from 'lucide-react';

const accountKey = a => `${a.serial}:${a.username}`;
const jobLabel = value => ({ running: 'Berjalan', stopping: 'Menghentikan…', stopped: 'Dihentikan', completed: 'Selesai', completed_with_errors: 'Selesai dengan kendala', failed: 'Gagal' })[value] || 'Belum berjalan';
const accountLabel = value => ({ waiting: 'Menunggu giliran', running: 'Berjalan', done: 'Selesai', stopped: 'Dihentikan', blocked: 'Dibatasi Instagram', failed: 'Terkendala' })[value] || value;
const TONES = [['positif', 'Positif'], ['netral', 'Netral'], ['negatif', 'Negatif']];
const DEFAULTS = { target: '', posts: 3, comments: 3, tone: 'positif' };
const likeLabel = value => ({ already: 'sudah disukai', not_liked: 'belum disukai', missing: 'tombol like tidak terlihat', unknown: 'status like belum terbaca' })[value] || value;
export default function InstagramWorkspace({ api, active, bridgeOnline, devices, onError, notify, openDevice }) {
  const [menu, setMenu] = useState('home'), [state, setState] = useState({ devices: [], job: null, scanning: false });
  const [selected, setSelected] = useState(new Set()), [scanning, setScanning] = useState(false), [previewing, setPreviewing] = useState(false), [starting, setStarting] = useState(false);
  const [startMode, setStartMode] = useState('bertahap');
  const [settings, setSettings] = useState({}), [bulk, setBulk] = useState(DEFAULTS), [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const running = ['running', 'stopping'].includes(state.job?.status), busy = scanning || state.scanning || previewing || running || starting;
  const online = devices.filter(d => d.status === 'device' && !d.serial.startsWith('emulator-'));
  const allAccounts = state.devices.flatMap(d => d.accounts.map(a => ({ ...a, serial: d.serial, online: d.online && !d.error, deviceName: d.name })));
  const usable = allAccounts.filter(a => a.online && !a.disabled), chosen = usable.filter(a => selected.has(accountKey(a)));
  useEffect(() => {
    if (!active || !bridgeOnline) return;
    let alive = true;
    const refresh = () => api('/api/ig').then(value => { if (alive) setState(value); }).catch(error => { if (alive) onError(error); });
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, bridgeOnline]);
  const settingFor = a => settings[accountKey(a)] || { ...DEFAULTS, ...state.plans?.[accountKey(a)] };
  const update = (a, change) => setSettings(old => ({ ...old, [accountKey(a)]: { ...settingFor(a), ...change } }));
  const applyAll = () => setSettings(old => { const next = { ...old }; for (const a of chosen) next[accountKey(a)] = { ...settingFor(a), ...(bulk.target.trim() ? bulk : { ...bulk, target: settingFor(a).target }) }; return next; });
  useEffect(() => { setPreview(null); setPreviewError(''); }, [settings, selected]);
  const plan = () => ({ accounts: chosen.map(a => { const s = settingFor(a); return { serial: a.serial, username: a.username, target: s.target.trim(), posts: Number(s.posts), comments: Number(s.comments), tone: s.tone }; }), startMode });
  const planned = chosen.reduce((n, a) => n + Number(settingFor(a).posts || 0) * Number(settingFor(a).comments || 0), 0);
  const canRun = bridgeOnline && !busy && chosen.length > 0 && chosen.every(a => settingFor(a).target.trim());
  const previewFor = a => preview?.results.find(r => r.serial === a.serial && r.username === a.username);
  const scan = async () => {
    setScanning(true);
    try { const data = await api('/api/ig/accounts/scan', { method: 'POST' }); setState(data); const count = data.devices.reduce((n, d) => n + (d.error ? 0 : d.accounts.length), 0); notify(data.stopped ? `Pemindaian dihentikan. ${count} akun terbaca.` : `${count} akun Instagram terbaca dari HP.`); }
    catch (error) { onError(error); } finally { setScanning(false); }
  };
  const toggle = key => setSelected(old => { const next = new Set(old); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const check = async () => {
    setPreviewing(true); setPreviewError('');
    try { const result = await api('/api/ig/preview', { method: 'POST', body: JSON.stringify(plan()) }); setPreview(result); notify(result.message); }
    catch (error) { setPreview(null); setPreviewError(error.message); onError(error); } finally { setPreviewing(false); }
  };
  const start = async event => {
    event.preventDefault(); setStarting(true);
    try { setState(await api('/api/ig/start', { method: 'POST', body: JSON.stringify(plan()) })); notify('Auto komen dimulai pada akun yang dipilih.'); }
    catch (error) { onError(error); } finally { setStarting(false); }
  };
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try { setState(await api('/api/ig/stop', { method: 'POST' })); notify('Menghentikan proses di semua HP…'); } catch (error) { onError(error); } finally { setStopping(false); }
  };
  const halting = stopping || state.stopping || state.job?.status === 'stopping';
  const StopButton = ({ label }) => <button type="button" className="button stop-button" onClick={stop} disabled={halting}><Square size={14} />{halting ? 'Menghentikan…' : label}</button>;

  if (menu === 'home') return <div className="ig-home">
    <div className="ig-intro"><span className="ig-icon"><Instagram size={26} /></span><div><h2>Workspace ig</h2><p>Pilih pekerjaan Instagram yang ingin kamu jalankan dari phonefarm.</p></div></div>
    <div className="ig-menu-grid">
      <button className="ig-menu-card" onClick={() => setMenu('comment')}><span className="ig-menu-symbol"><MessageCircle size={27} /></span><span className="ig-menu-content"><strong>Auto komen</strong><span>Pilih akun dari HP, lalu komentari postingan terbaru akun target.</span><span className="ig-card-link">Buka Auto komen <ArrowRight size={15} /></span></span></button>
      <button className="ig-menu-card" onClick={() => setMenu('upload')}><span className="ig-menu-symbol upload"><Upload size={27} /></span><span className="ig-menu-content"><strong>Auto upload postingan</strong><span>Publikasikan postingan dari akun yang terhubung di phonefarm.</span><span className="ig-soon">Tahap berikutnya</span></span></button>
    </div><p className="ig-home-note">{online.length} HP terhubung · Akun dibaca dari aplikasi Instagram yang sudah login di HP.</p>
  </div>;
  if (menu === 'upload') return <section className="settings-card ig-upload"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} /> Kembali ke ig</button><span className="ig-icon"><Upload size={26} /></span><h2>Auto upload postingan</h2><p>Menu ini disiapkan untuk tahap berikutnya. Sekarang kita fokus pada Auto komen.</p><button className="button primary" onClick={() => setMenu('comment')}>Buka Auto komen <ArrowRight size={15} /></button></section>;
  return <div className="ig-comment">
    <div className="ig-subheading"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} /> Kembali ke ig</button><span className="tiny-badge">AUTO KOMEN</span></div>
    <div className="ig-summary"><div><Users size={18} /><strong>{chosen.length}</strong><span>akun dipilih</span></div><div><Smartphone size={18} /><strong>{new Set(chosen.map(a => a.serial)).size}</strong><span>HP digunakan</span></div><div><ListChecks size={18} /><strong>{planned}</strong><span>komentar maksimal</span></div></div>
    <div className="ig-editor-grid"><section className="settings-card ig-accounts">
      <div className="ig-section-heading"><div><h2>1. Pilih akun Instagram</h2><p>Akun yang sudah login, dikelompokkan per HP.</p></div><div className="ig-heading-buttons"><button className="button secondary" onClick={scan} disabled={busy || !bridgeOnline || !online.length}><RefreshCw size={14} className={scanning || state.scanning ? 'spin' : ''} />{scanning || state.scanning ? `Membaca ${online.length} HP…` : 'Pindai akun HP'}</button>{(scanning || state.scanning) && <StopButton label="Hentikan" />}</div></div>
      {usable.length > 0 && <div className="ig-select-actions"><button className="text-link" disabled={busy} onClick={() => setSelected(new Set(usable.map(accountKey)))}>Pilih semua akun</button><button className="text-link" disabled={busy} onClick={() => setSelected(new Set())}>Hapus pilihan</button></div>}
      {!state.devices.length && <div className="ig-empty"><Users size={30} /><strong>Belum ada daftar akun</strong><p>Klik “Pindai akun HP”. Panel membuka pemilih akun Instagram dan membaca username yang sudah login.</p></div>}
      {state.devices.map(device => <article className="ig-device" key={device.serial}><div className="ig-device-heading"><span className="step-icon"><Smartphone size={18} /></span><div><strong>{device.name}</strong><span>{device.online ? `${device.accounts.length} akun terbaca` : 'HP offline'}{device.current ? ` · Aktif: @${device.current}` : ''}</span></div><button className="text-link" onClick={() => openDevice(device.serial)}>Lihat HP <Eye size={14} /></button></div>
        {device.error && <p className="ig-error">{device.error} Daftar sebelumnya belum diverifikasi ulang.</p>}
        {device.complete === false && <p className="ig-error">Daftar mungkin belum lengkap. Pindai ulang untuk memeriksa.</p>}
        <div className="ig-account-list">{device.accounts.map(account => <label className={`ig-account ${selected.has(`${device.serial}:${account.username}`) ? 'selected' : ''}`} key={account.username}><input type="checkbox" checked={selected.has(`${device.serial}:${account.username}`)} disabled={busy || !device.online || Boolean(device.error) || account.disabled} onChange={() => toggle(`${device.serial}:${account.username}`)} aria-label={`Pilih @${account.username} di ${device.name}`} /><span className="ig-account-avatar">{account.username.slice(0, 2).toUpperCase()}</span><span className="ig-account-name"><strong>@{account.username}</strong><span>{account.disabled ? 'Dinonaktifkan di Instagram' : account.active ? 'Aktif saat pemindaian' : 'Sudah login di HP'}</span></span>{selected.has(`${device.serial}:${account.username}`) && <Check size={15} />}</label>)}</div>
        {device.scannedAt && <p className="ig-scanned">Dibaca {new Date(device.scannedAt).toLocaleString('id-ID')}</p>}
      </article>)}
      <p className="muted">Tidak memerlukan password di panel. Akun yang sama pada HP berbeda tampil terpisah; riwayat komentar mencegah kirim ulang dari username yang sama.</p>
    </section><form className="settings-card ig-form" onSubmit={start}>
      <h2>2. Atur Auto komen per akun</h2><p>Setiap akun punya satu target. Komentar dirakit otomatis dari bank sesuai caption postingan dan nada akun; jeda diacak otomatis.</p>
      {!chosen.length && <div className="ig-empty"><ListChecks size={28} /><strong>Belum ada akun dipilih</strong><p>Centang akun di kolom kiri, lalu atur target dan nadanya di sini.</p></div>}
      {chosen.length > 0 && <div className="ig-plan-bulk"><strong>Isi semua akun</strong>
        <PlanFields value={bulk} onChange={change => setBulk(old => ({ ...old, ...change }))} disabled={busy} id="bulk" optionalTarget />
        <button type="button" className="button secondary" onClick={applyAll} disabled={busy}>Terapkan ke {chosen.length} akun</button></div>}
      {chosen.map(a => { const s = settingFor(a), r = previewFor(a); return <div className="ig-plan-row" key={accountKey(a)}>
        <div className="ig-plan-account"><strong>@{a.username}</strong><span>{a.deviceName}</span></div>
        <PlanFields value={s} onChange={change => update(a, change)} disabled={busy} id={accountKey(a)} />
        {r && (r.ok ? <div className="ig-plan-check"><Check size={14} /><div>
          <span>@{r.target} · suasana <b>{r.suasana}</b> · nada {r.tone} · {likeLabel(r.liked)} · sudah {r.existing} komentar, perlu {r.need}{r.pinned ? ` · ${r.pinned} pin dilewati` : ''}</span>
          {r.caption && <q>{r.caption}</q>}
          <ul>{r.samples.map(text => <li key={text}>{text}</li>)}</ul></div></div>
          : <p className="ig-error"><AlertTriangle size={14} /> {r.error}</p>)}
      </div>; })}
      <fieldset className="ig-start-mode" disabled={busy}><legend>Cara mulai HP</legend>
        <label className={startMode === 'bertahap' ? 'selected' : ''}><input type="radio" name="ig-start-mode" value="bertahap" checked={startMode === 'bertahap'} onChange={() => setStartMode('bertahap')} /><strong>Bertahap</strong><span>HP berikutnya mulai 10–20 detik setelah HP sebelumnya.</span></label>
        <label className={startMode === 'serentak' ? 'selected' : ''}><input type="radio" name="ig-start-mode" value="serentak" checked={startMode === 'serentak'} onChange={() => setStartMode('serentak')} /><strong>Serentak</strong><span>Semua HP mulai bersamaan tanpa menunggu.</span></label>
      </fieldset>
      <div className="ig-plan-note"><Clock size={16} /><span>{startMode === 'serentak' ? 'Semua HP mulai bersamaan.' : 'HP mulai bergiliran dengan selisih 10–20 detik.'} Tiap postingan: lewati pin, like, hitung komentar akun ini, lalu tambah sampai target. Jeda 3–6 detik antar komentar dan 5–12 detik antar postingan.</span></div>
      {preview && <div className="ig-preview-result"><Check size={16} /><span>{preview.message}</span></div>}
      {previewError && <p className="ig-error" role="alert">{previewError}</p>}
      <div className="ig-form-buttons">
        {previewing || state.checking ? <StopButton label="Hentikan pemeriksaan" /> : <button type="button" className="button secondary" disabled={!canRun} onClick={check}><Eye size={15} />Cek target tanpa mengirim</button>}
        {running ? <StopButton label="Hentikan Auto komen" /> : <button className="button primary" disabled={!canRun}><Play size={15} />{starting ? 'Memulai…' : 'Jalankan Auto komen'}</button>}
      </div>
    </form></div>
    <section className="settings-card ig-progress"><div className="ig-section-heading"><div><h2>Aktivitas Auto komen</h2><p>{state.job ? `${jobLabel(state.job.status)} · ${state.job.sent} terkirim · ${state.job.skipped} postingan dilewati · ${state.job.failed} akun terkendala` : 'Proses akan tampil di sini setelah dijalankan.'}</p></div>{running && <StopButton label="Hentikan semua" />}</div>
      {state.job && <div className="ig-job-accounts">{state.job.accounts.map(a => <div key={accountKey(a)} className={`ig-job-account ${a.status}`}><strong>@{a.username}</strong><span>→ @{a.target} · {TONES.find(t => t[0] === a.tone)?.[1]}</span><span className="status-pill">{accountLabel(a.status)}</span><span>{a.sent} terkirim · {a.skipped} dilewati · <Heart size={12} /> {a.liked}</span>{a.note && <small>{a.note}</small>}</div>)}</div>}
      <div className="ig-log" role="log" aria-label="Aktivitas Auto komen">{state.job?.logs.length ? [...state.job.logs].reverse().map((log, index) => <div key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString('id-ID')}</time><span>{log.username && <strong>@{log.username} · </strong>}{log.message}</span></div>) : <p>Belum ada aktivitas.</p>}</div>
    </section>
  </div>;
}

function PlanFields({ value, onChange, disabled, id, optionalTarget = false }) {
  return <div className="ig-plan-fields">
    <label>Target<input value={value.target} onChange={e => onChange({ target: e.target.value })} placeholder={optionalTarget ? 'biarkan kosong = tetap' : '@username_target'} disabled={disabled} aria-label={`Target ${id}`} /></label>
    <label>Postingan<input type="number" min={1} max={50} value={value.posts} onChange={e => onChange({ posts: e.target.value })} disabled={disabled} /></label>
    <label>Komentar / post<input type="number" min={1} max={100} value={value.comments} onChange={e => onChange({ comments: e.target.value })} disabled={disabled} /></label>
    <label>Nada<select value={value.tone} onChange={e => onChange({ tone: e.target.value })} disabled={disabled}>{TONES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  </div>;
}
