import { DeviceSession } from './device.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTarget } from '../platforms/facebook.mjs';
import { findLabel, ownIdentity, pageIdentity, postIdentity, composer, verifyDraft, sendButton, sameReel, renderedComment } from './facebook-core.mjs';

const packageName = 'com.facebook.katana';

export class FacebookAdapter extends DeviceSession {
  constructor(options) {
    super(options);
    this.pendingDir = options.pendingDir || '.phonefarm/verification/facebook/attempts';
    this.proofs = new Map();
  }
  async persist(record, exclusive = false) {
    await mkdir(this.pendingDir, { recursive: true, mode: 0o700 });
    const path = join(this.pendingDir, `${record.key}.json`);
    const destination = exclusive ? path : `${path}.${randomUUID()}.tmp`;
    const file = await open(destination, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record, null, 2)); await file.sync(); }
    finally { await file.close(); }
    if (!exclusive) await rename(destination, path);
    const directory = await open(this.pendingDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return path;
  }
  async swipeUp(nodes) {
    const root = nodes.find(node => /^\[0,0\]/.test(node.bounds || ''));
    const bounds = root?.bounds?.match(/\d+/g)?.map(Number);
    if (!bounds) throw new Error('Ukuran layar Facebook belum terbaca.');
    const [, , width, height] = bounds;
    await this.sh('input', 'swipe', String(Math.round(width * .5)), String(Math.round(height * .82)), String(Math.round(width * .5)), String(Math.round(height * .36)), '650');
    await this.pause();
  }
  async scan() {
    await this.launch(packageName);
    await this.openUrl('https://www.facebook.com/me', packageName);
    let nodes = await this.read();
    const ownProfile = findLabel(nodes, /^Go to profile$/);
    if (ownProfile) { await this.tap(ownProfile); await this.pause(); nodes = await this.read(); }
    const menu = findLabel(nodes, /^More profile settings$/);
    if (!menu) throw new Error('Menu profil Facebook aktif belum ditemukan; buka profil sendiri pada aplikasi.');
    await this.tap(menu); await this.pause();
    for (let attempt = 0; attempt < 5; attempt++) {
      nodes = await this.read();
      if (findLabel(nodes, /^Your profile link$/) && findLabel(nodes, /^Copy .+['’]s link$/)) {
        const account = ownIdentity(nodes); this.currentAccount = account;
        await this.back();
        // Only the active account URL has been verified; do not manufacture IDs for other rows.
        return { current: account, accounts: [account], complete: false };
      }
      await this.swipeUp(nodes);
    }
    throw new Error('Link akun Facebook aktif belum terlihat setelah membuka pengaturan profil.');
  }
  async inspect({ target, limit = 1 }) {
    if (limit !== 1) throw new Error('Pemeriksaan Facebook langsung saat ini dibatasi satu postingan.');
    const canonical = normalizeTarget(target);
    const { current: account } = await this.scan();
    await this.openUrl(canonical, packageName);
    let nodes = await this.read();
    const menu = findLabel(nodes, /^More profile settings$/);
    if (!menu) throw new Error('Menu identitas target Facebook belum terlihat.');
    await this.tap(menu); await this.pause();
    const page = pageIdentity(await this.read(), canonical);
    await this.back();
    for (let attempt = 0; attempt < 7; attempt++) {
      nodes = await this.read();
      const timestamp = findLabel(nodes, /Shared with: Public$/);
      const pinned = findLabel(nodes, /^(Pinned post|Pinned|Featured)$/);
      if (timestamp && !pinned) {
        await this.tap(timestamp); await this.pause();
        nodes = await this.read();
        const post = postIdentity(nodes, page), input = composer(nodes);
        if (input?.displayName !== account.displayName) throw new Error('Akun pada kolom komentar Facebook berbeda dari akun aktif terverifikasi.');
        this.inspection = { ...page, posts: [post], account };
        return this.inspection;
      }
      await this.swipeUp(nodes);
    }
    throw new Error('Postingan publik Halaman Facebook belum ditemukan; status pin belum dapat dipastikan.');
  }
  async prepare({ target, post, account, text, postUrl = null }) {
    const inspected = this.inspection;
    if (!inspected || normalizeTarget(target) !== inspected.target || inspected.account.username !== account?.username || inspected.account.displayName !== account?.displayName || inspected.posts[0].id !== post?.id) throw new Error('Periksa Halaman, akun, dan postingan Facebook pada sesi ini sebelum menyiapkan draft.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Teks komentar Facebook tidak valid.');
    if (postUrl && !/^https:\/\/www\.facebook\.com\/share\/r\/[A-Za-z0-9]+\/$/.test(postUrl)) throw new Error('Permalink Facebook belum dikenali.');
    const nodes = await this.read(), current = postIdentity(nodes, inspected), input = composer(nodes);
    if (current.id !== post.id || input?.displayName !== account.displayName || !input.placeholder) throw new Error('Postingan atau akun berubah, atau ada draft sebelumnya. Draft yang ada tidak diubah.');
    const key = createHash('sha256').update(JSON.stringify([this.serial, inspected.target, post.id, account.username])).digest('hex');
    const record = { version: 1, key, attemptId: randomUUID(), status: 'preparing', serial: this.serial, target: inspected.target, targetLabel: inspected.targetLabel, targetType: 'page', pageEvidence: inspected.evidence, postId: post.id, caption: post.caption, postUrl, username: account.username, displayName: account.displayName, accountUrl: account.url, text, createdAt: new Date().toISOString() };
    try { await this.persist(record, true); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Sudah ada percobaan Facebook pada akun dan postingan ini. Tidak membuat atau mengirim ulang.'); throw error; }
    this.proofs.set(record.attemptId, record);
    await this.tap(input.field); await this.pause(500); await this.typeText(text); await this.pause();
    const drafted = await this.read();
    const actual = verifyDraft(drafted, text);
    if (actual.displayName !== account.displayName || !sendButton(drafted, actual)) throw new Error('Identitas draft atau tombol Send Facebook belum terverifikasi. Tidak dikirim.');
    record.status = 'drafted'; await this.persist(record);
    return structuredClone(record);
  }
  async submit(proof) {
    const record = this.proofs.get(proof?.attemptId);
    if (!record || record.status !== 'drafted' || JSON.stringify(record) !== JSON.stringify(proof)) throw new Error('Bukti draft Facebook tidak valid atau percobaan sudah digunakan.');
    const persisted = JSON.parse(await readFile(join(this.pendingDir, `${record.key}.json`), 'utf8'));
    if (persisted.attemptId !== record.attemptId || persisted.status !== 'drafted') throw new Error('Status percobaan Facebook sudah berubah; tidak mengirim ulang.');
    const nodes = await this.read(), draft = verifyDraft(nodes, record.text), current = postIdentity(nodes, this.inspection);
    if (current.id !== record.postId || draft.displayName !== record.displayName) throw new Error('Akun atau postingan Facebook berubah sebelum kirim.');
    const send = sendButton(nodes, draft);
    if (!send) throw new Error('Tombol Send Facebook tidak jelas; tidak dikirim.');
    // Exclusive durable send claim prevents two adapters/processes from racing.
    const claim = await open(join(this.pendingDir, `${record.key}.send-claim`), 'wx', 0o600);
    try { await claim.writeFile(record.attemptId); await claim.sync(); } finally { await claim.close(); }
    record.status = 'pending'; record.sendClaimedAt = new Date().toISOString(); await this.persist(record);
    try { await this.tap(send); await this.pause(1600); }
    finally { record.status = 'uncertain'; record.tapAttemptedAt = new Date().toISOString(); await this.persist(record); }
    return { status: 'uncertain', text: record.text, postId: record.postId, username: record.username, attemptId: record.attemptId, evidence: 'Send dicoba tepat satu kali; perlu bukti komentar setelah membuka ulang postingan.' };
  }
  async clearDraft() {
    const record = [...this.proofs.values()].find(record => record.status === 'drafted');
    if (!record) return { cleared: false, reason: 'Tidak ada draft milik sesi Facebook ini yang aman dibersihkan.' };
    const nodes = await this.read(), draft = verifyDraft(nodes, record.text);
    if (draft.displayName !== record.displayName || postIdentity(nodes, this.inspection).id !== record.postId) throw new Error('Akun atau postingan berubah; draft tidak dibersihkan.');
    await this.clearField(draft.field); await this.pause();
    const after = composer(await this.read());
    if (!after?.placeholder || after.displayName !== record.displayName) throw new Error('Draft Facebook belum terbukti kosong.');
    record.status = 'cleared'; record.clearedAt = new Date().toISOString(); await this.persist(record);
    return { cleared: true };
  }
  async reconcile(proof) {
    if (!/^[a-f0-9]{64}$/.test(proof?.key || '')) throw new Error('Kunci percobaan Facebook tidak valid.');
    const record = JSON.parse(await readFile(join(this.pendingDir, `${proof.key}.json`), 'utf8'));
    if (record.serial !== this.serial || record.attemptId !== proof.attemptId || !['pending', 'uncertain', 'sent'].includes(record.status)) throw new Error('Percobaan Facebook tidak cocok atau belum pernah dikirim.');
    if (await readFile(join(this.pendingDir, `${record.key}.send-claim`), 'utf8') !== record.attemptId) throw new Error('Claim kirim Facebook tidak cocok.');
    const result = () => ({ status: record.status === 'sent' ? 'sent' : 'uncertain', text: record.text, postId: record.postId, username: record.username, attemptId: record.attemptId, evidence: record.evidence || null });
    if (record.status === 'sent') return result();
    if (!/^https:\/\/www\.facebook\.com\/share\/r\/[A-Za-z0-9]+\/$/.test(record.postUrl || '')) return result();
    // Only reopen and inspect. This method has no route to Send.
    await this.openUrl(record.postUrl, packageName);
    let matchedPost = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      let nodes = await this.read();
      const chooser = nodes.find(node => node.package === 'android' && node.text === 'Open with');
      if (chooser) {
        const facebook = nodes.filter(node => node.package === 'android' && node.text === 'Facebook');
        if (facebook.length !== 1) return result();
        await this.tap(facebook[0]); await this.pause(300); nodes = await this.read();
        const once = nodes.find(node => node.package === 'android' && node['content-desc'] === 'Use selected app just once' && node.enabled === 'true');
        if (!once) return result();
        await this.tap(once); await this.pause(1400); continue;
      }
      if (sameReel(nodes, record)) {
        const comments = nodes.find(node => node.package === packageName && node.class === 'android.widget.Button' && /^\d+ comments?$/.test(node['content-desc'] || ''));
        if (!comments) return result();
        matchedPost = true; await this.tap(comments); await this.pause(1000); break;
      }
      await this.pause(700);
    }
    if (!matchedPost) return result();
    for (let attempt = 0; attempt < 4; attempt++) {
      const nodes = await this.read(), comment = renderedComment(nodes, record);
      if (comment && composer(nodes)?.placeholder) {
        const screenshot = join(this.pendingDir, `${record.attemptId}-reopened.png`);
        await this.screenshot(screenshot);
        record.status = 'sent'; record.verifiedAt = new Date().toISOString();
        record.evidence = { ...comment, postUrl: record.postUrl, target: record.target, captionMatched: true, ownerMatched: true, reopened: true, screenshot };
        await this.persist(record);
        if (this.proofs.has(record.attemptId)) this.proofs.set(record.attemptId, record);
        return result();
      }
      await this.pause(800);
    }
    return result();
  }
  async reconcileViaPage(proof) {
    if (!/^[a-f0-9]{64}$/.test(proof?.key || '')) throw new Error('Kunci percobaan Facebook tidak valid.');
    const record = JSON.parse(await readFile(join(this.pendingDir, `${proof.key}.json`), 'utf8'));
    if (record.serial !== this.serial || record.attemptId !== proof.attemptId || !['pending', 'uncertain', 'sent'].includes(record.status)) throw new Error('Percobaan Facebook tidak cocok atau belum pernah dikirim.');
    if (await readFile(join(this.pendingDir, `${record.key}.send-claim`), 'utf8') !== record.attemptId) throw new Error('Claim kirim Facebook tidak cocok.');
    const result = () => ({ status: record.status === 'sent' ? 'sent' : 'uncertain', text: record.text, postId: record.postId, username: record.username, attemptId: record.attemptId, evidence: record.evidence || null });
    if (record.status === 'sent') return result();
    // If reel reopening fails, try the verified Page feed independently and
    // require the full same-post fingerprint before inspecting its thread.
    const inspected = await this.inspect({ target: record.target });
    if (inspected.posts[0]?.id !== record.postId || inspected.account.username !== record.username || inspected.account.displayName !== record.displayName) return result();
    for (let attempt = 0; attempt < 6; attempt++) {
      const nodes = await this.read();
      if (!findLabel(nodes, new RegExp(`^${record.targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[’']s post$`))) return result();
      const comment = renderedComment(nodes, record);
      if (comment && composer(nodes)?.placeholder) {
        const screenshot = join(this.pendingDir, `${record.attemptId}-page-reopened.png`);
        await this.screenshot(screenshot);
        record.status = 'sent'; record.verifiedAt = new Date().toISOString();
        record.evidence = { ...comment, postUrl: record.postUrl, target: record.target, captionMatched: true, ownerMatched: true, reopened: true, reopenedVia: 'verified-page-post', screenshot };
        await this.persist(record);
        if (this.proofs.has(record.attemptId)) this.proofs.set(record.attemptId, record);
        return result();
      }
      await this.swipeUp(nodes);
    }
    return result();
  }
}
export default FacebookAdapter;
