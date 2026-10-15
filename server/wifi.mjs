import { adb } from './adb.mjs';
import { DeviceSession } from './live/device.mjs';

export function parseConnection(wifi, vpn, connectivity) {
  const name = wifi.match(/Wifi is connected to "(.*)"/)?.[1] || '';
  // Samsung retains the package and VPN capabilities after disconnecting.
  // Require a connected VPN network, not that stale metadata.
  const vpnActive = !/Active vpn type:\s*-1\b/.test(vpn) && connectivity.split('\n').some(l => /NetworkAgentInfo\{/.test(l) && /ni\{VPN CONNECTED/.test(l));
  const owner = vpn.match(/Active package name:\s*(\S+)/)?.[1];
  const defaultId = connectivity.match(/Active default network:\s*(\d+)/)?.[1];
  const active = connectivity.split('\n').find(l => defaultId && l.includes(`NetworkAgentInfo{network{${defaultId}}`)) || '';
  return { wifi: name, frequency: Number(wifi.match(/Frequency: (\d+)MHz/)?.[1]) || null,
    activeMethod: vpnActive ? (owner === 'com.genymobile.gnirehtet' ? 'vpn' : 'other-vpn') : /ni\{WIFI CONNECTED/.test(active) && name ? 'wifi' : /ni\{MOBILE|ni\{CELLULAR/.test(active) ? 'cellular' : 'unknown' };
}
export async function connectionInfo(serial) {
  try {
    const [wifi, vpn, connectivity] = await Promise.all([
      adb(['-s', serial, 'shell', 'cmd', 'wifi', 'status']),
      adb(['-s', serial, 'shell', 'dumpsys', 'vpn_management']),
      adb(['-s', serial, 'shell', 'dumpsys', 'connectivity']),
    ]);
    return parseConnection(wifi, vpn, connectivity);
  } catch { return { wifi: null, frequency: null, activeMethod: 'unknown' }; }
}

export function parseWifiNetworks(output) {
  const networks = new Map();
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*[\da-f:]{17}\s+(\d+)\s+(-?\d+)(?:\([^)]*\))?\s+([\d.]+)\s+(.+?)\s{2,}(\[.*)$/i);
    if (!m) continue;
    const ssid = m[4].trim(); if (!ssid) continue;
    const item = { ssid, frequency: Number(m[1]), signal: Number(m[2]), ageSeconds: Number(m[3]), secured: /WPA|RSN|WEP/.test(m[5]) };
    if (!networks.has(ssid) || networks.get(ssid).signal < item.signal) networks.set(ssid, item);
  }
  return [...networks.values()].sort((a, b) => b.signal - a.signal);
}
export async function wifiNetworks(serial) {
  try {
    await adb(['-s', serial, 'shell', 'cmd', 'wifi', 'start-scan']);
    // Scans are asynchronous; age is surfaced rather than claiming cached rows are fresh.
    return parseWifiNetworks(await adb(['-s', serial, 'shell', 'cmd', 'wifi', 'list-scan-results']));
  } catch { throw new Error('Daftar Wi-Fi belum dapat dibaca. Aktifkan Wi-Fi pada HP lalu coba lagi.'); }
}

// Samsung production firmware restricts cmd wifi connect-network to root.
// Use its normal Settings screen, including Android's saved-network credentials.
export async function connectWifi(serial, ssid, password = '') {
  const d = new DeviceSession({ serial });
  let opened = false;
  try {
    await d.sh('cmd', 'wifi', 'set-wifi-enabled', 'enabled');
    if ((await connectionInfo(serial)).wifi === ssid) return;
    await d.sh('input', 'keyevent', '224');
    await d.sh('am', 'start', '-a', 'android.settings.WIFI_SETTINGS'); opened = true;
    let selected = false, submitted = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if ((await connectionInfo(serial)).wifi === ssid) return;
      const nodes = await d.read();
      if (nodes.some(n => /incorrect password|password.*incorrect|kata sandi salah|sandi.*tidak benar|authentication error/i.test(n.text || ''))) throw new Error('Password Wi-Fi ditolak oleh HP.');
      const field = nodes.find(n => n.class === 'android.widget.EditText' && n.password === 'true');
      if (selected && field && !submitted) {
        if (!password) throw new Error('Jaringan ini meminta password. Isi password Wi-Fi lalu terapkan lagi.');
        await d.clearField(field); await d.typeText(password);
        const after = await d.read();
        const connect = after.find(n => /^(Connect|Sambung|Hubungkan)$/i.test(n.text || '') && n.enabled === 'true');
        if (!connect) throw new Error('Tombol Hubungkan belum tersedia. Periksa pengaturan Wi-Fi di layar HP.');
        await d.tap(connect); submitted = true;
      } else if (!selected) {
        const row = nodes.find(n => n.text === ssid && n.package === 'com.android.settings');
        if (row) { await d.tap(row); selected = true; }
        else if (attempt >= 2) {
          const list = nodes.find(n => n.scrollable === 'true');
          const b = list?.bounds?.match(/\d+/g)?.map(Number);
          if (b) await d.sh('input', 'swipe', String(Math.round((b[0] + b[2]) / 2)), String(b[3] - 150), String(Math.round((b[0] + b[2]) / 2)), String(b[1] + 150), '350');
        }
      } else if (!submitted) {
        const connect = nodes.find(n => /^(Connect|Sambung|Hubungkan)$/i.test(n.text || '') && n.enabled === 'true');
        if (connect) { await d.tap(connect); submitted = true; }
      }
      await d.pause(900);
    }
    throw new Error(selected ? 'HP belum tersambung ke Wi-Fi pilihan. Periksa password dan hotspot.' : 'Wi-Fi pilihan belum terlihat di HP ini. Periksa nama, jangkauan, dan band hotspot.');
  } catch (error) {
    // ADB errors can contain the command/password. Never forward their raw text.
    if (/^(Password Wi-Fi|Jaringan ini|Tombol Hubungkan|HP belum|Wi-Fi pilihan)/.test(error.message || '')) throw error;
    throw new Error('Pengaturan Wi-Fi belum berhasil. Periksa layar HP lalu coba lagi.');
  } finally { if (opened) await d.back().catch(() => {}); }
}
