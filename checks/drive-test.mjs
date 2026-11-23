// Drive test for Stage B: runs the game in headless Chrome via CDP.
// Headless swiftshader runs at only a few fps, so every measurement is
// POLL-BASED (wait until the game state stabilises), never wall-clock.
// Steps: load ?test=drive, press E to enter the taxi, measure top speed for
// all 4 profiles (traffic off), reverse test, red-light stop test, then take
// the daytime drive screenshot (traffic + pedestrians on) into checks/shots/.
//
// Usage: node checks/drive-test.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 9222;
const GAME = 'http://127.0.0.1:8124/game/index.html?test=drive';
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
client.on('message', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push('CONSOLE ERROR: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  }
});
await client.send('Runtime.enable');
await client.send('Page.enable');
await client.send('Page.navigate', { url: GAME });
await sleep(5000);

async function evalJs(expr) {
  const r = await client.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
  return r.result?.result?.value;
}
async function key(type, code, keyName, codeNum) {
  await client.send('Input.dispatchKeyEvent', {
    type, code, key: keyName, windowsVirtualKeyCode: codeNum, nativeVirtualKeyCode: codeNum,
  });
}
async function keyTap(code, keyName, codeNum) {
  await key('keyDown', code, keyName, codeNum);
  await sleep(50);
  await key('keyUp', code, keyName, codeNum);
}
async function keyDown(code, keyName, codeNum) { await key('keyDown', code, keyName, codeNum); }
async function keyUp(code, keyName, codeNum) { await key('keyUp', code, keyName, codeNum); }
async function screenshot(path) {
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  console.log(`  screenshot -> ${path}`);
}
async function getCar() {
  const st = await evalJs('window.__palkon.debug.getState()');
  return st && !st.error ? st : null;
}
// Poll until cond(state) is true or timeoutMs passes. Returns the last state.
async function pollUntil(cond, timeoutMs, intervalMs = 1000) {
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < timeoutMs) {
    st = await getCar();
    if (st && cond(st)) return st;
    await sleep(intervalMs);
  }
  return st;
}

// 0. Page ready? (mode is 'walk' on foot, 'drive' in a car)
const st0 = await getCar();
console.log('  initial mode:', st0?.mode);
check('page loads with debug hooks', st0?.mode === 'walk', String(st0?.mode));

// 1. Enter the taxi with E.
await keyTap('KeyE', 'e', 69);
await sleep(500);
const mode1 = (await getCar())?.mode;
check('E enters the taxi', mode1 === 'drive', `mode=${mode1}`);
console.log('  state after E:', JSON.stringify((await getCar())?.car));

// 2. Top speed per profile (traffic off, flat boulevard, facing north).
// Hold W and poll until the speed stabilises (3 polls within 0.5 km/h).
await evalJs('window.__palkon.debug.setTrafficEnabled(false)');
const PROFILES = [
  ['compact', 115], ['sedan', 130], ['van', 108], ['coupe', 158],
];
for (const [name, target] of PROFILES) {
  await evalJs(`window.__palkon.debug.setProfile('${name}')`);
  await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
  await sleep(500);
  await keyDown('KeyW', 'w', 87);
  let last = -1; let stable = 0; let kmh = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    await sleep(2000);
    const st = await getCar();
    kmh = st?.car?.speedKmh ?? 0;
    if (Math.abs(kmh - last) < 0.5) stable++;
    else stable = 0;
    last = kmh;
    if (kmh >= target - 1 && stable >= 2) break;
    if (stable >= 3 && kmh > 20) break;
  }
  await keyUp('KeyW', 'w', 87);
  check(`top speed ${name} (browser)`, Math.abs(kmh - target) <= 2, `${kmh} vs ${target} km/h`);
  // Brake to a stop before the next profile.
  await keyDown('KeyS', 's', 83);
  await pollUntil((st) => (st.car?.speedKmh ?? 99) < 1, 60000);
  await keyUp('KeyS', 's', 83);
  await sleep(500);
}

// 3. Reverse: hold S until the car reverses at ~25 km/h, keep holding for
// 2.5 game-seconds, then measure the distance covered.
await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
await sleep(500);
const before = (await getCar())?.car;
await keyDown('KeyS', 's', 83);
const revSt = await pollUntil((st) => (st.car?.speedKmh ?? 0) <= -20, 60000);
const revT0 = revSt?.time ?? 0;
await pollUntil((st) => (st?.time ?? 0) - revT0 >= 2.5, 60000);
await keyUp('KeyS', 's', 83);
const after = (await getCar())?.car;
const revDist = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : -1;
check('reverse reaches ~25 km/h', (revSt?.car?.speedKmh ?? 0) <= -20, `${revSt?.car?.speedKmh} km/h`);
check('reverse moves car backwards', revDist > 10, `${revDist.toFixed(1)} units`);

