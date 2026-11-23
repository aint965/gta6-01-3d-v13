// Traffic + pedestrians for "Palkon Auto" — pure, no DOM, so Node can test
// it. Traffic cars drive rectangular loops on the straight streets (the
// off-grid Old Solmar streets are left to later stages). Each loop is a
// rounded rectangle in the right-hand lane, so cars corner smoothly.
// Cars stop at red/yellow lights, keep a follow gap, and never overlap.
import { signalState } from './signals.js';
import { makeRng } from './rng.js';

const LANE = 3; // right-lane offset on secondary streets
const BOULEVARD_LANE = 5; // right-lane offset on the boulevard (x=400)
const CORNER_R = 6; // corner cut radius
const STOP_OFFSET = 8; // stop line sits this far before the corner
const CAR_LEN = 4.6;
const CAR_WID = 2.0;

// Six loops, all on straight streets (no drifted Old Solmar road, no canal
// crossing, no park crossing). The rectangles share no corner with each
// other, so two loops never turn on the same arc; shared stretches are
// always same-direction straights, where following is well-defined.
const LOOP_RECTS = [
  { x1: 200, x2: 800, z1: -1000, z2: 600 },
  { x1: 400, x2: 1200, z1: -600, z2: 1000 },
  { x1: 1200, x2: 1600, z1: 200, z2: 600 },
  { x1: 400, x2: 800, z1: -1400, z2: -200 },
  { x1: 200, x2: 800, z1: 200, z2: 1000 },
  { x1: -400, x2: 200, z1: -600, z2: -200 },
];

const TRAFFIC_COLORS = [
  [0.85, 0.2, 0.2], [0.2, 0.3, 0.6], [0.85, 0.85, 0.85], [0.15, 0.15, 0.18],
  [0.4, 0.55, 0.65], [0.7, 0.3, 0.5], [0.85, 0.6, 0.2], [0.3, 0.6, 0.4],
];
const JACKET_COLORS = [
  [0.85, 0.3, 0.3], [0.3, 0.5, 0.9], [0.9, 0.7, 0.2], [0.4, 0.8, 0.4],
  [0.85, 0.5, 0.85], [0.9, 0.9, 0.9],
];

// Edge directions (east, south, west, north) and their right-hand vectors.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const RIGHTS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const AXES = ['EW', 'NS', 'EW', 'NS'];

// Build one loop path: straights + quarter arcs, with cumulative lengths.
// Corners are visited A -> B -> C -> D -> A (east, south, west, north).
// The lane intersection at a corner is where the two right-hand lane lines
// cross; the arc starts 6 units before it and ends 6 units after it.
function buildLoop(r) {
  const corners = [
    { x: r.x1, z: r.z1 }, // A top-left
    { x: r.x2, z: r.z1 }, // B top-right
    { x: r.x2, z: r.z2 }, // C bottom-right
    { x: r.x1, z: r.z2 }, // D bottom-left
  ];
  const offAt = (x) => (x === 400 ? BOULEVARD_LANE : LANE);
  const lanePt = [
    [r.x1 + offAt(r.x1), r.z1 + LANE],
    [r.x2 - offAt(r.x2), r.z1 + LANE],
    [r.x2 - offAt(r.x2), r.z2 - LANE],
    [r.x1 + offAt(r.x1), r.z2 - LANE],
  ];
  const segments = [];
  let s = 0;
  const cornerInfo = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    // Straight: from the previous corner's arc end to this corner's arc start.
    const prevArcEnd = [
      lanePt[i][0] + DIRS[i][0] * CORNER_R,
      lanePt[i][1] + DIRS[i][1] * CORNER_R,
    ];
    const arcStart = [
      lanePt[next][0] - DIRS[i][0] * CORNER_R,
      lanePt[next][1] - DIRS[i][1] * CORNER_R,
    ];
    const len = Math.hypot(arcStart[0] - prevArcEnd[0], arcStart[1] - prevArcEnd[1]);
    segments.push({ type: 'line', x0: prevArcEnd[0], z0: prevArcEnd[1], x1: arcStart[0], z1: arcStart[1], len, s0: s, end: arcStart });
    s += len;
    // Arc: centre is the arc start moved 6 units to the right of the
    // incoming edge; the sweep is +90 degrees (clockwise on the map).
    const ccx = arcStart[0] + RIGHTS[i][0] * CORNER_R;
    const ccz = arcStart[1] + RIGHTS[i][1] * CORNER_R;
    const a0 = Math.atan2(arcStart[1] - ccz, arcStart[0] - ccx);
    const arcLen = (Math.PI / 2) * CORNER_R;
    const arcEnd = [
      ccx + Math.cos(a0 + Math.PI / 2) * CORNER_R,
      ccz + Math.sin(a0 + Math.PI / 2) * CORNER_R,
    ];
    segments.push({ type: 'arc', cx: ccx, cz: ccz, r: CORNER_R, a0, len: arcLen, s0: s, end: arcEnd });
    s += arcLen;
    // The stop line is 8 units before the lane intersection point; the
    // arc starts 6 units before it, so the line is 2 units before the arc.
    cornerInfo.push({
      x: corners[next].x,
      z: corners[next].z,
      axis: AXES[i],
      sStop: segments[segments.length - 2].s0 + segments[segments.length - 2].len - (STOP_OFFSET - CORNER_R),
      sArc: segments[segments.length - 1].s0,
    });
  }
  return { rect: r, segments, totalLen: s, corners: cornerInfo };
}

