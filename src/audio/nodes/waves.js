// Single-cycle waveforms for the FM synth: WAVE_POINTS values from -1 to 1, one period, drawn by hand or taken from a preset.
// The oscillators read them with linear interpolation, so a few dozen points already sound smooth.
export const WAVE_POINTS = 128;
export const OPERATORS = 4;

const make = fn => Array.from({ length: WAVE_POINTS }, (_, i) => Math.round(fn(i / WAVE_POINTS) * 10000) / 10000);
const TAU = 2 * Math.PI;

export const WAVES = {
  sine: () => make(t => Math.sin(TAU * t)),
  triangle: () => make(t => (t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4)),
  saw: () => make(t => 2 * t - 1),
  square: () => make(t => (t < 0.5 ? 1 : -1)),
  pulse: () => make(t => (t < 0.25 ? 1 : -1)),
  'half sine': () => make(t => (t < 0.5 ? Math.sin(TAU * t) : 0) * 2 - 0.64),
  'abs sine': () => make(t => Math.abs(Math.sin(TAU * t)) * 2 - 1),
  organ: () => make(t => (Math.sin(TAU * t) + 0.5 * Math.sin(2 * TAU * t) + 0.25 * Math.sin(4 * TAU * t)) / 1.6),
  'sine 3': () => make(t => Math.sin(TAU * 3 * t)),
};

// Any stored waveform becomes WAVE_POINTS values in -1..1; anything unusable is a sine.
export function normalizeWave(points) {
  if (!Array.isArray(points) && !ArrayBuffer.isView(points)) return Float32Array.from(WAVES.sine());
  const a = Array.from(points);
  if (a.length < 2 || !a.every(Number.isFinite)) return Float32Array.from(WAVES.sine());
  return Float32Array.from({ length: WAVE_POINTS }, (_, i) => {
    const x = (i / WAVE_POINTS) * a.length, k = Math.floor(x), f = x - k;
    const v = a[k % a.length] * (1 - f) + a[(k + 1) % a.length] * f;
    return Math.min(1, Math.max(-1, v));
  });
}

// The four operator waveforms of a node's data (missing ones are sines).
export const normalizeWaves = waves => Array.from({ length: OPERATORS }, (_, i) => normalizeWave(Array.isArray(waves) ? waves[i] : undefined));
