// Headlight test for Stage B: probes three world points with the headlights
// OFF then ON, in both haze variants (haze=on and haze=off), at night.
// Thresholds (from the Stage B brief):
//   asphalt 15 units ahead, in the beam: mean gain >= +20, >= 90% pixels > +10
//   target-car roof: mean gain >= +20
//   off-beam control (16 lateral / 20 ahead): |gain| <= 1
// The player car sits at (400, 800) facing north (heading PI); the target
// car sits at (400, 778) facing north. Probes:
//   asphalt: (400, 785)  — 15 units ahead, on the road
//   roof:    (400, 778)  — the target car's roof
//   control: (416, 780)  — 16 lateral, 20 ahead, outside the beam
//
// Usage: node checks/headlight-test.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 9223;
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}
function httpJson(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method,
        headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Minimal raw WebSocket client (no ws package on this VM) ---
import net from 'node:net';
import crypto from 'node:crypto';
class RawWS {
  constructor(url) {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    this.host = m[1]; this.port = +m[2]; this.path = m[3];
    this.buf = Buffer.alloc(0);
    this.handlers = {};
    this.id = 0;
    this.pending = new Map();
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  async connect() {
    const key = crypto.randomBytes(16).toString('base64');
    this.sock = net.connect(this.port, this.host);
    await new Promise((res, rej) => {
      this.sock.once('error', rej);
      this.sock.write(
        `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
      );
      this.sock.once('data', (d) => {
        if (d.toString().includes('101')) res();
        else rej(new Error('ws handshake failed: ' + d.toString().slice(0, 200)));
      });
    });
    this.sock.on('data', (d) => this._feed(d));
  }
  _feed(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const op = b0 & 0x0f;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (op === 1) {
        const msg = JSON.parse(payload.toString());
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else if (this.handlers.message) this.handlers.message(msg);
      }
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    const data = Buffer.from(JSON.stringify({ id, method, params }));
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
    return new Promise((res) => this.pending.set(id, res));
  }
  close() { try { this.sock.destroy(); } catch {} }
}

const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,720',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

let targetId;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try {
    const list = await httpJson('/json/list');
    const page = list.find((t) => t.type === 'page');
    if (page) { targetId = page.id; break; }
  } catch {}
}
if (!targetId) { console.error('no CDP target'); process.exit(2); }
const targets = await httpJson('/json/list');
const page = targets.find((t) => t.id === targetId);
const client = new RawWS(page.webSocketDebuggerUrl);
await client.connect();

const consoleErrors = [];
const consoleLogs = [];
client.on('message', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push('CONSOLE ERROR: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'log') {
    consoleLogs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
});
await client.send('Runtime.enable');
await client.send('Page.enable');

async function evalJs(expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
  return r.result?.result?.value;
}
async function keyTap(code, keyName, codeNum) {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: codeNum, nativeVirtualKeyCode: codeNum,
  });
  await sleep(50);
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: codeNum, nativeVirtualKeyCode: codeNum,
  });
}
async function screenshot(path) {
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  console.log(`  screenshot -> ${path}`);
}

const POINTS = [
  { name: 'asphalt', x: 400, z: 770, y: 0.2 },
  { name: 'roof', x: 400, z: 740, y: 1.5 },
  { name: 'control', x: 416, z: 780, y: 0.2 },
];

async function probeAll() {
  const pts = POINTS.map((p) => `{x:${p.x},y:${p.y},z:${p.z}}`).join(',');
  const res = await evalJs(`window.__palkon.debug.probe([${pts}])`);
  if (!res || res.error) return res;
  // Log only the per-point mean + screen position, not the 4800-value arrays.
  console.log('  probe means:', JSON.stringify(res.map((r) => ({ valid: r.valid, mean: r.mean, sx: r.sx, sy: r.sy, ndc: r.ndcX !== undefined ? [r.ndcX.toFixed(2), r.ndcY.toFixed(2)] : null, cw: r.cw !== undefined ? r.cw.toFixed(1) : null }))));
  return res;
}
function gain(off, on) {
  // off/on: arrays of sample objects {valid, mean:[r,g,b], pixels:[...]}.
  // Returns per-point {mean, pct}: mean channel gain, and the fraction of
  // (pixel, channel) samples whose gain exceeds +10.
  return off.map((o, i) => {
    const n = on[i];
    const dMean = [
      n.mean[0] - o.mean[0],
      n.mean[1] - o.mean[1],
      n.mean[2] - o.mean[2],
    ];
    const mean = (dMean[0] + dMean[1] + dMean[2]) / 3;
    let over = 0;
    const total = Math.min(o.pixels.length, n.pixels.length);
    for (let k = 0; k < total; k++) {
      if (n.pixels[k] - o.pixels[k] > 10) over++;
    }
    return { mean, pct: total ? (over / total) * 100 : 0, d: dMean };
  });
}

for (const haze of ['on', 'off']) {
  // Fixed camera (no chase-cam motion between the OFF and ON probes):
  // high behind the car, looking north down the boulevard, far enough
  // back that the off-beam control point (16 lateral) is inside the frame.
  const url = `http://127.0.0.1:8124/game/index.html?test=headlight&preset=night&haze=${haze}&cam=400,25,900&target=400,0,770`;
  await client.send('Page.navigate', { url });
  await sleep(6000);
  const ready = await evalJs('window.__palkon && window.__palkon.debug ? window.__palkon.debug.getState().mode : "NO DEBUG"');
  console.log(`haze=${haze} mode:`, ready);
  check(`headlight page loads (haze=${haze})`, ready === 'walk' || ready === 'drive', String(ready));
  // Mara spawns on foot next to the taxi: press E to get in, then teleport.
  if (ready === 'walk') {
    await keyTap('KeyE', 'e', 69);
    await sleep(500);
  }
  const modeNow = await evalJs('window.__palkon.debug.getState().mode');
  check(`in the car (haze=${haze})`, modeNow === 'drive', String(modeNow));

  await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
  await evalJs('window.__palkon.debug.placeTargetCar(400, 740, Math.PI)');
  await sleep(1000);
  const camInfo = await evalJs('(() => { const s = window.__palkon.debug.getState(); return { eye: s.camEye, target: s.camTarget, canvas: s.canvas }; })()');
  console.log('  camera:', JSON.stringify(camInfo));
  // OFF probe: headlights explicitly off (the hook takes 'on'/'off'/'auto';
  // a boolean would fall through to auto, which turns them on at night).
  await evalJs(`window.__palkon.debug.setHeadlights('off')`);
  await sleep(800);
  const off = await probeAll();
  await evalJs(`window.__palkon.debug.setHeadlights('on')`);
  await sleep(800);
  const on = await probeAll();
  if (!off || off.error || !on || on.error) {
    check(`probe works (haze=${haze})`, false, JSON.stringify(off?.error ?? on?.error ?? 'no data'));
    continue;
  }
  const g = gain(off, on);
  g.forEach((r, i) => console.log(`  ${POINTS[i].name}: mean gain ${r.mean.toFixed(1)}, ${r.pct.toFixed(0)}% pixels > +10 (d=${r.d.map((v) => v.toFixed(1)).join(',')})`));
  // Diagnostic: per-half pass rate for the asphalt point (the readPixels
  // rows run bottom-to-top in screen space, so the first half of the
  // array is the bottom (near the player's car), the second the top).
  {
    const o = off[0], n = on[0];
    const total = Math.min(o.pixels.length, n.pixels.length);
    const half = Math.floor(total / 2);
    let overBottom = 0, overTop = 0;
    for (let k = 0; k < half; k++) if (n.pixels[k] - o.pixels[k] > 10) overBottom++;
    for (let k = half; k < total; k++) if (n.pixels[k] - o.pixels[k] > 10) overTop++;
    console.log(`  asphalt halves: bottom ${((overBottom / half) * 100).toFixed(0)}% > +10, top ${((overTop / (total - half)) * 100).toFixed(0)}% > +10`);
  }
  check(`asphalt gain >= +20 (haze=${haze})`, g[0].mean >= 20, `mean ${g[0].mean.toFixed(1)}`);
  check(`asphalt >= 90% pixels > +10 (haze=${haze})`, g[0].pct >= 90, `${g[0].pct.toFixed(0)}%`);
  check(`roof gain >= +20 (haze=${haze})`, g[1].mean >= 20, `mean ${g[1].mean.toFixed(1)}`);
  check(`control |gain| <= 1 (haze=${haze})`, Math.abs(g[2].mean) <= 1, `mean ${g[2].mean.toFixed(1)}`);
  if (haze === 'on') await screenshot(`${OUT}night-headlight.png`);
}

check('no console errors during headlight test', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
console.log('  spot logs:', JSON.stringify(consoleLogs.slice(-8)));

client.close();
chrome.kill('SIGKILL');
console.log(fails.length ? `${fails.length} FAILURES: ${fails.join(', ')}` : 'ALL HEADLIGHT TESTS PASS');
process.exit(fails.length ? 1 : 0);
