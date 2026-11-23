// Orbit/fly camera: yaw/pitch/distance around a target, with drag-look,
// scroll zoom and WASD fly. Own mat4 helpers (no library).
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

export function createCamera() {
  let yaw = Math.PI; // facing north (-z) at start
  let pitch = -0.12;
  let dist = 220;
  let target = [400, 12, 420];

  function eyePos() {
    const e = [
      target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
      target[1] - Math.sin(pitch) * dist,
      target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
    // Never let the eye sink under the street.
    e[1] = Math.max(3, e[1]);
    return e;
  }

  return {
    place(eye, tgt) {
      const dx = eye[0] - tgt[0];
      const dy = eye[1] - tgt[1];
      const dz = eye[2] - tgt[2];
      dist = Math.hypot(dx, dy, dz);
      yaw = Math.atan2(dx, dz);
      pitch = -Math.asin(Math.max(-0.9, Math.min(0.9, dy / dist)));
      target = [...tgt];
    },
    orbit(dyaw, dpitch) {
      yaw += dyaw;
      pitch = Math.max(-1.2, Math.min(0.4, pitch + dpitch));
    },
    zoom(f) {
      dist = Math.max(8, Math.min(900, dist * f));
    },
    move(dx, dz, dy = 0) {
      // dx: right, dz: forward (camera-relative, on the ground plane).
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      target[0] += rx * dx + fx * dz;
      target[2] += rz * dx + fz * dz;
      target[1] = Math.max(2, Math.min(120, target[1] + dy));
    },
    getYaw() {
      return yaw;
    },
    getTarget() {
      return [...target];
    },
    eye() {
      return eyePos();
    },
    viewMatrix() {
      return lookAt(eyePos(), target);
    },
  };
}
