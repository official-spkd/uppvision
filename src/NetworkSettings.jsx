import React, { useEffect, useRef, useState } from 'react';
import { Wifi, Cable, RefreshCw, Check } from 'lucide-react';
import { connectionStatus } from './connection-status.mjs';

export const methodLabel = method => ({ vpn: 'VPN lewat USB', wifi: 'Wi-Fi langsung', 'other-vpn': 'VPN lain', cellular: 'Data seluler', unknown: 'Belum diketahui' })[method] || 'Belum dipilih';

export default function NetworkSettings({ devices, internet, preferences, api, onUpdate, onError, notify, initialSerial, enabled }) {
  const [selected, setSelected] = useState(new Set()), [method, setMethod] = useState('wifi'), [ssid, setSsid] = useState(''), [password, setPassword] = useState('');
  const [networks, setNetworks] = useState([]), [scanning, setScanning] = useState(false), [applying, setApplying] = useState(false), [results, setResults] = useState([]);
  const form = useRef(null);
  const online = devices.filter(d => d.status === 'device');
  const targets = online.filter(d => selected.has(d.serial));
  const edit = serial => {
    const choice = preferences[serial]; setSelected(new Set([serial])); setMethod(choice?.method || 'wifi');
    setSsid(choice?.ssid || internet[serial]?.wifi || ''); setPassword(''); setNetworks([]); setResults([]);
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  useEffect(() => { if (initialSerial) edit(initialSerial); }, [initialSerial]);
  useEffect(() => {
    const available = new Set(online.map(d => d.serial));
    setSelected(old => new Set([...old].filter(s => available.has(s))));
  }, [devices]);
  const scan = async () => {
    if (!targets.length) return;
    setScanning(true);
    try { setNetworks((await api(`/api/internet/${encodeURIComponent(targets[0].serial)}/wifi`)).networks); }
    catch (error) { onError(error); } finally { setScanning(false); }
  };
  const apply = async event => {
    event.preventDefault(); setApplying(true); setResults([]);
    try {
      const data = await api('/api/internet/method', { method: 'POST', body: JSON.stringify({ serials: targets.map(d => d.serial), method, ...(method === 'wifi' ? { ssid, password } : {}) }) });
      onUpdate(data); setResults(data.results);
      const ok = data.results.filter(r => r.ok).length;
      notify(`${ok}/${data.results.length} HP berhasil memakai metode pilihan.`);
    } catch (error) { onError(error); }
    finally { setPassword(''); setApplying(false); }
  };
  const check = serial => api(`/api/internet/${encodeURIComponent(serial)}/check`, { method: 'POST' }).then(onUpdate).catch(onError);
  const reconnect = serial => api(`/api/internet/${encodeURIComponent(serial)}/reconnect`, { method: 'POST' }).then(onUpdate).catch(onError);
  return <section className="settings-card network-settings" aria-label="Metode internet HP">
    <div className="ig-section-heading"><div><h2>Internet HP</h2><p>Pilih VPN lewat USB atau Wi-Fi langsung. Metode disimpan per HP dan tidak berpindah otomatis.</p></div><span className="tiny-badge">PILIHAN MANUAL</span></div>
    <form onSubmit={apply} ref={form} className="network-form">
      <fieldset disabled={applying || !enabled}><legend>Metode untuk {targets.length} HP dipilih</legend><div className="network-methods">
        <label className={method === 'vpn' ? 'selected' : ''}><input type="radio" name="internet-method" checked={method === 'vpn'} onChange={() => { setMethod('vpn'); setPassword(''); }} /><Cable size={21} /><span><strong>VPN lewat USB</strong><small>Internet dari Mac melalui kabel USB.</small></span></label>
        <label className={method === 'wifi' ? 'selected' : ''}><input type="radio" name="internet-method" checked={method === 'wifi'} onChange={() => setMethod('wifi')} /><Wifi size={21} /><span><strong>Wi-Fi langsung</strong><small>Internet dari router atau hotspot. VPN USB dihentikan.</small></span></label>
      </div>
      {method === 'vpn' && <p className="network-vpn-note">Jika relay di Mac macet, pemulihan dapat menyambungkan ulang HP lain yang memakai VPN. Pemulihan relay menunggu tidak ada pekerjaan berjalan.</p>}
      {method === 'wifi' && <div className="network-wifi-fields"><label>Nama Wi-Fi<input list="phonefarm-wifi-networks" value={ssid} onChange={e => setSsid(e.target.value)} placeholder="Pilih atau ketik nama Wi-Fi" required maxLength={32} autoComplete="off" /><datalist id="phonefarm-wifi-networks">{networks.map(n => <option key={n.ssid} value={n.ssid}>{n.frequency >= 4900 ? '5/6 GHz' : '2,4 GHz'} · {n.secured ? 'Dengan password' : 'Terbuka'}</option>)}</datalist></label><label>Password Wi-Fi<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Kosongkan jika sudah tersimpan di HP" maxLength={63} autoComplete="new-password" /></label><button type="button" className="button secondary" disabled={!targets.length || scanning} onClick={scan}><RefreshCw size={14} className={scanning ? 'spin' : ''} />{scanning ? 'Membaca…' : 'Cari Wi-Fi'}</button><small>Password disimpan oleh Android, bukan di file panel. Daftar Wi-Fi dibaca dari {targets[0]?.name || 'HP pertama yang dipilih'}; jangkauan tiap HP dapat berbeda.{networks.some(n => n.ageSeconds > 60) ? ' Sebagian hasil pemindaian lama; cari ulang jika jaringan belum terlihat.' : ''}</small></div>}
      <div className="network-apply"><span>{targets.length ? targets.map(d => d.name).join(' · ') : 'Centang HP pada daftar di bawah, atau klik Atur pada satu HP.'}</span><button className="button primary" disabled={!targets.length || (method === 'wifi' && !ssid.trim()) || applying}><Check size={15} />{applying ? 'Menerapkan dan memeriksa…' : `Terapkan ke ${targets.length} HP`}</button></div>
      </fieldset>
    </form>
    {results.length > 0 && <div className="network-results" role="status">{results.map(r => <p key={r.serial} className={r.ok ? 'success' : 'ig-error'}><strong>{devices.find(d => d.serial === r.serial)?.name || r.serial}:</strong> {r.ok ? 'Internet terverifikasi melalui metode pilihan.' : r.message}</p>)}</div>}
    <div className="ig-select-actions"><button className="text-link" disabled={applying || !enabled} onClick={() => setSelected(new Set(online.map(d => d.serial)))}>Pilih semua HP online</button><button className="text-link" disabled={applying} onClick={() => setSelected(new Set())}>Hapus pilihan</button></div>
    <div className="network-device-list">{devices.map(d => {
      const info = internet[d.serial] || {}, preference = preferences[d.serial], busy = applying || info.state === 'restoring', offline = d.status !== 'device';
      const check = connectionStatus(info);
      return <article key={d.serial} className="network-device"><label><input type="checkbox" aria-label={`Atur internet ${d.name}`} checked={selected.has(d.serial)} disabled={offline || applying || !enabled} onChange={() => setSelected(old => { const next = new Set(old); next.has(d.serial) ? next.delete(d.serial) : next.add(d.serial); return next; })} /><strong>{d.name}</strong></label><div><span>Pilihan: <b>{methodLabel(preference?.method)}</b>{preference?.ssid ? ` · ${preference.ssid}` : ''}</span><span>Jalur aktif: {offline ? 'HP offline' : methodLabel(info.activeMethod || 'unknown')}{!offline && info.wifi ? ` · Wi-Fi: ${info.wifi}` : ''}</span><small>{offline ? 'Sambungkan HP untuk mengubah metode.' : `${check.message} · ${check.age}${check.warning ? ` · ${check.warning}` : ''}`}</small></div><div className="network-row-actions"><button className="button secondary" type="button" disabled={busy || offline || !enabled} onClick={() => edit(d.serial)}>Atur</button><button className="text-link" type="button" disabled={busy || offline || !enabled} onClick={() => check(d.serial)}>Cek internet</button><button className="text-link" type="button" disabled={busy || offline || !enabled || !preference} onClick={() => reconnect(d.serial)}>Sambungkan ulang</button></div></article>;
    })}</div>
  </section>;
}
