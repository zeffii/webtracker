// Lane curves: a drawn line over time that moves one parameter of a lane's machine (its volume, a filter cutoff, any
// parameter column). It is not pattern data: it belongs to the lane and runs across patterns.
//
// curve = { target: 'node.param', on: true, pts: [{ t, v, pin? }], kinds: ['c' | 'l', ...] }
//   t: tick (may fall between rows), v: 0..1 along the parameter's own scale, pin: 'start' | 'end' of the pattern it sits on.
//   kinds[i] is the segment from pts[i] to pts[i + 1]: 'c' a bezier with vertical handles (an S between the two values), 'l' a straight line.

export const RES = 8;            // baked samples per tick
const K = 0.42;                  // handle length of a bezier segment, as a fraction of its time span

export const newCurve = (target, at = 0, v = 0.5) => ({ target, on: true, pts: [{ t: at, v }], kinds: [] });

const clamp01 = x => Math.min(1, Math.max(0, x));

// The value of one segment at fraction u of its time, a bezier whose handles keep the value flat at both ends.
function segmentValue(a, b, kind, tt) {
  if (b.t <= a.t) return b.v;
  const x = (tt - a.t) / (b.t - a.t);
  if (kind === 'l') return a.v + (b.v - a.v) * x;
  // solve the bezier's time for x (its time handles are a third-ish of the span, so a few Newton steps do)
  const t1 = K, t2 = 1 - K;   // x(u) control points 0, K, 1-K, 1
  let u = x;
  for (let i = 0; i < 6; i++) {
    const m = 1 - u, xu = 3 * m * m * u * t1 + 3 * m * u * u * t2 + u * u * u, dx = 3 * m * m * t1 + 6 * m * u * (t2 - t1) + 3 * u * u * (1 - t2);
    if (Math.abs(dx) < 1e-6) break;
    u = clamp01(u - (xu - x) / dx);
  }
  const m = 1 - u;
  return a.v * (m * m * m + 3 * m * m * u) + b.v * (3 * m * u * u + u * u * u);   // y control points a.v, a.v, b.v, b.v
}

// The curve's value (0..1) at tick t: NaN before the first anchor, the last value held after the last one.
export function valueAt(curve, t) {
  const p = curve.pts;
  if (!p.length || t < p[0].t) return NaN;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let i = 0;
  while (p[i + 1].t <= t) i++;
  return segmentValue(p[i], p[i + 1], curve.kinds[i] ?? 'c', t);
}

// Fills `table` (Float32Array of length * RES + 1, shared with the audio thread) from the curve, in place.
export function bake(curve, table) {
  for (let i = 0; i < table.length; i++) table[i] = curve.on === false ? NaN : valueAt(curve, i / RES);
}

// The parameters of a lane that a curve can move: its parameter columns, plus the machine's output gain (Volume).
export function targetsOf(lane, registry) {
  const list = lane.columns.filter(c => c.kind === 'param' && c.slot !== undefined).map(c => ({
    id: `${c.node}.${c.param}`, label: c.long ?? c.label, slot: c.slot, min: c.min, max: c.max, log: c.log === true || (c.min > 0 && c.max / c.min >= 50), taper: c.node === 'out' && c.param === 'gain' ? 2 : 1,
  }));
  const gain = registry?.slots.get(`${lane.instrument}.out.gain`);
  if (gain !== undefined && !list.some(t => t.id === 'out.gain')) {
    const { min, max } = registry.meta[gain];
    list.unshift({ id: 'out.gain', label: 'Volume', slot: gain, min, max, log: false, taper: 2 });
  } else {
    const v = list.find(t => t.id === 'out.gain');
    if (v) v.label = 'Volume';
  }
  return list;
}

// The value on the parameter's own scale for a position x (0..1) along it.
export function scaled(target, x) {
  const e = clamp01(x) ** (target.taper ?? 1);
  return target.log ? target.min * (target.max / target.min) ** e : target.min + e * (target.max - target.min);
}

// For the audio thread: every working curve of a lane as { slot, min, max, log, taper, table }. The tables are shared
// memory, so an edit that only moves anchors is baked in place; `auto.key` names the shape, which changes with the set of
// curves and their targets, and then the lane is sent again.
export function buildAutomation(lane, registry, length) {
  const targets = registry ? targetsOf(lane, registry) : lane.targets ?? [], old = lane.auto, out = [];
  lane.targets = targets;
  for (const c of lane.curves ?? []) {
    const t = targets.find(x => x.id === c.target);
    if (!t) continue;
    const reuse = old?.find(a => a.id === c.target && a.table.length === length * RES + 1);
    const table = reuse?.table ?? new Float32Array(new SharedArrayBuffer((length * RES + 1) * 4));
    bake(c, table);
    out.push({ id: c.target, slot: t.slot, min: t.min, max: t.max, log: t.log, taper: t.taper, table });
  }
  lane.auto = out;
  return out;
}

// After an edit (or an undo): the tables are baked again from the curves. Returns true when the set of curves that run
// has changed, which is when the audio thread must be given the lane again.
export function rebake(lane, length) {
  const before = autoKey(lane.auto);
  buildAutomation(lane, null, length);
  return autoKey(lane.auto) !== before;
}

export const autoKey = auto => (auto ?? []).map(a => `${a.id}:${a.slot}`).join('|');

// ---- editing -------------------------------------------------------------------------------------------------------

// Puts an anchor at (t, v). Returns its index.
export function addPoint(curve, t, v, pin) {
  const p = curve.pts;
  let i = p.findIndex(q => q.t > t);
  if (i < 0) i = p.length;
  const at = p.findIndex(q => q.t === t);
  if (at >= 0) { p[at].v = v; if (pin) p[at].pin = pin; return at; }
  p.splice(i, 0, pin ? { t, v, pin } : { t, v });
  // the new anchor splits a segment: both halves take its kind
  if (p.length > 1) curve.kinds.splice(Math.max(0, i - 1), 0, curve.kinds[Math.max(0, i - 1)] ?? 'c');
  return i;
}

