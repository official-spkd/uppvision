import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, openSync, closeSync, readSync, fstatSync } from 'node:fs';
import { adb, adbEnv, adbPath } from './adb.mjs';
import { connectionInfo, connectWifi } from './wifi.mjs';
import { matchesConnection, restoreSelectedConnection } from './network-policy.mjs';

let preferenceFor = () => null;
export const configureNetwork = getPreference => { preferenceFor = getPreference; };
export const networkPreference = serial => preferenceFor(serial);

const exec = promisify(execFile);
const GNIREHTET = process.env.GNIREHTET_PATH || (existsSync('/opt/homebrew/bin/gnirehtet') ? '/opt/homebrew/bin/gnirehtet' : 'gnirehtet');
const APK = process.env.GNIREHTET_APK || '/opt/homebrew/opt/gnirehtet/libexec/gnirehtet.apk';
const env = { ...adbEnv, ADB: adbPath, GNIREHTET_APK: APK, PATH: `/opt/homebrew/bin:${process.env.PATH || ''}` };

// Mac reaches Instagram.
export async function macOnline() {
  try { await fetch('https://i.instagram.com/', { method: 'HEAD', signal: AbortSignal.timeout(6000) }); return true; } catch { return false; }
}
// The HP opens a real HTTPS connection to Instagram (curl on the HP). A DNS lookup alone is not enough:
// Android caches addresses, so a cut tunnel can still "resolve" for a while.
export async function phoneOnline(serial, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const out = await adb(['-s', serial, 'shell', "curl -s -o /dev/null -m 6 -w '%{http_code}' https://i.instagram.com/ 2>/dev/null; echo; command -v curl >/dev/null || echo NOCURL"], { timeout: 12000 });
      if (/^[1-5]\d\d$/m.test(out)) return true;
      if (/NOCURL/.test(out)) return pingOnline(serial);
    } catch {}
  }
  return false;
}
async function pingOnline(serial) {
  try {
    const out = await adb(['-s', serial, 'shell', 'ping -c 1 -W 3 i.instagram.com 2>&1; true'], { timeout: 9000 });
    return /(?:bytes from |[1-9]\d* (?:packets )?received)/i.test(out);
  } catch { return false; }
}
// Name of the Wi-Fi the HP is joined to, or "" when it has none. TikTok needs a real network under the
// tethering VPN (it reports "No internet" without one), even though traffic still goes through the Mac.
export async function wifiName(serial) {
  try { return (await adb(['-s', serial, 'shell', 'cmd', 'wifi', 'status'], { timeout: 8000 })).match(/connected to "([^"]*)"/i)?.[1] || ''; } catch { return null; }
}
export async function relayRunning() {
  try { await exec('/usr/bin/pgrep', ['-f', 'gnirehtet relay']); return true; } catch { return false; }
}
// Restores an HP's internet in steps: restart its gnirehtet client; if that is not enough, restart the relay
// (every HP reconnects to a fresh relay by itself). HP are handled one at a time.
let queue = Promise.resolve(), relayLog = null, relayStartedAt = 0;
export function setRelayLog(path) { relayLog = path; }
export function restoreInternet(serial, options = {}) {
  const restore = async () => {
    const preference = preferenceFor(serial);
    const result = await restoreSelectedConnection(serial, preference, {
      online: phoneOnline, info: connectionInfo, wifi: connectWifi, stopVpn,
      vpn: async (s, opts) => {
        const info = await connectionInfo(s);
        if (info.activeMethod === 'other-vpn') throw new Error('HP sedang memakai VPN lain. Putuskan VPN tersebut di HP terlebih dahulu.');
        return restoreOne(s, opts);
      },
    }, options);
    return { ...result, online: result.online && matchesConnection(preference, await connectionInfo(serial)) };
  };
  const job = queue.then(restore, restore);
  queue = job.catch(() => {});
  return job;
}
async function stopVpn(serial) {
  const before = await connectionInfo(serial);
  if (before.activeMethod === 'other-vpn') throw new Error('HP sedang memakai VPN lain. Putuskan VPN tersebut di HP terlebih dahulu.');
  try { await exec(GNIREHTET, ['stop', serial], { env, timeout: 15000 }); }
  catch { throw new Error('VPN USB belum dapat dihentikan pada HP ini.'); }
  await adb(['-s', serial, 'shell', 'am', 'force-stop', 'com.genymobile.gnirehtet']);
  if (['vpn', 'other-vpn', 'unknown'].includes((await connectionInfo(serial)).activeMethod)) {
    // No Wi-Fi yet legitimately reports unknown; only an active VPN is a conflict.
    await sleep(500);
    const info = await connectionInfo(serial);
    if (['vpn', 'other-vpn'].includes(info.activeMethod)) throw new Error('VPN masih aktif; Wi-Fi langsung belum diterapkan.');
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The relay slowly leaks sockets (about 10,000 after two hours with a full box). Near its open-file limit
// it drops new connections from every HP ("Too many open files"), so it is restarted before that.
export const RELAY_MAX_FILES = 7000;
export async function relayStrained() {
  try {
    const pid = (await exec('/usr/bin/pgrep', ['-f', 'gnirehtet relay'])).stdout.trim().split('\n')[0];
    if (pid) {
      const { stdout } = await exec('/bin/sh', ['-c', `/usr/sbin/lsof -nP -p ${Number(pid)} 2>/dev/null | wc -l`], { timeout: 30000 });
      if (Number(stdout.trim()) > RELAY_MAX_FILES) return true;
    }
  } catch {}
  return relayLog ? /Too many open files/.test(logTail(relayLog, 16384)) : false;
}
function logTail(path, bytes) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size, length = Math.min(bytes, size), buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}
export function restartRelay() {
  const job = queue.then(startRelay, startRelay);
  queue = job.catch(() => {});
  return job;
}
async function startRelay() {
  try { await exec('/usr/bin/pkill', ['-f', 'gnirehtet relay']); await sleep(1000); } catch {}
  const out = relayLog ? openSync(relayLog, 'w') : 'ignore';
  // Every HP's connections are open files in the relay; launchd's default limit (256) is far too low for a
  // full box and makes the relay drop packets ("Too many open files"), so the limit is raised first.
  spawn('/bin/sh', ['-c', 'ulimit -n 10240 2>/dev/null || ulimit -n 4096; exec "$0" relay', GNIREHTET], { env, detached: true, stdio: ['ignore', out, out] }).unref();
  if (typeof out === 'number') closeSync(out);
  relayStartedAt = Date.now();
  await sleep(2500);
}
async function restartClient(serial) {
  try { await exec(GNIREHTET, ['stop', serial], { env, timeout: 15000 }); } catch {}
  // A stopped VpnService can retain blocked RelayTunnel threads. Recreate only
  // this client's process and reverse mapping instead of disrupting the relay.
  await adb(['-s', serial, 'shell', 'am', 'force-stop', 'com.genymobile.gnirehtet']);
  await adb(['-s', serial, 'reverse', '--remove', 'localabstract:gnirehtet']).catch(() => {});
  await sleep(1000);
  try { await exec(GNIREHTET, ['start', serial], { env, timeout: 20000 }); } catch {}
  await sleep(4000);
}
// Waits a moment for the tunnel to come up before calling an HP offline.
async function settled(serial) {
  for (let i = 0; i < 2; i++) { if (await phoneOnline(serial, 1)) return true; await sleep(3000); }
  return phoneOnline(serial, 1);
}
// Waits for an HP to come back by itself (after a relay restart every HP reconnects within ~10 s).
async function cameBack(serial, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(3000)) if (await phoneOnline(serial, 1)) return true;
  return false;
}
async function restoreOne(serial, { relayRestart = true } = {}) {
  let relay = false;
  if (!await relayRunning()) {
    await startRelay(); relay = true;
  }
  await restartClient(serial);
  if (await settled(serial)) return { relay, online: true };
  // A tunnel app stuck at "Requesting client id" does not recover from its own restart; it recovers when the relay
  // drops its connection. Restarting the app right after the relay restart can leave it stuck again, so the HP
  // first gets time to reconnect by itself.
  if (relayRestart && Date.now() - relayStartedAt > 60000) {
    await startRelay(); relay = true;
    if (await cameBack(serial)) return { relay, online: true };
    await restartClient(serial);
  }
  return { relay, online: await settled(serial) };
}
