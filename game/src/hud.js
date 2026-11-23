// Permanent HUD: title, district + preset, compass strip, big speedometer,
// FPS, damage, the E-interaction prompt, a toast line, and the control
// scheme written on screen (identical in every mode).
export function createHud(city) {
  const el = {
    district: document.getElementById('district'),
    preset: document.getElementById('preset'),
    speed: document.getElementById('speed-num'),
    fps: document.getElementById('fps'),
    compass: document.getElementById('compass'),
    prompt: document.getElementById('prompt'),
    damage: document.getElementById('damage'),
    toast: document.getElementById('toast'),
    controls: document.getElementById('controls'),
  };
  const ctx = el.compass.getContext('2d');

  function drawCompass(yaw) {
    const w = el.compass.width;
    const h = el.compass.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(20, 45, 56, 0.55)';
    ctx.fillRect(0, 0, w, h);
    // North is yaw = 0 (camera south of its target, looking -z). Heading
    // degrees from yaw: yaw 0 = N, PI/2 = W, PI = S.
    let heading = ((-yaw * 180) / Math.PI + 360) % 360;
    const labels = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [deg, name] of labels) {
      let d = ((deg - heading + 540) % 360) - 180; // -180..180
      if (Math.abs(d) > 70) continue;
      const x = w / 2 + (d / 70) * (w / 2 - 10);
      ctx.fillStyle = deg === 0 ? '#d77f69' : '#ead8b2';
      ctx.fillText(name, x, h / 2);
    }
    // Centre tick.
    ctx.fillStyle = '#d77f69';
    ctx.fillRect(w / 2 - 1, 0, 2, 6);
  }

  return {
    update({ camera, presetName, presetLabel, speedKmh, fps, mode, profileLabel, damage, prompt, toast, controls }) {
      const t = camera.getTarget();
      el.district.textContent = `${city.districtAt(t[0], t[2])} · ${presetLabel}`;
      el.preset.textContent = presetName;
      el.speed.textContent = `${Math.round(speedKmh)}`;
      el.fps.textContent = fps > 0 ? `${fps} fps` : '— fps';
      if (el.prompt) el.prompt.textContent = prompt || '';
      if (el.damage) el.damage.textContent = damage > 0 ? `Damage ${Math.round(damage)}%` : '';
      if (el.toast) el.toast.textContent = toast || '';
      if (el.controls && controls) el.controls.textContent = controls;
      drawCompass(camera.getYaw());
    },
  };
}
