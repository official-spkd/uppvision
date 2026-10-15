import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export function validateConnection(body) {
  if (!Array.isArray(body?.serials) || !body.serials.length || body.serials.length > 200 || body.serials.some(s => typeof s !== 'string' || !/^[\w.:-]+$/.test(s))) throw new Error('Pilih HP yang akan diatur.');
  if (!['vpn', 'wifi'].includes(body.method)) throw new Error('Pilih VPN lewat USB atau Wi-Fi langsung.');
  const preference = { method: body.method };
  if (body.method === 'wifi') {
    if (typeof body.ssid !== 'string' || !body.ssid.trim() || Buffer.byteLength(body.ssid) > 32 || /[\x00-\x1f]/.test(body.ssid)) throw new Error('Nama Wi-Fi harus diisi, maksimal 32 byte.');
    preference.ssid = body.ssid;
    if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 63 || /[\x00-\x1f]/.test(body.password))) throw new Error('Password Wi-Fi tidak valid.');
  }
  return { serials: [...new Set(body.serials)], preference, password: body.method === 'wifi' ? body.password || '' : '' };
}

// Only method and SSID are persisted. Android owns saved Wi-Fi credentials.
export class NetworkPolicy {
  constructor(path) { this.path = path; this.choices = {}; this.writing = Promise.resolve(); }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      for (const [serial, value] of Object.entries(data)) {
        try { this.choices[serial] = validateConnection({ serials: [serial], ...value }).preference; } catch {}
      }
    } catch {}
  }
  get(serial) { return this.choices[serial] || null; }
  async set(serials, preference) {
    const validated = validateConnection({ serials, ...preference }).preference;
    const save = this.writing.catch(() => {}).then(async () => {
      const next = { ...this.choices, ...Object.fromEntries(serials.map(s => [s, validated])) };
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path); this.choices = next;
    });
    this.writing = save; return save;
  }
}

export function matchesConnection(preference, info) {
  if (!preference) return true;
  if (preference.method === 'vpn') return info.activeMethod === 'vpn';
  return info.activeMethod === 'wifi' && info.wifi === preference.ssid;
}

export async function restoreSelectedConnection(serial, preference, adapter, options = {}) {
  if (!preference) return { online: await adapter.online(serial), relay: false, message: 'Pilih metode internet terlebih dahulu.' };
  if (preference.method === 'vpn') return adapter.vpn(serial, options);
  await adapter.stopVpn(serial);
  await adapter.wifi(serial, preference.ssid, options.password || '');
  const info = await adapter.info(serial);
  return { online: matchesConnection(preference, info) && await adapter.online(serial), relay: false };
}
