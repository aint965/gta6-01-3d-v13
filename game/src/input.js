// Keyboard + mouse input. Tracks held keys, reports edge presses (E,
// Space) once per frame, and drives the orbit camera with drag/scroll.
// The game logic (main.js) interprets the keys per mode — this module
// never moves the camera or the player itself.
export function createInput(canvas, camera, onPreset) {
  const keys = new Set();
  const pressed = new Set();

  function key(e) {
    return e.code;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Digit1') { onPreset('day'); return; }
    if (e.code === 'Digit2') { onPreset('sunset'); return; }
    if (e.code === 'Digit3') { onPreset('night'); return; }
    if (e.code === 'KeyT') { onPreset('cycle'); return; }
    if (!e.repeat) pressed.add(key(e));
    keys.add(key(e));
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(key(e)));
  window.addEventListener('blur', () => keys.clear());

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camera.orbit(-dx * 0.005, -dy * 0.005);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom(e.deltaY > 0 ? 1.1 : 0.9);
  }, { passive: false });

  return {
    keys,
    pressed,
    // WASD / arrows as a movement axis: x = strafe right, y = forward.
    axis() {
      let x = 0;
      let y = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      return { x, y };
    },
    // Called at the end of each frame: edge presses live for one frame.
    endFrame() {
      pressed.clear();
    },
  };
}
