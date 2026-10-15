import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bankComments } from './instagram.mjs';

const tones = ['positif', 'netral', 'negatif'];
const scenarios = ['normal', 'network', 'uncertain'];
const active = job => ['running', 'stopping'].includes(job?.status);
const keyFor = (account, post) => JSON.stringify([account.username, post.id]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// This manager has no device transport. Its records can never count as live sends.
export class SocialSimulation {
  constructor({ platform, statePath, generate = bankComments, delay = 180, stagger = 900, now = () => Date.now() }) {
    this.platform = platform; this.statePath = statePath; this.generate = generate;
    this.delay = delay; this.stagger = stagger; this.now = now;
    this.state = { version: 1, platform: platform.id, mode: 'simulation', plans: [], startMode: 'bertahap', scenario: 'normal', ledger: {}, runs: [] };
    this.writing = Promise.resolve(); this.committing = Promise.resolve(); this.operation = false; this.task = null; this.job = null;
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (saved.version !== 1 || saved.platform !== this.platform.id || saved.mode !== 'simulation' || !Array.isArray(saved.runs) || !Array.isArray(saved.plans) || !saved.ledger || typeof saved.ledger !== 'object' || Array.isArray(saved.ledger)) throw new Error('Format data simulasi tidak valid.');
      this.state = saved;
      for (const run of this.state.runs) if (active(run)) {
        run.status = 'stopped'; run.finishedAt = this.iso();
        for (const account of run.accounts) if (['running', 'paused', 'waiting', 'stopping'].includes(account.status)) account.status = 'stopped';
        this.log(run, 'Simulasi terhenti saat layanan ditutup. Jalankan ulang untuk melengkapi.');
      }
      this.prune(); this.job = this.state.runs[0] || null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  iso() { return new Date(this.now()).toISOString(); }
  prune() {
    this.state.runs = this.state.runs.filter(run => active(run) || this.now() - Date.parse(run.startedAt) < 7 * 86400000).slice(0, 100);
    if (this.job && !this.state.runs.includes(this.job)) this.job = this.state.runs[0] || null;
  }
  save() {
    this.writing = this.writing.catch(() => {}).then(async () => {
      this.prune();
      await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
      const temp = `${this.statePath}.tmp`;
      await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      await rename(temp, this.statePath);
    });
    return this.writing;
  }
  // Serialize the mutation itself as well as its write. A failed account's
  // rollback must never undo a different account's successfully committed step.
  transaction(change) {
    const pending = this.committing.catch(() => {}).then(async () => {
      const rollback = change();
      if (!rollback) return false;
      try { await this.save(); } catch (error) { rollback(); throw error; }
      return true;
    });
    this.committing = pending;
    return pending;
  }
  accounts() { return this.platform.sampleAccounts.map((a, i) => ({ ...a, serial: `sim-${this.platform.id}-${i + 1}`, deviceName: `HP simulasi ${i + 1}` })); }
  snapshot() {
    this.prune();
    return structuredClone({ platform: { id: this.platform.id, name: this.platform.name, item: this.platform.item, action: this.platform.action, targetHint: this.platform.targetHint, liveChecklist: this.platform.liveChecklist }, mode: 'simulation', liveSupported: false, accounts: this.accounts(), plans: this.state.plans, startMode: this.state.startMode, scenario: this.state.scenario, busy: this.operation || active(this.job), job: this.job, runs: this.state.runs.map(({ logs, accounts, ...run }) => run) });
  }
  assertMode(body) { if (body?.mode !== 'simulation') throw new Error('Mode perangkat asli belum tersedia. Gunakan mode simulation; tidak ada kiriman ke platform.'); }
  assertIdle() { if (this.operation || active(this.job)) throw new Error('Tunggu atau hentikan simulasi yang sedang berjalan.'); }
  validate(body) {
    this.assertMode(body);
    if (!['bertahap', 'serentak'].includes(body.startMode)) throw new Error('Pilih cara mulai bertahap atau serentak.');
    if (!scenarios.includes(body.scenario)) throw new Error('Skenario simulasi tidak dikenal.');
    if (!Array.isArray(body.accounts) || !body.accounts.length || body.accounts.length > this.accounts().length) throw new Error('Pilih minimal satu akun simulasi.');
    const seen = new Set();
    const accounts = body.accounts.map(plan => {
      if (!plan || !this.accounts().some(a => a.username === plan.username && a.serial === plan.serial) || seen.has(plan.username)) throw new Error('Akun simulasi tidak valid atau dipilih dua kali.');
      seen.add(plan.username);
      if (!Number.isInteger(plan.posts) || plan.posts < 1 || plan.posts > 50 || !Number.isInteger(plan.comments) || plan.comments < 1 || plan.comments > 100) throw new Error('Jumlah postingan harus 1–50 dan komentar 1–100.');
      if (!tones.includes(plan.tone)) throw new Error('Nada komentar tidak valid.');
      return { serial: plan.serial, username: plan.username, target: this.platform.normalizeTarget(plan.target), posts: plan.posts, comments: plan.comments, tone: plan.tone };
    });
    return { accounts, startMode: body.startMode, scenario: body.scenario };
  }
  remember(plan) { this.state.plans = plan.accounts; this.state.startMode = plan.startMode; this.state.scenario = plan.scenario; }
  async savePlan(body) {
    this.assertIdle(); const plan = this.validate(body); this.operation = true;
    try {
      await this.transaction(() => {
        const previous = { plans: this.state.plans, startMode: this.state.startMode, scenario: this.state.scenario };
        this.remember(plan);
        return () => Object.assign(this.state, previous);
      });
    } finally { this.operation = false; }
    return this.snapshot();
  }
  posts(account) { return this.platform.createFixtures(account.target).filter(post => !post.pinned).slice(0, account.posts); }
  entry(account, post) { return this.state.ledger[keyFor(account, post)] || { count: post.existing, liked: post.liked, texts: [], uncertain: false }; }
  log(job, message, username) { job.logs.push({ at: this.iso(), username, message }); if (job.logs.length > 500) job.logs.shift(); }
  makeJob(kind, plan) {
    const job = { id: randomUUID(), kind, mode: 'simulation', startedAt: this.iso(), status: 'running', startMode: plan.startMode, scenario: plan.scenario, simulated: 0, skipped: 0, failed: 0, logs: [], accounts: plan.accounts.map(a => ({ ...a, status: 'waiting', simulated: 0, skipped: 0, liked: 0 })) };
    this.state.runs.unshift(job); this.job = job;
    this.log(job, `SIMULASI ${this.platform.name}. Semua akun, postingan, suka, dan kiriman adalah data contoh. Tidak mengakses HP atau internet platform.`);
    return job;
  }
  async samples(account, post, count) {
    const entry = this.entry(account, post);
    const generated = await this.generate({ caption: post.caption.replace(/^(?:\[SIMULASI\]|Simulasi:)\s*/i, ''), count, tone: account.tone, hindari: [...entry.texts] });
    if (!Array.isArray(generated.comments) || generated.comments.some(text => typeof text !== 'string' || !text.trim())) throw new Error('Bank komentar memberikan hasil yang tidak valid.');
    return { ...generated, comments: [...new Set(generated.comments)].filter(text => !entry.texts.includes(text)).slice(0, count) };
  }
  async preview(body) {
    this.assertIdle(); const plan = this.validate(body); this.operation = true;
    const previousPlan = { plans: this.state.plans, startMode: this.state.startMode, scenario: this.state.scenario };
    this.remember(plan);
    const job = this.makeJob('preview', plan), results = [];
    try {
      for (const account of job.accounts) {
        if (job.status === 'stopping') break;
        account.status = 'running';
        const post = this.posts(account).find(p => p.commentsEnabled);
        const entry = this.entry(account, post), samples = await this.samples(account, post, 3);
        if (job.status === 'stopping') break;
        results.push({ username: account.username, target: account.target, caption: post.caption, commentMode: 'new-per-job', need: entry.uncertain ? 0 : account.comments, uncertain: entry.uncertain, samples: samples.comments, mood: samples.suasana });
        account.status = 'done'; this.log(job, entry.uncertain
          ? `Target contoh ${account.target}: status kiriman tidak pasti, ditahan; perlu 0. Pratinjau tidak mengubah hitungan.`
          : `Target contoh ${account.target}: ${account.comments} komentar baru per postingan. Pratinjau tidak mengubah hitungan.`, account.username);
      }
      job.status = job.status === 'stopping' ? 'stopped' : 'completed';
    } catch (error) { job.status = 'failed'; this.log(job, error.message); throw error; }
    finally {
      for (const a of job.accounts) if (['waiting', 'running'].includes(a.status)) a.status = 'stopped';
      job.finishedAt = this.iso();
      try { await this.save(); } catch (error) {
        Object.assign(this.state, previousPlan);
        job.status = 'failed'; job.error = `Gagal menyimpan simulasi: ${error.message}`;
        throw error;
      } finally { this.operation = false; }
    }
    return { mode: 'simulation', results, stopped: job.status === 'stopped' };
  }
  async start(body) {
    this.assertIdle(); const plan = this.validate(body); this.operation = true;
    const previous = { plans: this.state.plans, startMode: this.state.startMode, scenario: this.state.scenario, runs: [...this.state.runs], job: this.job };
    this.remember(plan);
    const job = this.makeJob('run', plan);
    try { await this.save(); } catch (error) {
      const { job: oldJob, ...state } = previous;
      Object.assign(this.state, state); this.job = oldJob; this.operation = false; throw error;
    }
    this.task = this.run(job).catch(error => { job.status = 'failed'; this.log(job, `Simulasi gagal: ${error.message}`); }).finally(async () => {
      job.finishedAt = this.iso();
      try { await this.save(); } finally { this.operation = false; }
    });
    // Keep background persistence failures observable without an unhandled rejection.
    this.task.catch(error => { job.status = 'failed'; job.error = `Gagal menyimpan simulasi: ${error.message}`; });
    return this.snapshot();
  }
  stop() { if (active(this.job)) { this.job.status = 'stopping'; this.log(this.job, 'Penghentian diminta. Tidak ada langkah simulasi baru setelah langkah yang sedang ditunggu.'); } return this.snapshot(); }
  async wait(job, ms = this.delay) {
    for (let remaining = ms; remaining > 0; remaining -= 100) { if (job.status === 'stopping') return false; await pause(Math.min(remaining, 100)); }
    return job.status !== 'stopping';
  }
  commitPost(job, account, post, { text, uncertain = false }) {
    return this.transaction(() => {
      if (job.status === 'stopping') return null;
      const key = keyFor(account, post), previous = this.state.ledger[key];
      const entry = structuredClone(this.entry(account, post));
      const liked = entry.liked ? 0 : 1, sent = uncertain ? 0 : 1;
      entry.liked = true;
      if (uncertain) entry.uncertain = true;
      else { entry.count++; entry.texts.push(text); }
      this.state.ledger[key] = entry;
      account.liked += liked; account.simulated += sent; job.simulated += sent;
      return () => {
        if (previous) this.state.ledger[key] = previous; else delete this.state.ledger[key];
        account.liked -= liked; account.simulated -= sent; job.simulated -= sent;
      };
    });
  }
  async run(job) {
    this.log(job, `Mode ${job.startMode}; waktu dipercepat untuk simulasi. Skenario: ${job.scenario}.`);
    await Promise.all(job.accounts.map(async (account, index) => {
      try {
        if (!await this.wait(job, job.startMode === 'serentak' ? 0 : index * this.stagger)) { account.status = 'stopped'; return; }
        account.status = 'running'; this.log(job, 'Akun contoh mulai bekerja.', account.username);
        const fixtures = this.platform.createFixtures(account.target), posts = this.posts(account);
        this.log(job, `${fixtures.filter(p => p.pinned).length} item contoh bertanda pin dilewati; ${posts.length} ${this.platform.item} contoh diproses.`, account.username);
        if (posts.length < account.posts) this.log(job, `Data contoh hanya menyediakan ${posts.length} item non-pin, kurang dari permintaan ${account.posts}.`, account.username);
        let scenarioUsed = false;
        for (const post of posts) {
          if (!await this.wait(job)) break;
          if (!post.commentsEnabled) { account.skipped++; job.skipped++; this.log(job, `${post.caption}: komentar ditutup, dilewati.`, account.username); continue; }
          const entry = structuredClone(this.entry(account, post));
          if (entry.uncertain) { account.skipped++; job.skipped++; this.log(job, 'Status kiriman contoh sebelumnya tidak pasti; ditahan agar tidak terkirim ulang. Reset data simulasi untuk memulai skenario baru.', account.username); continue; }
          const need = account.comments;
          if (job.scenario === 'network' && !scenarioUsed) {
            account.status = 'paused'; this.log(job, 'SIMULASI internet putus → jeda → mencoba ulang. Tidak mengubah jaringan Mac.', account.username);
            if (!await this.wait(job, this.delay * 4)) break;
            account.status = 'running'; this.log(job, 'SIMULASI internet pulih; lanjut dari item yang sama.', account.username); scenarioUsed = true;
          }
          const generated = await this.samples(account, post, need);
          if (job.status === 'stopping') break;
          this.log(job, `${post.caption} · suasana ${generated.suasana || 'umum'} · nada ${generated.tone || account.tone} · ${need} komentar baru dalam pekerjaan ini.`, account.username);
          if (generated.comments.length < need) throw new Error('Bank belum menyediakan cukup komentar unik; kurangi target atau ubah nada.');
          let completed = 0;
          for (const text of generated.comments) {
            if (!await this.wait(job)) break;
            if (job.scenario === 'uncertain' && !scenarioUsed) {
              if (!await this.commitPost(job, account, post, { uncertain: true })) break;
              scenarioUsed = true;
              if (!entry.liked) { entry.liked = true; this.log(job, 'Suka disimulasikan sebelum komentar.', account.username); }
              this.log(job, 'SIMULASI hasil kiriman tidak pasti. Tidak dihitung berhasil dan tidak dikirim ulang.', account.username);
              break;
            }
            if (!await this.commitPost(job, account, post, { text })) break;
            if (!entry.liked) { entry.liked = true; this.log(job, 'Suka disimulasikan sebelum komentar.', account.username); }
            entry.count++;
            this.log(job, `SIMULASI ${this.platform.action} ${++completed}/${account.comments} baru: ${text}`, account.username);
          }
        }
        account.status = job.status === 'stopping' ? 'stopped' : 'done';
      } catch (error) { account.status = 'failed'; account.note = error.message; job.failed++; this.log(job, error.message, account.username); }
    }));
    job.status = job.status === 'stopping' ? 'stopped' : job.failed ? 'completed_with_errors' : 'completed';
    this.log(job, `Simulasi ${job.status === 'stopped' ? 'dihentikan' : 'selesai'}: ${job.simulated} kiriman contoh, 0 kiriman nyata.`);
  }
  async reset(body) {
    this.assertMode(body); this.assertIdle(); this.operation = true;
    try {
      await this.transaction(() => {
        const ledger = this.state.ledger, runs = this.state.runs, job = this.job;
        this.state.ledger = {}; this.state.runs = []; this.job = null;
        return () => { this.state.ledger = ledger; this.state.runs = runs; this.job = job; };
      });
    } finally { this.operation = false; }
    return this.snapshot();
  }
  history(id) { this.prune(); const run = this.state.runs.find(r => r.id === id); if (!run) throw new Error('Riwayat simulasi tidak ditemukan.'); return structuredClone(run); }
}
