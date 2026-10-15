import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, FlaskConical, History, ListChecks, MessageCircle, Play, RefreshCw, Save, ShieldCheck, Square, Upload, Users } from 'lucide-react';

export const SOCIAL_WORKSPACES = [
  { id: 'x', name: 'X', mark: 'X', action: 'balasan', item: 'postingan' },
  { id: 'threads', name: 'Threads', mark: '@', action: 'balasan', item: 'postingan' },
  { id: 'facebook', name: 'Facebook', mark: 'f', action: 'komentar', item: 'postingan' },
  { id: 'youtube', name: 'YouTube', mark: '▶', action: 'komentar', item: 'video' },
];
const defaults = { target: '', posts: 3, comments: 3, tone: 'positif' };
const labels = { running: 'Berjalan', stopping: 'Menghentikan…', stopped: 'Dihentikan', completed: 'Selesai', completed_with_errors: 'Selesai dengan kendala', failed: 'Gagal', waiting: 'Menunggu', done: 'Selesai', paused: 'Dijeda' };
const formatTime = value => new Date(value).toLocaleString('id-ID');

export default function SocialWorkspace({ platform, api, bridgeOnline, onError, notify }) {
  const P = SOCIAL_WORKSPACES.find(p => p.id === platform);
  const base = `/api/social/${platform}`;
  const [menu, setMenu] = useState('home'), [state, setState] = useState(null), [selected, setSelected] = useState([]);
  const [plans, setPlans] = useState({}), [bulk, setBulk] = useState(defaults), [startMode, setStartMode] = useState('bertahap'), [scenario, setScenario] = useState('normal');
  const [pending, setPending] = useState(false), [preview, setPreview] = useState(null), [openRun, setOpenRun] = useState(null), [history, setHistory] = useState(null), [resetting, setResetting] = useState(false), [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!bridgeOnline) return;
    let alive = true, polling = false;
    const refresh = async () => {
      if (polling) return; polling = true;
      try {
        const data = await api(base);
        if (alive) { setState(data); if (!initialized) { setPlans(Object.fromEntries(data.plans.map(p => [p.username, p]))); setSelected(data.plans.map(p => p.username)); setStartMode(data.startMode); setScenario(data.scenario); setInitialized(true); } }
      } catch (error) { if (alive) onError(error); } finally { polling = false; }
    };
    refresh(); const timer = setInterval(refresh, 1200);
    return () => { alive = false; clearInterval(timer); };
  }, [base, bridgeOnline, initialized]);
  const running = ['running', 'stopping'].includes(state?.job?.status);
  const busy = pending || state?.busy;
  const accounts = state?.accounts || [], chosen = accounts.filter(a => selected.includes(a.username));
  const setting = account => plans[account.username] || defaults;
  const body = () => ({ mode: 'simulation', startMode, scenario, accounts: chosen.map(a => ({ serial: a.serial, username: a.username, ...setting(a), posts: Number(setting(a).posts), comments: Number(setting(a).comments) })) });
  const update = (account, change) => { setPlans(old => ({ ...old, [account.username]: { ...setting(account), ...change } })); setPreview(null); };
  const canRun = initialized && bridgeOnline && !busy && chosen.length > 0 && chosen.every(a => setting(a).target.trim());
  const act = async (endpoint, method = 'POST') => {
    setPending(true); setResetting(false);
    try {
      const data = await api(`${base}/${endpoint}`, { method, body: JSON.stringify(endpoint === 'reset' ? { mode: 'simulation' } : body()) });
      if (endpoint === 'preview') { setPreview(data); setState(await api(base)); notify(data.stopped ? 'Pemeriksaan simulasi dihentikan.' : 'Target contoh diperiksa. Tidak ada kiriman nyata.'); }
      else { setState(data); if (endpoint === 'reset') { setOpenRun(null); setHistory(null); setPreview(null); } notify(endpoint === 'plan' ? 'Rencana simulasi disimpan.' : endpoint === 'reset' ? 'Hitungan dan riwayat simulasi direset. Rencana tetap tersimpan.' : 'Simulasi dimulai. Tidak mengakses HP.'); }
    } catch (error) { onError(error); } finally { setPending(false); }
  };
  const stop = async () => { try { setState(await api(`${base}/stop`, { method: 'POST' })); notify('Menghentikan simulasi…'); } catch (error) { onError(error); } };
  const showHistory = async id => {
    if (openRun === id) { setOpenRun(null); return; }
    setOpenRun(id); setHistory(null);
    try { const data = await api(`${base}/history/${encodeURIComponent(id)}`); setHistory(data); } catch (error) { onError(error); }
  };
  const banner = <div className="social-simulation-banner" role="status"><FlaskConical size={20} /><div><strong>Mode simulasi · tanpa phonefarm</strong><p>Akun dan {P.item} adalah data contoh. Tidak ada like, {P.action}, atau akses akun asli. Kendali HP belum tersedia.</p></div><span className="tiny-badge">SIMULASI</span></div>;
  const checklist = <details className="social-checklist"><summary><ShieldCheck size={16} />Yang perlu diverifikasi saat phonefarm tersambung <ChevronDown size={14} /></summary><ul>{state?.platform.liveChecklist?.map(item => <li key={item}>{item}</li>)}</ul><p>Auto upload disiapkan untuk tahap berikutnya. Kelulusan simulasi belum membuktikan pengiriman di aplikasi asli.</p></details>;
  if (menu === 'home') return <div className="ig-home social-workspace">{banner}<div className="ig-intro"><span className={`ig-icon social-logo ${platform}`}>{P.mark}</span><div><h2>Workspace {P.name}</h2><p>Siapkan alur {P.action} dengan pola kerja yang sama seperti IG dan TikTok.</p></div></div><div className="ig-menu-grid"><button className="ig-menu-card" onClick={() => setMenu('comment')}><span className="ig-menu-symbol"><MessageCircle size={27} /></span><span className="ig-menu-content"><strong>Auto {P.action}</strong><span>Pilih akun contoh, atur target, lalu coba alur lengkap melalui simulasi.</span><span className="ig-card-link">Buka Auto {P.action} <ArrowRight size={15} /></span></span></button><button className="ig-menu-card" onClick={() => setMenu('upload')}><span className="ig-menu-symbol upload"><Upload size={27} /></span><span className="ig-menu-content"><strong>Auto upload</strong><span>Tempat untuk alur publikasi {P.item} pada pengembangan berikutnya.</span><span className="ig-soon">Tahap berikutnya</span></span></button></div>{checklist}</div>;
  if (menu === 'upload') return <div>{banner}<section className="settings-card ig-upload"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} />Kembali ke {P.name}</button><h2>Auto upload</h2><p>Belum tersedia. Tahap ini berfokus pada simulasi {P.action}.</p><button className="button primary" onClick={() => setMenu('comment')}>Buka Auto {P.action}</button></section></div>;
  return <div className="ig-comment social-workspace">{banner}
    <div className="ig-subheading"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} />Kembali ke {P.name}</button><span className="tiny-badge">AUTO {P.action.toUpperCase()}</span></div>
    <div className="ig-summary"><div><Users size={18} /><strong>{chosen.length}</strong><span>akun contoh dipilih</span></div><div><ListChecks size={18} /><strong>{chosen.reduce((sum, a) => sum + (Number(setting(a).posts) || 0) * (Number(setting(a).comments) || 0), 0)}</strong><span>{P.action} maksimal</span></div><div><ShieldCheck size={18} /><strong>0</strong><span>kiriman nyata</span></div></div>
    <div className="ig-editor-grid"><section className="settings-card ig-accounts"><div className="ig-section-heading"><div><h2>1. Pilih akun {P.name}</h2><p>Akun fiktif untuk mencoba alur tanpa perangkat.</p></div><span className="tiny-badge">DATA CONTOH</span></div>
      {!initialized && <p className="muted">{bridgeOnline ? 'Memuat akun contoh…' : 'Menunggu layanan lokal…'}</p>}
      <div className="ig-select-actions"><button className="text-link" disabled={busy || !initialized} onClick={() => { setSelected(accounts.map(a => a.username)); setPreview(null); }}>Pilih semua</button><button className="text-link" disabled={busy} onClick={() => { setSelected([]); setPreview(null); }}>Hapus pilihan</button></div>
      <div className="ig-account-list">{accounts.map(a => <label className={`ig-account ${selected.includes(a.username) ? 'selected' : ''}`} key={a.username}><input type="checkbox" disabled={busy} checked={selected.includes(a.username)} onChange={() => { setSelected(old => old.includes(a.username) ? old.filter(name => name !== a.username) : [...old, a.username]); setPreview(null); }} /><span className={`ig-account-avatar ${platform}`}>{P.mark}</span><span className="ig-account-name"><strong>{a.displayName}</strong><span>@{a.username} · {a.deviceName}</span></span>{selected.includes(a.username) && <Check size={15} />}</label>)}</div>
      <div className="social-fixture-note"><strong>Yang dicoba dalam simulasi</strong><p>Data contoh mencakup item bertanda pin, komentar yang sudah ada, suka yang sudah aktif, dan kolom komentar yang ditutup. Target yang diisi hanya menjadi identitas data contoh; profil aslinya tidak dibuka.</p><p>Waktu tunggu dipercepat: mode bertahap memberi selisih mulai antar-akun, sedangkan serentak memulai keduanya bersama.</p></div>{checklist}
    </section><form className="settings-card ig-form" onSubmit={e => { e.preventDefault(); act('start'); }}>
      <h2>2. Atur Auto {P.action} per akun</h2><p>Satu target per akun. Bank komentar menyusun teks sesuai isi contoh dan nada yang dipilih.</p>
      {!chosen.length && <div className="ig-empty"><ListChecks size={28} /><strong>Pilih akun contoh dahulu</strong><p>Setelah itu, isi target dan jumlah {P.action} yang ingin disimulasikan.</p></div>}
      {chosen.length > 0 && <div className="ig-plan-bulk"><strong>Isi semua akun</strong><Fields P={P} value={bulk} onChange={change => setBulk(old => ({ ...old, ...change }))} disabled={busy} targetHint={state?.platform.targetHint} /><button type="button" className="button secondary" disabled={busy} onClick={() => { setPlans(old => ({ ...old, ...Object.fromEntries(chosen.map(a => [a.username, { ...setting(a), ...bulk, target: bulk.target.trim() || setting(a).target }])) })); setPreview(null); }}>Terapkan ke {chosen.length} akun</button></div>}
      {chosen.map(a => <div className="ig-plan-row" key={a.username}><div className="ig-plan-account"><strong>@{a.username}</strong><span>{a.deviceName}</span></div><Fields P={P} value={setting(a)} onChange={change => update(a, change)} disabled={busy} targetHint={state?.platform.targetHint} /></div>)}
      <fieldset className="ig-start-mode" disabled={busy}><legend>Cara mulai</legend>{['bertahap', 'serentak'].map(mode => <label key={mode} className={startMode === mode ? 'selected' : ''}><input type="radio" name={`start-${platform}`} checked={startMode === mode} onChange={() => setStartMode(mode)} /><strong>{mode === 'bertahap' ? 'Bertahap' : 'Serentak'}</strong><span>{mode === 'bertahap' ? 'Akun contoh mulai bergiliran.' : 'Semua akun contoh mulai bersama.'}</span></label>)}</fieldset>
      <label className="social-scenario">Skenario simulasi<select value={scenario} disabled={busy} onChange={e => setScenario(e.target.value)}><option value="normal">Normal</option><option value="network">Internet putus lalu pulih</option><option value="uncertain">Hasil kiriman tidak pasti</option></select></label>
      <p className="muted">Jumlah adalah komentar atau balasan baru per postingan untuk sekali jalan. Mulai lagi menambah jumlah baru, tanpa menghitung kiriman lama. Hasil tidak pasti ditahan sampai data simulasi direset.</p>
      {preview && <div className="social-preview">{preview.results.map(result => <div className="ig-plan-check" key={result.username}><Eye size={15} /><div><strong>@{result.username} → {result.target}</strong><q>{result.caption}</q><span>{result.need} kiriman baru{result.uncertain ? ' · ditahan: hasil sebelumnya tidak pasti' : ''}</span><ul>{result.samples.map(text => <li key={text}>{text}</li>)}</ul></div></div>)}</div>}
      <div className="ig-form-buttons"><button type="button" className="button secondary" disabled={!canRun} onClick={() => act('plan', 'PUT')}><Save size={15} />Simpan rencana</button><button type="button" className="button secondary" disabled={!canRun} onClick={() => act('preview')}><Eye size={15} />Cek target contoh</button>{running ? <button type="button" className="button stop-button" onClick={stop} disabled={state.job.status === 'stopping'}><Square size={15} />{state.job.status === 'stopping' ? 'Menghentikan…' : 'Hentikan simulasi'}</button> : <button className="button primary" disabled={!canRun}><Play size={15} />{pending ? 'Memproses…' : 'Jalankan simulasi'}</button>}</div>
    </form></div>
    <section className="settings-card ig-progress"><div className="ig-section-heading"><div><h2>Aktivitas simulasi</h2><p>{state?.job ? `${labels[state.job.status]} · ${state.job.simulated} ${P.action} disimulasikan · ${state.job.skipped} item dilewati · ${state.job.failed} akun terkendala` : 'Belum ada simulasi berjalan.'}</p></div>{running && <button className="button stop-button" onClick={stop} disabled={state.job.status === 'stopping'}><Square size={14} />Hentikan</button>}</div>
      {state?.job?.error && <p className="ig-error">{state.job.error}</p>}
      <div className="ig-job-accounts">{state?.job?.accounts.map(a => <div className={`ig-job-account ${a.status}`} key={a.username}><strong>@{a.username}</strong><span>→ {a.target}</span><span className="status-pill">{labels[a.status]}</span><span>{a.simulated} disimulasikan · {a.skipped} dilewati</span>{a.note && <small>{a.note}</small>}</div>)}</div>
      <div className="ig-log" role="log" aria-label={`Log simulasi ${P.name}`}>{state?.job?.logs.length ? [...state.job.logs].reverse().map((log, i) => <div key={i}><time>{new Date(log.at).toLocaleTimeString('id-ID')}</time><span>{log.username && <strong>@{log.username} · </strong>}{log.message}</span></div>) : <p>Belum ada aktivitas.</p>}</div>
    </section>
    <section className="settings-card ig-history"><div className="ig-section-heading"><div><h2><History size={16} />Riwayat simulasi {P.name}</h2><p>Disimpan terpisah selama 7 hari, maksimal 100 proses. Tidak memengaruhi riwayat IG/TikTok.</p></div><button className="button secondary" disabled={busy || !bridgeOnline} onClick={() => setResetting(!resetting)}><RefreshCw size={14} />Reset simulasi</button></div>
      {resetting && <div className="social-reset"><span>Hapus hitungan dan riwayat simulasi {P.name}? Rencana tetap disimpan.</span><button className="button stop-button" onClick={() => act('reset')}>Ya, reset data contoh</button><button className="text-link" onClick={() => setResetting(false)}>Batal</button></div>}
      {!state?.runs.length && <p className="muted">Belum ada riwayat simulasi.</p>}<div className="ig-history-list">{state?.runs.map(run => <div className={`ig-history-item ${openRun === run.id ? 'open' : ''}`} key={run.id}><button onClick={() => showHistory(run.id)} aria-expanded={openRun === run.id}><span className="tiny-badge">{run.kind === 'preview' ? 'CEK CONTOH' : 'SIMULASI'}</span><span>{formatTime(run.startedAt)}</span><small>{labels[run.status]} · {run.simulated} contoh</small><ChevronDown size={14} /></button>{openRun === run.id && <pre>{history?.id === run.id ? history.logs.map(log => `${formatTime(log.at)} ${log.username || ''} ${log.message}`).join('\n') : 'Memuat…'}</pre>}</div>)}</div>
    </section>
  </div>;
}

function Fields({ P, value, onChange, disabled, targetHint }) {
  return <div className="ig-plan-fields"><label>Target<input value={value.target} placeholder={targetHint || '@target_contoh'} onChange={e => onChange({ target: e.target.value })} disabled={disabled} /></label><label>{P.item === 'video' ? 'Video' : 'Postingan'}<input type="number" min="1" max="50" required value={value.posts} onChange={e => onChange({ posts: e.target.value })} disabled={disabled} /></label><label>{P.action === 'balasan' ? 'Balasan baru / post' : 'Komentar baru / post'}<input type="number" min="1" max="100" required value={value.comments} onChange={e => onChange({ comments: e.target.value })} disabled={disabled} /></label><label>Nada<select value={value.tone} onChange={e => onChange({ tone: e.target.value })} disabled={disabled}><option value="positif">Positif</option><option value="netral">Netral</option><option value="negatif">Negatif</option></select></label></div>;
}
