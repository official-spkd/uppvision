import { instagramUsername } from './instagram-accounts.mjs';
const number = device => Number((device.name || '').match(/(\d+)\s*$/)?.[1] || device.index || Number.MAX_SAFE_INTEGER);
const order = (a, b) => number(a) - number(b) || a.serial.localeCompare(b.serial);
// Re-run after each verified logout: counts are the current total on each HP.
export function duplicateAccountPlan(devices = []) {
  const groups = new Map(), candidates = [], blocked = [], retained = [];
  for (const device of devices) for (const account of device.accounts || []) {
    const username = instagramUsername(account.username);
    if (!username) continue;
    if (!groups.has(username)) groups.set(username, []);
    if (!groups.get(username).some(d => d.serial === device.serial)) groups.get(username).push({ ...device, disabled: Boolean(account.disabled), count: device.accounts.length });
  }
  for (const [username, copies] of groups) {
    if (copies.length < 2) continue;
    const uncertain = copies.find(d => !d.online || d.error || d.complete !== true);
    if (uncertain) { blocked.push({ username, reason: `${uncertain.name}: HP offline atau daftar akun belum lengkap.` }); continue; }
    const usable = copies.filter(d => !d.disabled);
    if (!usable.length) { blocked.push({ username, reason: 'Semua salinan akun ditandai nonaktif; perlu pemeriksaan langsung.' }); continue; }
    const keep = [...usable].sort((a, b) => a.count - b.count || order(a, b))[0];
    retained.push({ username, serial: keep.serial, name: keep.name });
    for (const remove of copies.filter(d => d.serial !== keep.serial)) {
      if (remove.disabled) { blocked.push({ username, serial: remove.serial, reason: `${remove.name}: akun nonaktif belum bisa dipilih untuk logout biasa.` }); continue; }
      candidates.push({ username, serial: remove.serial, name: remove.name, count: remove.count, keepSerial: keep.serial, keepName: keep.name, keepCount: keep.count, deviceNumber: number(remove) });
    }
  }
  candidates.sort((a, b) => b.count - a.count || b.deviceNumber - a.deviceNumber || a.username.localeCompare(b.username));
  return { candidates, blocked, retained, duplicateAccounts: [...groups.values()].filter(copies => copies.length > 1).length };
}

// UI-only allocation from the last inventory, including offline/incomplete copies.
// Virtual removals follow the cleanup order; they are never proof of a logout.
export function duplicateSelectionBlocks(devices = []) {
  const remaining = devices.map(d => ({ ...d, online: true, complete: true, error: null, accounts: (d.accounts || []).map(a => ({ ...a })) }));
  const removed = [];
  for (;;) {
    const next = duplicateAccountPlan(remaining).candidates[0];
    if (!next) break;
    removed.push(next);
    const device = remaining.find(d => d.serial === next.serial);
    device.accounts = device.accounts.filter(a => instagramUsername(a.username) !== next.username);
  }
  const blocks = new Map();
  for (const item of removed) {
    const keep = remaining.find(d => d.accounts.some(a => !a.disabled && instagramUsername(a.username) === item.username));
    if (keep) blocks.set(`${item.serial}:${item.username}`, { keepSerial: keep.serial, keepName: keep.name, reason: `Sudah ada di device lain — gunakan ${keep.name}.` });
  }
  return blocks;
}
