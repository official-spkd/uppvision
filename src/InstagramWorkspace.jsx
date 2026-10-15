import React, { useEffect, useMemo, useState } from 'react';
import InstagramLogin from './InstagramLogin.jsx';
import InstagramLinks from './InstagramLinks.jsx';
import { instagramUsername, summarizeInstagramAccounts } from './instagram-accounts.mjs';
import { accountReport, jobReport } from './activity-report.mjs';
import { connectionStatus } from './connection-status.mjs';
import { isInstagramPostTarget, instagramTargets, targetLabel, effectivePostCount, validCommentSettings, MAX_ACCOUNTS } from './instagram-target.mjs';
import { duplicateAccountPlan, duplicateSelectionBlocks } from './instagram-duplicates.mjs';
import { Camera as Instagram, MessageCircle, Upload, LogIn, LogOut, ArrowRight, ArrowLeft, RefreshCw, Smartphone, Check, Play, Square, Eye, Users, Clock, ListChecks, Heart, AlertTriangle, WifiOff, History, ChevronDown, Bookmark, Repeat, Send, Link2 } from 'lucide-react';

const accountKey = a => `${a.serial}:${a.username}`;
const TONES = [['positif', 'Positif'], ['netral', 'Netral'], ['negatif', 'Negatif']];
const DEFAULTS = { target: '', posts: 3, comments: 3, tone: 'positif' };
const likeLabel = value => ({ already: 'sudah disukai', not_liked: 'belum disukai', missing: 'tombol like tidak terlihat', unknown: 'status like belum terbaca' })[value] || value;
export const PLATFORMS = {
  ig: { base: '/api/ig', name: 'Instagram', short: 'ig', item: 'postingan' },
  tt: { base: '/api/tt', name: 'TikTok', short: 'TikTok', item: 'video' },
};
export default function InstagramWorkspace({ api, active, bridgeOnline, devices, internet = {}, onError, notify, openDevice, platform = 'ig' }) {
  const P = PLATFORMS[platform];
  const [menu, setMenu] = useState('home'), [state, setState] = useState({ devices: [], job: null, scanning: false });
  const [selected, setSelected] = useState(new Set()), [scanning, setScanning] = useState(false), [previewing, setPreviewing] = useState(false), [starting, setStarting] = useState(false);
  const [startMode, setStartMode] = useState('bertahap');
  const [settings, setSettings] = useState({}), [bulk, setBulk] = useState(DEFAULTS), [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false), [logoutTarget, setLogoutTarget] = useState(null);
  const logoutRunning = state.logoutJob?.status === 'running';
  const duplicateRunning = ['scanning', 'running', 'stopping'].includes(state.duplicateJob?.status);
  const running = ['running', 'stopping'].includes(state.job?.status), busy = recovering || duplicateRunning || loggingOut || logoutRunning || scanning || state.scanning || state.checking || previewing || running || starting || ['scanning', 'running', 'stopping'].includes(state.loginJob?.status);
  const report = jobReport(state.job);
  const online = devices.filter(d => d.status === 'device' && !d.serial.startsWith('emulator-'));
  const allAccounts = state.devices.flatMap(d => d.accounts.map(a => ({ ...a, serial: d.serial, online: d.online && !d.error, deviceName: d.name })));
  const accountInventory = platform === 'ig' ? summarizeInstagramAccounts(state.devices.map(d => ({ ...d, name: devices.find(live => live.serial === d.serial)?.name || d.name }))) : null;
  const duplicates = platform === 'ig' ? duplicateAccountPlan(state.devices) : null;
  const selectionBlocks = useMemo(() => platform === 'ig' ? duplicateSelectionBlocks(state.devices) : new Map(), [platform, state.devices]);
  const duplicateBlock = (serial, username) => selectionBlocks.get(`${serial}:${instagramUsername(username)}`);
  useEffect(() => {
    setSelected(old => {
      const next = new Set([...old].filter(key => {
        const split = key.lastIndexOf(':');
        return !selectionBlocks.has(`${key.slice(0, split)}:${instagramUsername(key.slice(split + 1))}`);
      }));
      return next.size === old.size ? old : next;
    });
  }, [selectionBlocks]);
  const usable = allAccounts.filter(a => a.online && !a.disabled && !duplicateBlock(a.serial, a.username)), chosen = usable.filter(a => selected.has(accountKey(a)));
  useEffect(() => {
    if (!active || !bridgeOnline) return;
    let alive = true;
    const refresh = () => api(P.base).then(value => { if (alive) setState(value); }).catch(error => { if (alive) onError(error); });
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, bridgeOnline]);
  const settingFor = a => settings[accountKey(a)] || { ...DEFAULTS, ...state.plans?.[accountKey(a)] };
  const update = (a, change) => setSettings(old => ({ ...old, [accountKey(a)]: { ...settingFor(a), ...change } }));
  const applyAll = () => setSettings(old => { const next = { ...old }; for (const a of chosen) next[accountKey(a)] = { ...settingFor(a), ...(bulk.target.trim() ? bulk : { ...bulk, target: settingFor(a).target }) }; return next; });
  useEffect(() => { setPreview(null); setPreviewError(''); }, [settings, selected]);
  const plan = () => ({ accounts: chosen.map(a => { const s = settingFor(a); return { serial: a.serial, username: a.username, target: s.target.trim(), posts: effectivePostCount(s, platform), comments: Number(s.comments), tone: s.tone }; }), startMode });
  const planned = chosen.reduce((n, a) => n + effectivePostCount(settingFor(a), platform) * Number(settingFor(a).comments || 0), 0);
  const overLimit = chosen.length > MAX_ACCOUNTS;
  const canRun = bridgeOnline && !busy && chosen.length > 0 && !overLimit && chosen.every(a => validCommentSettings(settingFor(a), platform));
  const incomplete = chosen.filter(a => !validCommentSettings(settingFor(a), platform));
  const incompleteKeys = new Set(incomplete.map(accountKey));
  const dropIncomplete = () => setSelected(old => { const next = new Set(old); for (const a of incomplete) next.delete(accountKey(a)); return next; });
  const trimToLimit = () => setSelected(new Set(chosen.slice(0, MAX_ACCOUNTS).map(accountKey)));
  const runBlock = !chosen.length ? '' : !bridgeOnline ? 'Panel belum tersambung ke layanan lokal.' : busy ? 'Tunggu proses yang sedang berjalan sampai selesai.' : overLimit ? `${chosen.length} akun terpilih melebihi batas ${MAX_ACCOUNTS} akun per pekerjaan. Kurangi dulu, atau batasi otomatis ke ${MAX_ACCOUNTS} akun pertama.` : incomplete.length ? `${incomplete.length} akun terpilih belum lengkap: ${incomplete.slice(0, 4).map(a => `@${a.username}`).join(', ')}${incomplete.length > 4 ? `, +${incomplete.length - 4} akun lain` : ''}. Isi target username/link dan komentar baru 1–100 di baris bertanda, atau pakai “Isi semua akun”.` : '';
  const previewFor = a => preview?.results.find(r => r.serial === a.serial && r.username === a.username);
  const scan = async () => {
    setScanning(true);
    try { const data = await api(`${P.base}/accounts/scan`, { method: 'POST' }); setState(data); const count = data.devices.reduce((n, d) => n + (d.error ? 0 : d.accounts.length), 0); notify(data.stopped ? `Pemindaian dihentikan. ${count} akun terbaca.` : `${count} akun ${P.name} terbaca dari HP.`); }
    catch (error) { onError(error); } finally { setScanning(false); }
  };
  const logout = async (device, account) => {
    setLogoutTarget(null); setLoggingOut(true);
    try {
      setState(await api('/api/ig/accounts/logout', { method: 'POST', body: JSON.stringify({ serial: device.serial, username: account.username }) }));
      setSelected(old => { const next = new Set(old); next.delete(`${device.serial}:${account.username}`); return next; });
      setPreview(null);
    } catch (error) { onError(error); } finally { setLoggingOut(false); }
  };
  const toggle = key => setSelected(old => { const next = new Set(old); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const check = async () => {
    setPreviewing(true); setPreviewError('');
    try { const result = await api(`${P.base}/preview`, { method: 'POST', body: JSON.stringify(plan()) }); setPreview(result); notify(result.message); }
    catch (error) { setPreview(null); setPreviewError(error.message); onError(error); } finally { setPreviewing(false); }
  };
  const start = async event => {
    event.preventDefault(); if (!canRun) return; setStarting(true);
    try { setState(await api(`${P.base}/start`, { method: 'POST', body: JSON.stringify(plan()) })); notify('Auto komen dimulai pada akun yang dipilih.'); }
    catch (error) { onError(error); } finally { setStarting(false); }
  };
  const deduplicate = async () => {
    setLoggingOut(true);
    try { setState(await api('/api/ig/accounts/deduplicate', { method: 'POST', body: '{}' })); }
    catch (error) { onError(error); } finally { setLoggingOut(false); }
  };
  const reviewResult = async recordId => {
    setRecovering(true);
    try { const result = await api(`${P.base}/comments/review`, { method: 'POST', body: JSON.stringify({ recordId }) }); setState(result); notify(result.message); }
    catch (error) { onError(error); } finally { setRecovering(false); }
  };
  const resumeSaved = async () => {
    setRecovering(true);
    try { setState(await api(`${P.base}/resume`, { method: 'POST', body: JSON.stringify({ resumeJobId: state.recovery.resume.id }) })); notify('Melanjutkan daftar dan sisa kuota pekerjaan tersimpan.'); }
    catch (error) { onError(error); } finally { setRecovering(false); }
  };
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    try { setState(await api(`${P.base}/stop`, { method: 'POST' })); notify('Menghentikan proses di semua HP…'); } catch (error) { onError(error); } finally { setStopping(false); }
  };
  const halting = stopping || state.stopping || state.job?.status === 'stopping';
  const StopButton = ({ label }) => <button type="button" className="button stop-button" onClick={stop} disabled={halting}><Square size={14} />{halting ? 'Menghentikan…' : label}</button>;

  if (menu === 'home') return <div className="ig-home">
    <div className="ig-intro"><span className="ig-icon"><Instagram size={26} /></span><div><h2>Workspace {P.short}</h2><p>Pilih pekerjaan {P.name} yang ingin kamu jalankan dari phonefarm.</p></div></div>
    <div className="ig-menu-grid">
      <button className="ig-menu-card" onClick={() => setMenu('comment')}><span className="ig-menu-symbol"><MessageCircle size={27} /></span><span className="ig-menu-content"><strong>Auto komen</strong><span>Pilih akun dari HP, lalu komentari postingan target.</span><span className="ig-card-link">Buka Auto komen <ArrowRight size={15} /></span></span></button>
      {platform === 'ig' ? <button className="ig-menu-card" onClick={() => setMenu('login')}><span className="ig-menu-symbol upload"><LogIn size={27} /></span><span className="ig-menu-content"><strong>Auto login</strong><span>Tambahkan akun Instagram ke HP dengan jumlah akun paling sedikit.</span><span className="ig-card-link">Buka Auto login <ArrowRight size={15} /></span></span></button> : (<button className="ig-menu-card" onClick={() => setMenu('upload')}><span className="ig-menu-symbol upload"><Upload size={27} /></span><span className="ig-menu-content"><strong>Auto upload postingan</strong><span>Publikasikan postingan dari akun yang terhubung di phonefarm.</span><span className="ig-soon">Tahap berikutnya</span></span></button>)}
      {platform === 'ig' && <button className="ig-menu-card" onClick={() => setMenu('links')}><span className="ig-menu-symbol upload"><Link2 size={27} /></span><span className="ig-menu-content"><strong>Ambil link postingan</strong><span>Ambil tautan postingan terbaru sebuah channel, lalu tempel ke kolom target Auto komen.</span><span className="ig-card-link">Buka Ambil link <ArrowRight size={15} /></span></span></button>}
    </div><p className="ig-home-note">{online.length} HP terhubung · Akun dibaca dari aplikasi {P.name} yang sudah login di HP.</p>
  </div>;
  if (menu === 'links' && platform === 'ig') return <InstagramLinks api={api} state={state} devices={devices} busy={busy} onBack={() => setMenu('home')} onError={onError} notify={notify} stop={stop} />;
  if (menu === 'login' && platform === 'ig') return <InstagramLogin api={api} state={state} setState={setState} devices={devices} busy={busy} bridgeOnline={bridgeOnline} onBack={() => setMenu('home')} onError={onError} openDevice={openDevice} stop={stop} />;
  if (menu === 'upload') return <section className="settings-card ig-upload"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} /> Kembali ke {P.short}</button><span className="ig-icon"><Upload size={26} /></span><h2>Auto upload postingan</h2><p>Menu ini disiapkan untuk tahap berikutnya. Sekarang kita fokus pada Auto komen.</p><button className="button primary" onClick={() => setMenu('comment')}>Buka Auto komen <ArrowRight size={15} /></button></section>;
  return <div className="ig-comment">
    <div className="ig-subheading"><button className="text-link" onClick={() => setMenu('home')}><ArrowLeft size={15} /> Kembali ke {P.short}</button><span className="tiny-badge">AUTO KOMEN</span></div>
    <div className="ig-summary"><div><Users size={18} /><strong>{chosen.length}</strong><span>akun dipilih</span></div><div><Smartphone size={18} /><strong>{new Set(chosen.map(a => a.serial)).size}</strong><span>HP digunakan</span></div><div><ListChecks size={18} /><strong>{planned}</strong><span>komentar baru maksimal</span></div></div>
    <div className="ig-editor-grid"><section className="settings-card ig-accounts">
      <div className="ig-section-heading"><div><h2>1. Pilih akun {P.name}</h2><p>Akun yang sudah login, dikelompokkan per HP.</p></div><div className="ig-heading-buttons"><button className="button secondary" onClick={scan} disabled={busy || !bridgeOnline || !online.length}><RefreshCw size={14} className={scanning || state.scanning ? 'spin' : ''} />{scanning || state.scanning ? `Membaca ${online.length} HP…` : 'Pindai akun HP'}</button>{(scanning || state.scanning) && <StopButton label="Hentikan" />}</div></div>
      {platform === 'ig' && state.logoutJob && <div className={`ig-logout-status ${state.logoutJob.status}`} role="status"><LogOut size={15} /><span><strong>@{state.logoutJob.username} · {state.logoutJob.deviceName}</strong>{state.logoutJob.note}</span>{state.logoutJob.status !== 'success' && <button className="text-link" onClick={() => openDevice(state.logoutJob.serial)}>Lihat HP <Eye size={14} /></button>}</div>}
      {usable.length > 0 && <div className="ig-select-actions"><button className="text-link" disabled={busy} onClick={() => setSelected(new Set(usable.map(accountKey)))}>Pilih semua akun</button><button className="text-link" disabled={busy} onClick={() => setSelected(new Set())}>Hapus pilihan</button></div>}
      {!state.devices.length && <div className="ig-empty"><Users size={30} /><strong>Belum ada daftar akun</strong><p>Klik “Pindai akun HP”. Panel membuka pemilih akun {P.name} dan membaca username yang sudah login.</p></div>}
      {state.devices.map(device => <article className="ig-device" key={device.serial}><div className="ig-device-heading"><span className="step-icon"><Smartphone size={18} /></span><div><strong>{device.name}</strong><span>{device.online ? `${device.accounts.length} akun terbaca` : 'HP offline'}{device.current ? ` · Aktif: @${device.current}` : ''}{device.online && internet[device.serial]?.state === 'offline' ? ' · ' : ''}{device.online && internet[device.serial]?.state === 'offline' && <b className="ig-no-internet">Internet terputus</b>}</span></div><button className="text-link" onClick={() => openDevice(device.serial)}>Lihat HP <Eye size={14} /></button></div>
        {device.error && <p className="ig-error">{device.error} Daftar sebelumnya belum diverifikasi ulang.</p>}
        {device.complete === false && <p className="ig-error">Daftar mungkin belum lengkap. Pindai ulang untuk memeriksa.</p>}
        <div className="ig-account-list">{device.accounts.map(account => <div className={`ig-account ${(!duplicateBlock(device.serial, account.username) && selected.has(`${device.serial}:${account.username}`)) ? 'selected' : ''}`} key={account.username}><label className="ig-account-select"><input type="checkbox" checked={(!duplicateBlock(device.serial, account.username) && selected.has(`${device.serial}:${account.username}`))} disabled={busy || !device.online || Boolean(device.error) || account.disabled || Boolean(duplicateBlock(device.serial, account.username))} title={duplicateBlock(device.serial, account.username)?.reason} onChange={() => toggle(`${device.serial}:${account.username}`)} aria-label={`Pilih @${account.username} di ${device.name}`} /><span className="ig-account-avatar">{account.username.slice(0, 2).toUpperCase()}</span><span className="ig-account-name"><strong>@{account.username}</strong><span>{duplicateBlock(device.serial, account.username)?.reason || (account.disabled ? `Dinonaktifkan di ${P.name}` : account.active ? 'Aktif saat pemindaian' : 'Sudah login di HP')}</span>{accountInventory && <AccountDevices account={accountInventory.byUsername.get(instagramUsername(account.username))} />}</span>{(!duplicateBlock(device.serial, account.username) && selected.has(`${device.serial}:${account.username}`)) && <Check size={15} />}</label>{platform === 'ig' && <button type="button" className="ig-account-logout" aria-label={`Log out @${account.username} dari ${device.name}`} title={`Log out dari ${device.name}`} disabled={busy || !bridgeOnline || !device.online || device.busy} onClick={() => setLogoutTarget({ device, account })}><LogOut size={14} />{logoutRunning && state.logoutJob.serial === device.serial && state.logoutJob.username === account.username ? 'Mengeluarkan…' : 'Log out'}</button>}</div>)}</div>
        {device.scannedAt && <p className="ig-scanned">Dibaca {new Date(device.scannedAt).toLocaleString('id-ID')}</p>}
      </article>)}
      <p className="muted">Tidak memerlukan password di panel. Akun duplikat tetap ditampilkan, tetapi salinan yang dijadwalkan dikeluarkan tidak bisa dicentang, termasuk lewat Pilih semua akun. Penetapan HP memakai inventaris terakhir; ini bukan bukti akun sudah logout.</p>
      {accountInventory && <div className="ig-account-total" aria-label="Total akun Instagram berbeda"><div><Users size={19} /><strong>{accountInventory.total}</strong><span>Total akun berbeda</span></div><p>{accountInventory.excluded} akun banned/nonaktif tidak dihitung. Username yang sama di beberapa HP dihitung satu kali.</p><small>Berdasarkan pemindaian terakhir, termasuk akun pada HP offline. Status banned/nonaktif mengikuti tanda yang terbaca di Instagram; jika ada di salah satu HP, akun dikeluarkan dari total.</small></div>}
      {duplicates && <section className="ig-duplicate-panel" aria-label="Rapikan akun duplikat"><h3>Akun duplikat di beberapa HP</h3><p>{duplicates.duplicateAccounts} username terdaftar di lebih dari satu HP. Logout dimulai dari HP dengan akun terbanyak. Sisakan di HP dengan akun paling sedikit; jika seri, pertahankan nomor HP lebih kecil.</p><p>Daftar dibaca ulang sebelum mulai dan jumlah dihitung ulang setelah setiap logout. Akun lain tetap dipertahankan.</p>{duplicateRunning ? <StopButton label="Hentikan perapian akun" /> : <button type="button" className="button secondary" onClick={deduplicate} disabled={busy || !bridgeOnline || !duplicates.duplicateAccounts}>Rapikan akun duplikat</button>}{state.duplicateJob && <div role="status"><strong>{state.duplicateJob.removed.length} logout terverifikasi</strong><p>{state.duplicateJob.note}</p>{state.duplicateJob.current && <button type="button" className="text-link" onClick={() => openDevice(state.duplicateJob.current.serial)}>Lihat HP yang diproses</button>}<ul>{state.duplicateJob.removed.map((r, i) => <li key={i}>@{r.username}: keluar dari {r.name}, tetap di {r.keepName}.</li>)}</ul>{state.duplicateJob.blocked.map((r, i) => <p key={i}>@{r.username}: {r.reason}</p>)}</div>}</section>}
    </section><form className="settings-card ig-form" onSubmit={start}>
      <h2>2. Atur Auto komen per akun</h2><p>Setiap akun punya satu target. Komentar dirakit otomatis dari bank sesuai caption postingan dan nada akun; jeda diacak otomatis.</p>
      {!chosen.length && <div className="ig-empty"><ListChecks size={28} /><strong>Belum ada akun dipilih</strong><p>Centang akun di kolom kiri, lalu atur target dan nadanya di sini.</p></div>}
      {chosen.length > 0 && <div className="ig-plan-bulk"><strong>Isi semua akun</strong>
        <PlanFields value={bulk} onChange={change => setBulk(old => ({ ...old, ...change }))} disabled={busy} id="bulk" optionalTarget platform={platform} />
        <button type="button" className="button secondary" onClick={applyAll} disabled={busy}>Terapkan ke {chosen.length} akun</button></div>}
      {chosen.map(a => { const s = settingFor(a), r = previewFor(a), bad = incompleteKeys.has(accountKey(a)); return <div className={`ig-plan-row${bad ? ' incomplete' : ''}`} key={accountKey(a)}>
        <div className="ig-plan-account"><strong>@{a.username}</strong>{bad && <span className="ig-plan-flag"><AlertTriangle size={11} /> belum lengkap</span>}<span>{a.deviceName}</span></div>
        <PlanFields value={s} onChange={change => update(a, change)} disabled={busy} id={accountKey(a)} platform={platform} />
        {r?.posts ? <div className="ig-multilink-preview">{r.posts.map(p => <div key={p.url}><strong>{p.url}</strong>{p.ok ? <><p>{p.suasana} · {p.need} komentar baru{p.uncertain ? ' · ditahan: kiriman belum pasti' : ''}</p><q>{p.fullCaption || p.caption}</q><ul>{p.samples.map(text => <li key={text}>{text}</li>)}</ul></> : <p className="ig-error">{p.error}</p>}</div>)}</div> : r && (r.ok ? <div className="ig-plan-check"><Check size={14} /><div>
          <span>{targetLabel(r.target)} · suasana <b>{r.suasana}</b> · nada {r.tone} · {likeLabel(r.liked)} · {r.need} komentar baru{r.uncertain ? ' · ditahan: kiriman belum pasti' : ''}{r.pinned ? ` · ${r.pinned} pin dilewati` : ''}</span>
          {r.caption && <q>{r.caption}</q>}
          <ul>{r.samples.map(text => <li key={text}>{text}</li>)}</ul></div></div>
          : <p className="ig-error"><AlertTriangle size={14} /> {r.error}</p>)}
      </div>; })}
      <fieldset className="ig-start-mode" disabled={busy}><legend>Cara mulai HP</legend>
        <label className={startMode === 'bertahap' ? 'selected' : ''}><input type="radio" name="ig-start-mode" value="bertahap" checked={startMode === 'bertahap'} onChange={() => setStartMode('bertahap')} /><strong>Bertahap</strong><span>HP berikutnya mulai 6–12 detik setelah HP sebelumnya.</span></label>
        <label className={startMode === 'serentak' ? 'selected' : ''}><input type="radio" name="ig-start-mode" value="serentak" checked={startMode === 'serentak'} onChange={() => setStartMode('serentak')} /><strong>Serentak</strong><span>Semua HP mulai bersamaan tanpa menunggu.</span></label>
      </fieldset>
      <div className="ig-plan-note"><Clock size={16} /><span>{startMode === 'serentak' ? 'Semua HP mulai bersamaan.' : 'HP mulai bergiliran dengan selisih 6–12 detik.'} {platform === 'ig' ? 'Target bisa username atau link postingan Instagram. Username: pilih postingan terbaru non-pin dan kunci daftarnya saat mulai. Link: maksimal 20 link, satu per baris; baris kosong diabaikan dan duplikat dihitung sekali. Daftar diproses sesuai urutan. Jumlah adalah komentar baru per postingan untuk sekali jalan. Unggahan baru tidak mengganti sasaran. Tiap postingan dikerjakan berurutan: like jika belum, simpan, repost, share ke kontak pertama yang muncul di lembar share, lalu komentar baru paling akhir. Share dilewati bila tidak ada kontak. Komentar yang ditahan karena hasilnya belum pasti berarti like, simpan, repost, dan share sudah terjadi.' : 'Tiap postingan: lewati pin, like jika belum, lalu kirim komentar baru sesuai jumlah.'} Mulai lagi menambah kuota baru; retry hanya melanjutkan sisa pekerjaan yang sama. Jeda 1,5–3 detik antar komentar dan 3–6 detik antar postingan.</span></div>
      {preview && <div className="ig-preview-result"><Check size={16} /><span>{preview.message}</span></div>}
      {previewError && <p className="ig-error" role="alert">{previewError}</p>}
      {!running && runBlock && <p className="ig-error ig-run-block" role="alert"><AlertTriangle size={14} /><span>{runBlock}</span>{bridgeOnline && !busy && (overLimit ? <button type="button" className="text-link" onClick={trimToLimit}>Batasi ke {MAX_ACCOUNTS} akun</button> : incomplete.length > 0 ? <button type="button" className="text-link" onClick={dropIncomplete}>Buang {incomplete.length} akun belum lengkap</button> : null)}</p>}
      <div className="ig-form-buttons">
        {previewing || state.checking ? <StopButton label="Hentikan pemeriksaan" /> : <button type="button" className="button secondary" disabled={!canRun} onClick={check}><Eye size={15} />Cek target tanpa mengirim</button>}
        {running ? <StopButton label="Hentikan Auto komen" /> : <button type="submit" className="button primary" disabled={!canRun}><Play size={15} />{starting ? 'Memulai…' : 'Jalankan Auto komen'}</button>}
      </div>
    </form></div>
    <section className="settings-card ig-progress" aria-label="Laporan hasil proses"><div className="ig-section-heading"><div><h2>Aktivitas Auto komen</h2><p>{state.job ? `${report.label} · ${report.requested ? `${report.confirmed}/${report.requested} terverifikasi` : `${report.sent} dicatat terkirim`} · ${report.failed} akun terkendala` : 'Proses akan tampil di sini setelah dijalankan.'}</p></div>{running && <StopButton label="Hentikan semua" />}</div>
      {state.job && <div className="ig-report-summary" role="status">{report.requested > 0 && <><span><b>{report.confirmed}/{report.requested}</b> terkirim dalam pekerjaan ini</span><span><b>{report.remaining}</b> komentar belum dikerjakan</span></>}<span><b>{report.pending}</b> komentar belum pasti pada {report.pendingAccounts} akun</span><span><b>{report.missed}</b> {P.item} tidak diproses karena kendala</span><span><b>{report.skipped}</b> {P.item} dilewati karena kuota pekerjaan ini terpenuhi</span><span><b>{report.reviewAccounts}</b> akun perlu pemeriksaan</span><p>Angka berasal dari catatan aplikasi. Pemrosesan berakhir tidak berarti semua hasil sudah terverifikasi. Hasil belum pasti tidak dihitung sebagai berhasil atau gagal.</p></div>}
      {state.job?.paused && <div className="ig-paused" role="status"><WifiOff size={16} /><span>Internet Mac terputus. Semua HP dijeda dan dicek setiap 15 detik; proses berhenti bila 5 menit belum kembali.</span></div>}
      {state.job?.stopReason && !running && <p className="ig-error"><AlertTriangle size={14} /> {state.job.stopReason}</p>}
      {state.job && <div className="ig-job-accounts">{state.job.accounts.map(a => { const r = accountReport(a), net = connectionStatus(internet[a.serial]); return <div key={accountKey(a)} className={`ig-job-account ${r.tone}`}><strong>@{a.username}</strong><span>→ {targetLabel(a.target)} · {TONES.find(t => t[0] === a.tone)?.[1]}</span><span className="status-pill">{r.label}</span><span>{r.requested ? `${r.confirmed}/${r.requested} terkirim dalam pekerjaan ini` : `${r.sent} dicatat terkirim`} · <Heart size={12} /> {r.liked}</span>{r.saved || r.reposted || r.shared ? <span><Bookmark size={12} /> {r.saved} · <Repeat size={12} /> {r.reposted} · <Send size={12} /> {r.shared}</span> : null}<span>{r.remaining} belum dikerjakan · {r.pending} belum pasti · {r.missed} {P.item} bermasalah</span><span>{r.skipped} dilewati karena kuota pekerjaan ini terpenuhi</span>{r.explanation && <small>{r.explanation}</small>}{a.progress && Object.values(a.progress).filter(p => p.remaining || p.held).map(p => <small key={p.index}>Postingan {p.index + 1}: {p.confirmed || 0}/{p.requested} terkirim · {p.held || p.pending || 0} belum pasti · {p.remaining} belum dikerjakan. {p.reason}</small>)}{r.explanation !== r.originalNote && <details><summary>Pesan asli pemeriksaan</summary><small>{r.originalNote}</small></details>}<small className={`ig-report-network ${net.stale ? 'stale' : ''}`}>{devices.find(d => d.serial === a.serial)?.name || a.deviceName || 'HP'} · {net.message} · {net.age}{net.warning ? ` · ${net.warning}` : ''}</small></div>; })}</div>}
      <div className="ig-log" role="log" aria-label="Aktivitas Auto komen">{state.job?.logs.length ? [...state.job.logs].reverse().map((log, index) => <div key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString('id-ID')}</time><span>{log.username && <strong>@{log.username} · </strong>}{log.message}</span></div>) : <p>Belum ada aktivitas.</p>}</div>
    </section>
    {(state.recovery?.pending.length > 0 || state.recovery?.resume) && <section className="settings-card ig-recovery" aria-label="Pemulihan pekerjaan">
      <h2>Periksa hasil dan lanjutkan</h2><p>Periksa hasil hanya membaca kiriman yang tertahan, tanpa like atau komentar baru. Kiriman yang tidak terlihat tetap dianggap belum pasti.</p>
      {state.recovery.pending.map(record => <article className="ig-recovery-item" key={record.id}><strong>@{record.username} → {record.target}</strong><q>{record.text}</q><p>{record.note || 'Hasil kiriman belum pasti; pengiriman pada sasaran ini ditahan.'}</p>
        <button type="button" className="button secondary" disabled={busy || !bridgeOnline || !record.reviewable} onClick={() => reviewResult(record.id)}><Eye size={14} />Periksa hasil</button>
        {!record.reviewable && <small>{platform === 'tt' ? 'Pemeriksaan otomatis TikTok belum tersedia karena referensi video belum tetap.' : 'Catatan lama belum memiliki referensi target yang cukup untuk diperiksa otomatis.'}</small>}
      </article>)}
      {state.recovery.resume && <div className="ig-recovery-resume"><p>Lanjutkan {state.recovery.resume.accounts} akun dari daftar tersimpan. Sisa {state.recovery.resume.remaining} komentar belum dikerjakan; kuota baru tidak dibuat.</p>
        <details><summary>Akun dan target pekerjaan tersimpan</summary><ul>{state.recovery.resume.targets.map(a => <li key={`${a.serial}:${a.username}`}>@{a.username} → {targetLabel(a.target)} · {a.posts} postingan × {a.comments} komentar</li>)}</ul></details>
        <button type="button" className="button secondary" disabled={busy || !bridgeOnline || state.recovery.resume.blocked || state.recovery.resume.remaining === 0} onClick={resumeSaved}><Play size={14} />Lanjutkan pekerjaan ini</button>
        {state.recovery.resume.blocked && <p>Periksa hasil kiriman belum pasti terlebih dahulu.</p>}
      </div>}
    </section>}
    <LogHistory api={api} active={active} onError={onError} refreshKey={`${state.job?.id}:${state.job?.status}`} />
    {logoutTarget && <div className="modal-backdrop" onClick={() => setLogoutTarget(null)} onKeyDown={event => { if (event.key === 'Escape') setLogoutTarget(null); }}><section className="small-modal ig-logout-confirm" role="dialog" aria-modal="true" aria-labelledby="ig-logout-title" onClick={event => event.stopPropagation()}><h2 id="ig-logout-title">Log out akun?</h2><p>Keluarkan <strong>@{logoutTarget.account.username}</strong> dari <strong>{logoutTarget.device.name}</strong>.</p><div><button type="button" className="button secondary" autoFocus onClick={() => setLogoutTarget(null)}>Batal</button><button type="button" className="button ig-confirm-logout" disabled={busy || !bridgeOnline} onClick={() => logout(logoutTarget.device, logoutTarget.account)}><LogOut size={14} />Log out</button></div></section></div>}
  </div>;
}

