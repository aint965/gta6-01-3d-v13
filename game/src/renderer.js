// Handwritten WebGL 2 renderer for "Palkon Auto". One shader program and one
// merged vertex buffer for the whole city (separate attribute buffers, so
// there is no interleave to get wrong), plus a flat sky shader for the sun,
// moon and stars. No vendored engine, no culling (winding can never blank
// the frame), no zero normals anywhere.
import { makeRng } from './rng.js';

const CITY_VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
in float aEmissive;
in float aSpec;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCamPos;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vColor;
out float vEmissive;
out float vSpec;
void main() {
  vec4 w = vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = aNormal;
  vColor = aColor;
  vEmissive = aEmissive;
  vSpec = aSpec;
  gl_Position = uProj * uView * w;
}`;

const CITY_FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vColor;
in float vEmissive;
in float vSpec;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uCamPos;
uniform vec3 uEmissiveColor;
uniform float uEmissive;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 base = vColor * (uAmbient + uSunColor * diff);
  vec3 r = reflect(-uSunDir, n);
  float spec = vSpec * pow(max(dot(r, v), 0.0), 24.0) * 0.7;
  vec3 color = base + vec3(spec) + uEmissiveColor * vEmissive * uEmissive;
  float d = distance(uCamPos, vWorld);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  color = mix(color, uFogColor, clamp(f, 0.0, 1.0));
  fragColor = vec4(color, 1.0);
}`;

