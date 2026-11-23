// Per-frame dynamic mesh for "Palkon Auto": every object that moves —
// cars (parked, traffic, player, target), Mara, walking pedestrians,
// traffic-light lenses (lit by the current signal), the E-interaction
// rings around drivable cars, and dust puffs. Rebuilt each frame from the
// same makeMesh builder the static city uses, so the look matches.
import { makeMesh } from './renderer.js';

const CORAL = [0.84, 0.5, 0.41];
const SKIN = [0.85, 0.7, 0.55];
const GLASS = [0.2, 0.25, 0.3];
const TYRE = [0.08, 0.08, 0.09];
const LENS = {
  red: { on: [0.95, 0.15, 0.15], off: [0.1, 0.1, 0.1] },
  yellow: { on: [0.95, 0.75, 0.15], off: [0.1, 0.1, 0.1] },
  green: { on: [0.15, 0.9, 0.3], off: [0.1, 0.1, 0.1] },
};

function drawCar(m, car) {
  const h = car.heading;
  const c = Math.cos(h);
  const s = Math.sin(h);
  // Body + cabin + wheels, rotated by the heading.
  m.boxRot(car.x, 0, car.z, 2.0, 1.3, 4.6, h, car.color, 0, 0.4);
  const cabX = car.x - 0.3 * s;
  const cabZ = car.z - 0.3 * c;
  m.boxRot(cabX, 1.3, cabZ, 1.7, 1.0, 2.5, h, GLASS, 0, 1);
  for (const [lx, lz] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]]) {
    const wx = car.x + lx * c + lz * s;
    const wz = car.z - lx * s + lz * c;
    m.boxRot(wx, 0, wz, 0.7, 0.7, 0.7, h, TYRE);
  }
  // Drivable cars read at a glance: a coral stripe across the roof.
  if (car.drivable) {
    const sx = car.x + 0.8 * s;
    const sz = car.z + 0.8 * c;
    m.boxRot(sx, 2.3, sz, 1.9, 0.1, 0.5, h, CORAL, 0.6, 0);
  }
  // Taxis carry a lit roof sign.
  if (car.taxi) {
    m.boxRot(car.x, 2.3, car.z, 0.9, 0.35, 0.5, h, [0.95, 0.8, 0.15], 0.8, 0);
  }
}

function drawFigure(m, x, z, heading, jacket) {
  m.boxRot(x, 0, z, 0.8, 1.8, 0.5, heading, jacket);
  m.boxRot(x, 1.8, z, 0.5, 0.5, 0.5, heading, SKIN);
}

// One traffic-light lens quad on a head face.
function lens(m, cx, cy, cz, nx, ny, nz, color, emissive) {
  const w = 0.35;
  const h = 0.35;
  if (nx !== 0) {
    // Face perpendicular to x: corners vary in y and z.
    m.quad(
      [cx, cy - h, cz - w], [cx, cy - h, cz + w],
      [cx, cy + h, cz + w], [cx, cy + h, cz - w],
      [nx, 0, 0], color, emissive, 0,
    );
  } else {
    // Face perpendicular to z: corners vary in x and y.
    m.quad(
      [cx - w, cy - h, cz], [cx + w, cy - h, cz],
      [cx + w, cy + h, cz], [cx - w, cy + h, cz],
      [0, 0, nz], color, emissive, 0,
    );
  }
}

function drawLenses(m, it, signalAt) {
  const ys = [8.0, 7.2, 6.4]; // red, yellow, green
  const names = ['red', 'yellow', 'green'];
  const ns = signalAt(it.x, it.z, 'NS');
  const ew = signalAt(it.x, it.z, 'EW');
  // Two heads: north-east corner and south-west corner. Each head shows
  // the NS signal on its z face and the EW signal on its x face.
  const heads = [
    { hx: it.x + 10, hz: it.z + 10, zSign: 1, xSign: 1 },
    { hx: it.x - 10, hz: it.z - 10, zSign: -1, xSign: -1 },
  ];
  for (const head of heads) {
    for (let i = 0; i < 3; i++) {
      const name = names[i];
      const nsLit = ns === name;
      const ewLit = ew === name;
      lens(m, head.hx, ys[i], head.hz + head.zSign * 0.65, 0, 0, head.zSign,
        nsLit ? LENS[name].on : LENS[name].off, nsLit ? 1 : 0);
      lens(m, head.hx + head.xSign * 0.65, ys[i], head.hz, head.xSign, 0, 0,
        ewLit ? LENS[name].on : LENS[name].off, ewLit ? 1 : 0);
    }
  }
}

function drawRing(m, car, bright) {
  const h = car.heading;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const rx = c;
  const rz = -s;
  const e = bright ? 0.7 : 0.25;
  const col = bright ? [0.95, 0.6, 0.45] : CORAL;
  // Four thin flat boxes forming a square border around the car.
  m.boxRot(car.x + s * 3.5, 0.05, car.z + c * 3.5, 7, 0.06, 0.3, h, col, e, 0);
  m.boxRot(car.x - s * 3.5, 0.05, car.z - c * 3.5, 7, 0.06, 0.3, h, col, e, 0);
  m.boxRot(car.x + rx * 3.5, 0.05, car.z + rz * 3.5, 0.3, 0.06, 7, h, col, e, 0);
  m.boxRot(car.x - rx * 3.5, 0.05, car.z - rz * 3.5, 0.3, 0.06, 7, h, col, e, 0);
}

// state: { cars, traffic, mara, pedestrians, intersections, signalAt, rings,
//          dust, targetCar }
export function buildDynamicMesh(state) {
  const m = makeMesh();
  for (const car of state.cars) drawCar(m, car);
  // Traffic cars: simulated by TrafficSystem, drawn here like any other
  // car (no coral stripe: they are not drivable). They were missing from
  // this mesh, so the streets looked empty even while traffic flowed.
  for (const car of state.traffic ?? []) drawCar(m, car);
  if (state.targetCar) drawCar(m, state.targetCar);
  for (const p of state.pedestrians) drawFigure(m, p.x, p.z, p.heading, p.color);
  if (state.mara) drawFigure(m, state.mara.x, state.mara.z, state.mara.heading, CORAL);
  for (const it of state.intersections) drawLenses(m, it, state.signalAt);
  for (const ring of state.rings) drawRing(m, ring.car, ring.bright);
  for (const d of state.dust) {
    const f = Math.max(0, 1 - d.age / 0.6);
    const size = 1.5 + (1 - f) * 3;
    m.boxRot(d.x, 0, d.z, size, 0.5, size, 0, [0.7 * f, 0.68 * f, 0.6 * f], 0, 0);
  }
  return m.finish();
}
