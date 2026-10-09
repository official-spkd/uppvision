import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Smartphone, LayoutGrid, Cable, Settings2, ArrowUpRight, ArrowLeft, Circle, Square, Search, RefreshCw, Play, Pause, ChevronDown, X, Maximize2, Battery, BatteryCharging, Volume2, Volume1, Sun, Moon, Download, Keyboard, Check, CheckCheck, Wifi, Usb, Monitor, Info, AlertCircle, Radio, Layers, Pencil, Command, Plus, Camera as Instagram } from 'lucide-react';
import './styles.css';
import InstagramWorkspace from './InstagramWorkspace.jsx';

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Layanan lokal tidak merespons.');
  return data;
}
const statusLabel = status => ({ device: 'Terhubung', unauthorized: 'Perlu izin', offline: 'Offline', recovery: 'Recovery', sideload: 'Sideload' })[status] || 'Tidak terdeteksi';
function IconButton({ label, children, onClick, disabled, className = '' }) { return <button className={`icon-button ${className}`} type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>; }

function Screen({ device, enabled, onInput, onError, large = false }) {
  const canvasRef = useRef(null), pointer = useRef(null), busy = useRef(false);
  const [state, setState] = useState('connecting'), [message, setMessage] = useState(''), [retry, setRetry] = useState(0), [ratio, setRatio] = useState(device.width && device.height ? device.width / device.height : 9 / 19.5);
  useEffect(() => {
    if (!enabled || device.status !== 'device') { setState('paused'); return; }
    let alive = true, socket, timer, reconnect, attempts = 0;
    const connect = () => {
      if (!alive) return;
      setState('connecting'); setMessage('');
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/screen?serial=${encodeURIComponent(device.serial)}`);
      socket.binaryType = 'arraybuffer';
      timer = setTimeout(() => { if (alive) { setState('error'); setMessage('Layar belum merespons.'); } }, 22000);
      socket.onmessage = async event => {
        if (!alive) return;
        if (typeof event.data === 'string') { const data = JSON.parse(event.data); setState('error'); setMessage(data.message); return; }
        if (busy.current) return;
        busy.current = true;
        let bitmap;
        try {
          bitmap = await createImageBitmap(new Blob([event.data], { type: 'image/jpeg' }));
          if (!alive || !canvasRef.current) return;
          const canvas = canvasRef.current;
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height; setRatio(bitmap.width / bitmap.height); }
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          clearTimeout(timer); attempts = 0; setState('live');
        } catch { if (alive) { setState('error'); setMessage('Frame layar tidak dapat ditampilkan.'); } }
        finally { bitmap?.close(); busy.current = false; }
      };
      socket.onerror = () => { if (alive) { setState('error'); setMessage('Sambungan layar gagal.'); } };
      socket.onclose = () => {
        clearTimeout(timer);
        if (alive && attempts++ < 3) reconnect = setTimeout(connect, 2000 * attempts);
        else if (alive) { setState('error'); setMessage(previous => previous || 'Sambungan layar terputus.'); }
      };
    };
    connect();
    return () => { alive = false; clearTimeout(timer); clearTimeout(reconnect); socket?.close(); };
  }, [device.serial, device.status, enabled, retry]);
  const position = event => { const rect = canvasRef.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const down = event => {
    if (state !== 'live' || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { ...position(event), time: performance.now() };
  };
  const up = event => {
    if (!pointer.current) return;
    const start = pointer.current, end = position(event); pointer.current = null;
    const duration = Math.min(1500, Math.max(80, performance.now() - start.time));
    const moved = Math.hypot(end.x - start.x, end.y - start.y) > 0.02;
    onInput(device.serial, moved || duration > 500 ? { type: 'swipe', x: start.x, y: start.y, endX: end.x, endY: end.y, duration } : { type: 'tap', x: end.x, y: end.y }).catch(onError);
  };
  const wheel = event => {
    if (state !== 'live' || pointer.current) return;
    const now = performance.now(); if (now - (canvasRef.current.lastScroll || 0) < 350) return;
    canvasRef.current.lastScroll = now;
    onInput(device.serial, { type: 'swipe', x: .5, y: event.deltaY > 0 ? .75 : .3, endX: .5, endY: event.deltaY > 0 ? .3 : .75, duration: 250 }).catch(onError);
  };
  return <div className={`screen-shell ${large ? 'large' : ''}`} style={{ aspectRatio: ratio }}>
    <canvas ref={canvasRef} className={state === 'live' ? 'screen-canvas' : 'screen-canvas hidden-canvas'} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { pointer.current = null; }} onWheel={wheel} aria-label={`Layar ${device.name}; klik untuk ketuk, seret untuk geser`} />
    {state !== 'live' && <div className="screen-overlay">
      <div className="screen-overlay-icon">{state === 'connecting' ? <RefreshCw className="spin" size={25} /> : state === 'error' ? <AlertCircle size={25} /> : <Smartphone size={28} />}</div>
      <strong>{device.status !== 'device' ? statusLabel(device.status) : state === 'connecting' ? 'Menghubungkan layar' : state === 'error' ? 'Layar belum tersedia' : 'Pratinjau dijeda'}</strong>
      <span>{device.status === 'unauthorized' ? 'Board belum menerima kunci ADB Mac.' : device.status !== 'device' ? 'Menunggu board tersambung kembali ke USB.' : state === 'error' ? message : state === 'connecting' ? 'Menyiapkan layar perangkat…' : 'Buka mode fokus atau aktifkan pratinjau.'}</span>
      {state === 'error' && <button className="screen-retry" onClick={() => setRetry(r => r + 1)}><RefreshCw size={13} /> Coba lagi</button>}
    </div>}
    {state === 'live' && <span className="live-tag"><i /> LIVE</span>}
  </div>;
}

function Navigation({ device, onInput, onError }) {
  const key = value => onInput(device.serial, { type: 'key', key: value }).catch(onError);
  return <div className="android-nav"><IconButton label="Kembali" onClick={() => key('back')} disabled={device.status !== 'device'}><ArrowLeft size={17} /></IconButton><IconButton label="Home" onClick={() => key('home')} disabled={device.status !== 'device'}><Circle size={16} /></IconButton><IconButton label="Aplikasi terbaru" onClick={() => key('recent')} disabled={device.status !== 'device'}><Square size={15} /></IconButton></div>;
}

function BoxStatus({ box }) {
  if (!box) return <p className="muted">Membaca status slot dari pengendali box…</p>;
  if (!box.available) return <p className="muted">{box.error || 'Status slot belum tersedia.'}</p>;
  return <section className="box-status" aria-label="Status slot pengendali box">
    <h3>Slot fisik dari pengendali box</h3>
    <p>{box.boardCount} board dikenali box · {box.usbSlotCount} slot dalam mode USB</p>
    <div className="box-slots">{box.slots.map(slot => <div key={slot.slot} className={slot.boardDetected ? 'box-slot present' : 'box-slot'} title={`Slot ${slot.slot}: ${slot.boardDetected ? 'board dikenali box' : 'board tidak terdeteksi'} · ${slot.mode}`}>
      <strong>{String(slot.slot).padStart(2, '0')}</strong><span>{slot.mode}</span><small>{slot.boardDetected ? 'Board ada' : 'Tidak terbaca'}</small>
    </div>)}</div>
    <p className="muted">Board dikenali box belum berarti Android sudah menyala atau tersambung ke USB Mac. Nomor slot ini berasal dari pengendali; nama HP pada panel belum dipetakan ke slot fisik.</p>
    <p className="muted">Firmware {box.firmware} · Dibaca {new Date(box.readAt).toLocaleTimeString('id-ID')} · Diperbarui setiap 30 detik</p>
  </section>;
}

function App() {
  const [snapshot, setSnapshot] = useState({ devices: [], expectedCount: 19, lastUpdated: null }), [ready, setReady] = useState(false), [bridgeOnline, setBridgeOnline] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [page, setPage] = useState('devices'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [paused, setPaused] = useState(false), [selected, setSelected] = useState(new Set()), [sync, setSync] = useState(false);
  const [focus, setFocus] = useState(null), [toast, setToast] = useState(null), [scanning, setScanning] = useState(false), [connection, setConnection] = useState(null), [textModal, setTextModal] = useState(null), [text, setText] = useState(''), [sending, setSending] = useState(false), [rename, setRename] = useState(null), [newName, setNewName] = useState(''), [slotCount, setSlotCount] = useState(19), [compact, setCompact] = useState(false), [pageVisible, setPageVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => { const update = () => setPageVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  const notify = useCallback((message, error = false) => setToast({ message, error, id: Date.now() }), []);
  const onError = useCallback(error => notify(error.message || 'Operasi gagal.', true), [notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    let events, cancelled = false, retry;
    const start = async () => {
      try {
        await api('/api/session');
        const data = await api('/api/devices'); if (cancelled) return;
        setSnapshot(data); setSlotCount(data.expectedCount); setReady(true); setBridgeOnline(true);
        events = new EventSource('/api/events');
        events.onmessage = event => { setSnapshot(JSON.parse(event.data)); setBridgeOnline(true); };
        events.onerror = () => { setBridgeOnline(false); events.close(); retry = setTimeout(start, 4000); };
      } catch (error) { if (!cancelled) { setReady(true); setBridgeOnline(false); retry = setTimeout(start, 4000); } }
    };
    start(); return () => { cancelled = true; events?.close(); clearTimeout(retry); };
  }, []);
  useEffect(() => {
    if (page !== 'connection' || !bridgeOnline) return;
    let active = true;
    const refresh = () => api('/api/connection').then(data => { if (active) setConnection(data); }).catch(onError);
    refresh(); const timer = setInterval(refresh, 6000); return () => { active = false; clearInterval(timer); };
  }, [page, bridgeOnline]);
  useEffect(() => {
    const available = new Set(snapshot.devices.filter(d => d.status === 'device').map(d => d.serial));
    setSelected(old => { const next = new Set([...old].filter(s => available.has(s))); return next.size === old.size ? old : next; });
  }, [snapshot.devices]);
  const devices = snapshot.devices, online = devices.filter(d => d.status === 'device'), waiting = devices.filter(d => d.status === 'unauthorized'), missing = Math.max(0, snapshot.expectedCount - (snapshot.detectedCount ?? devices.length));
  const focusedDevice = devices.find(d => d.serial === focus);
  const visible = devices.filter(d => (filter === 'all' || (filter === 'online' ? d.status === 'device' : d.status !== 'device')) && `${d.name} ${d.model} ${d.serial}`.toLowerCase().includes(search.toLowerCase()));
  const toggleSelected = serial => setSelected(old => { const next = new Set(old); next.has(serial) ? next.delete(serial) : next.add(serial); return next; });
  const send = useCallback(async (serial, action) => {
    const targets = sync && selected.has(serial) && selected.size > 1 ? [...selected] : [serial];
    const results = await Promise.allSettled(targets.map(target => api(`/api/devices/${encodeURIComponent(target)}/input`, { method: 'POST', body: JSON.stringify(action) })));
    const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
  }, [sync, selected]);
  const scan = async () => { setScanning(true); try { const data = await api('/api/scan', { method: 'POST' }); setSnapshot(data); notify(`Pemindaian selesai. ${data.devices.filter(d => d.status === 'device').length} perangkat siap.`); } catch (error) { onError(error); } finally { setScanning(false); } };
  const bulkKey = async key => { try { await Promise.all([...selected].map(serial => api(`/api/devices/${encodeURIComponent(serial)}/input`, { method: 'POST', body: JSON.stringify({ type: 'key', key }) }))); notify(`Kontrol dikirim ke ${selected.size} perangkat.`); } catch (error) { onError(error); } };
  const screenshot = async device => {
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(device.serial)}/screenshot`);
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = `${device.name}-${device.serial}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); notify('Tangkapan layar disimpan.');
    } catch (error) { onError(error); }
  };
  const sendText = async event => { event.preventDefault(); setSending(true); try { await send(textModal.serial, { type: 'text', text }); setTextModal(null); setText(''); notify('Teks dikirim ke perangkat.'); } catch (error) { onError(error); } finally { setSending(false); } };
  const saveName = async event => { event.preventDefault(); try { setSnapshot(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ serial: rename.serial, name: newName }) })); setRename(null); notify('Nama perangkat diperbarui.'); } catch (error) { onError(error); } };
  const saveSlots = async event => { event.preventDefault(); try { setSnapshot(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ expectedCount: Number(slotCount) }) })); notify('Jumlah slot disimpan.'); } catch (error) { onError(error); } };
  useEffect(() => {
    const handle = event => {
      if (event.key === 'Escape') { if (textModal) setTextModal(null); else if (rename) setRename(null); else setFocus(null); return; }
      if (event.key === 'Tab' && (focus || textModal || rename)) {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea, a[href]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (!focusedDevice || ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = { Backspace: 'back', Home: 'home', Enter: 'enter', Delete: 'delete' }[event.key];
      if (key) { event.preventDefault(); send(focusedDevice.serial, { type: 'key', key }).catch(onError); }
    };
    document.addEventListener('keydown', handle); return () => document.removeEventListener('keydown', handle);
  }, [focusedDevice, send, focus, textModal, rename]);
  useEffect(() => {
    if (!(focus || textModal || rename)) return;
    const previous = document.activeElement;
    const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
    dialog?.querySelector('textarea, input, button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [focus, Boolean(textModal), Boolean(rename)]);

  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('devices'); }}><span className="brand-mark"><Smartphone size={23} strokeWidth={2.2} /></span><span>phonefarm<span className="brand-sub">RUANG KENDALI</span></span></a>
      <div className="workspace-picker"><button className="workspace-select" onClick={() => setWorkspaceMenu(value => !value)} aria-expanded={workspaceMenu} aria-label="Pilih workspace"><span className="workspace-avatar">{page === 'ig' ? 'ig' : 'PF'}</span><div><strong>{page === 'ig' ? 'ig' : 'Farm saya'}</strong><span>Workspace lokal</span></div><ChevronDown size={15} /></button>{workspaceMenu && <div className="workspace-dropdown"><button onClick={() => { setPage('devices'); setWorkspaceMenu(false); }}><Smartphone size={16} />Farm saya</button><button onClick={() => { setPage('ig'); setWorkspaceMenu(false); }}><Instagram size={16} />ig</button></div>}</div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>
        <button className={page === 'devices' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('devices')}><LayoutGrid size={18} />Perangkat<span className="nav-count">{online.length}</span></button>
        <button className={page === 'connection' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('connection')}><Cable size={18} />Koneksi{waiting.length > 0 && <span className="nav-warning">{waiting.length}</span>}</button>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}><Settings2 size={18} />Pengaturan</button>
        <button className={page === 'ig' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('ig')}><Instagram size={18} />ig</button>
      </nav>
      <div className="sidebar-foot">
        <div className="local-card"><span className="local-icon"><Monitor size={18} /></span><strong>Berjalan di Mac ini</strong><p>Hubungkan phonefarm lewat USB untuk mulai mengontrol.</p><div><i className={bridgeOnline ? 'dot green' : 'dot gray'} />{bridgeOnline ? 'Layanan lokal aktif' : 'Menghubungkan layanan'}</div></div>
        <div className="profile"><span className="profile-avatar">M</span><div><strong>Mac workspace</strong><span>Phonefarm Panel · v0.1</span></div></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>{page === 'devices' ? 'Perangkat' : page === 'connection' ? 'Koneksi' : page === 'ig' ? 'ig' : 'Pengaturan'}</strong></div><div className="topbar-right"><span className="local-badge"><i className={bridgeOnline ? 'dot green' : 'dot gray'} />{bridgeOnline ? 'Terhubung ke Mac' : 'Layanan terputus'}</span><span className="topbar-divider" /><span className="user-avatar">M</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">PHONEFARM CONTROL CENTER</div><h1>{page === 'devices' ? 'Semua perangkat' : page === 'connection' ? 'Koneksi perangkat' : page === 'ig' ? 'Workspace ig' : 'Pengaturan workspace'}<span className="heading-dot">.</span></h1><p>{page === 'devices' ? 'Satu ruang untuk melihat dan mengontrol seluruh HP kamu.' : page === 'connection' ? 'Lihat jalur USB, izin perangkat, dan status koneksi ke Mac.' : page === 'ig' ? 'Kelola pekerjaan Instagram dari akun yang login di phonefarm kamu.' : 'Sesuaikan panel dengan susunan phonefarm kamu.'}</p></div><button className="button secondary" onClick={scan} disabled={scanning || !bridgeOnline}><RefreshCw size={15} className={scanning ? 'spin' : ''} />{scanning ? 'Memindai…' : 'Pindai perangkat'}</button></div>
        {!bridgeOnline && ready && <div className="notice error"><AlertCircle size={18} /><div><strong>Layanan lokal belum terhubung</strong><span>Panel akan tersambung kembali secara otomatis saat layanan aktif.</span></div></div>}
        {snapshot.error && <div className="notice error"><AlertCircle size={18} /><span>{snapshot.error}</span></div>}
        {page !== 'ig' && <div className="stats-grid">
          <div className="stat-card"><span className="stat-icon blue"><Smartphone size={18} /></span><span className="stat-label">Total slot</span><div className="stat-value">{snapshot.expectedCount}<span>perangkat</span></div><span className="stat-note">Kapasitas farm kamu</span></div>
          <div className="stat-card"><span className="stat-icon green-bg"><Radio size={18} /></span><span className="stat-label">Terhubung</span><div className="stat-value">{online.length}<span className="stat-pill green-bg">{online.length ? 'Siap dikontrol' : 'Menunggu board'}</span></div><span className="stat-note"><i className={`dot ${online.length ? 'green' : 'gray'}`} />Koneksi langsung lewat USB / Wi-Fi</span></div>
          <div className="stat-card"><span className="stat-icon amber-bg"><Cable size={18} /></span><span className="stat-label">Belum terdeteksi</span><div className="stat-value">{missing}<span>slot</span></div><span className="stat-note">Periksa daya dan mode USB board</span></div>
          <div className="stat-card"><span className="stat-icon purple"><CheckCheck size={18} /></span><span className="stat-label">Dipilih</span><div className="stat-value">{selected.size}<span>perangkat</span></div><span className="stat-note">Untuk kontrol bersama</span></div>
        </div>}
        <div hidden={page !== 'ig'}><InstagramWorkspace api={api} active={page === 'ig'} bridgeOnline={bridgeOnline} devices={devices} onError={onError} notify={notify} openDevice={setFocus} /></div>

        {page === 'devices' && <>
          <div className="workspace-body">
            <section className="devices-panel">
              <div className="panel-header"><div className="panel-title"><span className="panel-icon"><LayoutGrid size={17} /></span><h2>Layar perangkat</h2><span className="count-badge">{devices.length}</span></div><div className="view-buttons"><IconButton label={paused ? 'Aktifkan semua pratinjau' : 'Jeda semua pratinjau'} onClick={() => setPaused(p => !p)}>{paused ? <Play size={16} /> : <Pause size={16} />}</IconButton><IconButton label={compact ? 'Kartu besar' : 'Kartu ringkas'} onClick={() => setCompact(c => !c)} className={compact ? 'active-icon' : ''}><Layers size={16} /></IconButton></div></div>
              <div className="devices-toolbar"><div className="filter-tabs"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Semua <span>{devices.length}</span></button><button className={filter === 'online' ? 'selected' : ''} onClick={() => setFilter('online')}>Terhubung</button><button className={filter === 'attention' ? 'selected' : ''} onClick={() => setFilter('attention')}>Perlu perhatian{waiting.length > 0 && <span>{waiting.length}</span>}</button></div><label className="search"><Search size={15} /><input placeholder="Cari perangkat…" value={search} onChange={event => setSearch(event.target.value)} aria-label="Cari nama, model, atau serial perangkat" />{search && <button onClick={() => setSearch('')} aria-label="Hapus pencarian"><X size={13} /></button>}</label></div>
              {selected.size > 0 && <div className="selection-bar"><span><CheckCheck size={15} />{selected.size} dipilih</span><label className="sync-toggle"><input type="checkbox" checked={sync} onChange={event => setSync(event.target.checked)} /><span />Kontrol sinkron</label><button onClick={() => bulkKey('home')}><Circle size={14} /> Home</button><button onClick={() => bulkKey('wake')}><Sun size={14} /> Bangunkan</button><button className="selection-clear" onClick={() => { setSelected(new Set()); setSync(false); }}>Batal</button></div>}
              <div className={`device-grid ${compact ? 'compact' : ''}`}>
                {visible.map(device => <article className={`device-card ${selected.has(device.serial) ? 'selected-card' : ''}`} key={device.serial}>
                  <div className="device-card-heading"><label className="device-selection"><input type="checkbox" checked={selected.has(device.serial)} onChange={() => toggleSelected(device.serial)} disabled={device.status !== 'device'} aria-label={`Pilih ${device.name}`} /><span>{selected.has(device.serial) && <Check size={12} />}</span></label><span className="device-name" title={device.name}>{device.name}</span><IconButton label={`Buka layar ${device.name}`} onClick={() => setFocus(device.serial)}><ArrowUpRight size={17} /></IconButton></div>
                  <div className="phone-frame"><Screen device={device} enabled={!paused && pageVisible} onInput={send} onError={onError} /><Navigation device={device} onInput={send} onError={onError} /></div>
                  <div className="device-card-meta"><div><strong>{device.model}</strong><span>{device.serial}</span></div><span className={`device-status ${device.status === 'device' ? 'online' : 'attention'}`}><i />{device.status === 'device' ? 'Online' : statusLabel(device.status)}</span></div>
                  <div className="device-card-footer"><span><Usb size={13} />{device.transport}</span>{device.android && <span>Android {device.android}</span>}{device.battery !== null && device.battery !== undefined && <span className="battery">{device.charging ? <BatteryCharging size={15} /> : <Battery size={15} />}{device.battery}%</span>}</div>
                </article>)}
                {visible.length === 0 && <div className="empty-state"><span><Smartphone size={30} /></span><h3>{!ready ? 'Menghubungkan phonefarm…' : search || filter !== 'all' ? 'Tidak ada perangkat yang cocok' : 'Menunggu perangkat kamu'}</h3><p>{search || filter !== 'all' ? 'Coba nama lain atau tampilkan semua perangkat.' : 'Sambungkan USB phonefarm ke Mac. Board yang terbaca akan muncul otomatis di sini.'}</p><button className="button secondary" onClick={search || filter !== 'all' ? () => { setSearch(''); setFilter('all'); } : scan} disabled={!bridgeOnline}>{search || filter !== 'all' ? 'Tampilkan semua' : 'Pindai perangkat'}</button></div>}
              </div>
              <div className="panel-bottom"><span><i className="dot green" />Pembaruan otomatis setiap 5 detik</span><button onClick={() => setSelected(new Set(online.map(d => d.serial)))} disabled={!online.length}><CheckCheck size={14} />Pilih semua</button></div>
            </section>
            <aside className="insights-column">
              <section className="insight-card fleet-card"><div className="insight-heading"><h3>Status farm</h3><span className="tiny-badge">LOKAL</span></div><div className="fleet-number">{online.length}<span>/ {snapshot.expectedCount}</span></div><p>perangkat siap digunakan</p><div className="slot-map" aria-label={`${online.length} terhubung, ${missing} belum terdeteksi`}>
                {Array.from({ length: Math.min(snapshot.expectedCount, 40) }, (_, index) => <span key={index} className={index < online.length ? 'connected-slot' : index < online.length + waiting.length ? 'waiting-slot' : ''} title={index < online.length ? 'Terhubung' : index < online.length + waiting.length ? 'Perlu izin' : 'Belum terdeteksi'} />)}
              </div><div className="fleet-legend"><span><i className="dot green" />Terhubung</span><span><i className="dot gray" />Belum terbaca</span></div><div className="fleet-note"><Info size={15} /><p>Slot yang belum terbaca belum tentu mati. Periksa daya, kabel, dan mode USB.</p></div><button className="text-link" onClick={() => setPage('connection')}>Lihat detail koneksi <ArrowUpRight size={15} /></button></section>
              <section className="insight-card quick-guide"><span className="guide-icon"><Command size={20} /></span><h3>Kendalikan seperti HP biasa</h3><p>Layar perangkat adalah ruang kerja kamu.</p><div className="guide-row"><span>01</span><div><strong>Klik untuk mengetuk</strong><p>Buka aplikasi langsung dari layar.</p></div></div><div className="guide-row"><span>02</span><div><strong>Seret untuk menggeser</strong><p>Scroll atau tahan untuk long press.</p></div></div><div className="guide-row"><span>03</span><div><strong>Buka mode fokus</strong><p>Layar lebih besar, kontrol lebih lengkap.</p></div></div></section>
              <div className="workspace-note"><span><Monitor size={15} />Dibuat untuk workspace Mac</span><p>Layar perangkat tersambung melalui layanan lokal di laptop ini.</p></div>
            </aside>
          </div>
        </>}

        {page === 'connection' && <div className="connection-layout"><section className="settings-card"><div className="section-heading"><Cable size={19} /><div><h2>Jalur koneksi</h2><p>Informasi langsung dari laptop ini.</p></div></div><div className="connection-step"><span className="step-icon"><Monitor size={20} /></span><div><strong>Mac · layanan lokal</strong><span>{bridgeOnline ? 'Terhubung melalui localhost' : 'Layanan belum terhubung'}</span></div><span className="status-pill"><i className="dot green" />Aktif</span></div><div className="connection-step"><span className="step-icon"><Cable size={20} /></span><div><strong>Hub phonefarm</strong><span>{connection?.usb ? `${connection.usb.hubs} hub USB · ${connection.usb.serialPorts} pengendali serial` : 'Informasi USB sedang diperiksa…'}</span></div></div><div className="connection-step"><span className="step-icon"><Smartphone size={20} /></span><div><strong>Board Android</strong><span>{snapshot.detectedCount ?? devices.length} terdeteksi · {online.length} mendapat izin · {waiting.length} perlu izin</span></div></div><div className="connection-step"><span className="step-icon"><CheckCheck size={20} /></span><div><strong>Kunci ADB tambahan</strong><span>{connection?.keyLoaded ? 'Kunci Windows tersedia untuk koneksi board tanpa layar.' : 'Menggunakan identitas ADB lokal Mac.'}</span></div></div><BoxStatus box={connection?.box} /><div className="connection-list">{devices.map(device => <div key={device.serial}><div><strong>{device.name}</strong><span>{device.serial} · {device.model}</span></div><span className={`status-pill ${device.status !== 'device' ? 'warning-pill' : ''}`}>{statusLabel(device.status)}</span></div>)}</div></section><section className="settings-card help-card"><span className="guide-icon"><Info size={21} /></span><h2>Board belum muncul?</h2><p>Perangkat perlu terbaca di USB sebelum layar bisa dibuka di panel.</p><ol><li>Pastikan daya box dan board menyala.</li><li>Periksa kabel data serta port USB ke laptop.</li><li>Untuk box GenFarmer, pastikan slot aktif berada di USB Mode.</li><li>Jika statusnya “Perlu izin”, gunakan kunci ADB dari komputer yang sudah dipercaya board.</li></ol><p>Status slot menunjukkan board yang dikenali pengendali. Untuk HP yang belum muncul di USB Mac, periksa proses boot dan jalur data board. Pemeriksaan konektor internal dilakukan saat daya box dimatikan.</p><button className="button secondary" onClick={scan} disabled={scanning || !bridgeOnline}><RefreshCw size={15} />Pindai ulang</button></section></div>}

        {page === 'settings' && <div className="connection-layout"><section className="settings-card"><div className="section-heading"><Settings2 size={19} /><div><h2>Susunan phonefarm</h2><p>Jumlah slot membantu kamu melihat berapa board yang belum terbaca.</p></div></div><form className="settings-form" onSubmit={saveSlots}><label htmlFor="slot-count">Total slot perangkat</label><div><input id="slot-count" type="number" min="1" max="200" value={slotCount} onChange={event => setSlotCount(event.target.value)} /><button className="button primary" disabled={!bridgeOnline}>Simpan</button></div><p>Angka ini adalah kapasitas farm, bukan jumlah HP yang sedang terhubung.</p></form><div className="settings-divider" /><h3>Nama perangkat</h3><p className="muted">Beri nama sesuai posisi board supaya mudah dikenali.</p><div className="connection-list">{devices.map(device => <div key={device.serial}><div><strong>{device.name}</strong><span>{device.serial}</span></div><IconButton label={`Ganti nama ${device.name}`} onClick={() => { setRename(device); setNewName(device.name); }}><Pencil size={15} /></IconButton></div>)}{!devices.length && <p className="muted">Perangkat akan muncul di sini setelah tersambung.</p>}</div></section><section className="settings-card help-card"><span className="guide-icon"><Monitor size={21} /></span><h2>Website sekarang.<br />Aplikasi Mac berikutnya.</h2><p>Versi web ini berjalan di Mac kamu dan tersambung langsung ke phonefarm. Versi aplikasi Mac direncanakan untuk tahap berikutnya.</p><div className="native-note"><strong>Versi saat ini</strong><span>Panel web lokal · v0.1.0</span><span>Layar langsung dan kontrol perangkat</span></div></section></div>}
        <footer className="main-footer"><span>phonefarm<span className="footer-dot">•</span>Ruang kendali pribadi</span><span><Usb size={12} />USB bridge aktif di Mac ini</span></footer>
      </main>
    </div>

    {focus && <div className="modal-backdrop" role="presentation" onClick={() => setFocus(null)}><section className="focus-modal" role="dialog" aria-modal="true" aria-label="Kontrol perangkat" onClick={event => event.stopPropagation()}>
      <div className="focus-heading"><div><span className="eyebrow">MODE FOKUS</span><h2>{focusedDevice?.name || 'Perangkat terputus'}</h2></div><IconButton label="Tutup mode fokus" onClick={() => setFocus(null)}><X size={21} /></IconButton></div>
      {focusedDevice ? <div className="focus-body"><div className="focus-phone"><Screen device={focusedDevice} enabled={focusedDevice.status === 'device' && pageVisible} large onInput={send} onError={onError} /><Navigation device={focusedDevice} onInput={send} onError={onError} /></div><aside className="focus-tools"><span className="status-pill"><i className={`dot ${focusedDevice.status === 'device' ? 'green' : 'gray'}`} />{statusLabel(focusedDevice.status)}</span><h3>{focusedDevice.model}</h3><dl><dt>Nomor seri</dt><dd>{focusedDevice.serial}</dd><dt>Sistem</dt><dd>{focusedDevice.android ? `Android ${focusedDevice.android}` : 'Belum tersedia'}</dd><dt>Ukuran layar</dt><dd>{focusedDevice.width ? `${focusedDevice.width} × ${focusedDevice.height}` : 'Belum tersedia'}</dd></dl><div className="focus-control-buttons"><button onClick={() => { setTextModal(focusedDevice); setText(''); }} disabled={focusedDevice.status !== 'device'}><Keyboard size={17} />Kirim teks</button><button onClick={() => screenshot(focusedDevice)} disabled={focusedDevice.status !== 'device'}><Download size={17} />Tangkapan layar</button><button onClick={() => send(focusedDevice.serial, { type: 'key', key: 'wake' }).catch(onError)} disabled={focusedDevice.status !== 'device'}><Sun size={17} />Bangunkan layar</button><button onClick={() => send(focusedDevice.serial, { type: 'key', key: 'sleep' }).catch(onError)} disabled={focusedDevice.status !== 'device'}><Moon size={17} />Tidurkan layar</button><div className="volume-controls"><button onClick={() => send(focusedDevice.serial, { type: 'key', key: 'volumeDown' }).catch(onError)} disabled={focusedDevice.status !== 'device'}><Volume1 size={17} />Volume −</button><button onClick={() => send(focusedDevice.serial, { type: 'key', key: 'volumeUp' }).catch(onError)} disabled={focusedDevice.status !== 'device'}><Volume2 size={17} />Volume +</button></div></div>{sync && selected.has(focusedDevice.serial) && selected.size > 1 && <div className="focus-sync-note"><CheckCheck size={16} />Kontrol sinkron aktif untuk {selected.size} perangkat terpilih.</div>}<p className="focus-hint">Klik dan seret pada layar.<br /><kbd>Backspace</kbd> kembali · <kbd>Home</kbd> beranda<br /><kbd>Esc</kbd> tutup mode fokus</p></aside></div> : <div className="empty-state"><Cable size={32} /><h3>Board tidak terhubung</h3><p>Sambungkan kembali board ke USB. Panel akan memperbarui daftar otomatis.</p></div>}
    </section></div>}
    {textModal && <div className="modal-backdrop nested-modal"><form className="small-modal" role="dialog" aria-modal="true" aria-label="Kirim teks" onSubmit={sendText}><div className="small-modal-heading"><h2>Kirim teks</h2><IconButton label="Tutup" onClick={() => setTextModal(null)}><X size={19} /></IconButton></div><p>Klik kolom teks di layar {textModal.name} terlebih dahulu.</p><textarea autoFocus value={text} onChange={event => setText(event.target.value)} placeholder="Tulis teks yang ingin dikirim…" maxLength={500} rows={5} /><span className="input-help">Mendukung huruf Latin, angka, dan simbol.</span><button className="button primary" disabled={!text.trim() || sending}>{sending ? 'Mengirim…' : 'Kirim ke perangkat'}<ArrowUpRight size={15} /></button></form></div>}
    {rename && <div className="modal-backdrop nested-modal"><form className="small-modal" role="dialog" aria-modal="true" aria-label="Ganti nama perangkat" onSubmit={saveName}><div className="small-modal-heading"><h2>Nama perangkat</h2><IconButton label="Tutup" onClick={() => setRename(null)}><X size={19} /></IconButton></div><p>{rename.serial}</p><input autoFocus value={newName} onChange={event => setNewName(event.target.value)} maxLength={40} required /><button className="button primary" disabled={!newName.trim()}>Simpan nama<Check size={15} /></button></form></div>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role="status">{toast.error ? <AlertCircle size={18} /> : <Check size={18} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Tutup notifikasi"><X size={15} /></button></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
