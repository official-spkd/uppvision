import { DeviceSession } from './device.mjs';
import { normalizeTarget } from '../platforms/x.mjs';

export function xScreenBlocker(nodes) {
  const own = nodes.filter(node => node.package === 'com.twitter.android');
  const login = own.find(node => /Login with username/.test(node.text || ''));
  const phone = own.find(node => node.text === 'Continue with Phone');
  if (login && phone) return {
    code: 'X_LOGIN_REQUIRED',
    reason: 'X masih menampilkan layar login. Akun aktif belum tersedia untuk uji balasan.',
    evidence: [login, phone].map(node => ({ text: node.text })),
  };
  return { code: 'X_UI_UNVERIFIED', reason: 'Akun, target, dan kontrol balasan X belum terverifikasi.', evidence: [] };
}

// All three inspected devices showed the login screen. Sending remains disabled
// until a real authenticated reply screen can be observed and verified.
export class XAdapter extends DeviceSession {
  async scan() {
    await this.launch('com.twitter.android');
    return { current: null, accounts: [], complete: false, ...xScreenBlocker(await this.read()) };
  }
  async inspect({ target }) {
    const canonical = normalizeTarget(target);
    const state = await this.scan();
    return { target: canonical, targetLabel: null, verified: false, account: null, posts: [], code: state.code, reason: state.reason, evidence: state.evidence };
  }
  async prepare() { const state = xScreenBlocker(await this.read()); throw Object.assign(new Error(state.reason), { code: state.code }); }
  async submit() { return this.prepare(); }
  async clearDraft() { return { cleared: false, reason: 'Adapter X belum membuat draft.' }; }
}

export default XAdapter;
