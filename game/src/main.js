// Entrypoint: wires the city, renderer, camera, HUD and minimap together,
// plus Stage B: driving, traffic, headlights, collision, Mara on foot.
// URL staging (for screenshots and tests):
//   ?shot=boulevard-day | sunset | night | plaza
//   ?cam=x,y,z&target=x,y,z&preset=day|sunset|night&haze=on|off
//   ?test=drive | headlight   (test hooks on window.__palkon.debug)
import { createCity, SEED } from './city.js';
import { createRenderer } from './renderer.js';
import { createCamera, perspective } from './camera.js';
import { createInput } from './input.js';
import { PRESETS, PRESET_ORDER } from './lighting.js';
import { createHud } from './hud.js';
import { createMinimap } from './minimap.js';
import { Vehicle, PROFILES, msToKmh } from './vehicle.js';
import { TrafficSystem } from './traffic.js';
import { Player, ENTER_RADIUS, PROMPT_RADIUS } from './player.js';
import { buildDynamicMesh } from './dynamic.js';
import { aabbOf, resolveCarVsBuildings, resolveCarVsCars } from './collision.js';
import { signalState } from './signals.js';

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

// ---- car entities ------------------------------------------------------
// Drivable: the 3 yellow taxis (sedan) + the 5 parked cars nearest the
// boulevard, one of each profile so every profile is on the street.
// Parked cars stay locked and render without the coral roof stripe.
const carEntities = [];
{
  const parked = [...city.cars];
  const taxis = parked.filter((c) => c.taxi);
  const others = parked.filter((c) => !c.taxi)
    .sort((a, b) => Math.abs(a.x - 400) - Math.abs(b.x - 400));
  const drivableProfiles = ['compact', 'coupe', 'van', 'sedan', 'compact'];
  const chosen = new Set();
  for (const t of taxis) {
    chosen.add(t);
    carEntities.push({
      x: t.x, z: t.z, heading: t.heading, color: t.color, taxi: true,
      drivable: true, profile: 'sedan', vehicle: new Vehicle('sedan', t.x, t.z, t.heading),
      len: 4.6, wid: 2.0, idx: -1,
    });
  }
  for (let i = 0; i < 5; i++) {
    const c = others[i];
    chosen.add(c);
    const profile = drivableProfiles[i];
    carEntities.push({
      x: c.x, z: c.z, heading: c.heading, color: c.color, taxi: false,
      drivable: true, profile, vehicle: new Vehicle(profile, c.x, c.z, c.heading),
      len: 4.6, wid: 2.0, idx: -1,
    });
  }
  for (const c of parked) {
    if (chosen.has(c)) continue;
    carEntities.push({
      x: c.x, z: c.z, heading: c.heading, color: c.color, taxi: false,
      drivable: false, profile: null, vehicle: null,
      len: 4.6, wid: 2.0, idx: 99, movable: false,
    });
  }
}
const buildingAabbs = city.buildings.map(aabbOf);

const traffic = new TrafficSystem(city);
const player = new Player(390, 320); // plaza edge, on foot
let targetCar = null; // static car placed by the headlight test hook
let headlightMode = 'auto'; // 'auto' | 'on' | 'off'
let trafficEnabled = true;
let shake = 0;
let toast = { text: '', until: 0 };
let gameTime = 0;
const dust = []; // collision dust puffs: {x, z, age}
const STOP_LINE_OFFSET = 8 + 2.3; // stop line 8 before the centre + half a car
let sampleResolve = null; // pending pixel-probe promise
let sampleTaken = null; // last sample object already handed out

function showToast(text) {
  toast = { text, until: performance.now() + 2500 };
}

// Staged camera shots. The opening vista is high over the boulevard south
// of the plaza, looking north at the clock tower and the skyline.
const SHOTS = {
  'boulevard-day': { preset: 'day', eye: [400, 42, 880], target: [400, 16, -300] },
  sunset: { preset: 'sunset', eye: [400, 30, 900], target: [400, 12, 300] },
  night: { preset: 'night', eye: [400, 16, 700], target: [400, 12, -200] },
  plaza: { preset: 'day', eye: [400, 12, 480], target: [400, 18, 280] },
};
const shot = SHOTS[params.get('shot') || ''];
const staged = Boolean(shot) || (params.get('cam') && params.get('target'));
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
    camera.place([390, 25, 400], [390, 2, 320]);
    camera.setDist(12);
    camera.setPitch(-0.22);
  }
}
if (params.get('haze') === 'off') {
  renderer.setHazeEnabled(false);
}

