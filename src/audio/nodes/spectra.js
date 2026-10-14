// Harmonic spectra for the additive synth: HARMONICS amplitudes, partial 1 first, each 0 to 1.
export const HARMONICS = 32;

const make = fn => Array.from({ length: HARMONICS }, (_, i) => Math.round(Math.min(1, Math.max(0, fn(i + 1))) * 1000) / 1000);

export const SPECTRA = {
  saw: () => make(n => 1 / n),
  square: () => make(n => (n % 2 ? 1 / n : 0)),
  triangle: () => make(n => (n % 2 ? 1 / (n * n) : 0)),
  organ: () => make(n => ([1, 2, 3, 4, 6, 8].includes(n) ? [1, 0.8, 0.6, 0.5, 0.35, 0.3][[1, 2, 3, 4, 6, 8].indexOf(n)] : 0)),
  hollow: () => make(n => (n % 2 ? Math.exp(-(n - 1) / 6) : 0)),
  formant: () => make(n => 0.12 / n + Math.exp(-(((n - 7) / 1.8) ** 2))),
  sine: () => make(n => (n === 1 ? 1 : 0)),
};

// A stored spectrum of any length, resampled to HARMONICS values; falls back to a saw.
export function normalizeSpectrum(points) {
  if (!Array.isArray(points) && !ArrayBuffer.isView(points)) return Float32Array.from(SPECTRA.saw());
  const a = Array.from(points);
  if (a.length < 1 || !a.every(Number.isFinite)) return Float32Array.from(SPECTRA.saw());
  return Float32Array.from({ length: HARMONICS }, (_, i) => Math.min(1, Math.max(0, a[Math.min(i, a.length - 1)])));
}
