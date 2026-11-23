// Solmar: the city of "Palkon Auto". Pure deterministic generation (seed 20261123):
// no DOM, no Math.random — the layout verifier imports this file in Node.
// Bounds 3,840 x 3,456. One wide boulevard, secondary + local streets, an
// off-grid Old Solmar, a central plaza with a clock tower and fountain, a
// canal with 3 bridges, a harbour, a beach and a park.

import { makeRng } from './rng.js';

export const SEED = 20261123;
export const BOUNDS = { x0: -1920, x1: 1920, z0: -1728, z1: 1728 };
export const BOULEVARD_X = 400;
export const BOULEVARD_HALF = 18;

// District wall palettes (RGB 0..1). Each district reads from a block away.
export const DISTRICTS = {
  'Old Solmar': { walls: [[0.78, 0.55, 0.32], [0.72, 0.38, 0.26], [0.82, 0.62, 0.4]], css: '#b98a52' },
  'Canal Ward': { walls: [[0.62, 0.32, 0.24], [0.58, 0.36, 0.28], [0.68, 0.4, 0.3]], css: '#8a4a3d' },
  'South Market': { walls: [[0.85, 0.72, 0.5], [0.84, 0.5, 0.42], [0.8, 0.66, 0.45]], css: '#c9a86a' },
  'Citrus Quarter': { walls: [[0.34, 0.52, 0.42], [0.85, 0.75, 0.35], [0.45, 0.6, 0.38]], css: '#6f8a52' },
  'Pearl Marina': { walls: [[0.92, 0.92, 0.88], [0.65, 0.78, 0.85], [0.88, 0.88, 0.82]], css: '#cfd8d2' },
  Glasspoint: { walls: [[0.55, 0.68, 0.72], [0.45, 0.6, 0.68], [0.62, 0.72, 0.75]], css: '#7fa3ad' },
  'Sunstrand Beach': { walls: [[0.88, 0.78, 0.6], [0.9, 0.7, 0.68], [0.85, 0.74, 0.55]], css: '#d8b896' },
};

const HOUSE_TONES = [[0.9, 0.72, 0.6], [0.85, 0.8, 0.6], [0.7, 0.8, 0.85], [0.92, 0.78, 0.7], [0.8, 0.85, 0.65]];

function inRect(x, z, r) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

