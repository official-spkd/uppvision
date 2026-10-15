export function parseDevices(output) {
  return output.split('\n').filter(line => line.trim() && !line.startsWith('List of') && !line.startsWith('*')).map(line => {
    const [serial, status, ...parts] = line.trim().split(/\s+/);
    const fields = Object.fromEntries(parts.filter(p => p.includes(':')).map(p => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }));
    return { serial, status, model: fields.model?.replaceAll('_', '-') || 'Android', product: fields.product || '', transport: fields.usb ? 'USB' : 'Wi-Fi', transportId: fields.transport_id || null };
  }).filter(d => d.serial && ['device', 'unauthorized', 'offline', 'recovery', 'sideload'].includes(d.status));
}

export function shellQuote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

export function inputArgs(action, geometry) {
  const allowedKeys = { back: 4, home: 3, recent: 187, wake: 224, sleep: 223, volumeUp: 24, volumeDown: 25, enter: 66, delete: 67 };
  if (action.type === 'key' && Object.hasOwn(allowedKeys, action.key)) return ['shell', 'input', 'keyevent', String(allowedKeys[action.key])];
  if (action.type === 'text') {
    if (typeof action.text !== 'string' || !action.text.length || action.text.length > 500 || /[^\x20-\x7e\n]/.test(action.text)) throw new Error('Gunakan teks Latin, angka, atau simbol, maksimal 500 karakter.');
    return ['shell', 'input', 'text', shellQuote(action.text.replaceAll('\n', ' ').replaceAll(' ', '%s'))];
  }
  if (!['tap', 'swipe'].includes(action.type)) throw new Error('Kontrol tidak dikenal.');
  if (!geometry || !Number.isFinite(geometry.width) || !Number.isFinite(geometry.height)) throw new Error('Ukuran layar belum tersedia.');
  const coordinate = (value, size) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Koordinat layar tidak valid.');
    return String(Math.round(value * (size - 1)));
  };
  const start = [coordinate(action.x, geometry.width), coordinate(action.y, geometry.height)];
  if (action.type === 'tap') return ['shell', 'input', 'tap', ...start];
  const duration = action.duration ?? 300;
  if (!Number.isFinite(duration) || duration < 50 || duration > 2000) throw new Error('Durasi geser tidak valid.');
  return ['shell', 'input', 'swipe', ...start, coordinate(action.endX, geometry.width), coordinate(action.endY, geometry.height), String(Math.round(duration))];
}

// JPEG markers may cross process stdout chunks; keep incomplete frames until the next chunk.
export class JpegParser {
  constructor(onFrame) { this.buffer = Buffer.alloc(0); this.onFrame = onFrame; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const start = this.buffer.indexOf(Buffer.from([255, 216]));
      if (start < 0) { this.buffer = this.buffer.subarray(-1); return; }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const end = this.buffer.indexOf(Buffer.from([255, 217]), 2);
      if (end < 0) { if (this.buffer.length > 8 * 1024 * 1024) this.buffer = Buffer.alloc(0); return; }
      const frame = this.buffer.subarray(0, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      this.onFrame(frame);
    }
  }
}
