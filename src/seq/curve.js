// The shape of an interpolation: a curve from 0 (the first value) to 1 (the last), kept as a table of CURVE_N + 1 samples so
// that a preset, a bend and a freehand drawing are all the same thing to the code that uses it.
export const CURVE_N = 64;
export const SHAPES = ['linear', 'ease in', 'ease out', 's-curve', 'exponential', 'steps'];

const base = {
  linear: x => x,
  'ease in': x => x * x,
  'ease out': x => 1 - (1 - x) * (1 - x),
  's-curve': x => x * x * (3 - 2 * x),
  exponential: x => (2 ** (4 * x) - 1) / 15,
  steps: x => Math.min(3, Math.floor(x * 4)) / 3,
};

// bend: -1..1, below zero the curve sags, above it bulges (a power curve laid over the shape)
export function shapeTable(shape = 'linear', bend = 0) {
  const f = base[shape] ?? base.linear, p = 2 ** (-2 * bend), t = new Float64Array(CURVE_N + 1);
  for (let i = 0; i <= CURVE_N; i++) { const x = i / CURVE_N; t[i] = shape === 'steps' ? f(x) : f(x) ** p; }
  t[CURVE_N] = 1;
  return t;
}

export function sampleTable(table, x) {
  const p = Math.min(1, Math.max(0, x)) * CURVE_N, i = Math.min(CURVE_N - 1, Math.floor(p)), f = p - i;
  return table[i] * (1 - f) + table[i + 1] * f;
}

export const newCurve = () => ({ shape: 'linear', bend: 0, table: shapeTable(), custom: false, cycles: 0, depth: 0, empties: false });

// The curve's value at x (0..1): the table plus an optional wave laid on top (depth is a fraction of the range)
export const curveAt = (c, x) => sampleTable(c.table, x) + (c.cycles > 0 && c.depth > 0 ? c.depth * Math.sin(2 * Math.PI * c.cycles * x) : 0);

// Painting by hand: sets the samples between two mouse positions (x, y in 0..1; y is the curve's value)
export function paintTable(table, x0, y0, x1, y1) {
  const a = Math.round(Math.min(1, Math.max(0, x0)) * CURVE_N), b = Math.round(Math.min(1, Math.max(0, x1)) * CURVE_N);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = lo; i <= hi; i++) {
    const f = hi === lo ? 1 : (i - a) / (b - a);
    table[i] = Math.min(1.25, Math.max(-0.25, y0 + (y1 - y0) * f));
  }
  table[0] = 0; table[CURVE_N] = 1;   // the ends are the cells' own values
}
