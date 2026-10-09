import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/read-box.py', import.meta.url));
let cached = null, pending = null, checkedAt = 0;
export async function boxStatus() {
  if (process.platform !== 'darwin') return { available: false, error: 'Pembacaan pengendali tersedia di Mac.' };
  if (cached && Date.now() - checkedAt < 30000) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { stdout } = await exec(process.env.PYTHON_PATH || 'python3', [script], { timeout: 11000, maxBuffer: 128 * 1024 });
      cached = JSON.parse(stdout);
    } catch {
      cached = { available: false, error: 'Status pengendali belum tersedia. Periksa USB dan Python 3.' };
    }
    checkedAt = Date.now();
    return cached;
  })().finally(() => { pending = null; });
  return pending;
}
