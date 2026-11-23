// Traffic-light cycle for Solmar — pure, no DOM.
// One 26 s cycle: NS green 11 s, NS yellow 2 s, EW green 11 s, EW yellow
// 2 s. Each intersection has a fixed phase offset from its coordinates,
// so neighbouring lights do not all flip together.
export const CYCLE = 26;
export const NS_GREEN = 11;
export const NS_YELLOW = 2;
export const EW_GREEN = 11;
export const EW_YELLOW = 2;

export function signalOffset(x, z) {
  return (((x * 7 + z * 13) % CYCLE) + CYCLE) % CYCLE;
}

// Returns { ns, ew, phase } where each direction is 'green' | 'yellow' |
// 'red'. 'NS' is travel along z (north-south), 'EW' along x.
export function signalState(x, z, t) {
  const ph = (((t + signalOffset(x, z)) % CYCLE) + CYCLE) % CYCLE;
  if (ph < NS_GREEN) return { ns: 'green', ew: 'red', phase: ph };
  if (ph < NS_GREEN + NS_YELLOW) return { ns: 'yellow', ew: 'red', phase: ph };
  if (ph < NS_GREEN + NS_YELLOW + EW_GREEN) return { ns: 'red', ew: 'green', phase: ph };
  return { ns: 'red', ew: 'yellow', phase: ph };
}

// Seconds until the given axis turns green (0 when already green).
export function secondsUntilGreen(x, z, t, axis) {
  const ph = (((t + signalOffset(x, z)) % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'NS') {
    if (ph < NS_GREEN) return 0;
    return CYCLE - ph;
  }
  const ewStart = NS_GREEN + NS_YELLOW;
  if (ph >= ewStart && ph < ewStart + EW_GREEN) return 0;
  if (ph < ewStart) return ewStart - ph;
  return CYCLE - ph + ewStart;
}
