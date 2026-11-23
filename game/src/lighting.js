// Three lighting presets: scorching midday sun, low sunset, night with
// moon + stars + street lights. Fog is kept thin on purpose — the far
// skyline must keep its district colours instead of washing out.
export const PRESET_ORDER = ['day', 'sunset', 'night'];

export const PRESETS = {
  day: {
    name: 'day',
    label: 'Midday',
    sunDir: [0.35, 0.85, 0.25],
    sunColor: [1.0, 0.95, 0.85],
    ambient: [0.55, 0.55, 0.52],
    fogColor: [0.72, 0.8, 0.88],
    fogDensity: 0.0002,
    sky: [0.55, 0.75, 0.9],
    emissive: 0.15,
  },
  sunset: {
    name: 'sunset',
    label: 'Sunset',
    sunDir: [-0.85, 0.28, 0.2],
    sunColor: [1.0, 0.55, 0.25],
    ambient: [0.46, 0.38, 0.34],
    fogColor: [0.95, 0.6, 0.4],
    fogDensity: 0.00024,
    sky: [0.95, 0.55, 0.35],
    emissive: 0.6,
  },
  night: {
    name: 'night',
    label: 'Night',
    sunDir: [0.3, 0.7, -0.4],
    sunColor: [0.35, 0.45, 0.65],
    ambient: [0.22, 0.24, 0.3],
    fogColor: [0.05, 0.07, 0.12],
    fogDensity: 0.00032,
    sky: [0.03, 0.05, 0.1],
    emissive: 1.0,
  },
};