const SKY_VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  gl_PointSize = 2.0;
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`program link: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

function shade(c, f) {
  return [c[0] * f, c[1] * f, c[2] * f];
}

// Geometry builder: plain arrays, one vertex at a time.
function makeMesh() {
  const pos = [];
  const nrm = [];
  const col = [];
  const emi = [];
  const spc = [];
  const idx = [];
  let vbase = 0;
  function vert(x, y, z, nx, ny, nz, c, e, s) {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    col.push(c[0], c[1], c[2]);
    emi.push(e);
    spc.push(s);
    return vbase++;
  }
  // Quad from four corners (a,b,c,d), one normal, one colour.
  function quad(a, b, c, d, n, color, e = 0, s = 0) {
    const i0 = vert(a[0], a[1], a[2], n[0], n[1], n[2], color, e, s);
    const i1 = vert(b[0], b[1], b[2], n[0], n[1], n[2], color, e, s);
    const i2 = vert(c[0], c[1], c[2], n[0], n[1], n[2], color, e, s);
    const i3 = vert(d[0], d[1], d[2], n[0], n[1], n[2], color, e, s);
    idx.push(i0, i1, i2, i0, i2, i3);
  }
  // Axis-aligned box; cy is the base height. Roof is a shade darker.
  function box(cx, cy, cz, w, h, d, color, e = 0, s = 0) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy;
    const y1 = cy + h;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const roof = shade(color, 0.78);
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], roof, e, s);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, e, s);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color, e, s);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color, e, s);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color, e, s);
  }
  // Flat quad on the ground plane (normal +y), from a rectangle.
  function groundQuad(x0, z0, x1, z1, y, color, e = 0, s = 0) {
    quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], color, e, s);
  }
  // Quad along a street segment, width 2*half, at height y.
  function streetQuad(x0, z0, x1, z1, half, y, color) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * half;
    const pz = (dx / len) * half;
    quad(
      [x0 + px, y, z0 + pz], [x1 + px, y, z1 + pz],
      [x1 - px, y, z1 - pz], [x0 - px, y, z0 - pz],
      [0, 1, 0], color,
    );
  }
  // Four-sided pyramid (cone) for tree foliage and roofs.
  function pyramid(cx, cy, cz, base, height, color) {
    const h = base / 2;
    const top = [cx, cy + height, cz];
    const c = [
      [cx - h, cy, cz - h], [cx + h, cy, cz - h],
      [cx + h, cy, cz + h], [cx - h, cy, cz + h],
    ];
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      // Outward normal of the slope face (rough but never zero).
      const mx = (a[0] + b[0]) / 2 - cx;
      const mz = (a[2] + b[2]) / 2 - cz;
      const n = [mx, base * 0.7, mz];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      const i0 = vert(a[0], a[1], a[2], n[0] / l, n[1] / l, n[2] / l, color, 0, 0);
      const i1 = vert(b[0], b[1], b[2], n[0] / l, n[1] / l, n[2] / l, color, 0, 0);
      const i2 = vert(top[0], top[1], top[2], n[0] / l, n[1] / l, n[2] / l, color, 0, 0);
      idx.push(i0, i1, i2);
    }
  }
  // Vertical disc (fan) in the plane perpendicular to n.
  function disc(cx, cy, cz, r, n, color, e = 0, s = 0, seg = 12) {
    // Pick a tangent that is never parallel to n.
    const t = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    const uu = [u[0] / ul, u[1] / ul, u[2] / ul];
    const vv = [n[1] * uu[2] - n[2] * uu[1], n[2] * uu[0] - n[0] * uu[2], n[0] * uu[1] - n[1] * uu[0]];
    const centre = vert(cx, cy, cz, n[0], n[1], n[2], color, e, s);
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const px = cx + (Math.cos(a) * uu[0] + Math.sin(a) * vv[0]) * r;
      const py = cy + (Math.cos(a) * uu[1] + Math.sin(a) * vv[1]) * r;
      const pz = cz + (Math.cos(a) * uu[2] + Math.sin(a) * vv[2]) * r;
      ring.push(vert(px, py, pz, n[0], n[1], n[2], color, e, s));
    }
    for (let i = 0; i < seg; i++) idx.push(centre, ring[i], ring[i + 1]);
  }
  // Eight-sided cylinder (fountain basin): side + top disc.
  function cylinder(cx, cy, cz, r, h, color, seg = 8) {
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    for (let i = 0; i < seg; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[i + 1];
      const mx = (ax + bx) / 2 - cx;
      const mz = (az + bz) / 2 - cz;
      const l = Math.hypot(mx, mz) || 1;
      const n = [mx / l, 0, mz / l];
      const i0 = vert(ax, cy, az, n[0], n[1], n[2], color, 0, 0);
      const i1 = vert(bx, cy, bz, n[0], n[1], n[2], color, 0, 0);
      const i2 = vert(bx, cy + h, bz, n[0], n[1], n[2], color, 0, 0);
      const i3 = vert(ax, cy + h, az, n[0], n[1], n[2], color, 0, 0);
      idx.push(i0, i1, i2, i0, i2, i3);
    }
    disc(cx, cy + h, cz, r, [0, 1, 0], shade(color, 0.85), 0, 0, seg);
  }
  return {
    pos, nrm, col, emi, spc, idx,
    quad, box, groundQuad, streetQuad, pyramid, disc, cylinder,
    finish() {
      return {
        position: new Float32Array(pos),
        normal: new Float32Array(nrm),
        color: new Float32Array(col),
        emissive: new Float32Array(emi),
        spec: new Float32Array(spc),
        index: new Uint32Array(idx),
        triangles: idx.length / 3,
      };
    },
  };
}

const WINDOW_COLOR = [0.1, 0.12, 0.16];

function buildCityMesh(city) {
  const m = makeMesh();
  const rng = makeRng(20261123 + 7);
  const B = city.bounds;

  // Ground: grass base, sand, water, plaza, park.
  m.groundQuad(B.x0, B.z0, B.x1, B.z1, 0, [0.5, 0.68, 0.45]);
  for (const r of city.beach) m.groundQuad(r.x0, r.z0, r.x1, r.z1, 0.01, [0.9, 0.82, 0.62]);
  m.groundQuad(city.water.canal.x0, city.water.canal.z0, city.water.canal.x1, city.water.canal.z1, 0.03, [0.22, 0.5, 0.62], 0, 1);
  m.groundQuad(city.water.harbour.x0, city.water.harbour.z0, city.water.harbour.x1, city.water.harbour.z1, 0.03, [0.22, 0.5, 0.62], 0, 1);
  const pl = city.plaza;
  m.groundQuad(pl.x - pl.half, pl.z - pl.half, pl.x + pl.half, pl.z + pl.half, 0.02, [0.92, 0.85, 0.68]);
  const pk = city.park;
  m.groundQuad(pk.x0, pk.z0, pk.x1, pk.z1, 0.01, [0.4, 0.6, 0.38]);

  // Streets: pale sidewalk under dark asphalt; bridges ride higher.
  for (const s of city.streets) {
    const y = s.bridge ? 0.14 : 0.03;
    m.streetQuad(s.x0, s.z0, s.x1, s.z1, s.half + 5, y - 0.015, [0.85, 0.8, 0.68]);
    m.streetQuad(s.x0, s.z0, s.x1, s.z1, s.half, y, [0.34, 0.35, 0.38]);
    if (s.bridge) {
      // Bridge rails.
      const dx = s.x1 - s.x0;
      const dz = s.z1 - s.z0;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * (s.half + 1);
      const pz = (dx / len) * (s.half + 1);
      const mx = (s.x0 + s.x1) / 2;
      const mz = (s.z0 + s.z1) / 2;
      const bl = Math.hypot(dx, dz);
      m.box(mx + px, 0.14, mz + pz, 1.2, 1.6, bl, [0.7, 0.68, 0.6]);
      m.box(mx - px, 0.14, mz - pz, 1.2, 1.6, bl, [0.7, 0.68, 0.6]);
    }
  }

  // Buildings with real windows.
  for (const b of city.buildings) {
    const isGlass = b.type === 'glass';
    const spec = isGlass ? 1 : 0;
    m.box(b.x, 0, b.z, b.w, b.h, b.d, b.color, 0, spec);
    if (isGlass && b.h >= 12) {
      // Glass towers: lit floor lines so the slab never reads flat.
      const band = shade(b.color, 1.4);
      for (let y = 6; y < b.h - 2; y += 8) {
        const zf = b.z + b.d / 2 + 0.06;
        m.quad([b.x - b.w / 2, y, zf], [b.x + b.w / 2, y, zf], [b.x + b.w / 2, y + 1.2, zf], [b.x - b.w / 2, y + 1.2, zf], [0, 0, 1], band, 0.35, 0);
        const zb = b.z - b.d / 2 - 0.06;
        m.quad([b.x + b.w / 2, y, zb], [b.x - b.w / 2, y, zb], [b.x - b.w / 2, y + 1.2, zb], [b.x + b.w / 2, y + 1.2, zb], [0, 0, -1], band, 0.35, 0);
        const xf = b.x + b.w / 2 + 0.06;
        m.quad([xf, y, b.z - b.d / 2], [xf, y, b.z + b.d / 2], [xf, y + 1.2, b.z + b.d / 2], [xf, y + 1.2, b.z - b.d / 2], [1, 0, 0], band, 0.35, 0);
        const xw = b.x - b.w / 2 - 0.06;
        m.quad([xw, y, b.z + b.d / 2], [xw, y, b.z - b.d / 2], [xw, y + 1.2, b.z - b.d / 2], [xw, y + 1.2, b.z + b.d / 2], [-1, 0, 0], band, 0.35, 0);
      }
    }
    if (!isGlass && b.w >= 14 && b.h >= 12) {
      const cols = Math.min(5, Math.max(1, Math.floor(b.w / 5)));
      const rows = Math.min(6, Math.max(1, Math.floor(b.h / 6)));
      const ww = 1.6;
      const wh = 2.4;
      // North (+z) and south (-z) faces.
      for (const side of [1, -1]) {
        const zf = b.z + side * (b.d / 2 + 0.06);
        for (let c = 0; c < cols; c++) {
          const wx = b.x - ((cols - 1) * 5) / 2 + c * 5;
          for (let r = 0; r < rows; r++) {
            const wy = 4 + r * 6;
            if (wy + wh > b.h - 1) continue;
            const lit = rng.chance(0.45) ? 1 : 0;
            const n = [0, 0, side];
            m.quad(
              [wx - ww / 2, wy, zf], [wx + ww / 2, wy, zf],
              [wx + ww / 2, wy + wh, zf], [wx - ww / 2, wy + wh, zf],
              n, WINDOW_COLOR, lit, 0,
            );
          }
        }
      }
      // East (+x) and west (-x) faces.
      for (const side of [1, -1]) {
        const xf = b.x + side * (b.w / 2 + 0.06);
        for (let c = 0; c < cols; c++) {
          const wz = b.z - ((cols - 1) * 5) / 2 + c * 5;
          for (let r = 0; r < rows; r++) {
            const wy = 4 + r * 6;
            if (wy + wh > b.h - 1) continue;
            const lit = rng.chance(0.45) ? 1 : 0;
            const n = [side, 0, 0];
            m.quad(
              [xf, wy, wz - ww / 2], [xf, wy, wz + ww / 2],
              [xf, wy + wh, wz + ww / 2], [xf, wy + wh, wz - ww / 2],
              n, WINDOW_COLOR, lit, 0,
            );
          }
        }
      }
    }
  }

  // Clock tower + fountain: the plaza landmarks.
  const tower = city.landmarks.clockTower;
  m.box(tower.x, 0, tower.z, tower.w, tower.h, tower.w, [0.9, 0.82, 0.62]);
  m.pyramid(tower.x, tower.h, tower.z, tower.w + 4, 10, [0.72, 0.38, 0.26]);
  for (const side of [1, -1]) {
    m.disc(tower.x, 50, tower.z + side * (tower.w / 2 + 0.1), 5, [0, 0, side], [0.95, 0.93, 0.85]);
    // Clock hands: two thin dark boxes on the dial.
    m.box(tower.x - 1.5, 48.5, tower.z + side * (tower.w / 2 + 0.25), 0.7, 4, 0.3, [0.1, 0.1, 0.12]);
    m.box(tower.x + 1, 50, tower.z + side * (tower.w / 2 + 0.25), 3, 0.7, 0.3, [0.1, 0.1, 0.12]);
  }
  const f = city.landmarks.fountain;
  m.cylinder(f.x, 0, f.z, f.r, 1.5, [0.85, 0.8, 0.68]);
  m.disc(f.x, 1.2, f.z, f.r - 1.5, [0, 1, 0], [0.3, 0.6, 0.7], 0, 1);
  m.box(f.x, 1.2, f.z, 2, 4, 2, [0.85, 0.8, 0.68]);

  // Trees: trunk + two foliage pyramids.
  const leafTones = [[0.3, 0.5, 0.3], [0.4, 0.58, 0.3], [0.25, 0.45, 0.35]];
  for (const t of city.trees) {
    const leaf = leafTones[Math.floor(t.hue * leafTones.length) % leafTones.length];
    m.box(t.x, 0, t.z, 1, 3.5 * t.s, 1, [0.45, 0.32, 0.2]);
    m.pyramid(t.x, 3 * t.s, t.z, 7 * t.s, 8 * t.s, leaf);
    m.pyramid(t.x, 8 * t.s, t.z, 5 * t.s, 6 * t.s, shade(leaf, 1.15));
  }

  // Street lamps: pole + glowing head.
  for (const l of city.lamps) {
    m.box(l.x, 0, l.z, 0.6, 7, 0.6, [0.2, 0.2, 0.22]);
    m.box(l.x, 7, l.z, 1.6, 0.6, 1.6, [1, 0.85, 0.6], 1, 0);
  }

  // Traffic lights at every intersection: pole + head, red one corner,
  // green the opposite (static in Stage A; timing comes later).
  for (const it of city.intersections) {
    m.box(it.x + 10, 0, it.z + 10, 0.5, 6, 0.5, [0.15, 0.15, 0.16]);
    m.box(it.x + 10, 6, it.z + 10, 1.2, 2.6, 1.2, [0.1, 0.1, 0.1]);
    m.quad([it.x + 9.3, 7.2, it.z + 10.65], [it.x + 10.7, 7.2, it.z + 10.65], [it.x + 10.7, 8.2, it.z + 10.65], [it.x + 9.3, 8.2, it.z + 10.65], [0, 0, 1], [0.9, 0.15, 0.15], 0.7, 0);
    m.box(it.x - 10, 0, it.z - 10, 0.5, 6, 0.5, [0.15, 0.15, 0.16]);
    m.box(it.x - 10, 6, it.z - 10, 1.2, 2.6, 1.2, [0.1, 0.1, 0.1]);
    m.quad([it.x - 10.7, 5.6, it.z - 10.65], [it.x - 9.3, 5.6, it.z - 10.65], [it.x - 9.3, 6.6, it.z - 10.65], [it.x - 10.7, 6.6, it.z - 10.65], [0, 0, -1], [0.15, 0.85, 0.3], 0.7, 0);
  }

  // Boats in the harbour: hull + cabin.
  for (const b of city.boats) {
    m.box(b.x, 0, b.z, b.len, 3, 8, b.color);
    m.box(b.x, 3, b.z, b.len * 0.45, 2.2, 8 * 0.7, [0.95, 0.95, 0.92]);
  }

  // Parked cars: body + cabin + wheels.
  for (const car of city.cars) {
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    // Body is axis-aligned for the two headings the city uses (0/90deg);
    // heading PI/2 swaps length and width.
    const along = Math.abs(s) > 0.5 ? 2 : 4.6;
    const across = Math.abs(s) > 0.5 ? 4.6 : 2;
    m.box(car.x, 0, car.z, along, 1.3, across, car.color, 0, 0.4);
    m.box(car.x, 1.3, car.z, along * 0.55, 1.0, across * 0.85, [0.2, 0.25, 0.3], 0, 1);
    for (const wx of [-1.5, 1.5]) {
      for (const wz of [-0.9, 0.9]) {
        const lx = Math.abs(s) > 0.5 ? wz : wx;
        const lz = Math.abs(s) > 0.5 ? wx : wz;
        m.box(car.x + lx, 0, car.z + lz, 0.7, 0.7, 0.7, [0.08, 0.08, 0.09]);
      }
    }
    void c;
  }

  // Pedestrians: bright jacket + head.
  for (const p of city.pedestrians) {
    m.box(p.x, 0, p.z, 0.8, 1.8, 0.5, p.color);
    m.box(p.x, 1.8, p.z, 0.5, 0.5, 0.5, [0.85, 0.7, 0.55]);
  }

  return m.finish();
}

function buildSkyMesh() {
  const rng = makeRng(20261123 + 99);
  const pos = [];
  const col = [];
  // Stars on a dome, radius 3400, only above the horizon.
  for (let i = 0; i < 600; i++) {
    const a = rng.range(0, Math.PI * 2);
    const e = rng.range(0.08, 1.4);
    const r = 3400;
    pos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    const b = 0.5 + rng.range(0, 0.5);
    col.push(b, b, b * 1.05);
  }
  // Sun disc (day/sunset) and moon disc (night), placed far away.
  const sunDir = [0.35, 0.85, 0.25];
  const sunC = [sunDir[0] * 3200, sunDir[1] * 3200, sunDir[2] * 3200];
  const sunCol = [1.0, 0.9, 0.6];
  const moonDir = [0.3, 0.7, -0.4];
  const moonC = [moonDir[0] * 3200, moonDir[1] * 3200, moonDir[2] * 3200];
  const moonCol = [0.9, 0.92, 1.0];
  const discPos = [];
  const discCol = [];
  function addDisc(centre, radius, color) {
    // Billboards the camera: a disc in the plane facing the origin.
    const n = centre.map((v) => -v / Math.hypot(...centre));
    const t = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const ul = Math.hypot(...u) || 1;
    const uu = u.map((v) => v / ul);
    const vv = [n[1] * uu[2] - n[2] * uu[1], n[2] * uu[0] - n[0] * uu[2], n[0] * uu[1] - n[1] * uu[0]];
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2;
      const p0 = centre;
      const p1 = centre.map((v, k) => v + (Math.cos(a0) * uu[k] + Math.sin(a0) * vv[k]) * radius);
      const p2 = centre.map((v, k) => v + (Math.cos(a1) * uu[k] + Math.sin(a1) * vv[k]) * radius);
      discPos.push(...p0, ...p1, ...p2);
      discCol.push(...color, ...color, ...color);
    }
  }
  addDisc(sunC, 130, sunCol);
  addDisc(moonC, 90, moonCol);
  return {
    stars: { position: new Float32Array(pos), color: new Float32Array(col), count: pos.length / 3 },
    discs: { position: new Float32Array(discPos), color: new Float32Array(discCol), count: discPos.length / 3 },
  };
}

export function createRenderer(canvas, city) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 not available');
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST);

  const cityProg = program(gl, CITY_VERT, CITY_FRAG);
  const skyProg = program(gl, SKY_VERT, SKY_FRAG);

  const mesh = buildCityMesh(city);
  const sky = buildSkyMesh();

  function makeBuffer(data, usage = gl.STATIC_DRAW) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return b;
  }
  function makeIndex(data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const posBuf = makeBuffer(mesh.position);
  const nrmBuf = makeBuffer(mesh.normal);
  const colBuf = makeBuffer(mesh.color);
  const emiBuf = makeBuffer(mesh.emissive);
  const spcBuf = makeBuffer(mesh.spec);
  const idxBuf = makeIndex(mesh.index);
  function attrib(prog, name, buf, size) {
    const loc = gl.getAttribLocation(prog, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  attrib(cityProg, 'aPos', posBuf, 3);
  attrib(cityProg, 'aNormal', nrmBuf, 3);
  attrib(cityProg, 'aColor', colBuf, 3);
  attrib(cityProg, 'aEmissive', emiBuf, 1);
  attrib(cityProg, 'aSpec', spcBuf, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

  const skyVao = gl.createVertexArray();
  gl.bindVertexArray(skyVao);
  const starPosBuf = makeBuffer(sky.stars.position);
  const starColBuf = makeBuffer(sky.stars.color);
  const discPosBuf = makeBuffer(sky.discs.position);
  const discColBuf = makeBuffer(sky.discs.color);
  gl.bindVertexArray(null);

  const U = {};
  for (const name of ['uProj', 'uView', 'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogDensity', 'uCamPos', 'uEmissiveColor', 'uEmissive']) {
    U[name] = gl.getUniformLocation(cityProg, name);
  }
  const SU = {
    uProj: gl.getUniformLocation(skyProg, 'uProj'),
    uView: gl.getUniformLocation(skyProg, 'uView'),
  };

  let preset = null;
  let hazeEnabled = true;

  function bindSkyAttribs(posBuf, colBuf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    const lp = gl.getAttribLocation(skyProg, 'aPos');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    const lc = gl.getAttribLocation(skyProg, 'aColor');
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 3, gl.FLOAT, false, 0, 0);
  }

  return {
    meshTriangles: mesh.triangles,
    setPreset(p) {
      preset = p;
    },
    setHazeEnabled(v) {
      hazeEnabled = v;
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    render(camera, proj) {
      if (!preset) return;
      gl.clearColor(preset.sky[0], preset.sky[1], preset.sky[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const view = camera.viewMatrix();

      // Sky first: sun/moon discs, then stars at night, no depth write.
      gl.useProgram(skyProg);
      gl.uniformMatrix4fv(SU.uProj, false, proj);
      gl.uniformMatrix4fv(SU.uView, false, view);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(skyVao);
      bindSkyAttribs(discPosBuf, discColBuf);
      // Day shows the sun, night the moon: draw the disc whose preset it is.
      const discStart = preset.name === 'night' ? 12 : 0;
      gl.drawArrays(gl.TRIANGLES, discStart, 12);
      if (preset.name === 'night') {
        bindSkyAttribs(starPosBuf, starColBuf);
        gl.drawArrays(gl.POINTS, 0, sky.stars.count);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);

      // The city.
      gl.useProgram(cityProg);
      gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(U.uProj, false, proj);
      gl.uniformMatrix4fv(U.uView, false, view);
      gl.uniform3fv(U.uSunDir, preset.sunDir);
      gl.uniform3fv(U.uSunColor, preset.sunColor);
      gl.uniform3fv(U.uAmbient, preset.ambient);
      gl.uniform3fv(U.uFogColor, preset.fogColor);
      gl.uniform1f(U.uFogDensity, hazeEnabled ? preset.fogDensity : 0);
      gl.uniform3fv(U.uCamPos, camera.eye());
      gl.uniform3fv(U.uEmissiveColor, [1.0, 0.72, 0.42]);
      gl.uniform1f(U.uEmissive, preset.emissive);
      gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    },
  };
}