export function pointAt(loop, s) {
  const total = loop.totalLen;
  s = ((s % total) + total) % total;
  for (let i = 0; i < loop.segments.length; i++) {
    const seg = loop.segments[i];
    if (s <= seg.s0 + seg.len || i === loop.segments.length - 1) {
      const u = Math.max(0, Math.min(1, (s - seg.s0) / seg.len));
      if (seg.type === 'line') {
        return [seg.x0 + (seg.x1 - seg.x0) * u, seg.z0 + (seg.z1 - seg.z0) * u];
      }
      const a = seg.a0 + (Math.PI / 2) * u;
      return [seg.cx + Math.cos(a) * seg.r, seg.cz + Math.sin(a) * seg.r];
    }
  }
  const seg = loop.segments[0];
  return [seg.x0, seg.z0];
}

function tangentAt(loop, s) {
  const total = loop.totalLen;
  s = ((s % total) + total) % total;
  for (let i = 0; i < loop.segments.length; i++) {
    const seg = loop.segments[i];
    if (s <= seg.s0 + seg.len || i === loop.segments.length - 1) {
      const u = Math.max(0, Math.min(1, (s - seg.s0) / seg.len));
      if (seg.type === 'line') {
        const dx = seg.x1 - seg.x0;
        const dz = seg.z1 - seg.z0;
        const l = Math.hypot(dx, dz) || 1;
        return [dx / l, dz / l];
      }
      const a = seg.a0 + (Math.PI / 2) * u;
      return [-Math.sin(a), Math.cos(a)];
    }
  }
  return [1, 0];
}

function headingFromDir(fx, fz) {
  return Math.atan2(fx, fz);
}

export class TrafficSystem {
  constructor(city) {
    this.city = city;
    this.time = 0;
    // Street grid, derived from the city's intersections (the plaza
    // crossing is not one, so it has no light). Used to find the next
    // signal along a car's current street — not just the next loop corner.
    this.gridX = [...new Set(city.intersections.map((i) => i.x))].sort((a, b) => a - b);
    this.gridZ = [...new Set(city.intersections.map((i) => i.z))].sort((a, b) => a - b);
    this.loops = LOOP_RECTS.map(buildLoop);
    this.cars = [];
    this.pedestrians = [];
    this.stats = { stops: 0, redRuns: 0, minFollowGap: Infinity, minPairDist: Infinity };
    const rng = makeRng(20261123 + 31);
    // 3 cars per loop, staggered along the path.
    for (let li = 0; li < this.loops.length; li++) {
      const loop = this.loops[li];
      for (let k = 0; k < 3; k++) {
        const s = (loop.totalLen * (k / 3) + rng.range(0, 120)) % loop.totalLen;
        const [x, z] = pointAt(loop, s);
        const [fx, fz] = tangentAt(loop, s);
        this.cars.push({
          idx: li * 3 + k,
          loop: li,
          s,
          x,
          z,
          heading: headingFromDir(fx, fz),
          speed: rng.range(6, 9),
          cruise: rng.range(8, 12.5),
          color: TRAFFIC_COLORS[(li * 3 + k) % TRAFFIC_COLORS.length],
          len: CAR_LEN,
          wid: CAR_WID,
          stoppedFor: null,
          prevDistToStop: Infinity,
          prevSignalKey: '',
        });
      }
    }
    // 24 pedestrians on sidewalks: boulevard, promenade, plaza, cross streets.
    const pedPaths = [];
    for (const sx of [-22, 22]) {
      for (let k = 0; k < 4; k++) {
        pedPaths.push({ axis: 'z', fixed: 400 + sx, from: -1200, to: 1000, start: rng.range(-1200, 1000) });
      }
    }
    for (let k = 0; k < 4; k++) {
      pedPaths.push({ axis: 'x', fixed: 1140, from: -1600, to: 1600, start: rng.range(-1600, 1600) });
    }
    for (let k = 0; k < 4; k++) {
      pedPaths.push({ axis: 'x', fixed: 300 + (k % 2 ? 40 : -40), from: 320, to: 480, start: rng.range(320, 480) });
    }
    for (const fz of [-213, -187, 587, 613]) {
      for (let k = 0; k < 2; k++) {
        pedPaths.push({ axis: 'x', fixed: fz, from: -1400, to: 1600, start: rng.range(-1400, 1600) });
      }
    }
    for (const p of pedPaths) {
      this.pedestrians.push({
        ...p,
        pos: p.start,
        dir: rng.chance(0.5) ? 1 : -1,
        speed: rng.range(1.2, 1.8),
        color: JACKET_COLORS[Math.floor(rng.next() * JACKET_COLORS.length)],
        x: 0,
        z: 0,
        heading: 0,
      });
    }
    this.updatePositions();
  }

