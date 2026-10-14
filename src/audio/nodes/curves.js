// Transfer curves for the waveshaper: CURVE_POINTS values of y for x from -1 to 1.
export const CURVE_POINTS = 129;

const make = fn => Array.from({ length: CURVE_POINTS }, (_, i) => {
  const x = (2 * i) / (CURVE_POINTS - 1) - 1;
  return Math.round(Math.min(1, Math.max(-1, fn(x))) * 10000) / 10000;
});

export const PRESETS = {
  linear: () => make(x => x),
  soft: () => make(x => Math.tanh(2 * x) / Math.tanh(2)),
  hard: () => make(x => Math.min(1, Math.max(-1, x * 2.5))),
  fold: () => make(x => Math.sin(x * Math.PI * 1.5)),
  asym: () => make(x => (x >= 0 ? Math.tanh(2 * x) / Math.tanh(2) : Math.max(-1, x * 2))),
  crush: () => make(x => Math.round(x * 4) / 4),
};

// Resamples a stored curve of any length to CURVE_POINTS values, or falls back to soft clipping.
export function normalizeCurve(points) {
  if (!Array.isArray(points) && !ArrayBuffer.isView(points)) return Float32Array.from(PRESETS.soft());
  const n = points.length;
  if (n < 2 || !Array.from(points).every(Number.isFinite)) return Float32Array.from(PRESETS.soft());
  return Float32Array.from({ length: CURVE_POINTS }, (_, i) => {
    const p = (i / (CURVE_POINTS - 1)) * (n - 1), k = Math.floor(p), f = p - k;
    const a = points[k], b = points[Math.min(k + 1, n - 1)];
    return Math.min(1, Math.max(-1, a + (b - a) * f));
  });
}
