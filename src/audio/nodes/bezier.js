// A one-shot envelope drawn as a Bezier spline, shared by the node that plays it and the panel that draws it.
//
// The spline is a list of anchors { x, y, l, r }: x is the time across the drawing (0 to 1), y the level (0 to 1), and
// `l` and `r` are the handles that shape the curve going into and out of the anchor, as [dx, dy] from the anchor. A
// handle that is null is worked out to make the curve smooth through the anchor; [0, 0] makes a corner. Handles are held
// inside their segment on the time axis, so the curve never doubles back on itself and is always a function of time.
// The node plays the spline as a table of ENV_POINTS + 1 values, from the first anchor's level to the last one's.
export const ENV_POINTS = 256;
const STEPS = 40;   // how finely each segment is walked when the table is made

export const SHAPES = {
  // fast fall, then a long flat tail: the way a kick's pitch or level falls
  fall: () => [{ x: 0, y: 1, l: null, r: [0.03, -0.5] }, { x: 1, y: 0, l: [-0.55, 0], r: null }],
  line: () => [{ x: 0, y: 1, l: null, r: [0, 0] }, { x: 1, y: 0, l: [0, 0], r: null }],
  // a click of attack, then a long fall to nothing
  punch: () => [{ x: 0, y: 0, l: null, r: [0.002, 0.4] }, { x: 0.02, y: 1, l: [-0.006, 0], r: [0.06, -0.05] }, { x: 1, y: 0, l: [-0.5, 0], r: null }],
  // up, hold, down
  hump: () => [{ x: 0, y: 0, l: null, r: [0.12, 0.05] }, { x: 0.4, y: 1, l: [-0.15, 0], r: [0.15, 0] }, { x: 1, y: 0, l: [-0.2, 0.05], r: null }],
  // stays high, then drops at the end
  hold: () => [{ x: 0, y: 1, l: null, r: [0.3, 0] }, { x: 0.7, y: 0.9, l: [-0.2, 0], r: [0.1, -0.1] }, { x: 1, y: 0, l: [-0.05, 0.2], r: null }],
  flat: () => [{ x: 0, y: 0, l: null, r: [0, 0] }, { x: 1, y: 0, l: [0, 0], r: null }],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const handle = h => (Array.isArray(h) && finite(h[0]) && finite(h[1]) ? [h[0], h[1]] : null);

// Whatever was stored becomes a clean spline: sorted, from x = 0 to x = 1, levels 0 to 1, at least two anchors.
export function cleanSpline(points, fallback = SHAPES.fall) {
  if (!Array.isArray(points)) return fallback();
  const a = points.filter(p => p && finite(p.x) && finite(p.y)).map(p => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), l: handle(p.l), r: handle(p.r) }));
  if (a.length < 2) return fallback();
  a.sort((p, q) => p.x - q.x);
  a[0].x = 0; a[a.length - 1].x = 1;
  for (let i = 1; i < a.length; i++) if (a[i].x - a[i - 1].x < 0.002) a[i].x = Math.min(1, a[i - 1].x + 0.002);   // anchors never sit on top of each other
  a[a.length - 1].x = 1;
  return a;
}

// The handles an anchor has when it has none of its own: along the line between its neighbours, a third of the way to each.
export function autoHandles(a, i) {
  const p = a[i], prev = a[i - 1], next = a[i + 1];
  if (!prev && !next) return { l: [0, 0], r: [0, 0] };
  const from = prev ?? p, to = next ?? p;
  let tx = to.x - from.x, ty = to.y - from.y;
  const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
  // an anchor at a turn (a peak or a valley) is kept level, so the curve does not overshoot it
  if (prev && next && (p.y - prev.y) * (next.y - p.y) <= 0) { tx = 1; ty = 0; }
  const reach = (q, back) => (q ? Math.abs(q.x - p.x) / 3 : 0) * (back ? -1 : 1);
  const dxL = reach(prev, true), dxR = reach(next, false);
  const slope = tx > 1e-6 ? ty / tx : 0;
  return { l: prev ? [dxL, dxL * slope] : [0, 0], r: next ? [dxR, dxR * slope] : [0, 0] };
}

// The four control points of the segment from anchor i to i + 1, the handles held inside the segment.
export function segmentOf(a, i) {
  const p = a[i], q = a[i + 1], auto0 = autoHandles(a, i), auto1 = autoHandles(a, i + 1);
  const r = p.r ?? auto0.r, l = q.l ?? auto1.l;
  let c1x = clamp(p.x + r[0], p.x, q.x), c2x = clamp(q.x + l[0], p.x, q.x);
  if (c1x > c2x) c1x = c2x = (c1x + c2x) / 2;
  return [[p.x, p.y], [c1x, clamp(p.y + r[1], 0, 1)], [c2x, clamp(q.y + l[1], 0, 1)], [q.x, q.y]];
}

const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

// The spline walked as a line of [x, y] pairs, for drawing it and for making the table.
export function walk(points) {
  const a = cleanSpline(points), out = [[a[0].x, a[0].y]];
  for (let i = 0; i + 1 < a.length; i++) {
    const [p0, p1, p2, p3] = segmentOf(a, i);
    for (let s = 1; s <= STEPS; s++) { const t = s / STEPS; out.push([bez(p0[0], p1[0], p2[0], p3[0], t), bez(p0[1], p1[1], p2[1], p3[1], t)]); }
  }
  return out;
}

// ENV_POINTS + 1 values: the level at evenly spaced times from the start of the drawing to its end.
export function envelopeTable(points) {
  const line = walk(points), table = new Float32Array(ENV_POINTS + 1);
  let j = 0;
  for (let k = 0; k <= ENV_POINTS; k++) {
    const x = k / ENV_POINTS;
    while (j + 2 < line.length && line[j + 1][0] < x) j++;
    const [x0, y0] = line[j], [x1, y1] = line[j + 1];
    table[k] = x1 > x0 ? y0 + (y1 - y0) * clamp((x - x0) / (x1 - x0), 0, 1) : y1;
  }
  return table;
}

// The table read at `pos`, 0 to 1 (a position past the end holds the last value).
export function readEnvelope(table, pos) {
  const x = clamp(pos, 0, 1) * ENV_POINTS, k = Math.min(ENV_POINTS - 1, x | 0), f = x - k;
  return table[k] + (table[k + 1] - table[k]) * f;
}
