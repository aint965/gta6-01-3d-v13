// Entrypoint: wires the city, renderer, camera, HUD and minimap together.
// URL staging (for screenshots and tests):
//   ?shot=boulevard-day | sunset | night | plaza
//   ?cam=x,y,z&target=x,y,z&preset=day|sunset|night&haze=on|off
import { createCity, SEED } from './city.js';
import { createRenderer } from './renderer.js';
import { createCamera, perspective } from './camera.js';
import { createInput } from './input.js';
import { PRESETS, PRESET_ORDER } from './lighting.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const city = createCity(SEED);
const renderer = createRenderer(canvas, city);
const camera = createCamera();
const minimap = createMinimap(document.getElementById('minimap'), city);
const hud = createHud(city);

let presetName = 'day';
function setPreset(name) {
  if (name === 'cycle') {
    const i = PRESET_ORDER.indexOf(presetName);
    name = PRESET_ORDER[(i + 1) % PRESET_ORDER.length];
  }
  presetName = name;
  renderer.setPreset(PRESETS[name]);
}
const input = createInput(canvas, camera, setPreset);

// Staged camera shots. The opening vista is high over the boulevard south
// of the plaza, looking north at the clock tower and the skyline.
const SHOTS = {
  'boulevard-day': { preset: 'day', eye: [400, 42, 880], target: [400, 16, -300] },
  sunset: { preset: 'sunset', eye: [400, 30, 900], target: [400, 12, 300] },
  night: { preset: 'night', eye: [400, 16, 700], target: [400, 12, -200] },
  plaza: { preset: 'day', eye: [400, 12, 480], target: [400, 18, 280] },
};
const shot = SHOTS[params.get('shot') || ''];
if (shot) {
  setPreset(shot.preset);
  camera.place(shot.eye, shot.target);
} else {
  const cam = params.get('cam');
  const tgt = params.get('target');
  if (cam && tgt) {
    setPreset(params.get('preset') || 'day');
    camera.place(cam.split(',').map(Number), tgt.split(',').map(Number));
  } else {
    setPreset(params.get('preset') || 'day');
    camera.place([400, 55, 750], [400, 15, 250]);
  }
}
if (params.get('haze') === 'off') {
  renderer.setHazeEnabled(false);
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let frames = 0;
let fps = 0;
let fpsTime = last;
let hudTime = last;
let rendered = 0;

window.__palkon = { ready: false, frames: 0 };

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.step(dt);
  const proj = perspective((55 * Math.PI) / 180, canvas.width / canvas.height, 0.5, 8000);
  renderer.render(camera, proj);
  rendered++;
  window.__palkon.frames = rendered;
  if (rendered >= 3) window.__palkon.ready = true;
  frames++;
  if (now - fpsTime >= 1000) {
    fps = Math.round((frames * 1000) / (now - fpsTime));
    frames = 0;
    fpsTime = now;
  }
  if (now - hudTime >= 120) {
    hudTime = now;
    hud.update({
      camera,
      presetName,
      presetLabel: PRESETS[presetName].label,
      speedKmh: 0,
      fps,
    });
    minimap.draw(camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