// Distance from a point to a segment (x0,z0)-(x1,z1).
function distToSegment(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (pz - z0) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx;
  const cz = z0 + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export function createCity(seed = SEED) {
  const rng = makeRng(seed);

  // ---- water, beach, park, plaza -------------------------------------
  const canal = { x0: -1920, x1: 1920, z0: 1180, z1: 1320 };
  const harbour = { x0: -800, x1: 800, z0: 1320, z1: 1728 };
  const beach = [
    { x0: 800, x1: 1920, z0: 1400, z1: 1728 },
    { x0: -1920, x1: -800, z0: 1400, z1: 1728 },
  ];
  const park = { x0: 1000, x1: 1600, z0: -1500, z1: -1000 };
  const plaza = { x: 400, z: 300, half: 110 };

  function isWater(x, z) {
    if (inRect(x, z, canal) || inRect(x, z, harbour)) return true;
    return false;
  }

  // ---- streets --------------------------------------------------------
  // Each street is a segment {x0,z0,x1,z1,half,bridge}. Boulevard first.
  const streets = [];
  const addStreet = (x0, z0, x1, z1, half, bridge = false) => streets.push({ x0, z0, x1, z1, half, bridge });

  // The boulevard: one wide north-south avenue through the centre.
  addStreet(BOULEVARD_X, -1700, BOULEVARD_X, 1150, BOULEVARD_HALF);

  const verticals = [-1600, -1200, -800, -400, 200, 800, 1200, 1600];
  const horizontals = [-1400, -1000, -600, -200, 0, 200, 600, 1000, 1400];

  // Old Solmar drift: streets jog and angle instead of following the grid.
  const drift = (t, phase) => 35 * Math.sin(t * 0.003 + phase) + 20 * Math.sin(t * 0.009 + phase * 1.7);
  function addDriftedVertical(x0, z0, z1, phase) {
    let prevX = x0 + drift(z0, phase);
    let prevZ = z0;
    for (let z = z0 + 120; z <= z1; z += 120) {
      const x = x0 + drift(z, phase);
      addStreet(prevX, prevZ, x, z, 9);
      prevX = x;
      prevZ = z;
    }
    addStreet(prevX, prevZ, x0 + drift(z1, phase), z1, 9);
  }
  function addDriftedHorizontal(z0, x0, x1, phase) {
    let prevZ = z0 + drift(x0, phase);
    let prevX = x0;
    for (let x = x0 + 120; x <= x1; x += 120) {
      const z = z0 + drift(x, phase);
      addStreet(prevX, prevZ, x, z, 9);
      prevX = x;
      prevZ = z;
    }
    addStreet(prevX, prevZ, x1, z0 + drift(x1, phase), 9);
  }

  // Secondary verticals: drifted inside Old Solmar, straight elsewhere.
  for (const x of verticals) {
    if (x === -1600 || x === -1200 || x === -800) {
      addDriftedVertical(x, -1600, 300, x * 0.01);
      addStreet(x, 300, x, 1150, 9);
    } else {
      addStreet(x, -1700, x, 1150, 9);
    }
  }
  // Secondary horizontals: drifted inside Old Solmar, straight elsewhere.
  for (const z of horizontals) {
    if (z >= -1400 && z <= 0) {
      addDriftedHorizontal(z, -1900, -400, z * 0.013);
      addStreet(-400, z, 1920, z, 9);
    } else {
      addStreet(-1920, z, 1920, z, 9);
    }
  }
  // Old Solmar's diagonal avenue: from the north-west corner to the centre.
  addStreet(-1750, -1550, -450, 150, 9);

  // Narrow local streets (visibly narrower than the secondary grid).
  const locals = [
    [1000, -1400, 1000, -600], [1400, -1400, 1400, -600],
    [-1400, 400, -1400, 1000], [-1000, 400, -1000, 1000],
    [-1600, 1450, -1600, 1700], [-1200, 1450, -1200, 1700],
    [1000, 1450, 1000, 1700], [1400, 1450, 1400, 1700],
    [600, -1600, 600, -800], [1000, -1600, 1000, -800],
  ];
  for (const [x0, z0, x1, z1] of locals) addStreet(x0, z0, x1, z1, 5);

  // Three drivable bridges over the canal.
  const bridges = [];
  for (const bx of [-800, 0, 800]) {
    addStreet(bx, 1150, bx, 1350, 9, true);
    bridges.push({ x: bx, z0: 1150, z1: 1350 });
  }

  function nearStreet(x, z, clear) {
    for (const s of streets) {
      if (distToSegment(x, z, s.x0, s.z0, s.x1, s.z1) < s.half + clear) return true;
    }
    return false;
  }

  // ---- districts ------------------------------------------------------
  function districtAt(x, z) {
    if (z > 1400) return 'Sunstrand Beach';
    if (z >= 900 && z <= 1180 && x >= -900 && x <= 900) return 'Pearl Marina';
    if (x >= 200 && x <= 700 && z >= -700 && z <= 100) return 'Glasspoint';
    if (x >= -1920 && x <= -400 && z >= -1600 && z <= 300) return 'Old Solmar';
    if (x >= -400 && x <= 200 && z >= -1728 && z <= -700) return 'Canal Ward';
    if (x >= 700 && z >= -1500 && z <= -200) return 'Citrus Quarter';
    if (x >= -1600 && x <= -400 && z >= 300 && z <= 1100) return 'South Market';
    if (x > 700) return 'Citrus Quarter';
    if (z > 300) return 'South Market';
    if (x < 200) return 'Canal Ward';
    if (z >= 100) return 'South Market'; // plaza + boulevard south stretch
    return 'Glasspoint';
  }

  // ---- buildings ------------------------------------------------------
  const buildings = [];
  function tryPlace(x, z, w, d, h, type, color) {
    buildings.push({ x, z, w, d, h, type, color, district: districtAt(x, z) });
  }

  // Jittered grid placement: one building per cell, so none overlap.
  for (let gx = -1850; gx <= 1850; gx += 100) {
    for (let gz = -1680; gz <= 1680; gz += 95) {
      const x = gx + rng.range(-25, 25);
      const z = gz + rng.range(-22, 22);
      if (isWater(x, z)) continue;
      if (inRect(x, z, park)) continue;
      if (Math.abs(x - plaza.x) < plaza.half + 20 && Math.abs(z - plaza.z) < plaza.half + 20) continue;
      if (nearStreet(x, z, 14)) continue;
      if (rng.chance(0.12)) continue; // empty lots break the grid up
      const district = districtAt(x, z);
      const pal = DISTRICTS[district].walls;
      let w = 22 + rng.range(0, 26);
      let d = 22 + rng.range(0, 24);
      let h = 14 + rng.range(0, 22);
      let type = 'block';
      let color = rng.pick(pal);
      if (Math.abs(x - BOULEVARD_X) < 70) {
        // Tallest buildings line the boulevard.
        h = 40 + rng.range(0, 50);
        if (rng.chance(0.45)) { type = 'glass'; color = [0.55, 0.68, 0.72]; }
      } else if (district === 'Glasspoint') {
        h = 30 + rng.range(0, 40);
        if (rng.chance(0.6)) { type = 'glass'; color = [0.5, 0.64, 0.7]; }
      } else if (district === 'Citrus Quarter') {
        h = 16 + rng.range(0, 24);
        if (rng.chance(0.3)) { type = 'house'; color = rng.pick(HOUSE_TONES); }
      } else if (district === 'Canal Ward') {
        h = 20 + rng.range(0, 30);
      } else if (district === 'South Market') {
        h = 14 + rng.range(0, 12);
        if (rng.chance(0.4)) { type = 'market'; color = [0.75, 0.6, 0.4]; }
      } else if (district === 'Old Solmar') {
        h = 12 + rng.range(0, 14);
        w = 16 + rng.range(0, 22);
        d = 16 + rng.range(0, 20);
      } else if (district === 'Sunstrand Beach') {
        h = 10 + rng.range(0, 10);
        type = 'house';
        color = rng.pick(HOUSE_TONES);
      } else if (district === 'Pearl Marina') {
        h = 16 + rng.range(0, 16);
      }
      // Warehouses by the harbour quay.
      if (z > 1000 && z < 1180 && Math.abs(x) < 700 && rng.chance(0.6)) {
        type = 'warehouse';
        color = [0.6, 0.58, 0.5];
        w = 40 + rng.range(0, 20);
        d = 30 + rng.range(0, 15);
        h = 12 + rng.range(0, 6);
      }
      tryPlace(x, z, w, d, h, type, color);
    }
  }

  // ---- trees, lamps, boats, intersections -----------------------------
  const trees = [];
  for (let i = 0; i < 150; i++) {
    const x = park.x0 + 20 + rng.range(0, park.x1 - park.x0 - 40);
    const z = park.z0 + 20 + rng.range(0, park.z1 - park.z0 - 40);
    if (nearStreet(x, z, 13)) continue;
    trees.push({ x, z, s: 0.8 + rng.range(0, 0.7), hue: rng.next() });
  }
  // Promenade trees along the canal banks.
  for (let z of [1150, 1350]) {
    for (let x = -1800; x <= 1800; x += 90) {
      const xx = x + rng.range(-18, 18);
      const zz = z + rng.range(-15, 15);
      if (isWater(xx, zz)) continue;
      if (nearStreet(xx, zz, 13)) continue;
      trees.push({ x: xx, z: zz, s: 0.7 + rng.range(0, 0.5), hue: rng.next() });
    }
  }
  let scattered = 0;
  let guard = 0;
  while (scattered < 80 && guard++ < 2000) {
    const x = BOUNDS.x0 + 60 + rng.range(0, BOUNDS.x1 - BOUNDS.x0 - 120);
    const z = BOUNDS.z0 + 60 + rng.range(0, BOUNDS.z1 - BOUNDS.z0 - 120);
    if (isWater(x, z)) continue;
    if (inRect(x, z, park)) continue;
    if (nearStreet(x, z, 13)) continue;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 4 && Math.abs(z - b.z) < b.d / 2 + 4)) continue;
    trees.push({ x, z, s: 0.7 + rng.range(0, 0.6), hue: rng.next() });
    scattered++;
  }

  const lamps = [];
  for (let z = -1700; z <= 1150; z += 90) {
    if (!isWater(BOULEVARD_X - 22, z)) lamps.push({ x: BOULEVARD_X - 22, z });
    if (!isWater(BOULEVARD_X + 22, z + 45)) lamps.push({ x: BOULEVARD_X + 22, z: z + 45 });
  }
  for (const cx of [-1600, -1200, -800, -400, 200, 800, 1200, 1600]) {
    for (let z = -1600; z <= 1600; z += 180) {
      if (!isWater(cx + 12, z)) lamps.push({ x: cx + 12, z });
    }
  }
  for (let z = -1500; z <= 1100; z += 150) {
    if (!isWater(-90, z)) lamps.push({ x: -90, z });
    if (!isWater(90, z + 75)) lamps.push({ x: 90, z: z + 75 });
  }

  const boats = [];
  for (let i = 0; i < 5; i++) {
    boats.push({
      x: -380 + rng.range(0, 760),
      z: 1380 + rng.range(0, 280),
      heading: rng.range(-0.45, 0.45),
      len: 26 + rng.range(0, 18),
      color: [[0.9, 0.9, 0.88], [0.85, 0.5, 0.4], [0.4, 0.6, 0.7]][i % 3],
    });
  }

  // Parked cars (static in Stage A): 3 yellow taxis on the boulevard + 20
  // along secondary streets, parked at the kerb.
  const cars = [];
  const carColors = [[0.85, 0.2, 0.2], [0.2, 0.3, 0.6], [0.85, 0.85, 0.85], [0.15, 0.15, 0.18], [0.4, 0.55, 0.65], [0.7, 0.3, 0.5]];
  for (const tz of [-400, 50, 500]) {
    cars.push({ x: BOULEVARD_X - 13, z: tz, heading: 0, color: [0.95, 0.8, 0.15], taxi: true });
  }
  const parkStreets = [];
  for (const sx of [-1200, -800, -400, 200, 800, 1200]) parkStreets.push({ x: sx, z0: -1200, z1: 1000, vertical: true });
  for (const sz of [-1000, -600, -200, 200, 600, 1000]) parkStreets.push({ z: sz, x0: -1400, x1: 1800, vertical: false });
  for (let i = 0; i < 20; i++) {
    const s = rng.pick(parkStreets);
    if (s.vertical) {
      const z = rng.range(s.z0, s.z1);
      if (isWater(s.x, z)) continue;
      cars.push({ x: s.x + (rng.chance(0.5) ? 13 : -13), z, heading: rng.chance(0.5) ? 0 : Math.PI, color: rng.pick(carColors), taxi: false });
    } else {
      const x = rng.range(s.x0, s.x1);
      if (isWater(x, s.z)) continue;
      cars.push({ x, z: s.z + (rng.chance(0.5) ? 13 : -13), heading: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, color: rng.pick(carColors), taxi: false });
    }
  }

  // Pedestrians (static in Stage A): boulevard sidewalks, plaza, promenade.
  const pedestrians = [];
  const jacketColors = [[0.85, 0.3, 0.3], [0.3, 0.5, 0.9], [0.9, 0.7, 0.2], [0.4, 0.8, 0.4], [0.85, 0.5, 0.85], [0.9, 0.9, 0.9]];
  for (let i = 0; i < 25; i++) {
    let x;
    let z;
    const spot = i % 3;
    if (spot === 0) { x = BOULEVARD_X + rng.range(-30, 30); z = rng.range(-600, 800); }
    else if (spot === 1) { x = plaza.x + rng.range(-100, 100); z = plaza.z + rng.range(-100, 100); }
    else { x = rng.range(-1600, 1600); z = rng.range(1100, 1150); }
    if (isWater(x, z)) continue;
    pedestrians.push({ x, z, color: rng.pick(jacketColors), heading: rng.range(0, Math.PI * 2) });
  }

  const intersections = [];
  for (const nx of [-1600, -1200, -800, -400, 200, 400, 800, 1200, 1600]) {
    for (const ez of [-1400, -1000, -600, -200, 0, 200, 600, 1000, 1400]) {
      if (isWater(nx, ez)) continue;
      if (Math.abs(nx - BOULEVARD_X) < 30 && Math.abs(ez - plaza.z) < 130) continue; // the plaza has no signals
      intersections.push({ x: nx, z: ez });
    }
  }

  const city = {
    seed,
    bounds: BOUNDS,
    water: { canal, harbour },
    beach,
    park,
    plaza,
    landmarks: {
      clockTower: { x: BOULEVARD_X, z: 190, w: 14, h: 62 },
      fountain: { x: BOULEVARD_X, z: 300, r: 16 },
    },
    streets,
    bridges,
    buildings,
    trees,
    lamps,
    boats,
    cars,
    pedestrians,
    intersections,
    counts: {
      buildings: buildings.length,
      trees: trees.length,
      lamps: lamps.length,
      boats: boats.length,
      cars: cars.length,
      pedestrians: pedestrians.length,
      streets: streets.length,
      intersections: intersections.length,
    },
    isWater,
    districtAt,
    nearStreet,
    groundAt(x, z) {
      if (isWater(x, z)) return 'water';
      if (beach.some((r) => inRect(x, z, r))) return 'sand';
      if (inRect(x, z, park)) return 'park';
      if (Math.abs(x - plaza.x) < plaza.half && Math.abs(z - plaza.z) < plaza.half) return 'plaza';
      return 'grass';
    },
  };
  return city;
}
