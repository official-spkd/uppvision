import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { adb, input } from '../adb.mjs';
import { shellQuote } from '../core.mjs';
import { parseUi, center } from '../instagram-core.mjs';

// Every operation remains scoped to the assigned device. No network or ADB
// server changes belong in a platform adapter.
export class DeviceSession {
  constructor({ serial, log = () => {}, signal } = {}) {
    if (!serial || !/^[\w.:-]+$/.test(serial)) throw new Error('Serial perangkat tidak valid.');
    Object.assign(this, { serial, log, signal });
  }
  check() { this.signal?.throwIfAborted(); }
  async sh(...args) { this.check(); return adb(['-s', this.serial, 'shell', ...args], { timeout: 15000 }); }
  async pause(ms = 700) { this.check(); await new Promise(resolve => setTimeout(resolve, ms)); this.check(); }
  async read(attempts = 3) {
    let error;
    for (let i = 0; i < attempts; i++) {
      this.check();
      const path = `/data/local/tmp/phonefarm-live-${randomUUID()}.xml`;
      try {
        const result = await this.sh('uiautomator', 'dump', path);
        if (/ERROR|could not get idle/i.test(result)) throw new Error('Layar belum siap dibaca.');
        const xml = await adb(['-s', this.serial, 'exec-out', 'cat', path]);
        const nodes = parseUi(xml);
        if (!nodes.length) throw new Error('Layar tidak menyediakan elemen UI.');
        return nodes;
      } catch (e) { error = e; }
      finally { await adb(['-s', this.serial, 'shell', 'rm', '-f', path]).catch(() => {}); }
      if (i + 1 < attempts) await this.pause(500 + i * 300);
    }
    throw error;
  }
  async tap(node) { const [x, y] = center(node); await this.sh('input', 'tap', String(x), String(y)); }
  async back() { await this.sh('input', 'keyevent', '4'); await this.pause(); }
  async launch(packageName) {
    if (!/^[\w.]+$/.test(packageName)) throw new Error('Paket aplikasi tidak valid.');
    await this.sh('input', 'keyevent', '224');
    await this.sh('monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1');
    await this.pause(1200);
  }
  async openUrl(url, packageName) {
    if (!/^https:\/\//.test(url) || !/^[\w.]+$/.test(packageName)) throw new Error('Tautan aplikasi tidak valid.');
    await this.sh('am', 'start', '-a', 'android.intent.action.VIEW', '-d', shellQuote(url), packageName);
    await this.pause(1200);
  }
  async typeText(text) { this.check(); await input(this.serial, { type: 'text', text }); }
  async clearField(node) {
    await this.tap(node);
    await this.sh('input', 'keycombination', '113', '29');
    await this.sh('input', 'keyevent', '67');
  }
  async screenshot(path) {
    this.check();
    const data = await adb(['-s', this.serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return path;
  }
}
