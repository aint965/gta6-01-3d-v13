// CDP driver: opens the game in headless Chrome, waits for the renderer
// to be ready, collects console/page errors, takes a 1280x720 screenshot.
// Usage: node checks/drive.mjs <shot-name> <url-query> [haze=on|off]
//   shot-name: boulevard-day | sunset | night | plaza | custom
//   url-query: e.g. "?shot=boulevard-day" or "?cam=...&target=...&preset=night"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = path.join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');
const [shotName, query = '', haze = 'on'] = process.argv.slice(2);
const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '..');
const outPath = path.join(repo, 'screenshots', `${shotName}.png`);
const url = `http://127.0.0.1:8124/game/index.html${query}${query.includes('?') ? '&' : '?'}haze=${haze}`;

const chrome = spawn(CHROME, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,720',
  '--remote-debugging-port=9222',
  url,
], { stdio: 'ignore' });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* chrome not up yet */ }
    await sleep(500);
  }
  throw new Error('no CDP page target after 30s');
}

const errors = [];
let ws;
let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m.result);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  // Wait for the renderer to report ready (3 frames rendered).
  let ready = false;
  for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', { expression: 'window.__palkon && window.__palkon.ready', returnByValue: true });
    if (r?.result?.value === true) { ready = true; break; }
    await sleep(250);
  }
  if (!ready) {
    const r = await send('Runtime.evaluate', { expression: 'window.__palkon ? JSON.stringify(window.__palkon) : "no __palkon"', returnByValue: true });
    errors.push('NOT READY: ' + (r?.result?.value ?? 'unknown'));
  }
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  const size = fs.statSync(outPath).size;
  console.log(JSON.stringify({ shot: shotName, ready, errors, file: outPath, bytes: size }));
  process.exitCode = errors.length ? 1 : 0;
} catch (e) {
  console.log(JSON.stringify({ shot: shotName, ready: false, errors: [String(e)], file: null, bytes: 0 }));
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
}
