import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { adb } from './adb.mjs';

const exec = promisify(execFile);
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'ocr', 'ocr.swift');

// Reads the text shown on an HP screen with macOS Vision. The screenshot is deleted right after reading.
export class ScreenReader {
  constructor(dataDir) { this.binary = join(dataDir, 'bin', 'ocr'); this.tmp = join(dataDir, 'tmp'); this.ready = null; }
  async build() {
    const [source, binary] = await Promise.all([stat(SOURCE), stat(this.binary).catch(() => null)]);
    if (binary && binary.mtimeMs >= source.mtimeMs) return;
    await mkdir(dirname(this.binary), { recursive: true });
    await exec('xcrun', ['swiftc', '-O', SOURCE, '-o', this.binary], { timeout: 180000 });
  }
  available() {
    this.ready ||= this.build().then(() => true, () => false);
    return this.ready;
  }
  async read(serial) { return this.extract(serial, false); }
  async readBoxes(serial) { return this.extract(serial, true); }
  async extract(serial, boxes) {
    if (!await this.available()) return null;
    await mkdir(this.tmp, { recursive: true, mode: 0o700 });
    const file = join(this.tmp, `${randomUUID()}.png`);
    try {
      const png = await adb(['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 12000 });
      await writeFile(file, png, { mode: 0o600 });
      const { stdout } = await exec(this.binary, [file, ...(boxes ? ['--boxes'] : [])], { timeout: 20000, maxBuffer: 1024 * 1024 });
      if (!boxes) return stdout.trim();
      if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20), rows = JSON.parse(stdout);
      if (!width || !height || !Array.isArray(rows)) return null;
      const pixel = (n, max) => Math.round(Math.max(0, Math.min(max, n)));
      const nodes = rows.filter(r => typeof r.text === 'string' && ['x','y','width','height','confidence'].every(k => Number.isFinite(r[k]))).map(r => ({
        text: r.text, confidence: r.confidence,
        bounds: `[${pixel(r.x * width,width)},${pixel((1-r.y-r.height)*height,height)}][${pixel((r.x+r.width)*width,width)},${pixel((1-r.y)*height,height)}]`,
      }));
      return { width, height, nodes };
    } catch { return null; } finally { await unlink(file).catch(() => {}); }
  }
}
