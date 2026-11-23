// Stage B pure-logic tests (Node, no browser): vehicle profiles, collision,
// signals, traffic (240 s simulated), player enter/exit, loop paths.
// Usage: node checks/test-stage-b.mjs   (exit 0 = all pass)
import { createCity } from '../game/src/city.js';
import { Vehicle, PROFILES, msToKmh } from '../game/src/vehicle.js';
import { aabbOf, obbVsObb, resolveCarVsBuildings, resolveCarVsCars } from '../game/src/collision.js';
import { signalState, CYCLE } from '../game/src/signals.js';
import { TrafficSystem, pointAt } from '../game/src/traffic.js';
import { Player, ENTER_RADIUS } from '../game/src/player.js';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const city = createCity();
const aabbs = city.buildings.map(aabbOf);

// ---- 1. Top speeds -----------------------------------------------------
for (const [name, p] of Object.entries(PROFILES)) {
  const v = new Vehicle(name, 400, 800, Math.PI); // boulevard, facing north
  let maxKmh = 0;
  for (let t = 0; t < 20; t += 1 / 60) {
    v.update(1 / 60, { throttle: true, brake: false, steer: 0, handbrake: false });
    maxKmh = Math.max(maxKmh, v.speedKmh());
  }
  check(`top speed ${name}`, Math.abs(maxKmh - p.topKmh) < 1, `measured ${maxKmh.toFixed(1)} vs target ${p.topKmh}`);
}

// ---- 2. Reverse ---------------------------------------------------------
{
  const v = new Vehicle('sedan', 400, 800, Math.PI);
  const z0 = v.z;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    v.update(1 / 60, { throttle: false, brake: true, steer: 0, handbrake: false });
  }
  const dist = Math.abs(v.z - z0);
  check('reverse 2.5s', dist > 8 && dist < 30, `reversed ${dist.toFixed(1)} units, speed ${v.speedKmh().toFixed(1)} km/h`);
}

// ---- 3. Collision vs building -------------------------------------------
{
  // Aim a coupe at a building wall: start 30 units south of a wide building.
  const b = city.buildings.find((bb) => bb.w > 30 && bb.d > 20 && Math.abs(bb.x - 400) > 60);
  const v = new Vehicle('coupe', b.x, b.z + b.d / 2 + 30, Math.PI);
  v.speed = 30; // 108 km/h into the wall
  const dmgBefore = v.damage;
  let penetrated = false;
  for (let t = 0; t < 3; t += 1 / 60) {
    const s = Math.abs(v.speed);
    v.update(1 / 60, { throttle: true, brake: false, steer: 0, handbrake: false });
    resolveCarVsBuildings(v, aabbs, s);
    const a = aabbOf(b);
    if (v.x > a.x0 - 2.3 && v.x < a.x1 + 2.3 && v.z > a.z0 - 2.3 && v.z < a.z1 + 2.3) penetrated = true;
  }
  check('building collision stops car', Math.abs(v.speed) < 5, `final speed ${v.speedKmh().toFixed(1)} km/h`);
  check('building collision damages', v.damage > dmgBefore, `damage ${v.damage.toFixed(1)}%`);
  check('building collision no penetration', !penetrated, `car at ${v.x.toFixed(1)},${v.z.toFixed(1)}`);
}

// ---- 4. Car vs car head-on ----------------------------------------------
{
  const a = new Vehicle('sedan', 400, 0, Math.PI);
  const b = new Vehicle('sedan', 400, -40, 0);
  a.speed = 20;
  b.speed = 20;
  for (let t = 0; t < 2; t += 1 / 60) {
    a.update(1 / 60, { throttle: false, brake: false, steer: 0, handbrake: false });
    b.update(1 / 60, { throttle: false, brake: false, steer: 0, handbrake: false });
    resolveCarVsCars(a, [b], 20);
  }
  const overlap = obbVsObb(a, b);
  check('car vs car no overlap', overlap === null, overlap ? `penetration ${overlap.map((x) => x.toFixed(2))}` : `gap ok, speeds ${a.speedKmh().toFixed(1)}/${b.speedKmh().toFixed(1)}`);
}

