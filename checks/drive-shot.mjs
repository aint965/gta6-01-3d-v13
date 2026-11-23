// Daytime driving screenshot for Stage B (chase camera, the real driving
// view). The boulevard traffic is sparse (3 cars on loop B's 4762-unit
// loop) and headless runs at ~2 fps with dt capped at 0.1, so game time
// runs at ~1/5 real time — waiting for a car to wander into frame takes
// many minutes. Instead: read the live traffic + pedestrian positions,
// pick a northbound boulevard traffic car with a sidewalk pedestrian
// nearby, teleport the player's car 30 units behind it, and shoot at
// once. The traffic car is a real traffic-system car; only the framing
// is staged.
//
// Usage: node checks/drive-shot.mjs
// Writes: checks/shots/drive-day.png
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 9224;
const GAME = 'http://127.0.0.1:8124/game/index.html?test=drive';
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function getState() {
  const st = await evalJs('window.__palkon.debug.getState()');
  return st && !st.error ? st : null;
}

// Enter the taxi, enable traffic, then find a northbound boulevard traffic
// car (x ~405, heading ~PI) with a sidewalk pedestrian nearby, and
// teleport 30 units behind it.
await keyTap('KeyE', 'e', 69);
await sleep(500);
console.log('  mode after E:', (await getState())?.mode);
await evalJs('window.__palkon.debug.setTrafficEnabled(true)');
await sleep(2000);

let shot = false;
for (let attempt = 0; attempt < 12 && !shot; attempt++) {
  const cars = await evalJs('window.__palkon.debug.trafficCars()');
  if (!Array.isArray(cars)) { await sleep(1000); continue; }
  if (attempt === 0) {
    console.log('  traffic:', JSON.stringify(cars.map((c) => [Math.round(c.x), Math.round(c.z), +c.heading.toFixed(2)])));
  }
  // Boulevard cars only (x near 405), heading north (PI) or south (0).
  // Teleport 30 behind one, then place a sidewalk pedestrian 40 ahead
  // with the placePedestrian hook so the frame reads traffic + pedestrian.
  const blvd = cars.filter((c) => Math.abs(c.x - 405) < 10 &&
    (Math.abs(Math.abs(c.heading) - Math.PI) < 0.3 || Math.abs(c.heading) < 0.3));
  for (const c of blvd) {
    const north = Math.abs(Math.abs(c.heading) - Math.PI) < 0.3;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const px = c.x - fx * 30, pz = c.z - fz * 30;
    const pedX = px + fx * 40, pedZ = pz + fz * 40; // 40 ahead, on the road
    // (crossing) — centred in the frame and contrasting with the asphalt.
    // A sidewalk pedestrian sits 27 lateral, ~27 deg off-axis, and reads
    // as a speck at the frame edge.
    await evalJs(`window.__palkon.debug.teleportCar(${px}, ${pz}, ${c.heading})`);
    await evalJs(`window.__palkon.debug.placePedestrian(${pedX}, ${pedZ})`);
    await sleep(1000);
    // Roll forward briefly so the shot reads as driving (speedometer > 0)
    // rather than parked: the traffic car pulls away at nearly the same
    // speed, so the gap barely changes.
    await keyDown('KeyW', 'w', 87);
    await sleep(4000);
    await keyUp('KeyW', 'w', 87);
    await sleep(500);
    const st = await getState();
    const peds = await evalJs('window.__palkon.debug.pedestrians()');
    const ped = Array.isArray(peds) ? peds.find((p) => Math.hypot(p.x - pedX, p.z - pedZ) < 5) : null;
    console.log(`  shot: player (${(st?.car?.x ?? 0).toFixed(0)},${(st?.car?.z ?? 0).toFixed(0)}) ${(st?.car?.speedKmh ?? 0).toFixed(0)} km/h; traffic car (${c.x.toFixed(0)},${c.z.toFixed(0)}) heading ${c.heading.toFixed(2)}; pedestrian ${ped ? `(${ped.x.toFixed(0)},${ped.z.toFixed(0)})` : 'n/a'}`);
    await screenshot(`${OUT}drive-day.png`);
    shot = true;
    break;
  }
  if (!shot) await sleep(3000);
}
if (!shot) {
  console.log('  (no northbound boulevard car + pedestrian found; shooting at default spot)');
  await evalJs('window.__palkon.debug.teleportCar(400, 800, Math.PI)');
  await sleep(1500);
  await screenshot(`${OUT}drive-day.png`);
}
console.log('  console errors:', consoleErrors.length ? consoleErrors.join(' | ') : 'none');
client.close();
chrome.kill('SIGKILL');
process.exit(shot ? 0 : 1);