function AccountDevices({ account }) {
  if (!account) return null;
  return <span className="ig-account-devices"><b>Terdaftar di {account.devices.length} HP</b><span>{account.devices.map(d => `${d.name}${!d.online ? ' (offline)' : ''}${d.unverified ? ' (belum terverifikasi ulang)' : ''}`).join(' · ')}</span>{account.excluded && <em>Banned/nonaktif terdeteksi · tidak dihitung dalam total</em>}</span>;
}

// Text logs of the last 7 days, newest first; one opens at a time.
function LogHistory({ api, active, onError, refreshKey }) {
  const [logs, setLogs] = useState([]), [open, setOpen] = useState(null), [text, setText] = useState(''), [loading, setLoading] = useState(false);
  const load = () => api('/api/ig/logs').then(data => setLogs(data.logs)).catch(onError);
  useEffect(() => { if (active) load(); }, [active, refreshKey]);
  const show = async id => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setText(''); setLoading(true);
    try { setText((await api(`/api/ig/logs/${encodeURIComponent(id)}`)).text); } catch (error) { onError(error); setOpen(null); } finally { setLoading(false); }
  };
  return <section className="settings-card ig-history">
    <div className="ig-section-heading"><div><h2><History size={16} /> Riwayat proses</h2><p>Log teks setiap Pindai, Cek target, dan Auto komen. Disimpan 7 hari.</p></div><button className="button secondary" onClick={load}><RefreshCw size={14} />Muat ulang</button></div>
    {!logs.length && <p className="muted">Belum ada riwayat.</p>}
    <div className="ig-history-list">{logs.map(log => <div key={log.id} className={`ig-history-item ${open === log.id ? 'open' : ''}`}>
      <button onClick={() => show(log.id)} aria-expanded={open === log.id}><span className="tiny-badge">{log.label.toUpperCase()}</span><span>{log.startedAt}</span><small>{Math.max(1, Math.round(log.size / 1024))} KB</small><ChevronDown size={14} /></button>
      {open === log.id && <pre>{loading ? 'Memuat…' : text}</pre>}
    </div>)}</div>
  </section>;
}

