export const instagramUsername = value => (value || '').trim().replace(/^@/, '').toLowerCase();

// Inventory is from the last account scan, including phones currently offline.
// A disabled observation on any phone excludes that username from the total.
export function summarizeInstagramAccounts(devices = []) {
  const byUsername = new Map();
  for (const device of devices) {
    for (const account of device.accounts || []) {
      const username = instagramUsername(account.username);
      if (!username) continue;
      if (!byUsername.has(username)) byUsername.set(username, { username, excluded: false, devices: [] });
      const group = byUsername.get(username);
      group.excluded ||= Boolean(account.disabled);
      if (!group.devices.some(d => d.serial === device.serial)) group.devices.push({
        serial: device.serial, name: device.name || device.serial,
        online: Boolean(device.online), unverified: Boolean(device.error) || device.complete === false,
      });
    }
  }
  const accounts = [...byUsername.values()];
  return { byUsername, total: accounts.filter(a => !a.excluded).length, excluded: accounts.filter(a => a.excluded).length };
}
