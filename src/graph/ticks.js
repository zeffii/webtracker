// Song ticks on time and rate sliders. A parameter in ms or s is a time, and a few in Hz are rates (an LFO's speed, not a
// filter's frequency), so each can be read as a number of ticks at the song's tempo, and drawn with a faint line wherever a
// tick falls. A linear slider has a line at every tick. A log slider bunches the ticks at the short end, so it marks the
// halves of a tick and the powers of two of ticks instead. The beat (every ticks-per-beat) is marked stronger.
import { unitOf } from './units.js';

const RATE = new Set(['rate', 'lfoRate', 'vrate', 'pwmrate']);

// 'ms', 's' or 'hz' for a parameter that can be read as ticks, else null.
export function timeKind(type, name) {
  const u = unitOf(type, name);
  if (u === 'ms' || u === 's') return u;
  if (u === 'Hz' && RATE.has(name) && type !== 'crusher') return 'hz';
  return null;
}

const MS = { ms: 1, s: 1000 };
export const toTicks = (kind, value, tickMs) => (kind === 'hz' ? (value > 0 ? 1000 / value / tickMs : Infinity) : (value * MS[kind]) / tickMs);
export const fromTicks = (kind, ticks, tickMs) => (kind === 'hz' ? 1000 / (ticks * tickMs) : (ticks * tickMs) / MS[kind]);

// The lines for one slider: [{ pos, value, ticks, beat }] in slider order, no two closer than `gap` pixels.
// `toPos(value)` is the slider's own mapping (0 to 1); `log` says whether it is logarithmic.
export function tickMarks({ kind, min, max, log, toPos, tickMs, perBeat = 4, width = 200, gap = 4 }) {
  const out = [];
  const add = ticks => {
    const value = fromTicks(kind, ticks, tickMs);
    if (!(value >= min && value <= max)) return;
    out.push({ ticks, value, pos: toPos(value), beat: Number.isInteger(ticks) && ticks % perBeat === 0 });
  };
  if (!log && kind !== 'hz') {
    const hi = toTicks(kind, max, tickMs);
    for (let n = 1; n <= Math.min(hi, 4096); n++) add(n);
  } else {
    for (const f of [0.125, 0.25, 0.5]) add(f);
    for (let n = 1; n <= 4096; n *= 2) add(n);
    if (![1, 2, 4, 8, 16].includes(perBeat)) for (let n = perBeat; n <= 4096; n *= 2) add(n);
  }
  out.sort((a, b) => a.pos - b.pos);
  const keep = [];
  let last = -Infinity;
  for (const m of out) if ((m.pos - last) * width >= gap - 1e-6) { keep.push(m); last = m.pos; }
  return keep;
}

// The position a drag at `pos` snaps to, or null when no line is within `px` pixels.
export function snapTo(marks, pos, width, px = 4) {
  let best = null, d = px;
  for (const m of marks) { const e = Math.abs(m.pos - pos) * width; if (e < d) { d = e; best = m; } }
  return best;
}

// "3.02t": the value in ticks, short enough for a slider.
export function tickText(ticks) {
  if (!Number.isFinite(ticks)) return '';
  const r = Math.round(ticks * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(ticks < 10 ? 2 : 1).replace(/0$/, '')}t`;
}
