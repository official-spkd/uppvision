import { DeviceSession } from './device.mjs';
import { normalizeTarget } from '../platforms/youtube.mjs';
import { youtubePackage, screenBlocker, verificationError } from './youtube-core.mjs';

// The installed app currently fails sign-in before showing an account or search.
// This live adapter reports that observed state and never invents sending UI.
export class YouTubeAdapter extends DeviceSession {
  async launchAndRead() {
    await this.launch(youtubePackage);
    return this.read();
  }

  async scan() {
    const nodes = await this.launchAndRead();
    const error = verificationError(nodes);
    return { current: null, accounts: [], complete: false, code: error.code, reason: error.message, evidence: error.evidence };
  }

  async inspect({ target }) {
    const canonical = normalizeTarget(target);
    const nodes = await this.launchAndRead();
    const error = verificationError(nodes);
    return { target: canonical, targetLabel: null, verified: false, posts: [], account: null, code: error.code, reason: error.message, evidence: error.evidence };
  }

  async prepare() {
    throw verificationError(await this.read());
  }

  async submit() {
    // Even a caller-supplied proof cannot bypass on-device verification.
    throw verificationError(await this.read());
  }

  async clearDraft() {
    const nodes = await this.read();
    const blocker = screenBlocker(nodes);
    if (!blocker) throw verificationError(nodes);
    return { cleared: false, reason: 'Tidak ada draft yang dibuat oleh adapter YouTube; akun/channel/koneksi sedang terhalang.' };
  }
}

export default YouTubeAdapter;
