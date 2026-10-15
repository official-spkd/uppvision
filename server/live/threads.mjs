import { DeviceSession } from './device.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTarget } from '../platforms/threads.mjs';
import { byDescription, profileIdentity, visiblePosts, detailControls, replyField, expandedComposer, submissionPendingOrFailed } from './threads-core.mjs';

const PACKAGE = 'com.instagram.barcelona';
export class ThreadsAdapter extends DeviceSession {
  constructor(options = {}) {
    super(options);
    this.journalDir = options.journalDir || '.phonefarm/live/threads';
    this.evidenceDir = options.evidenceDir || '.phonefarm/verification/threads';
  }
  async typePaced(text) { for (const char of text) { await this.typeText(char); await this.pause(80); } }
  async atomicRecord(path, value) {
    await mkdir(this.journalDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(this.journalDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  attemptPath(proof) {
    const key = createHash('sha256').update(JSON.stringify([this.serial, proof.username, proof.target, proof.post.id])).digest('hex');
    return join(this.journalDir, `${key}.json`);
  }
  async assertNoAttempt(proof) {
    const path = this.attemptPath(proof);
    for (const candidate of [path, `${path}.lock`]) {
      try { await access(candidate); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error('Postingan ini memiliki catatan kirim sebelumnya; tidak boleh dikirim ulang otomatis.');
    }
  }
  async reserveAttempt(proof) {
    await this.assertNoAttempt(proof);
    await mkdir(this.journalDir, { recursive: true, mode: 0o700 });
    const path = this.attemptPath(proof), record = { ...proof, status: 'pending', pendingAt: new Date().toISOString() };
    const lock = await open(`${path}.lock`, 'wx', 0o600);
    try { await lock.writeFile(JSON.stringify(record)); await lock.sync(); } finally { await lock.close(); }
    await this.atomicRecord(path, record);
    return { path, record };
  }
  async scan() {
    await this.launch(PACKAGE);
    const initial = await this.read();
    if (expandedComposer(initial)?.text || replyField(initial)?.text) throw new Error('Ada draft Threads; pemeriksaan akun dihentikan agar draft tetap utuh.');
    for (let attempt = 0; attempt < 8; attempt++) {
      const nodes = await this.read();
      const current = profileIdentity(nodes, { own: true });
      if (current) {
        this.current = current;
        return { current, accounts: [{ ...current, active: true }], complete: false, note: 'Baru akun aktif yang terbaca; daftar pengalih akun belum diverifikasi.' };
      }
      const profile = byDescription(nodes, 'Profile');
      if (profile && !byDescription(nodes, 'Close sheet')) await this.tap(profile);
      else await this.back();
      await this.pause(400);
      if (attempt === 2) await this.launch(PACKAGE);
    }
    throw new Error('Profil akun aktif Threads belum terbaca. Buka tab Profile pada aplikasi Threads terlebih dahulu.');
  }

  async inspect({ target, limit = 1 }) {
    const canonical = normalizeTarget(target);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Batas pemeriksaan Threads harus 1–10 postingan.');
    const { current } = await this.scan();
    let nodes = await this.targetProfile(canonical), identity = profileIdentity(nodes);
    if (identity?.username !== canonical) throw new Error('Identitas profil tujuan Threads belum cocok dengan target; pemeriksaan dihentikan.');
    const found = new Map();
    for (let attempt = 0; attempt < 5 && found.size < limit; attempt++) {
      for (const post of visiblePosts(nodes, canonical)) if (!found.has(post.id)) found.set(post.id, post);
      if (found.size >= limit) break;
      const root = nodes.find(node => node.package === PACKAGE && node.bounds)?.bounds.match(/\d+/g)?.map(Number);
      if (!root) break;
      const width = root[2], height = root[3];
      await this.sh('input', 'swipe', String(Math.round(width * .56)), String(Math.round(height * .77)), String(Math.round(width * .56)), String(Math.round(height * .3)), '420');
      await this.pause(500); nodes = await this.read();
    }
    const posts = [...found.values()].slice(0, limit);
    if (limit === 1 && posts.length) {
      const visible = visiblePosts(nodes, canonical).find(post => post.id === posts[0].id);
      if (visible) {
        await this.tap(visible.node); await this.pause(500); nodes = await this.read();
        const detail = visiblePosts(nodes, canonical).find(post => post.id === posts[0].id);
        if (detail) Object.assign(posts[0], detailControls(nodes, canonical));
      }
    }
    return {
      target: canonical, targetLabel: identity.displayName, verified: true,
      posts: posts.map(({ node, ...post }) => post), account: current,
      complete: false, liveSupported: false,
      note: `${posts.length ? 'Profil dan caption terbaca langsung.' : 'Profil terbaca; postingan belum berhasil dibaca.'} Status pin dan hitungan balasan sendiri belum tervalidasi. Pemeriksaan ini tidak menyukai atau mengirim; alur kirim tunggal memerlukan proof draft terpisah.`,
    };
  }

  async targetProfile(canonical) {
    // The observed app opens profile deeplinks as a partially expanded sheet.
    // Search results open the full profile, so use that verified UI route.
    let nodes = await this.read();
    const search = byDescription(nodes, 'Search');
    if (!search) throw new Error('Tombol pencarian Threads tidak terbaca.');
    await this.tap(search); nodes = await this.read();
    const filter = byDescription(nodes, 'Clear filter');
    if (filter) { await this.tap(filter); nodes = await this.read(); }
    let field = nodes.find(node => node.package === PACKAGE && node['resource-id'] === 'BdsSearchBarInput');
    if (!field) throw new Error('Kolom pencarian Threads tidak terbaca.');
    if (field.text) {
      await this.clearField(field); nodes = await this.read();
      field = nodes.find(node => node.package === PACKAGE && node['resource-id'] === 'BdsSearchBarInput');
      if (!field || field.text) throw new Error('Kolom pencarian Threads belum berhasil dikosongkan.');
    }
    let matched = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.tap(field); await this.pause(700); await this.typePaced(canonical);
      const typed = (await this.read()).find(node => node.package === PACKAGE && node['resource-id'] === 'BdsSearchBarInput');
      if (typed?.text === canonical) { matched = true; break; }
      if (!typed || attempt === 1) break;
      await this.clearField(typed); await this.pause(400);
      field = (await this.read()).find(node => node.package === PACKAGE && node['resource-id'] === 'BdsSearchBarInput');
      if (!field || field.text) break;
    }
    if (!matched) throw new Error('Teks pencarian Threads tidak cocok setelah pengetikan; periksa metode input perangkat.');
    await this.sh('input', 'keyevent', '66');
    await this.pause(1200); nodes = await this.read();
    const match = nodes.find(node => node.package === PACKAGE && node['resource-id'] === 'ig_text' && node.text === canonical);
    if (!match) throw new Error('Hasil pencarian tidak memuat username target Threads yang persis sama.');
    await this.tap(match); await this.pause(700);
    return this.read();
  }

  async openSelectedPost(post, target) {
    if (!/^https:\/\/(?:www\.)?threads\.(?:com|net)\/(?:share\/[a-zA-Z0-9_-]+\/?|@[a-zA-Z0-9_.]+\/post\/[a-zA-Z0-9_-]+\/?)(?:\?[^\s]*)?$/.test(post.url || '')) throw new Error('URL postingan Threads belum tervalidasi.');
    await this.openUrl(post.url, PACKAGE);
    let nodes = await this.read();
    if (nodes.some(node => node.package === PACKAGE && node.text === 'Turn on notifications')) {
      await this.pause(900); nodes = await this.read();
      const close = byDescription(nodes, 'Close sheet');
      if (!close) throw new Error('Prompt notifikasi Threads belum dapat ditutup.');
      await this.tap(close); await this.pause(400); nodes = await this.read();
    }
    const candidate = visiblePosts(nodes, target).find(item => item.id === post.id && item.caption === post.caption);
    if (!candidate) throw new Error('Pemilik dan caption postingan Threads tidak cocok.');
    if (!nodes.some(node => node.package === PACKAGE && node['resource-id'] === 'PermalinkScreen')) {
      await this.tap(candidate.node); await this.pause(700); nodes = await this.read();
    }
    if (!nodes.some(node => node.package === PACKAGE && node['resource-id'] === 'PermalinkScreen') || !visiblePosts(nodes, target).some(item => item.id === post.id && item.caption === post.caption)) throw new Error('Halaman detail postingan Threads belum terbukti cocok.');
    return nodes;
  }
  async prepare({ target, post, account, text } = {}) {
    const canonical = normalizeTarget(target), username = normalizeTarget(account?.username || '');
    if (typeof text !== 'string' || !text.trim() || text !== text.trim() || /[^\x20-\x7e]/.test(text) || text.length > 500) throw new Error('Draft harus berupa teks Latin utuh, 1–500 karakter.');
    if (!post?.id || post.owner !== canonical || !post.caption) throw new Error('Identitas postingan Threads belum lengkap.');
    const proof = { id: randomUUID(), serial: this.serial, username, target: canonical, text, post, status: 'prepared', preparedAt: new Date().toISOString() };
    await this.assertNoAttempt(proof);
    let nodes = await this.read(), existing = expandedComposer(nodes);
    if (existing?.text || replyField(nodes)?.text) throw new Error('Ada draft Threads yang tidak boleh ditimpa.');
    if (existing) { await this.tap(byDescription(nodes, 'Cancel')); await this.pause(500); }
    const { current } = await this.scan();
    if (current.username !== username) throw new Error('Akun aktif Threads tidak cocok dengan akun yang diminta.');
    nodes = await this.openSelectedPost(post, canonical);
    proof.postScreenshot = await this.screenshot(join(this.evidenceDir, `${proof.id}-post.png`));
    const expand = byDescription(nodes, 'Add attachment');
    if (!expand || detailControls(nodes, canonical).commentsEnabled !== true) throw new Error('Kolom balasan untuk target Threads belum tersedia.');
    await this.tap(expand); await this.pause(700); nodes = await this.read();
    let composer = expandedComposer(nodes);
    if (!composer || composer.username !== username || composer.target !== canonical || composer.text) throw new Error('Identitas akun atau tujuan pada composer Threads belum cocok.');
    await this.tap(composer.field); await this.pause(700); await this.typePaced(text);
    composer = expandedComposer(await this.read());
    if (!composer || composer.username !== username || composer.text !== text || !composer.button) throw new Error('Draft Threads belum persis cocok atau tombol Post belum aktif; tidak dikirim.');
    proof.screenshot = await this.screenshot(join(this.evidenceDir, `${proof.id}-draft.png`));
    await this.atomicRecord(join(this.journalDir, `prepared-${this.serial}.json`), proof);
    this.prepared = structuredClone(proof);
    return structuredClone(proof);
  }
  async scrollComposer(nodes, towardTop) {
    const scroll = nodes.find(node => node.package === PACKAGE && node.class === 'android.widget.ScrollView');
    const bounds = scroll?.bounds?.match(/\d+/g)?.map(Number);
    if (!bounds) throw new Error('Area gulir composer Threads tidak terbaca.');
    const [left, top, right, bottom] = bounds, x = Math.round((left + right) / 2);
    const high = Math.round(top + (bottom - top) * .2), low = Math.round(top + (bottom - top) * .8);
    await this.sh('input', 'swipe', String(x), String(towardTop ? high : low), String(x), String(towardTop ? low : high), '500');
    await this.pause(400);
  }
  async verifyDraft(proof) {
    let nodes = await this.read(), matched = false;
    const shell = () => byDescription(nodes, 'Cancel') && nodes.some(node => node.package === PACKAGE && node.text === 'Reply');
    for (let step = 0; step < 6; step++) {
      if (!shell()) throw new Error('Layar bukan composer balasan Threads yang disiapkan.');
      if (visiblePosts(nodes, proof.target).some(post => post.id === proof.post.id && post.caption === proof.post.caption)) { matched = true; break; }
      await this.scrollComposer(nodes, true); nodes = await this.read();
    }
    if (!matched) throw new Error('Postingan induk pada draft Threads tidak cocok; tidak dikirim.');
    const parentScreenshot = await this.screenshot(join(this.evidenceDir, `${proof.id}-parent-before-send.png`));
    for (let step = 0; step < 6; step++) {
      if (!shell()) throw new Error('Composer Threads berubah saat verifikasi draft.');
      const composer = expandedComposer(nodes);
      if (composer) {
        if (composer.username !== proof.username || composer.text !== proof.text || !composer.button) throw new Error('Akun, teks, atau tombol Post pada draft Threads berubah.');
        return { composer, parentScreenshot };
      }
      await this.scrollComposer(nodes, false); nodes = await this.read();
    }
    throw new Error('Draft Threads tidak dapat diverifikasi ulang sebelum kirim.');
  }
  async submit(proof) {
    const saved = JSON.parse(await readFile(join(this.journalDir, `prepared-${this.serial}.json`), 'utf8'));
    if (saved.serial !== this.serial || saved.status !== 'prepared' || JSON.stringify(saved) !== JSON.stringify(proof)) throw new Error('Proof draft Threads tidak cocok dengan draft tersimpan.');
    const approved = structuredClone(saved);
    await this.assertNoAttempt(approved);
    const { composer, parentScreenshot } = await this.verifyDraft(approved);
    const { path, record } = await this.reserveAttempt({ ...approved, parentScreenshot });
    // The exclusive durable pending record is complete before this single tap.
    // Any failure after this point stays uncertain, with no retry of the button.
    try {
      await this.tap(composer.button);
      await this.pause(1800);
      record.tappedAt = new Date().toISOString(); record.status = 'uncertain';
      record.evidence = [await this.screenshot(join(this.evidenceDir, `${approved.id}-after-tap.png`))];
      await this.atomicRecord(path, record);
      return { status: 'uncertain', text: approved.text, postId: approved.post.id, username: approved.username, evidence: record.evidence, note: 'Post diketuk sekali; perlu verifikasi ulang balasan dari thread yang dibuka kembali.' };
    } catch (error) {
      record.status = 'uncertain'; record.error = error.message;
      await this.atomicRecord(path, record).catch(() => {});
      throw new Error(`Hasil kirim Threads belum pasti; jangan kirim ulang. ${error.message}`);
    }
  }
  async verifySubmitted(proof) {
    const path = this.attemptPath(proof), record = JSON.parse(await readFile(path, 'utf8'));
    if (record.id !== proof.id || record.text !== proof.text || record.username !== proof.username) throw new Error('Catatan kirim Threads tidak cocok.');
    if (record.status === 'sent') return { status: 'sent', text: record.text, postId: record.post.id, username: record.username, evidence: record.evidence };
    let nodes = await this.openSelectedPost(record.post, record.target);
    const reopened = await this.screenshot(join(this.evidenceDir, `${record.id}-reopened-post.png`));
    for (let step = 0; step < 10; step++) {
      if (submissionPendingOrFailed(nodes) || !nodes.some(node => node.package === PACKAGE && node['resource-id'] === 'PermalinkScreen')) break;
      const own = visiblePosts(nodes, record.username).find(post => post.caption === record.text);
      if (own && !replyField(nodes)?.text && !expandedComposer(nodes)) {
        const evidence = [...(record.evidence || []), reopened, await this.screenshot(join(this.evidenceDir, `${record.id}-verified-reply.png`))];
        await this.atomicRecord(path, { ...record, status: 'sent', verifiedAt: new Date().toISOString(), evidence });
        return { status: 'sent', text: record.text, postId: record.post.id, username: record.username, evidence };
      }
      const area = nodes.find(node => node.package === PACKAGE && node['resource-id'] === 'IgLazyColumn');
      const bounds = area?.bounds?.match(/\d+/g)?.map(Number);
      if (!bounds) break;
      const [left, top, right, bottom] = bounds, x = Math.round((left + right) / 2), high = Math.round(top + (bottom - top) * .25), low = Math.round(top + (bottom - top) * .8);
      await this.sh('input', 'swipe', String(x), String(low), String(x), String(high), '450');
      await this.pause(600); nodes = await this.read();
    }
    return { status: 'uncertain', text: record.text, postId: record.post.id, username: record.username, evidence: [...(record.evidence || []), reopened], note: 'Balasan penulis sendiri belum terbaca setelah membuka ulang; tidak dikirim ulang.' };
  }
  async clearDraft() {
    const nodes = await this.read(), expanded = expandedComposer(nodes), field = expanded?.field || replyField(nodes);
    if (field?.text) throw new Error('Ada draft Threads yang belum dibuat adaptor; tidak dihapus otomatis.');
    if (expanded) await this.tap(byDescription(nodes, 'Cancel'));
    else if (field) await this.back();
  }
}

export default ThreadsAdapter;
