// Keyboard + mouse input. Drag looks around, scroll zooms, WASD flies the
// camera, 1/2/3 or T cycles the lighting presets.
export function createInput(canvas, camera, onPreset) {
  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function key(e) {
    return e.code;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Digit1') { onPreset('day'); return; }
    if (e.code === 'Digit2') { onPreset('sunset'); return; }
    if (e.code === 'Digit3') { onPreset('night'); return; }
    if (e.code === 'KeyT') { onPreset('cycle'); return; }
    keys.add(key(e));
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(key(e)));
  window.addEventListener('blur', () => keys.clear());

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
    // Called once a frame: applies the held movement keys.
    step(dt) {
      const speed = 60 * dt;
      let dx = 0;
      let dz = 0;
      let dy = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dz += speed;
      if (keys.has('KeyS') || keys.has('ArrowDown')) dz -= speed;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= speed;
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += speed;
      if (keys.has('KeyQ')) dy -= speed;
      if (keys.has('KeyE')) dy += speed;
      if (dx !== 0 || dz !== 0 || dy !== 0) camera.move(dx, dz, dy);
    },
  };
}
