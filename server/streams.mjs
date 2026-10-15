import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { JpegParser } from './core.mjs';
import { adb, adbProcess } from './adb.mjs';
import { getDisplay } from './display.mjs';

const exec = promisify(execFile);
const binary = name => process.env[`${name.toUpperCase()}_PATH`] || (existsSync(`/opt/homebrew/bin/${name}`) ? `/opt/homebrew/bin/${name}` : name);
let serverInfo;
async function getServerInfo() {
  if (!serverInfo) serverInfo = (async () => {
    const path = process.env.SCRCPY_SERVER_PATH || ['/opt/homebrew/share/scrcpy/scrcpy-server', '/usr/local/share/scrcpy/scrcpy-server'].find(existsSync);
    if (!path || !existsSync(path)) throw new Error('scrcpy-server belum tersedia di Mac ini.');
    const { stdout } = await exec(binary('scrcpy'), ['--version'], { timeout: 5000 });
    const version = stdout.match(/scrcpy\s+(\S+)/)?.[1];
    if (!version) throw new Error('Versi scrcpy tidak dapat dibaca.');
    return { path, version };
  })().catch(error => { serverInfo = null; throw error; });
  return serverInfo;
}
function connectVideo(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setNoDelay(true);
    const finish = () => { clearTimeout(timer); socket.removeListener('error', fail); socket.removeListener('end', ended); };
    const fail = error => { finish(); socket.destroy(); reject(error); };
    const ended = () => fail(new Error('Menunggu server video.'));
    const timer = setTimeout(() => fail(new Error('Menunggu server video.')), 700);
    socket.once('error', fail);
    socket.once('end', ended);
    socket.once('data', first => { socket.pause(); finish(); resolve({ socket, first }); });
  });
}

