import { mkdir, appendFile, readdir, stat, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Text logs of every Instagram process (scan, check, auto comment), kept for 7 days.
export const LOG_DAYS = 7;
const KINDS = { komen: 'Auto komen', cek: 'Cek target', pindai: 'Pindai akun', link: 'Ambil link', internet: 'Internet', ttkomen: 'TikTok · Auto komen', ttcek: 'TikTok · Cek target', ttpindai: 'TikTok · Pindai akun' };
const NAME = /^(komen|cek|pindai|link|internet|ttkomen|ttcek|ttpindai)-(\d{8})-(\d{6})(?:-(\d+))?\.log$/;
const pad = n => String(n).padStart(2, '0');
const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
export const clock = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export class JobLogs {
  constructor(dir) { this.dir = dir; this.writing = Promise.resolve(); }
  async create(kind, title) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.prune();
    const base = `${kind}-${stamp(new Date())}`;
    let name = `${base}.log`;
    for (let i = 2; await exists(join(this.dir, name)); i++) name = `${base}-${i}.log`;
    const file = join(this.dir, name);
    await appendFile(file, `${KINDS[kind]} · ${title}\n`, { mode: 0o600 });
    return { id: name.slice(0, -4), file };
  }
  // Writes are queued so lines from many HP stay whole and in order.
  write(file, line) {
    if (!file) return this.writing;
    this.writing = this.writing.catch(() => {}).then(() => appendFile(file, line + '\n'));
    return this.writing;
  }
  async prune(now = Date.now()) {
    for (const name of await this.names()) {
      const path = join(this.dir, name);
      try { if (now - (await stat(path)).mtimeMs > LOG_DAYS * 86400000) await unlink(path); } catch {}
    }
  }
  async names() {
    try { return (await readdir(this.dir)).filter(name => NAME.test(name)); } catch { return []; }
  }
  async list() {
    const items = [];
    for (const name of await this.names()) {
      const [, kind, day, time] = name.match(NAME);
      let info;
      try { info = await stat(join(this.dir, name)); } catch { continue; }
      items.push({ id: name.slice(0, -4), kind, label: KINDS[kind], startedAt: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}`, size: info.size, updatedAt: info.mtime.toISOString() });
    }
    return items.sort((a, b) => b.id.localeCompare(a.id));
  }
  async read(id) {
    if (typeof id !== 'string' || !NAME.test(`${id}.log`)) throw new Error('Log tidak ditemukan.');
    const text = await readFile(join(this.dir, `${id}.log`), 'utf8').catch(() => { throw new Error('Log tidak ditemukan.'); });
    return text.length > 2_000_000 ? text.slice(-2_000_000) : text;
  }
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