// ---- 5. Signals -----------------------------------------------------------
{
  const x = 400;
  const z = 200;
  let nsGreen = 0;
  let nsYellow = 0;
  let ewGreen = 0;
  let ewYellow = 0;
  for (let t = 0; t < CYCLE * 4; t += 0.5) {
    const s = signalState(x, z, t);
    if (s.ns === 'green') nsGreen++;
    if (s.ns === 'yellow') nsYellow++;
    if (s.ew === 'green') ewGreen++;
    if (s.ew === 'yellow') ewYellow++;
  }
  check('signal cycle NS green 11s', nsGreen === 88, `${nsGreen * 0.5}s per ${CYCLE}s cycle`);
  check('signal cycle NS yellow 2s', nsYellow === 16, `${nsYellow * 0.5}s`);
  check('signal cycle EW green 11s', ewGreen === 88, `${ewGreen * 0.5}s`);
  check('signal cycle EW yellow 2s', ewYellow === 16, `${ewYellow * 0.5}s`);
}

// ---- 6a. Mid-edge red light: a car stops at a crossing that is NOT a
// corner, and never crosses the line while the light is red --------------
{
  const traffic = new TrafficSystem(city);
  // Find the start of a red phase for the NS light at (800,-200).
  let tRed = -1;
  let prev = signalState(800, -200, 0).ns;
  for (let t = 0.05; t < 26; t += 0.05) {
    const cur = signalState(800, -200, t).ns;
    if (prev !== 'red' && cur === 'red') { tRed = t; break; }
    prev = cur;
  }
  check('red phase found at (800,-200)', tRed >= 0, `t=${tRed.toFixed(2)}`);
  traffic.time = tRed;
  // Place car 0 (loop A) 30 units before the (800,-200) crossing, heading
  // south on the x=797 lane. Find its arc position by scanning.
  const loop = traffic.loops[0];
  let bestS = 0;
  let bestD = Infinity;
  for (let s = 0; s < loop.totalLen; s += 0.5) {
    const [x, z] = pointAt(loop, s);
    const d = Math.hypot(x - 797, z - (-230));
    if (d < bestD) { bestD = d; bestS = s; }
  }
  const car = traffic.cars[0];
  car.s = bestS;
  car.speed = 12;
  car.cruise = 12.5;
  traffic.updatePositions();
  let maxZ = -Infinity; // front bumper z (southbound: z increases toward -200)
  let stopped = false;
  for (let t = 0; t < 10; t += 1 / 30) {
    traffic.update(1 / 30, null);
    const bumperZ = car.z + 2.3;
    if (bumperZ > maxZ) maxZ = bumperZ;
    if (car.speed < 0.5) stopped = true;
  }
  // The stop line sits 8 units before the crossing (z=-200), so the
  // bumper must never pass z=-208.0 while the light is red.
  check('mid-edge red: bumper never crosses the line', maxZ <= -208.0 + 0.05, `closest bumper z=${maxZ.toFixed(1)} (line -208.0)`);
  check('mid-edge red: car stops', stopped);
  check('mid-edge red: 0 red runs in 10s', traffic.stats.redRuns === 0, `${traffic.stats.redRuns}`);
}