// Test modes: spawn Mara next to a taxi so E works at once.
const testMode = params.get('test') || '';
if (testMode === 'drive' || testMode === 'headlight') {
  player.x = 390;
  player.z = 503;
  if (testMode === 'headlight') {
    setPreset('night');
    trafficEnabled = false;
  }
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

window.__palkon = { ready: false, frames: 0, time: 0, mode: 'walk', speedKmh: 0 };

function headlightsOn() {
  if (headlightMode === 'on') return true;
  if (headlightMode === 'off') return false;
  return presetName === 'night' || presetName === 'sunset';
}

// Two cones per car (left/right headlight), world-space spot lights.
function conesFor(car, color = [1.0, 0.9, 0.7], pow = 0.9) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  const dirLen = Math.hypot(fx, -0.12, fz);
  const dir = [fx / dirLen, -0.12 / dirLen, fz / dirLen];
  const out = [];
  for (const side of [-0.7, 0.7]) {
    out.push({
      pos: [car.x + fx * 2.3 + rx * side, 0.9, car.z + fz * 2.3 + rz * side],
      dir,
      color,
      cos: Math.cos((24 * Math.PI) / 180),
      pow,
    });
  }
  return out;
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  gameTime += dt;
  window.__palkon.time = gameTime;

  // Traffic (frozen when the test hook disables it).
  if (trafficEnabled) {
    const playerCar = player.mode === 'drive' ? player.car : null;
    traffic.update(dt, playerCar);
  }

  // ---- player --------------------------------------------------------
  const { x: ax, y: ay } = input.axis();
  const yaw = camera.getYaw();
  const fwd = [-Math.sin(yaw), -Math.cos(yaw)];
  const right = [Math.cos(yaw), -Math.sin(yaw)];
  if (player.mode === 'walk') {
    let mx = ax * right[0] + ay * fwd[0];
    let mz = ax * right[1] + ay * fwd[1];
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    player.updateWalk(dt, mx, mz, buildingAabbs);
    if (input.pressed.has('KeyE')) {
      const near = player.nearestDrivable(carEntities, ENTER_RADIUS);
      if (near) {
        player.enter(near.car);
        near.car.vehicle.speed = 0;
        showToast(`Driving the ${near.car.profile}`);
        // Chase framing only when the camera is not staged (a staged
        // ?cam= shot or test keeps its fixed camera on E).
        if (!staged) {
          camera.setDist(16);
          camera.setPitch(-0.2);
        }
      }
    }
  } else {
    const car = player.car;
    const v = car.vehicle;
    const steer = (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0)
      - (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? 1 : 0);
    const speedBefore = Math.abs(v.speed);
    v.update(dt, {
      throttle: input.keys.has('KeyW') || input.keys.has('ArrowUp'),
      brake: input.keys.has('KeyS') || input.keys.has('ArrowDown'),
      steer,
      handbrake: input.keys.has('Space'),
    });
    car.speed = v.speed; // traffic's follow logic reads this
    const dmgBefore = v.damage;
    const others = [...traffic.cars, ...carEntities.filter((c) => c !== car), ...(targetCar ? [targetCar] : [])];
    resolveCarVsBuildings(v, buildingAabbs, speedBefore);
    resolveCarVsCars(v, others, speedBefore);
    car.x = v.x;
    car.z = v.z;
    car.heading = v.heading;
    if (v.damage > dmgBefore) {
      const gained = v.damage - dmgBefore;
      shake = Math.min(1.5, v.lastImpact / 14);
      showToast(`CRASH! Damage +${Math.round(gained)}%`);
      // Dust puff at the front bumper.
      const [fx, fz] = v.forward();
      for (let i = 0; i < 6; i++) {
        dust.push({
          x: v.x + fx * 2.4 + (Math.random() - 0.5) * 2,
          z: v.z + fz * 2.4 + (Math.random() - 0.5) * 2,
          age: Math.random() * 0.15,
        });
      }
    }
    if (input.pressed.has('KeyE')) {
      player.exit();
      showToast('On foot');
      if (!staged) {
        camera.setDist(12);
        camera.setPitch(-0.22);
      }
    }
  }

  // Dust ages out.
  for (let i = dust.length - 1; i >= 0; i--) {
    dust[i].age += dt;
    if (dust[i].age > 0.6) dust.splice(i, 1);
  }
  shake *= Math.exp(-dt * 4);
  camera.setShake(shake);

  // ---- camera follow (not in staged shots) ---------------------------
  if (!staged) {
    if (player.mode === 'drive') {
      const car = player.car;
      camera.easeTargetTo([car.x, 2, car.z], dt, 5);
      if (camera.secondsSinceDrag(now) > 2.5) {
        const [fx, fz] = car.vehicle.forward();
        camera.easeYawTo(Math.atan2(-fx, -fz), dt, 1.2);
      }
    } else {
      camera.easeTargetTo([player.x, 1.5, player.z], dt, 5);
    }
  }

  // ---- headlights -----------------------------------------------------
  let spots = [];
  if (headlightsOn()) {
    if (player.mode === 'drive') spots.push(...conesFor(player.car));
    // The 3 nearest traffic cars also light the road at night.
    // (Skipped in headlight test mode: the test isolates the player's own
    // beams, so a frozen traffic car's cone cannot leak into a probe.)
    if (testMode !== 'headlight') {
      const moving = [...traffic.cars].sort((a, b) => {
        const da = Math.hypot(a.x - camera.getTarget()[0], a.z - camera.getTarget()[2]);
        const db = Math.hypot(b.x - camera.getTarget()[0], b.z - camera.getTarget()[2]);
        return da - db;
      });
      for (const t of moving.slice(0, 3)) spots.push(...conesFor(t));
    }
    spots = spots.slice(0, 8);
  }

  // ---- dynamic mesh ---------------------------------------------------
  const near = player.mode === 'walk' ? player.nearestDrivable(carEntities, PROMPT_RADIUS) : null;
  const rings = [];
  if (player.mode === 'walk') {
    for (const c of carEntities) {
      if (!c.drivable) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < PROMPT_RADIUS) rings.push({ car: c, bright: d < ENTER_RADIUS });
    }
  }
  const dynMesh = buildDynamicMesh({
    cars: carEntities,
    traffic: traffic.cars,
    mara: player.mode === 'walk' ? player : null,
    pedestrians: traffic.pedestrians,
    intersections: city.intersections,
    signalAt: (x, z, axis) => {
      const s = signalState(x, z, traffic.time);
      return axis === 'NS' ? s.ns : s.ew;
    },
    rings,
    dust,
    targetCar,
  });

  // ---- render ---------------------------------------------------------
  const proj = perspective((55 * Math.PI) / 180, canvas.width / canvas.height, 0.5, 8000);
  renderer.render(camera, proj, { mesh: dynMesh, spots });
  // Resolve a pending pixel probe with this frame's sample.
  if (sampleResolve && renderer.lastSample && renderer.lastSample !== sampleTaken) {
    const r = sampleResolve;
    sampleResolve = null;
    sampleTaken = renderer.lastSample;
    r(renderer.lastSample);
  }
  rendered++;
  window.__palkon.frames = rendered;
  if (rendered >= 3) window.__palkon.ready = true;
  frames++;
  if (now - fpsTime >= 250) {
    fps = Math.round((frames * 1000) / (now - fpsTime));
    frames = 0;
    fpsTime = now;
  }
  if (now - hudTime >= 120) {
    hudTime = now;
    const walking = player.mode === 'walk' && (ax !== 0 || ay !== 0);
    hud.update({
      camera,
      presetName,
      presetLabel: PRESETS[presetName].label,
      speedKmh: player.mode === 'drive' ? player.car.vehicle.speedKmh() : (walking ? 6 : 0),
      fps,
      mode: player.mode,
      profileLabel: player.mode === 'drive' ? player.car.profile : '',
      damage: player.mode === 'drive' ? player.car.vehicle.damage : 0,
      prompt: player.mode === 'walk'
        ? (near ? `Press E to drive the ${near.car.profile}` : '')
        : 'E exit car',
      toast: now < toast.until ? toast.text : '',
      controls: player.mode === 'drive'
        ? 'WASD drive · Space handbrake · E exit car · 1 / 2 / 3 midday / sunset / night · T cycle light'
        : 'Drag to look around · Scroll to zoom · WASD walk · E enter car · 1 / 2 / 3 midday / sunset / night · T cycle light',
    });
    const dots = [];
    for (const t of traffic.cars) dots.push({ kind: 'traffic', x: t.x, z: t.z });
    for (const c of carEntities) {
      if (c.drivable) dots.push({ kind: 'drivable', x: c.x, z: c.z });
    }
    if (player.mode === 'drive') dots.push({ kind: 'player', x: player.car.x, z: player.car.z });
    else dots.push({ kind: 'mara', x: player.x, z: player.z });
    minimap.draw(camera, dots);
  }
  window.__palkon.mode = player.mode;
  window.__palkon.speedKmh = player.mode === 'drive' ? player.car.vehicle.speedKmh() : 0;
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- test hooks (window.__palkon.debug) -------------------------------
// Used by the Stage B verification drivers only; invisible in normal play.
const debug = {
  setTrafficTime(t) {
    traffic.time = t;
    for (const c of traffic.cars) c.prevDistToStop = Infinity;
  },
  setTrafficEnabled(on) {
    trafficEnabled = on;
  },
  setMara(x, z) {
    if (player.mode === 'drive') player.exit();
    player.x = x;
    player.z = z;
  },
  teleportCar(x, z, heading) {
    if (player.mode !== 'drive') return false;
    const v = player.car.vehicle;
    v.x = x;
    v.z = z;
    v.heading = heading;
    v.speed = 0;
    player.car.x = x;
    player.car.z = z;
    player.car.heading = heading;
    return true;
  },
  setProfile(name) {
    if (player.mode !== 'drive' || !PROFILES[name]) return false;
    const car = player.car;
    const dmg = car.vehicle.damage;
    car.profile = name;
    car.vehicle = new Vehicle(name, car.x, car.z, car.heading);
    car.vehicle.damage = dmg;
    return true;
  },
  enterNearest() {
    if (player.mode !== 'walk') return false;
    const near = player.nearestDrivable(carEntities, ENTER_RADIUS);
    if (!near) return false;
    player.enter(near.car);
    near.car.vehicle.speed = 0;
    return true;
  },
  setHeadlights(mode) {
    headlightMode = mode;
  },
  // Positions of the live traffic cars and pedestrians (for the drive
  // test's screenshot: wait until a car is ahead and a pedestrian is on
  // the sidewalk in view before shooting).
  trafficCars() {
    return traffic.cars.map((c) => ({ x: c.x, z: c.z, heading: c.heading }));
  },
  pedestrians() {
    return traffic.pedestrians.map((p) => ({ x: p.x, z: p.z }));
  },
  placeTargetCar(x, z, heading) {
    targetCar = {
      x, z, heading, color: [0.85, 0.2, 0.2], taxi: false, drivable: false,
      profile: null, vehicle: null, len: 4.6, wid: 2.0, idx: 98, speed: 0,
    };
    return true;
  },
  // Move the nearest pedestrian to (x, z) so a driving screenshot can
  // frame one. Works for boulevard pedestrians (axis 'z': x is the
  // sidewalk, z is the path position) and cross-street pedestrians
  // (axis 'x': z is the street, x is the path position). Test hook only;
  // the pedestrian keeps walking from there at its own speed.
  placePedestrian(x, z) {
    let best = null;
    for (const p of traffic.pedestrians) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.d) best = { p, d };
    }
    if (!best) return false;
    const p = best.p;
    if (p.axis === 'z') { p.fixed = x; p.pos = z; }
    else { p.fixed = z; p.pos = x; }
    return true;
  },
  // Pixel probe: resolves with the renderer's readPixels result for the
  // next rendered frame. points: [{id, x, y, z}] (size 40 px each).
  probe(points) {
    renderer.requestSample(points.map((p) => ({ ...p, size: 40 })));
    return new Promise((resolve) => { sampleResolve = resolve; });
  },
  getState() {
    const state = {
      mode: player.mode,
      time: gameTime,
      trafficTime: traffic.time,
      trafficStats: { ...traffic.stats },
      camEye: camera.eye(),
      camTarget: camera.getTarget(),
      canvas: [canvas.width, canvas.height],
      mara: { x: player.x, z: player.z, heading: player.heading },
      car: null,
      nearestDrivable: null,
      ahead: null,
      fps,
    };
    if (player.mode === 'walk') {
      const near = player.nearestDrivable(carEntities, ENTER_RADIUS);
      if (near) state.nearestDrivable = { dist: near.dist, profile: near.car.profile };
    } else {
      const v = player.car.vehicle;
      state.car = {
        x: player.car.x, z: player.car.z, heading: player.car.heading,
        speedKmh: v.speedKmh(), profile: player.car.profile, damage: v.damage,
      };
      // Nearest intersection ahead on the car's current street.
      const [fx, fz] = v.forward();
      let best = null;
      for (const it of city.intersections) {
        const dx = it.x - player.car.x;
        const dz = it.z - player.car.z;
        const along = dx * fx + dz * fz;
        if (along <= 0 || along > 600) continue;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 20) continue;
        if (!best || along < best.along) best = { x: it.x, z: it.z, along, lat };
      }
      if (best) {
        const axis = Math.abs(fz) > Math.abs(fx) ? 'NS' : 'EW';
        const sig = signalState(best.x, best.z, traffic.time);
        state.ahead = {
          x: best.x, z: best.z, along: best.along,
          distToStopLine: best.along - STOP_LINE_OFFSET,
          signal: axis === 'NS' ? sig.ns : sig.ew,
          axis,
        };
      }
    }
    return state;
  },
};
window.__palkon.debug = debug;
