// Mara on foot — pure, no DOM. Walks at 6 m/s, collides with buildings
// as a circle, and enters/exits drivable cars with E.
import { circleVsAabb } from './collision.js';

export const WALK_SPEED = 6; // m/s
export const ENTER_RADIUS = 4.5; // E works within this distance of a car
export const PROMPT_RADIUS = 12; // the ground ring shows within this distance

export class Player {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.heading = Math.PI; // facing north
    this.mode = 'walk'; // 'walk' | 'drive'
    this.car = null; // the car entity being driven
    this.radius = 0.6;
  }

  // Move on foot. mx/mz is the camera-relative movement direction
  // (already normalised, may be zero). aabbs are the building boxes.
  updateWalk(dt, mx, mz, aabbs) {
    if (mx === 0 && mz === 0) return;
    this.heading = Math.atan2(mx, mz);
    const nx = this.x + mx * WALK_SPEED * dt;
    const nz = this.z + mz * WALK_SPEED * dt;
    this.x = nx;
    this.z = nz;
    for (const aabb of aabbs) {
      if (Math.abs(this.x - (aabb.x0 + aabb.x1) / 2) > 60 || Math.abs(this.z - (aabb.z0 + aabb.z1) / 2) > 60) continue;
      const push = circleVsAabb(this.x, this.z, this.radius, aabb);
      if (push) {
        this.x += push[0];
        this.z += push[1];
      }
    }
  }

  // Nearest drivable car within a radius (null when none).
  nearestDrivable(cars, maxDist = ENTER_RADIUS) {
    let best = null;
    let bestD = maxDist;
    for (const c of cars) {
      if (!c.drivable) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  enter(car) {
    this.mode = 'drive';
    this.car = car;
  }

  // Step out on the car's right side, clear of the body.
  exit() {
    const car = this.car;
    if (!car) return;
    const rx = Math.cos(car.heading);
    const rz = -Math.sin(car.heading);
    this.x = car.x + rx * 3.2;
    this.z = car.z + rz * 3.2;
    this.heading = car.heading;
    this.mode = 'walk';
    this.car = null;
  }
}