// ---- 6b. Follow: fast car behind a slow leader on the same loop --------
{
  const traffic = new TrafficSystem(city);
  const a = traffic.cars[0];
  const b = traffic.cars[1]; // same loop (loop 0)
  b.s = (a.s + 30) % traffic.loops[0].totalLen; // b 30 units ahead of a
  a.cruise = 12.5;
  a.speed = 12.5;
  b.cruise = 8;
  b.speed = 8;
  traffic.updatePositions();
  let minGap = Infinity;
  let overlap = false;
  for (let t = 0; t < 30; t += 1 / 30) {
    traffic.update(1 / 30, null);
    let gap = b.s - a.s;
    if (gap < 0) gap += traffic.loops[0].totalLen;
    gap -= 4.6;
    if (gap < minGap) minGap = gap;
    if (obbVsObb(a, b)) overlap = true;
  }
  check('follow keeps gap >= 4', minGap >= 4, `min gap ${minGap.toFixed(1)}`);
  check('follow never overlaps', !overlap);
  check('follower slows to leader speed', a.speed <= b.speed + 1.5, `follower ${a.speed.toFixed(1)} vs leader ${b.speed.toFixed(1)} m/s`);
}
{
  const traffic = new TrafficSystem(city);
  const dt = 1 / 30;
  let overlapFrames = 0;
  let offRoad = 0;
  for (let t = 0; t < 240; t += dt) {
    traffic.update(dt, null);
    // Pairwise OBB overlap check (sampled every second).
    if (Math.round(t * 30) % 30 === 0) {
      for (let i = 0; i < traffic.cars.length; i++) {
        for (let j = i + 1; j < traffic.cars.length; j++) {
          if (obbVsObb(traffic.cars[i], traffic.cars[j])) overlapFrames++;
        }
        const c = traffic.cars[i];
        if (!city.nearStreet(c.x, c.z, 0) && !city.nearStreet(c.x, c.z, -2)) {
          // Cars may sit up to ~3 units off the centreline (lane offset);
          // nearStreet with clear 0 covers the road half-width.
          if (!city.nearStreet(c.x, c.z, 2)) offRoad++;
        }
      }
    }
  }
  const st = traffic.stats;
  check('traffic 0 red runs (240s)', st.redRuns === 0, `${st.redRuns} red runs`);
  check('traffic stops at red lights', st.stops > 0, `${st.stops} stops`);
  check('traffic follow gap kept', st.minFollowGap === Infinity || st.minFollowGap >= 4,
    st.minFollowGap === Infinity ? 'no following observed' : `min gap ${st.minFollowGap.toFixed(1)}`);
  check('traffic cars never overlap', overlapFrames === 0, `${overlapFrames} overlapping samples`);
  check('traffic min pair distance sane', st.minPairDist >= 4.5, `min ${st.minPairDist.toFixed(1)}`);
  check('traffic stays on roads', offRoad === 0, `${offRoad} off-road samples`);
  console.log(`  traffic: ${traffic.cars.length} cars, ${traffic.pedestrians.length} pedestrians, stops=${st.stops}, redRuns=${st.redRuns}`);
}

// ---- 6d. Traffic at browser dt (0.1s steps, 300 s): no red runs --------
// The discrete step at dt=0.1 used to overshoot the stop line by a fraction
// and count phantom red runs; the stop-line clamp must prevent that.
{
  const traffic = new TrafficSystem(city);
  for (let t = 0; t < 300; t += 0.1) traffic.update(0.1, null);
  check('traffic 0 red runs at dt=0.1 (300s)', traffic.stats.redRuns === 0, `${traffic.stats.redRuns} red runs`);
  check('traffic stops at red lights at dt=0.1', traffic.stats.stops > 0, `${traffic.stats.stops} stops`);
  check('traffic cars never overlap at dt=0.1', traffic.stats.minPairDist >= 4.6, `min pair dist ${traffic.stats.minPairDist.toFixed(1)}`);
  console.log(`  dt=0.1 traffic: stops=${traffic.stats.stops}, redRuns=${traffic.stats.redRuns}, minPairDist=${traffic.stats.minPairDist.toFixed(1)}`);
}

// ---- 7. Player enter/exit --------------------------------------------------
{
  const p = new Player(390, 503);
  const cars = [
    { x: 387, z: 500, heading: 0, drivable: true, profile: 'sedan' },
    { x: 200, z: 200, heading: 0, drivable: true, profile: 'coupe' },
    { x: 100, z: 100, heading: 0, drivable: false, profile: null },
  ];
  const near = p.nearestDrivable(cars, ENTER_RADIUS);
  check('player finds nearest drivable car', near && near.car.profile === 'sedan', near ? `dist ${near.dist.toFixed(1)}` : 'none');
  p.enter(near.car);
  check('player enters car', p.mode === 'drive' && p.car === near.car);
  p.exit();
  check('player exits beside car', p.mode === 'walk' && Math.hypot(p.x - near.car.x, p.z - near.car.z) < 4.5, `exit at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  const far = new Player(0, 0);
  check('player finds nothing far away', far.nearestDrivable(cars, ENTER_RADIUS) === null);
}

// ---- 8. Loop paths: cars stay on roads -------------------------------------
{
  const t2 = new TrafficSystem(city);
  for (let t = 0; t < 60; t += 1 / 30) t2.update(1 / 30, null);
  const allOnRoad = t2.cars.every((c) => city.nearStreet(c.x, c.z, 2));
  check('loop cars stay on roads after 60s', allOnRoad);
  const totalLen = t2.loops.map((l) => Math.round(l.totalLen)).join(', ');
  console.log(`  loop lengths: ${totalLen}`);
}

console.log(failures.length === 0 ? 'ALL STAGE B PURE TESTS PASS' : `${failures.length} FAILURES: ${failures.join(', ')}`);
process.exit(failures.length ? 1 : 0);
