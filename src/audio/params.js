// Parameter registry, imported by both the main thread and the worklet.
// One slot per parameter in a shared block of 32-bit floats.
export const PARAMS = [
  { id: 'tone.freq', min: 20, max: 2000, def: 220 },
  { id: 'tone.level', min: 0, max: 1, def: 0.2 },
];

export const PARAM_COUNT = PARAMS.length;
export const SLOT = Object.fromEntries(PARAMS.map((p, i) => [p.id, i]));

export const initParams = view => PARAMS.forEach((p, i) => { view[i] = p.def; });