export class StreamManager {
  constructor() { this.sessions = new Map(); }
  subscribe(serial, socket) {
    let session = this.sessions.get(serial);
    if (!session) {
      session = { serial, clients: new Set(), active: true, processes: [], lastFrame: null, timer: null, socket: null, forward: null, jar: null };
      this.sessions.set(serial, session);
      session.clients.add(socket);
      this.start(session).catch(error => this.fail(session, /device.*not found|offline|closed|disconnected/i.test(error.message) ? 'Board terputus dari USB.' : error.code === 'ENOENT' ? 'scrcpy atau FFmpeg belum tersedia di Mac ini.' : 'Layar belum dapat dibuka. Periksa koneksi lalu coba lagi.'));
    } else session.clients.add(socket);
    if (session.lastFrame) socket.send(session.lastFrame);
    socket.on('close', () => {
      session.clients.delete(socket);
      if (!session.clients.size) this.stop(session);
    });
  }
  broadcast(session, message) {
    for (const socket of session.clients) if (socket.readyState === 1 && socket.bufferedAmount < 512 * 1024) socket.send(message);
  }
  async start(session) {
    const info = await getServerInfo();
    if (!session.active) return;
    session.timer = setTimeout(() => this.fail(session, 'Layar belum merespons. Periksa koneksi board, lalu coba lagi.'), 20000);
    const scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, '0');
    session.jar = `/data/local/tmp/phonefarm-${scid}.jar`;
    await adb(['-s', session.serial, 'push', info.path, session.jar]);
    if (!session.active) { await this.cleanup(session); return; }
    await adb(['-s', session.serial, 'shell', 'input', 'keyevent', '224']);
    session.display = await getDisplay(session.serial);
    if (!session.active) { await this.cleanup(session); return; }
    session.forward = Number((await adb(['-s', session.serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).trim());
    if (!session.active) { await this.cleanup(session); return; }
    if (!session.forward) throw new Error('Port video tidak tersedia.');
    const mirror = adbProcess(['-s', session.serial, 'shell', `CLASSPATH=${session.jar}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', info.version, `scid=${scid}`, 'log_level=warn', 'audio=false', 'control=false', 'tunnel_forward=true', 'raw_stream=true', 'video_codec=h264', 'max_size=720', 'max_fps=15', 'video_bit_rate=2000000', 'video_codec_options=repeat-previous-frame-after:long=100000']);
    session.processes.push(mirror);
    let mirrorLog = '', decoderLog = '';
    mirror.stdout.on('data', chunk => { mirrorLog = (mirrorLog + chunk.toString()).slice(-1500); });
    mirror.stderr.on('data', chunk => { mirrorLog = (mirrorLog + chunk.toString()).slice(-1500); });
    const failed = (code, log) => {
      if (!session.active) return;
      console.warn(`[stream ${session.serial}] exit ${code}: ${log.slice(-450)}`);
      this.fail(session, /unauthorized/i.test(log) ? 'Board belum memberi izin ADB.' : /device.*not found|offline|closed|disconnected/i.test(log) ? 'Board terputus dari USB.' : 'Streaming terhenti. Coba sambungkan ulang layar.');
    };
    mirror.on('error', error => this.fail(session, error.message));
    mirror.on('close', code => failed(code, mirrorLog));
    let video;
    for (let attempt = 0; attempt < 20 && session.active; attempt++) {
      try { video = await connectVideo(session.forward); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 120)); }
    }
    if (!session.active) { video?.socket.destroy(); return; }
    if (!video) throw new Error('Server video belum merespons.');
    session.socket = video.socket;
    const decoder = spawn(binary('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-flags', 'low_delay', '-threads', '1', '-probesize', '32', '-analyzeduration', '0', '-f', 'h264', '-i', 'pipe:0', '-an', '-fps_mode', 'passthrough', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-threads', '1', '-flush_packets', '1', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    session.processes.push(decoder);
    const parser = new JpegParser(frame => {
      if (!session.active) return;
      clearTimeout(session.timer);
      session.lastFrame = frame;
      this.broadcast(session, frame);
    });
    decoder.stdout.on('data', chunk => parser.push(chunk));
    decoder.stderr.on('data', chunk => { decoderLog = (decoderLog + chunk.toString()).slice(-1500); });
    decoder.on('error', error => this.fail(session, error.code === 'ENOENT' ? 'FFmpeg belum tersedia di Mac ini.' : 'Decoder layar gagal dijalankan.'));
    decoder.on('close', code => failed(code, decoderLog));
    decoder.stdin.on('error', () => this.fail(session, 'Streaming terhenti. Coba sambungkan ulang layar.'));
    video.socket.on('error', () => this.fail(session, 'Koneksi video terputus.'));
    video.socket.on('end', () => this.fail(session, 'Koneksi video terputus.'));
    decoder.stdin.write(video.first);
    video.socket.pipe(decoder.stdin);
    video.socket.resume();
  }
  fail(session, message) {
    if (!session.active) return;
    this.broadcast(session, JSON.stringify({ type: 'error', message }));
    this.stop(session);
  }
  async cleanup(session) {
    if (session.forward) await adb(['-s', session.serial, 'forward', '--remove', `tcp:${session.forward}`]).catch(() => {});
    if (session.jar) await adb(['-s', session.serial, 'shell', 'rm', '-f', session.jar]).catch(() => {});
  }
  stop(session) {
    if (!session.active) return;
    session.active = false;
    clearTimeout(session.timer);
    if (this.sessions.get(session.serial) === session) this.sessions.delete(session.serial);
    session.socket?.destroy();
    for (const child of session.processes) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000);
      timer.unref();
    }
    for (const socket of session.clients) socket.close(1012, 'Stream stopped');
    this.cleanup(session).catch(() => {});
  }
  disconnectMissing(connectedSerials) {
    for (const session of this.sessions.values()) if (!connectedSerials.has(session.serial)) this.fail(session, 'Board terputus dari USB.');
  }
  reconcileDisplay(serial, display) {
    const session = this.sessions.get(serial);
    // The MJPEG encoder retains its initial dimensions. Reconnect on size changes
    // so landscape/portrait transitions never stretch or crop subsequent frames.
    if (session?.display && (session.display.width !== display.width || session.display.height !== display.height)) this.stop(session);
  }
  close() { for (const session of [...this.sessions.values()]) this.stop(session); }
}