function PlanFields({ value, onChange, disabled, id, optionalTarget = false, platform = 'ig' }) {
  const directPost = platform === 'ig' && isInstagramPostTarget(value.target);
  let targetError = '';
  if (!String(value.target ?? '').trim()) { if (!optionalTarget) targetError = platform === 'ig' ? 'Isi username atau link postingan Instagram.' : 'Isi username target.'; }
  else if (platform === 'ig') { try { instagramTargets(value.target); } catch (error) { targetError = error.message; } }
  return <div className="ig-plan-fields">
    <label>{platform === 'ig' ? 'Target / link postingan' : 'Target'}{platform === 'ig' ? <textarea value={value.target} onChange={e => onChange({ target: e.target.value })} rows={Math.max(1, Math.min(20, value.target.split('\n').length))} placeholder={optionalTarget ? 'biarkan kosong = tetap' : '@username atau link Instagram, satu link per baris (maks. 20)'} disabled={disabled} aria-label={`Target ${id}`} aria-invalid={Boolean(targetError)} /> : <input value={value.target} onChange={e => onChange({ target: e.target.value })} placeholder={optionalTarget ? 'biarkan kosong = tetap' : '@username_target'} disabled={disabled} aria-label={`Target ${id}`} />}{targetError && <span className="ig-error" role="alert">{targetError}</span>}</label>
    <label>{directPost ? 'Postingan dari link' : 'Postingan'}<input type="number" min={1} max={50} value={directPost ? effectivePostCount(value, platform) : value.posts} onChange={e => onChange({ posts: e.target.value })} disabled={disabled || directPost} aria-label={`Postingan ${id}`} /></label>
    <label>Komentar baru / post<input type="number" min={1} max={100} value={value.comments} onChange={e => onChange({ comments: e.target.value })} disabled={disabled} /></label>
    <label>Nada<select value={value.tone} onChange={e => onChange({ tone: e.target.value })} disabled={disabled}>{TONES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  </div>;
}
