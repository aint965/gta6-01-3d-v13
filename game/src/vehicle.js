// Driving model for "Palkon Auto" — pure, no DOM, so Node can test it.
// Scale: 1 world unit = 1 metre. Speeds are stored in m/s; the profiles
// are specified in km/h exactly as the brief demands.
export const PROFILES = {
  compact: { name: 'compact', label: 'Compact', topKmh: 115, accel: 9, brake: 14, reverseKmh: 25, steer: 2.0 },
  sedan: { name: 'sedan', label: 'Sedan', topKmh: 130, accel: 10, brake: 14, reverseKmh: 25, steer: 1.9 },
  van: { name: 'van', label: 'Van', topKmh: 108, accel: 7.5, brake: 12, reverseKmh: 22, steer: 1.7 },
  coupe: { name: 'coupe', label: 'Coupe', topKmh: 158, accel: 12, brake: 15, reverseKmh: 28, steer: 2.1 },
};

export function kmhToMs(kmh) {
  return kmh / 3.6;
}

export function msToKmh(ms) {
  return ms * 3.6;
}

// A drivable car. Heading 0 faces +z (south); heading PI faces -z (north).
// forward() = (sin h, cos h), so heading matches the city data (taxis sit
// at heading 0 / PI on the vertical streets, +/-PI/2 on the horizontal).
export class Vehicle {
  constructor(profileName, x, z, heading) {
    this.profile = PROFILES[profileName];
    if (!this.profile) throw new Error(`unknown profile ${profileName}`);
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0; // signed m/s, + forward
    this.damage = 0; // 0..100
    this.len = 4.6;
    this.wid = 2.0;
    this.lastImpact = 0;
  }

  forward() {
    return [Math.sin(this.heading), Math.cos(this.heading)];
  }

  right() {
    return [Math.cos(this.heading), -Math.sin(this.heading)];
  }

  speedKmh() {
    return msToKmh(this.speed);
  }

  // input: { throttle, brake, steer (-1..1, + is right), handbrake }
  update(dt, input) {
    const p = this.profile;
    const top = kmhToMs(p.topKmh);
    if (input.throttle) {
      if (this.speed < top) this.speed = Math.min(top, this.speed + p.accel * dt);
    } else if (!input.brake && !input.handbrake) {
      // Engine braking + drag when neither pedal is down.
      const drag = 1.5 + Math.abs(this.speed) * 0.08;
      const s = Math.sign(this.speed);
      this.speed -= s * Math.min(Math.abs(this.speed), drag * dt);
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
    if (input.brake) {
      if (this.speed > 0.5) {
        this.speed = Math.max(0, this.speed - p.brake * dt);
      } else {
        // S reverses once the car has (nearly) stopped.
        this.speed = Math.max(-kmhToMs(p.reverseKmh), this.speed - 6 * dt);
      }
    }
    if (input.handbrake) {
      const dec = 18 * dt;
      const s = Math.sign(this.speed);
      this.speed -= s * Math.min(Math.abs(this.speed), dec);
    }
    // Steering bites only while moving, and less at high speed.
    const spd = Math.abs(this.speed);
    const steerFactor = Math.min(1, spd / 6) * (1 - 0.55 * Math.min(1, spd / top));
    const rate = p.steer * steerFactor * (input.handbrake ? 1.6 : 1);
    this.heading += input.steer * rate * dt * (this.speed >= 0 ? 1 : -1);
    const [fx, fz] = this.forward();
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
  }

  // Called by the collision resolver after a hard hit.
  registerImpact(impactMs) {
    this.lastImpact = impactMs;
    if (impactMs > 3) {
      this.damage = Math.min(100, this.damage + (impactMs - 3) * 2);
      this.speed *= -0.15; // small bounce off the wall
      return true;
    }
    this.speed *= 0.2;
    return false;
  }
}
