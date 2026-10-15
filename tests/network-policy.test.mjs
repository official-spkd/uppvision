import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NetworkPolicy, validateConnection, matchesConnection, restoreSelectedConnection } from '../server/network-policy.mjs';
import { parseConnection, parseWifiNetworks } from '../server/wifi.mjs';
import { InternetWatch } from '../server/internet.mjs';

test('manual preferences persist across reloads but Wi-Fi passwords never enter the saved file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phonefarm-network-'));
  try {
    const path = join(dir, 'network.json'), policy = new NetworkPolicy(path);
    const input = validateConnection({ serials: ['a', 'a', 'b'], method: 'wifi', ssid: 'Wi-Fi test', password: 'test-only-password' });
    assert.deepEqual(input.serials, ['a', 'b']);
    await policy.set(input.serials, { ...input.preference, password: input.password });
    await policy.set(['c'], { method: 'vpn' });
    const text = await readFile(path, 'utf8');
    assert.ok(!text.includes('password'));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const reloaded = new NetworkPolicy(path); await reloaded.load();
    assert.deepEqual(reloaded.get('a'), { method: 'wifi', ssid: 'Wi-Fi test' });
    assert.deepEqual(reloaded.get('b'), reloaded.get('a'));
    assert.deepEqual(reloaded.get('c'), { method: 'vpn' });
    assert.equal(reloaded.get('new-phone'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('invalid methods, device lists and Wi-Fi inputs are rejected before applying', () => {
  for (const input of [{}, { serials: ['a'], method: 'auto' }, { serials: ['a'], method: 'wifi', ssid: '' }, { serials: ['a;reboot'], method: 'vpn' }, { serials: ['a'], method: 'wifi', ssid: 'x'.repeat(33) }]) assert.throws(() => validateConnection(input));
  assert.equal(validateConnection({ serials: ['a'], method: 'wifi', ssid: "Wi-Fi ' $(not-a-command)", password: 'p'.repeat(8) }).preference.ssid, "Wi-Fi ' $(not-a-command)");
});
test('Wi-Fi failure never invokes VPN recovery, and a wrong network never counts as success', async () => {
  const calls = [];
  const adapter = { stopVpn: async () => calls.push('stop-vpn'), wifi: async () => { calls.push('wifi'); throw new Error('Wi-Fi failed'); }, vpn: async () => calls.push('vpn'), online: async () => true, info: async () => ({ activeMethod: 'wifi', wifi: 'wrong' }) };
  await assert.rejects(restoreSelectedConnection('a', { method: 'wifi', ssid: 'chosen' }, adapter), /Wi-Fi failed/);
  assert.deepEqual(calls, ['stop-vpn', 'wifi']);
  adapter.wifi = async () => {};
  assert.equal((await restoreSelectedConnection('a', { method: 'wifi', ssid: 'chosen' }, adapter)).online, false);
  assert.equal(matchesConnection({ method: 'wifi', ssid: 'chosen' }, { activeMethod: 'vpn', wifi: 'chosen' }), false);
});
test('VPN recovery uses only the VPN adapter and unconfigured HP are observed without mutation', async () => {
  const calls = [];
  const adapter = { vpn: async () => { calls.push('vpn'); return { online: true }; }, wifi: async () => calls.push('wifi'), stopVpn: async () => calls.push('stop'), online: async () => true };
  await restoreSelectedConnection('a', { method: 'vpn' }, adapter);
  await restoreSelectedConnection('b', null, adapter);
  assert.deepEqual(calls, ['vpn']);
});
test('active VPN is distinguished from its underlying Wi-Fi and from an inactive VPN package', () => {
  const wifi = 'Wifi is connected to "putri"\nFrequency: 5220MHz';
  const wifiConn = 'Active default network: 104\n  NetworkAgentInfo{network{104} ni{WIFI CONNECTED extra: }';
  const conn = wifiConn + '\n  NetworkAgentInfo{network{103} ni{VPN CONNECTED extra: }';
  const vpn = 'Active package name: com.genymobile.gnirehtet\nNetworkCapabilities: [ Transports: VPN Capabilities: INTERNET ]';
  assert.equal(parseConnection(wifi, vpn, conn).activeMethod, 'vpn');
  assert.equal(parseConnection(wifi, vpn.replace('com.genymobile.gnirehtet', 'example.vpn'), conn).activeMethod, 'other-vpn');
  assert.equal(parseConnection(wifi, 'Active package name: com.genymobile.gnirehtet', wifiConn).activeMethod, 'wifi');
  assert.equal(parseConnection(wifi, vpn + '\nActive vpn type: -1', wifiConn).activeMethod, 'wifi', 'disconnected Samsung VPN retains capabilities');
  assert.equal(parseConnection('', '', '').activeMethod, 'unknown');
});
test('Wi-Fi scan keeps SSIDs with spaces, deduplicates bands and reports cached age', () => {
  const output = '  da:a0:e9:c6:d5:9f  5240  -63(0:-64/1:-73)  433.439  My WiFi  [WPA2-PSK-CCMP][ESS]\n  da:a0:e9:c6:d5:90  2412  -80  5.1  My WiFi  [ESS]\n  da:a0:e9:c6:d5:91  2412  -50  4.2  Open WiFi  [ESS]';
  const list = parseWifiNetworks(output);
  assert.equal(list.length, 2); assert.equal(list[0].ssid, 'Open WiFi');
  assert.equal(list[1].frequency, 5240); assert.equal(list[1].secured, true); assert.equal(list[1].ageSeconds, 433.439);
});
test('check-only does not restart even a strained relay or recover an offline HP', async () => {
  const w = new InternetWatch({ devices: () => [{ serial: 'a', status: 'device' }],
    net: { preference: () => ({ method: 'vpn' }), relayStrained: async () => true, restartRelay: async () => assert.fail('read-only check restarted relay'), phoneOnline: async () => false, restoreInternet: async () => assert.fail('read-only check restored HP') },
    logs: { create: async () => null, write() {} }, settle: 0 });
  await w.check(null, { manual: true, repair: false });
  assert.equal(w.status.get('a').state, 'offline');
});
test('a connected Wi-Fi with a stray USB VPN is repaired through the saved Wi-Fi choice', async () => {
  let activeMethod = 'vpn'; let repairs = 0;
  const w = new InternetWatch({ devices: () => [{ serial: 'a', status: 'device' }],
    net: { preference: () => ({ method: 'wifi', ssid: 'chosen' }), relayStrained: async () => assert.fail('Wi-Fi mode must not manage relay'), phoneOnline: async () => true,
      connectionInfo: async () => ({ activeMethod, wifi: 'chosen' }), restoreInternet: async () => { repairs++; activeMethod = 'wifi'; return { online: true, relay: false }; } },
    logs: { create: async () => null, write() {} }, settle: 0 });
  await w.check(); assert.equal(repairs, 1); assert.equal(w.status.get('a').activeMethod, 'wifi');
  assert.equal(w.status.get('a').state, 'online');
});
