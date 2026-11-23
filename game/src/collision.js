// 2D collision helpers for "Palkon Auto" — pure, no DOM, so Node can test
// them. Everything runs on the ground plane (x, z). Buildings are
// axis-aligned boxes; cars are oriented boxes (OBB); Mara is a circle.

export function aabbOf(b) {
  return { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 };
}

// The four corners of an oriented box, in order.
export function obbCorners(x, z, heading, len, wid) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  const hl = len / 2;
  const hw = wid / 2;
  return [
    [x + fx * hl + rx * hw, z + fz * hl + rz * hw],
    [x + fx * hl - rx * hw, z + fz * hl - rz * hw],
    [x - fx * hl - rx * hw, z - fz * hl - rz * hw],
    [x - fx * hl + rx * hw, z - fz * hl + rz * hw],
  ];
}

function project(corners, ax, az) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, z] of corners) {
    const d = x * ax + z * az;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

// Separating-axis test. Returns the minimum-translation vector [px, pz]
// that pushes the first shape out of the second, or null when separated.
function sat(cornersA, cornersB, axes) {
  let bestOverlap = Infinity;
  let bestAxis = null;
  for (const [ax, az] of axes) {
    const [loA, hiA] = project(cornersA, ax, az);
    const [loB, hiB] = project(cornersB, ax, az);
    const overlap = Math.min(hiA, hiB) - Math.max(loA, loB);
    if (overlap <= 0) return null;
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestAxis = [ax, az];
    }
  }
  // Point the push away from B's centre (use the first corner's offset).
  const cxA = cornersA.reduce((s, c) => s + c[0], 0) / cornersA.length;
  const czA = cornersA.reduce((s, c) => s + c[1], 0) / cornersA.length;
  const cxB = cornersB.reduce((s, c) => s + c[0], 0) / cornersB.length;
  const czB = cornersB.reduce((s, c) => s + c[1], 0) / cornersB.length;
  const dx = cxA - cxB;
  const dz = czA - czB;
  if (dx * bestAxis[0] + dz * bestAxis[1] < 0) {
    bestAxis = [-bestAxis[0], -bestAxis[1]];
  }
  return [bestAxis[0] * bestOverlap, bestAxis[1] * bestOverlap];
}

export function obbVsAabb(x, z, heading, len, wid, aabb) {
  const corners = obbCorners(x, z, heading, len, wid);
  const box = [
    [aabb.x0, aabb.z0],
    [aabb.x1, aabb.z0],
    [aabb.x1, aabb.z1],
    [aabb.x0, aabb.z1],
  ];
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  return sat(corners, box, [[fx, fz], [rx, rz], [1, 0], [0, 1]]);
}

export function obbVsObb(a, b) {
  const ca = obbCorners(a.x, a.z, a.heading, a.len, a.wid);
  const cb = obbCorners(b.x, b.z, b.heading, b.len, b.wid);
  const fa = [Math.sin(a.heading), Math.cos(a.heading)];
  const ra = [Math.cos(a.heading), -Math.sin(a.heading)];
  const fb = [Math.sin(b.heading), Math.cos(b.heading)];
  const rb = [Math.cos(b.heading), -Math.sin(b.heading)];
  return sat(ca, cb, [fa, ra, fb, rb]);
}

// Circle (Mara) vs an axis-aligned building. Returns the push vector or null.
export function circleVsAabb(x, z, r, aabb) {
  const cx = Math.max(aabb.x0, Math.min(x, aabb.x1));
  const cz = Math.max(aabb.z0, Math.min(z, aabb.z1));
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return [dx / d * (r - d), dz / d * (r - d)];
  }
  // Centre inside the box: push out along the smallest penetration axis.
  const pl = x - aabb.x0 + r;
  const pr = aabb.x1 - x + r;
  const pt = z - aabb.z0 + r;
  const pb = aabb.z1 - z + r;
  const m = Math.min(pl, pr, pt, pb);
  if (m === pl) return [-pl, 0];
  if (m === pr) return [pr, 0];
  if (m === pt) return [0, -pt];
  return [0, pb];
}

// Resolve a car against every building AABB. Returns the hardest hit
// (impact speed is supplied by the caller from the pre-move speed) and
// moves the car out of all penetration. Call AFTER integrating motion.
// Only a real hit (impact > 3 m/s) costs speed/damage: scraping a wall
// at low speed just pushes the car out and lets it slide along.
export function resolveCarVsBuildings(car, aabbs, impactMs) {
  let hit = false;
  for (const aabb of aabbs) {
    // Cheap reject: skip boxes far from the car.
    if (Math.abs(car.x - (aabb.x0 + aabb.x1) / 2) > 60 || Math.abs(car.z - (aabb.z0 + aabb.z1) / 2) > 60) continue;
    const push = obbVsAabb(car.x, car.z, car.heading, car.len, car.wid, aabb);
    if (push) {
      car.x += push[0];
      car.z += push[1];
      hit = true;
    }
  }
  if (hit && impactMs > 3) car.registerImpact(impactMs);
  return hit;
}

// Resolve a car against other cars (traffic, parked, target). Returns true
// when any contact happened; both cars share the push. Parked cars
// (movable === false) do not move — the player car takes the whole push.
export function resolveCarVsCars(car, others, impactMs) {
  let hit = false;
  for (const o of others) {
    if (o === car) continue;
    const dx = car.x - o.x;
    const dz = car.z - o.z;
    if (dx * dx + dz * dz > 64) continue; // 8 units: no contact possible
    const push = obbVsObb(car, o);
    if (push) {
      car.x += push[0] * 0.7;
      car.z += push[1] * 0.7;
      if (o.movable !== false) {
        o.x -= push[0] * 0.3;
        o.z -= push[1] * 0.3;
      }
      hit = true;
    }
  }
  if (hit && impactMs > 3) car.registerImpact(impactMs);
  return hit;
}