// 4. Red-light stop test (traffic on, drive north on the boulevard).
await evalJs('window.__palkon.debug.setTrafficEnabled(true)');
await evalJs('window.__palkon.debug.setProfile("sedan")');
await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
await sleep(500);
let redRun = false;
let stoppedGap = null;
let sawRed = false;
let braking = false;
await keyDown('KeyW', 'w', 87);
const t1 = Date.now();
while (Date.now() - t1 < 240000) {
  const st = await getCar();
  const a = st?.ahead;
  if (a && a.signal === 'red') {
    sawRed = true;
    if (!braking && a.distToStopLine < 60) {
      braking = true;
      await keyUp('KeyW', 'w', 87);
      await keyDown('KeyS', 's', 83);
    }
    if (braking && (st.car?.speedKmh ?? 99) < 1) {
      stoppedGap = a.distToStopLine;
      if (stoppedGap < -1) redRun = true;
      break;
    }
  }
  await sleep(1000);
}
await keyUp('KeyW', 'w', 87);
await keyUp('KeyS', 's', 83);
console.log(`  red-light stop: gap=${stoppedGap === null ? 'n/a' : stoppedGap.toFixed(1)}`);
check('red light seen during drive', sawRed);
check('stops before the red line', stoppedGap !== null && stoppedGap > 0, `gap=${stoppedGap === null ? 'n/a' : stoppedGap.toFixed(1)}`);
check('no red run', !redRun);

// 5. Exit the car with E, then re-enter for the screenshot.
await keyTap('KeyE', 'e', 69);
await sleep(500);
const mode2 = (await getCar())?.mode;
check('E exits the car', mode2 === 'walk', `mode=${mode2}`);
await keyTap('KeyE', 'e', 69);
await sleep(500);
const mode3 = (await getCar())?.mode;
check('E re-enters the car', mode3 === 'drive', `mode=${mode3}`);

// 6. Daytime drive screenshot: traffic + pedestrians on, drive north on
// the boulevard at ~30-35 km/h (just above the 28.8 km/h traffic flow)
// and shoot the moment a traffic car is 15-35 units ahead in the lane
// (close enough to read clearly in the chase-cam frame) and a pedestrian
// is on the sidewalk within 80 units. The shot is taken immediately when
// the moment is found — no delay, so the car ahead stays in frame.
await evalJs('window.__palkon.debug.setTrafficEnabled(true)');
await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
await sleep(500);
let shot = false;
{
  const t0 = Date.now();
  let wDown = false;
  while (Date.now() - t0 < 180000) {
    const st = await getCar();
    const cars = await evalJs('window.__palkon.debug.trafficCars()');
    const peds = await evalJs('window.__palkon.debug.pedestrians()');
    const cz = st?.car?.z ?? 800;
    const cx = st?.car?.x ?? 400;
    const kmh = st?.car?.speedKmh ?? 0;
    const carAhead = Array.isArray(cars) && cars.some((c) => Math.abs(c.x - cx) < 12 && c.z < cz - 15 && c.z > cz - 35);
    const pedInView = Array.isArray(peds) && peds.some((p) => Math.abs(p.x - cx) < 30 && p.z < cz + 20 && p.z > cz - 80);
    if (carAhead && pedInView) {
      console.log(`  screenshot moment: car at (${cx.toFixed(0)},${cz.toFixed(0)}) ${kmh.toFixed(0)} km/h, traffic 15-35 ahead + pedestrian in view`);
      await screenshot(`${OUT}drive-day.png`);
      shot = true;
      break;
    }
    // Hold ~30-35 km/h: W on below 30, off above 35 (poll 500 ms so the
    // speed does not overshoot far past the band).
    if (kmh < 30 && !wDown) { await keyDown('KeyW', 'w', 87); wDown = true; }
    if (kmh > 35 && wDown) { await keyUp('KeyW', 'w', 87); wDown = false; }
    await sleep(500);
  }
  await keyUp('KeyW', 'w', 87);
}
if (!shot) {
  console.log('  (no traffic+pedestrian moment in 180 s; shooting anyway)');
  await screenshot(`${OUT}drive-day.png`);
}
console.log('  final state:', JSON.stringify(await getCar()));

check('no console errors during drive test', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));

client.close();
chrome.kill('SIGKILL');
console.log(fails.length ? `${fails.length} FAILURES: ${fails.join(', ')}` : 'ALL DRIVE TESTS PASS');
process.exit(fails.length ? 1 : 0);