export function removePoint(curve, i) {
  const p = curve.pts;
  if (i < 0 || i >= p.length) return false;
  p.splice(i, 1);
  curve.kinds.splice(Math.min(i, Math.max(0, curve.kinds.length - 1)), 1);
  curve.kinds.length = Math.max(0, p.length - 1);
  return true;
}

// Moves anchor i to (t, v), keeping the order: it stops at its neighbours (one tick apart).
export function movePoint(curve, i, t, v) {
  const p = curve.pts, lo = i > 0 ? p[i - 1].t + 1 : 0, hi = i < p.length - 1 ? p[i + 1].t - 1 : Infinity;
  p[i].t = Math.min(hi, Math.max(lo, Math.round(t)));
  p[i].v = clamp01(v);
  if (p[i].pin) delete p[i].pin;   // dragging lets go of a pin; dropping on an edge snaps and pins again
  return p[i];
}

// Where an anchor dropped near tick t lands. Pattern edges first, then rows; { t, pin } with pin set when it is on an edge.
export function snapTick(lane, t, { edges = true, rows = 0, reach = 6, length = Infinity } = {}) {
  if (edges) {
    let best = null;
    for (const pl of lane.placements) {
      const pat = lane.patterns[pl.puid];
      if (!pat) continue;
      const end = pl.start + Math.min(pl.length, pat.length ?? pl.length);
      for (const [edge, at] of [['start', pl.start], ['end', end]]) if (at <= length && Math.abs(at - t) <= reach && (!best || Math.abs(at - t) < Math.abs(best.t - t) || (at === best.t && edge === 'start'))) best = { t: at, pin: edge };   // where an end meets a start, the start wins
    }
    if (best) return best;
  }
  if (rows > 0) return { t: Math.round(t / rows) * rows, pin: null };
  return { t: Math.round(t), pin: null };
}

// The pattern edges of a lane, as { t, edge, puid }.
export function edgesOf(lane) {
  const out = [];
  for (const pl of lane.placements) {
    const pat = lane.patterns[pl.puid];
    if (!pat) continue;
    out.push({ t: pl.start, edge: 'start', puid: pl.puid }, { t: pl.start + Math.min(pl.length, pat.length ?? pl.length), edge: 'end', puid: pl.puid });
  }
  return out;
}

// After an edit to the placements: pinned anchors follow the pattern edge they sat on. `before` is the placements as they
// were ({ puid, start, length } list, lengths already clipped to the pattern). A pin whose pattern is gone lets go and
// the anchor stays where it was. Returns how many pins were let go.
export function followPins(curves, before, after) {
  let freed = 0;
  const edge = (pl, e) => (e === 'start' ? pl.start : pl.start + pl.length);
  for (const c of curves ?? []) {
    for (const pt of c.pts) {
      if (!pt.pin) continue;
      const was = before.find(pl => edge(pl, pt.pin) === pt.t);
      if (!was) { delete pt.pin; freed++; continue; }
      // the same pattern, nearest to where it was (a pattern can be placed several times)
      const same = after.filter(pl => pl.puid === was.puid);
      if (!same.length) { delete pt.pin; freed++; continue; }
      const now = same.reduce((best, pl) => (Math.abs(pl.start - was.start) < Math.abs(best.start - was.start) ? pl : best));
      pt.t = edge(now, pt.pin);
    }
    // anchors that landed on one tick keep the later one; order is restored
    c.pts.sort((a, b) => a.t - b.t);
    for (let i = c.pts.length - 1; i > 0; i--) if (c.pts[i].t === c.pts[i - 1].t) { c.pts.splice(i - 1, 1); c.kinds.splice(Math.max(0, i - 1), 1); }
    c.kinds.length = Math.max(0, c.pts.length - 1);
    for (let i = 0; i < c.kinds.length; i++) c.kinds[i] ??= 'c';
  }
  return freed;
}

// Placements as the curve code sees them: lengths clipped to their pattern.
export const spans = lane => lane.placements.map(pl => ({ puid: pl.puid, start: pl.start, length: Math.min(pl.length, lane.patterns[pl.puid]?.length ?? pl.length) }));

// The SVG path of a curve between two ticks, in the units of `x(v)` and `y(t)`: M/C/L segments. The path runs down the
// page, so time is y and the value is x.
export function pathOf(curve, x, y) {
  const p = curve.pts;
  if (!p.length) return '';
  const f = n => Math.round(n * 10) / 10;
  let d = `M${f(x(p[0].v))} ${f(y(p[0].t))}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1], ya = y(a.t), yb = y(b.t);
    if ((curve.kinds[i] ?? 'c') === 'l') d += ` L${f(x(b.v))} ${f(yb)}`;
    else d += ` C${f(x(a.v))} ${f(ya + (yb - ya) * K)} ${f(x(b.v))} ${f(yb - (yb - ya) * K)} ${f(x(b.v))} ${f(yb)}`;
  }
  return d;
}

// The middle of segment i, for the tick box that shows on hover.
export function midOf(curve, i) {
  const a = curve.pts[i], b = curve.pts[i + 1];
  if (!b) return null;
  const t = (a.t + b.t) / 2;
  return { t, v: valueAt(curve, t) };
}

// Prunes anchors and pins to a song length (after the song is shortened).
export function clipCurves(curves, length) {
  for (const c of curves ?? []) {
    c.pts = c.pts.filter(p => p.t <= length);
    c.kinds.length = Math.max(0, c.pts.length - 1);
  }
}
