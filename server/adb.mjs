import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { parseDevices, inputArgs } from './core.mjs';

const exec = promisify(execFile);
export const adbPath = process.env.ADB_PATH || (existsSync('/opt/homebrew/bin/adb') ? '/opt/homebrew/bin/adb' : 'adb');
// Identitas ADB diambil dari pengaturan ADB itu sendiri; layanan tidak menambahkannya sendiri.
export const adbEnv = { ...process.env, ADB_LIBUSB: process.env.ADB_LIBUSB || '1' };
export async function adb(args, options = {}) {
  return (await exec(adbPath, args, { env: adbEnv, timeout: 8000, maxBuffer: 12 * 1024 * 1024, ...options })).stdout;
}
export function adbProcess(args) { return spawn(adbPath, args, { env: adbEnv, stdio: ['ignore', 'pipe', 'pipe'] }); }
// Process id of the running adb server; it changes whenever the server restarts (which drops every adb reverse).
export async function adbServerId() {
  try { return (await exec('/usr/bin/pgrep', ['-f', 'fork-server server'])).stdout.trim().split('\n')[0] || null; } catch { return null; }
}
export async function listDevices() { return parseDevices(await adb(['devices', '-l'])); }
export async function getDetails(serial) {
  const output = await adb(['-s', serial, 'shell', 'getprop ro.product.model; getprop ro.build.version.release; wm size; dumpsys battery']);
  const lines = output.trim().split(/\r?\n/);
  const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const size = matches.at(-1);
  return { model: lines[0], android: lines[1], width: size ? Number(size[1]) : null, height: size ? Number(size[2]) : null, battery: Number(output.match(/^\s*level:\s*(\d+)/m)?.[1] ?? NaN), charging: /(?:AC|USB|Wireless) powered: true/.test(output) };
}
export async function input(serial, action, geometry) { await adb(['-s', serial, ...inputArgs(action, geometry)]); }
export async function usbOverview() {
  if (process.platform !== 'darwin') return null;
  const { stdout } = await exec('/usr/sbin/ioreg', ['-p', 'IOUSB', '-w', '0'], { timeout: 5000 });
  return { hubs: (stdout.match(/\+-o USB Hub@/g) || []).length, android: (stdout.match(/\+-o [^@\n]*Android@/g) || []).length, serialPorts: (stdout.match(/\+-o USB Serial@/g) || []).length };
}
