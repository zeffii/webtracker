import { SAMPLE_KEYS, usersOfSample } from './ops.js';

// Destructive sample editing: each tool changes a range of a sample (or all of it) and keeps its loop
// points sensible. A range is { from, to } in frames, or null for the whole sample. The tools take and
// change the sample object { rate, data, right?, loopStart?, ... }; applyEdit() wraps them with undo.

const channels = s => (s.right ? [s.data, s.right] : [s.data]);
const clampRange = (s, range) => {
  const n = s.data.length;
  const from = Math.max(0, Math.min(n, Math.floor(range?.from ?? 0))), to = Math.max(0, Math.min(n, Math.floor(range?.to ?? n)));
  if (to - from < 1) throw new Error('Nothing to edit: the range is empty.');
  return { from, to };
};

const LOOPS = [['loopStart', 'loopEnd', 'loopOn', 'loopXfade'], ['susStart', 'susEnd', 'susOn', 'susXfade']];
const dropLoop = (s, keys) => { for (const k of keys) delete s[k]; };

// Moves the loops after the audio changes length: map(point) says where an old frame lands. A loop that
// is left shorter than two frames is removed.
function remapLoops(s, map) {
  for (const keys of LOOPS) {
    const [sk, ek] = keys;
    if (!(s[ek] > 0)) continue;
    const a = map(s[sk]), b = map(s[ek]);
    if (b - a < 2 || b > s.data.length) dropLoop(s, keys); else { s[sk] = a; s[ek] = b; }
  }
}

export const TOOLS = {
  // keeps only the range (trim); with no selection it keeps the loop region. A loop survives if it was inside.
  crop(s, range) {
    if (!range) {
      if (!(s.loopEnd > 0)) throw new Error('Select the part to keep first (or set a loop).');
      range = { from: s.loopStart, to: s.loopEnd };
    }
    const { from, to } = clampRange(s, range);
    for (const keys of LOOPS) if (s[keys[1]] > 0 && !(s[keys[0]] >= from && s[keys[1]] <= to)) dropLoop(s, keys);
    s.data = s.data.slice(from, to);
    if (s.right) s.right = s.right.slice(from, to);
    remapLoops(s, p => p - from);
  },
  // removes the range
  cut(s, range) {
    const { from, to } = clampRange(s, range);
    if (to - from >= s.data.length) throw new Error('That would remove the whole sample.');
    const keep = a => { const out = new Float32Array(a.length - (to - from)); out.set(a.subarray(0, from)); out.set(a.subarray(to), from); return out; };
    s.data = keep(s.data);
    if (s.right) s.right = keep(s.right);
    remapLoops(s, p => (p <= from ? p : p >= to ? p - (to - from) : from));
  },
  silence(s, range) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) c.fill(0, from, to);
  },
  reverse(s, range) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) c.subarray(from, to).reverse();
  },
  // scales the range so its loudest frame (in either channel) reaches full scale
  normalise(s, range) {
    const { from, to } = clampRange(s, range);
    let peak = 0;
    for (const c of channels(s)) for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(c[i]));
    if (peak === 0) throw new Error('The range is silent.');
    for (const c of channels(s)) for (let i = from; i < to; i++) c[i] /= peak;
  },
  gain(s, range, factor) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) for (let i = from; i < to; i++) c[i] *= factor;
  },
  fadeIn(s, range) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) for (let i = from; i < to; i++) c[i] *= (i - from) / (to - from);
  },
  fadeOut(s, range) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) for (let i = from; i < to; i++) c[i] *= 1 - (i - from) / (to - from);
  },
  // takes the average (the DC offset) out of the range
  removeDc(s, range) {
    const { from, to } = clampRange(s, range);
    for (const c of channels(s)) {
      let sum = 0;
      for (let i = from; i < to; i++) sum += c[i];
      const mean = sum / (to - from);
      for (let i = from; i < to; i++) c[i] -= mean;
    }
  },
  // writes each loop's crossfade into the audio, the way the sampler plays it live, and clears the setting
  bakeCrossfade(s) {
    let baked = 0;
    for (const [sk, ek, ok, xk] of LOOPS) {
      const ls = s[sk], le = s[ek];
      const xf = le > 0 ? Math.max(0, Math.min(Math.floor(s[xk] ?? 0), ls, le - ls)) : 0;
      if (!xf) continue;
      const span = le - ls;
      for (const c of channels(s)) {
        const orig = c.slice();
        for (let i = le - xf; i < le; i++) {
          const t = (i - (le - xf)) / xf;
          c[i] = orig[i] * Math.cos(t * Math.PI / 2) + orig[i - span] * Math.sin(t * Math.PI / 2);
        }
      }
      delete s[xk];
      baked++;
    }
    if (!baked) throw new Error('No loop has a crossfade to bake.');
  },
};

// ---- undo ----
const snapshot = s => ({
  data: s.data.slice(), right: s.right?.slice(),
  props: Object.fromEntries(SAMPLE_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]])),
});
const restore = (s, snap) => {
  s.data = snap.data.slice();
  if (snap.right) s.right = snap.right.slice(); else delete s.right;
  for (const k of SAMPLE_KEYS) delete s[k];
  Object.assign(s, snap.props);
};

// Undo and redo stacks per sample, in memory only.
export function createHistory(limit = 20) {
  const stacks = new Map();
  const of = id => { if (!stacks.has(id)) stacks.set(id, { undo: [], redo: [] }); return stacks.get(id); };
  return {
    // runs fn(sample) with a snapshot kept for undo; a failing edit leaves nothing behind
    record(project, id, fn) {
      const h = of(id), snap = snapshot(project.samples[id]);
      fn(project.samples[id]);
      h.undo.push(snap);
      if (h.undo.length > limit) h.undo.shift();
      h.redo.length = 0;
    },
    undo(project, id) {
      const h = of(id);
      if (!h.undo.length) throw new Error('Nothing to undo.');
      h.redo.push(snapshot(project.samples[id]));
      restore(project.samples[id], h.undo.pop());
    },
    redo(project, id) {
      const h = of(id);
      if (!h.redo.length) throw new Error('Nothing to redo.');
      h.undo.push(snapshot(project.samples[id]));
      restore(project.samples[id], h.redo.pop());
    },
    rename(from, to) { if (stacks.has(from)) { stacks.set(to, stacks.get(from)); stacks.delete(from); } },
    drop(id) { stacks.delete(id); },
    clear() { stacks.clear(); },
    depth: id => of(id).undo.length,
  };
}

// Runs a tool on a sample with undo; a failed tool leaves the sample untouched. Returns the instruments to update.
export function applyEdit(project, id, history, tool, range, ...args) {
  if (!TOOLS[tool]) throw new Error(`Unknown edit: ${tool}`);
  const s = project.samples[id];
  // work on a copy, so a tool that throws halfway cannot leave a half-edited sample
  const trial = { ...s, data: s.data.slice(), right: s.right?.slice() };
  TOOLS[tool](trial, range, ...args);
  history.record(project, id, sample => { TOOLS[tool](sample, range, ...args); });
  return usersOfSample(project, id);
}

export const undoEdit = (project, id, history) => { history.undo(project, id); return usersOfSample(project, id); };
export const redoEdit = (project, id, history) => { history.redo(project, id); return usersOfSample(project, id); };
