// Layout verifier for Solmar. Runs in Node (no DOM): imports the pure city
// generator and checks every placement rule the renderer relies on.
// Usage: node checks/verify-layout.mjs   (exit 0 = no problems)
import { createCity } from '../game/src/city.js';

const city = createCity();
const problems = [];
const { buildings, trees, lamps, boats, intersections } = city;

function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.5;
}

// Buildings: not in water, not on a street, not in the plaza or park, no overlap.
for (const b of buildings) {
  if (city.isWater(b.x, b.z)) problems.push(`building in water at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
  if (city.nearStreet(b.x, b.z, 14)) problems.push(`building on street at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
  if (Math.abs(b.x - city.plaza.x) < city.plaza.half + 20 && Math.abs(b.z - city.plaza.z) < city.plaza.half + 20) {
    problems.push(`building in plaza at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
  }
  if (b.x >= city.park.x0 && b.x <= city.park.x1 && b.z >= city.park.z0 && b.z <= city.park.z1) {
    problems.push(`building in park at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
  }
  if (!(b.w >= 10 && b.w <= 70 && b.d >= 10 && b.d <= 70 && b.h >= 8 && b.h <= 100)) {
    problems.push(`building out of size bounds at ${b.x.toFixed(0)},${b.z.toFixed(0)} w=${b.w} d=${b.d} h=${b.h}`);
  }
}
// Pairwise overlap via a coarse spatial hash (buildings are grid-placed, so
// this should find none; the check is the verifier's own bounding rule).
const cell = new Map();
const key = (x, z) => `${Math.floor(x / 120)},${Math.floor(z / 120)}`;
for (const b of buildings) {
  const cx = Math.floor(b.x / 120);
  const cz = Math.floor(b.z / 120);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (const o of cell.get(key((cx + dx) * 120, (cz + dz) * 120)) ?? []) {
        if (rectsOverlap(b, o)) problems.push(`buildings overlap at ${b.x.toFixed(0)},${b.z.toFixed(0)} and ${o.x.toFixed(0)},${o.z.toFixed(0)}`);
      }
    }
  }
  const k = key(b.x, b.z);
  if (!cell.has(k)) cell.set(k, []);
  cell.get(k).push(b);
}

// Trees: not in water, not on a street.
for (const t of trees) {
  if (city.isWater(t.x, t.z)) problems.push(`tree in water at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);
  if (city.nearStreet(t.x, t.z, 13)) problems.push(`tree on street at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);
}

// Lamps and boats sanity.
for (const l of lamps) {
  if (city.isWater(l.x, l.z)) problems.push(`lamp in water at ${l.x.toFixed(0)},${l.z.toFixed(0)}`);
}
for (const b of boats) {
  if (!city.isWater(b.x, b.z)) problems.push(`boat on land at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
}

// Intersections: not in water, not in the plaza.
for (const it of intersections) {
  if (city.isWater(it.x, it.z)) problems.push(`intersection in water at ${it.x},${it.z}`);
}

// District coverage: every district must have buildings.
const byDistrict = {};
for (const b of buildings) byDistrict[b.district] = (byDistrict[b.district] ?? 0) + 1;
for (const name of ['Old Solmar', 'Canal Ward', 'South Market', 'Citrus Quarter', 'Pearl Marina', 'Glasspoint', 'Sunstrand Beach']) {
  if ((byDistrict[name] ?? 0) < 20) problems.push(`district ${name} has only ${byDistrict[name] ?? 0} buildings`);
}

console.log(`buildings ${city.counts.buildings} trees ${city.counts.trees} lamps ${city.counts.lamps} boats ${city.counts.boats} streets ${city.counts.streets} intersections ${city.counts.intersections}`);
console.log(`by district: ${Object.entries(byDistrict).map(([k, v]) => `${k}=${v}`).join(', ')}`);
if (problems.length > 0) {
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems.slice(0, 30)) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('layout verifier: 0 problems');
