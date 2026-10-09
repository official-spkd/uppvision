import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { adb, adbEnv, adbPath } from './adb.mjs';

const exec = promisify(execFile);
const GNIREHTET = process.env.GNIREHTET_PATH || (existsSync('/opt/homebrew/bin/gnirehtet') ? '/opt/homebrew/bin/gnirehtet' : 'gnirehtet');
const APK = process.env.GNIREHTET_APK || '/opt/homebrew/opt/gnirehtet/libexec/gnirehtet.apk';
const env = { ...adbEnv, ADB: adbPath, GNIREHTET_APK: APK, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}` };

// Mac reaches Instagram.
export async function macOnline() {
  try { await fetch('https://i.instagram.com/', { method: 'HEAD', signal: AbortSignal.timeout(6000) }); return true; } catch { return false; }
}
// The HP resolves Instagram. Over gnirehtet ICMP replies never arrive, but a resolved address proves
// the HP reaches DNS through the relay and the Mac's internet.
export async function phoneOnline(serial) {
  try {
    const out = await adb(['-s', serial, 'shell', 'ping -c 1 -W 3 i.instagram.com 2>&1; true'], { timeout: 9000 });
    return /^PING\s+\S+\s+\(\d+\.\d+\.\d+\.\d+\)/m.test(out);
  } catch { return false; }
}
export async function relayRunning() {
  try { await exec('/usr/bin/pgrep', ['-f', 'gnirehtet relay']); return true; } catch { return false; }
}
// Starts the reverse-tethering relay if it is not running, then reconnects the HP's VPN.
export async function restoreInternet(serial) {
  let relay = false;
  if (!await relayRunning()) {
    spawn(GNIREHTET, ['relay'], { env, detached: true, stdio: 'ignore' }).unref();
    relay = true;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  try { await exec(GNIREHTET, ['start', serial], { env, timeout: 20000 }); } catch {}
  await new Promise(resolve => setTimeout(resolve, 3000));
  return { relay, online: await phoneOnline(serial) };
}