  updatePositions() {
    for (const c of this.cars) {
      const loop = this.loops[c.loop];
      const [x, z] = pointAt(loop, c.s);
      const [fx, fz] = tangentAt(loop, c.s);
      c.x = x;
      c.z = z;
      c.heading = headingFromDir(fx, fz);
    }
    for (const p of this.pedestrians) {
      if (p.axis === 'x') {
        p.x = p.pos;
        p.z = p.fixed;
        p.heading = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        p.x = p.fixed;
        p.z = p.pos;
        p.heading = p.dir > 0 ? 0 : Math.PI;
      }
    }
  }

  // Next corner ahead of arc position s on this loop (with its stop line).
  nextCorner(loop, s) {
    let best = null;
    for (const c of loop.corners) {
      let d = c.sArc - s;
      if (d < 0) d += loop.totalLen;
      if (!best || d < best.d) best = { ...c, d };
    }
    return best;
  }

  // Next signalised intersection ahead of (x, z) along the car's current
  // street — including the mid-edge crossings a loop corner never sees.
  // Returns {x, z, dist, distToStopLine, phase, axis} or null when the car
  // is not on a street or no crossing lies ahead within 600 units. The
  // stop line sits STOP_OFFSET before the crossing, measured from the
  // front bumper (CAR_LEN/2 ahead of the car's centre).
  nextSignal(x, z, heading) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const nearest = (arr, v) => {
      let best = null;
      let bd = Infinity;
      for (const g of arr) {
        const d = Math.abs(g - v);
        if (d < bd) { bd = d; best = g; }
      }
      return { value: best, dist: bd };
    };
    if (Math.abs(fx) >= Math.abs(fz)) {
      // Moving along a horizontal street (east/west).
      const street = nearest(this.gridZ, z);
      if (street.dist > 8) return null;
      const dir = fx > 0 ? 1 : -1;
      let ix = null;
      let dist = Infinity;
      for (const gx of this.gridX) {
        const d = (gx - x) * dir;
        if (d > 0 && d < dist) { dist = d; ix = gx; }
      }
      if (ix === null || dist > 600) return null;
      const sig = signalState(ix, street.value, this.time);
      return {
        x: ix, z: street.value, dist,
        distToStopLine: dist - CAR_LEN / 2 - STOP_OFFSET,
        phase: sig.ew, axis: 'EW',
      };
    }
    // Moving along a vertical street (north/south).
    const street = nearest(this.gridX, x);
    if (street.dist > 8) return null;
    const dir = fz > 0 ? 1 : -1;
    let iz = null;
    let dist = Infinity;
    for (const gz of this.gridZ) {
      const d = (gz - z) * dir;
      if (d > 0 && d < dist) { dist = d; iz = gz; }
    }
    if (iz === null || dist > 600) return null;
    const sig = signalState(street.value, iz, this.time);
    return {
      x: street.value, z: iz, dist,
      distToStopLine: dist - CAR_LEN / 2 - STOP_OFFSET,
      phase: sig.ns, axis: 'NS',
    };
  }

  update(dt, playerCar) {
    this.time += dt;
    for (const c of this.cars) {
      const loop = this.loops[c.loop];
      const corner = this.nextCorner(loop, c.s);
      // The signal that governs this car: the next crossing on its current
      // street, not just the next loop corner (a long edge crosses several
      // lit intersections before it turns).
      const sig = this.nextSignal(c.x, c.z, c.heading);
      // Distance from the car's front bumper to the stop line.
      const distToStop = sig ? sig.distToStopLine : Infinity;
      const light = sig ? sig.phase : 'green';
      const sigKey = sig ? `${sig.x},${sig.z}` : '';
      let vAllowed = c.cruise;
      // Slow for the corner itself.
      if (corner.d < 20) vAllowed = Math.min(vAllowed, 5);
      // Stop at red / yellow: brake so the front bumper halts at the line.
      if (sig && (light === 'red' || light === 'yellow') && distToStop > 0) {
        vAllowed = Math.min(vAllowed, Math.sqrt(2 * 8 * distToStop));
        if (distToStop < 0.5) vAllowed = 0;
      }
      // A red run is crossing the line while it is red (a transition, not
      // merely sitting past the line when the light changes). A new
      // crossing ahead resets the reference: no transition is counted.
      if (sigKey !== c.prevSignalKey) {
        c.prevSignalKey = sigKey;
        c.prevDistToStop = distToStop;
      } else if (c.prevDistToStop > 0 && distToStop <= 0 && light === 'red') {
        this.stats.redRuns++;
      }
      c.prevDistToStop = distToStop;
      // Follow gap: same loop, car ahead.
      for (const o of this.cars) {
        if (o === c || o.loop !== c.loop) continue;
        let gap = o.s - c.s;
        if (gap < 0) gap += loop.totalLen;
        gap -= CAR_LEN;
        if (gap > 0 && gap < 25) {
          if (gap < this.stats.minFollowGap) this.stats.minFollowGap = gap;
          vAllowed = Math.min(vAllowed, o.speed + Math.max(0, gap - 8) * 0.7);
          if (gap < 5) vAllowed = 0;
        }
      }
      // Separation from every other car (other loops, player car). Two
      // cases, both deadlock-free because only the car behind yields:
      //  - same direction, in my lane: follow it (speed matching);
      //  - crossing my lane (perpendicular / oncoming): the lower index
      //    has priority, the other stops. The player car has idx -1:
      //    traffic always yields to the player.
      const others = [...this.cars, ...(playerCar ? [playerCar] : [])];
      for (const o of others) {
        if (o === c) continue;
        const dx = o.x - c.x;
        const dz = o.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < this.stats.minPairDist) this.stats.minPairDist = d;
        const [fx, fz] = [Math.sin(c.heading), Math.cos(c.heading)];
        const ahead = dx * fx + dz * fz;
        const lat = Math.abs(dx * fz - dz * fx);
        if (ahead <= 0 || ahead >= 25 || lat >= 3.5) continue;
        const gap = ahead - CAR_LEN;
        const [ofx, ofz] = [Math.sin(o.heading), Math.cos(o.heading)];
        const sameDir = ofx * fx + ofz * fz > 0.7;
        // Only record the gap statistic while both cars are on a straight
        // (headings aligned): around a bend the Euclidean projection
        // underestimates the along-path distance.
        if (sameDir && ofx * fx + ofz * fz > 0.95 && gap < this.stats.minFollowGap) {
          this.stats.minFollowGap = gap;
        }
        if (sameDir) {
          vAllowed = Math.min(vAllowed, (o.speed ?? 0) + Math.max(0, gap - 8) * 0.7);
          if (gap < 5) vAllowed = 0;
        } else if ((o.idx ?? 99) < c.idx && gap < 12) {
          vAllowed = 0;
        }
      }
      // Integrate speed toward the allowed speed.
      if (c.speed < vAllowed) c.speed = Math.min(vAllowed, c.speed + 6 * dt);
      else if (c.speed > vAllowed) c.speed = Math.max(vAllowed, c.speed - 10 * dt);
      // Never cross a red/yellow stop line: if this frame's step would
      // carry the bumper past the line, stop exactly at the line instead.
      // (At the browser's dt=0.1 the discrete step otherwise overshoots by
      // a fraction and counts a phantom red run.)
      let step = c.speed * dt;
      if (sig && (light === 'red' || light === 'yellow') && distToStop > 0 && step > distToStop - 0.05) {
        step = distToStop - 0.05;
        c.speed = 0;
      }
      // Count a stop: fully stopped just before a red/yellow stop line.
      if (c.speed < 0.5 && distToStop > 0 && distToStop < 14 && (light === 'red' || light === 'yellow')) {
        const key = sigKey;
        if (c.stoppedFor !== key) {
          this.stats.stops++;
          c.stoppedFor = key;
        }
      } else if (light === 'green') {
        c.stoppedFor = null;
      }
      c.s = (c.s + step) % loop.totalLen;
    }
    for (const p of this.pedestrians) {
      p.pos += p.dir * p.speed * dt;
      if (p.pos > p.to) { p.pos = p.to; p.dir = -1; }
      if (p.pos < p.from) { p.pos = p.from; p.dir = 1; }
    }
    this.updatePositions();
  }
}
