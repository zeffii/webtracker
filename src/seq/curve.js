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

export const newCurve = () => ({ shape: 'linear', bend: 0, table: shapeTable(), custom: false, bezier: null, cycles: 0, depth: 0, empties: false });

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

// Bezier mode: a chain of cubic segments through anchors { x, y, hl, hr, smooth }, hl and hr being the handle offsets
// from the anchor. Anchors stay in time order, a handle never reaches past its neighbour (so x(t) is monotone and the
// curve is a function of time) and every value stays inside 0..1. The two ends are the cells' own values: 0 and 1.
const mk = (x, y, dl, dr, hly = 0, hry = 0) => ({ x, y, hl: { x: -dl, y: hly }, hr: { x: dr, y: hry }, smooth: true });
export const BEZIER_PRESETS = {
  linear: () => [mk(0, 0, 0, 0.33, 0, 0.33), mk(1, 1, 0.33, 0, -0.33, 0)],
  'ease in': () => [mk(0, 0, 0, 0.55), mk(1, 1, 0.3, 0, -0.05, 0)],
  'ease out': () => [mk(0, 0, 0, 0.3, 0, 0.05), mk(1, 1, 0.55, 0)],
  's-curve': () => [mk(0, 0, 0, 0.5), mk(1, 1, 0.5, 0)],
};
export const bezierFrom = shape => (BEZIER_PRESETS[shape] ?? BEZIER_PRESETS['s-curve'])();
const MIN_GAP = 0.004, clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function bezierFix(pts) {
  pts.sort((a, b) => a.x - b.x);
  const last = pts.length - 1;
  pts.forEach((p, i) => {
    p.x = i === 0 ? 0 : i === last ? 1 : clamp(p.x, pts[i - 1].x + MIN_GAP, pts[i + 1].x - MIN_GAP);
    p.y = i === 0 ? 0 : i === last ? 1 : clamp(p.y, 0, 1);
    const lo = i ? p.x - pts[i - 1].x : 0, hi = i < last ? pts[i + 1].x - p.x : 0;
    p.hl.x = -Math.min(-p.hl.x, lo); p.hr.x = Math.min(p.hr.x, hi);
    p.hl.y = clamp(p.hl.y, -p.y, 1 - p.y); p.hr.y = clamp(p.hr.y, -p.y, 1 - p.y);
  });
  return pts;
}

// y at time x: find the segment, solve x(t) = x by bisection, evaluate y(t)
export function bezierValue(pts, x) {
  if (x <= 0) return pts[0].y;
  if (x >= 1) return pts[pts.length - 1].y;
  let i = 0; while (i < pts.length - 2 && x > pts[i + 1].x) i++;
  const a = pts[i], b = pts[i + 1];
  const x1 = a.x + a.hr.x, x2 = b.x + b.hl.x, y1 = a.y + a.hr.y, y2 = b.y + b.hl.y;
  let lo = 0, hi = 1;
  for (let k = 0; k < 28; k++) { const t = (lo + hi) / 2, u = 1 - t; if (u * u * u * a.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * b.x < x) lo = t; else hi = t; }
  const t = (lo + hi) / 2, u = 1 - t;
  return clamp(u * u * u * a.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * b.y, 0, 1);
}

export function bezierTable(pts) {
  const t = new Float64Array(CURVE_N + 1);
  for (let i = 0; i <= CURVE_N; i++) t[i] = bezierValue(pts, i / CURVE_N);
  return t;
}
