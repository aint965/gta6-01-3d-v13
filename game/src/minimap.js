// Canvas minimap: buildings coloured by district, so the boulevard, the
// off-grid old quarter and the plaza all read at a glance. North is up.
import { DISTRICTS, BOULEVARD_X } from './city.js';

export function createMinimap(canvas, city) {
  const ctx = canvas.getContext('2d');
  const B = city.bounds;
  const sx = canvas.width / (B.x1 - B.x0);
  const sz = canvas.height / (B.z1 - B.z0);
  const X = (x) => (x - B.x0) * sx;
  const Z = (z) => (z - B.z0) * sz;

  // Static layer, drawn once into an offscreen canvas.
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const l = layer.getContext('2d');
  l.fillStyle = '#c9b489';
  l.fillRect(0, 0, layer.width, layer.height);
  // Water.
  l.fillStyle = '#398e99';
  l.fillRect(X(city.water.canal.x0), Z(city.water.canal.z0), (city.water.canal.x1 - city.water.canal.x0) * sx, (city.water.canal.z1 - city.water.canal.z0) * sz);
  l.fillRect(X(city.water.harbour.x0), Z(city.water.harbour.z0), (city.water.harbour.x1 - city.water.harbour.x0) * sx, (city.water.harbour.z1 - city.water.harbour.z0) * sz);
  // Beach and park.
  l.fillStyle = '#e8d9a8';
  for (const r of city.beach) l.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * sx, (r.z1 - r.z0) * sz);
  l.fillStyle = '#56856b';
  l.fillRect(X(city.park.x0), Z(city.park.z0), (city.park.x1 - city.park.x0) * sx, (city.park.z1 - city.park.z0) * sz);
  // Plaza, with a coral dot on the clock tower so the landmark reads.
  l.fillStyle = '#ead8b2';
  l.fillRect(X(city.plaza.x - city.plaza.half), Z(city.plaza.z - city.plaza.half), city.plaza.half * 2 * sx, city.plaza.half * 2 * sz);
  l.fillStyle = '#d77f69';
  l.beginPath();
  l.arc(X(city.plaza.x), Z(city.plaza.z), 4, 0, Math.PI * 2);
  l.fill();
  // Streets.
  l.strokeStyle = '#5a5e63';
  l.lineWidth = 1;
  for (const s of city.streets) {
    l.beginPath();
    l.moveTo(X(s.x0), Z(s.z0));
    l.lineTo(X(s.x1), Z(s.z1));
    l.stroke();
  }
  // The boulevard, wider and brighter than every other street.
  l.strokeStyle = '#398e99';
  l.lineWidth = 4;
  l.beginPath();
  l.moveTo(X(BOULEVARD_X), Z(-1700));
  l.lineTo(X(BOULEVARD_X), Z(1150));
  l.stroke();
  // Buildings, coloured by district.
  for (const b of city.buildings) {
    l.fillStyle = DISTRICTS[b.district]?.css ?? '#8a7a5a';
    l.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), Math.max(1, b.w * sx), Math.max(1, b.d * sz));
  }

  return {
    draw(camera) {
      ctx.drawImage(layer, 0, 0);
      const t = camera.getTarget();
      const e = camera.eye();
      // View direction line + camera dot.
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(e[0]), Z(e[2]));
      ctx.lineTo(X(t[0]), Z(t[2]));
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(X(e[0]), Z(e[2]), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#142d38';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X(e[0]), Z(e[2]), 4, 0, Math.PI * 2);
      ctx.stroke();
    },
  };
}
