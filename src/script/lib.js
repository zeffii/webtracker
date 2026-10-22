// The script engine: runs a user's script against a copy of one pattern and reports what changed.
// It is plain functions with no DOM, so it runs inside a Worker (worker.js) in the browser and directly in the tests.
//
// A script sees `pat` (the pattern under the cursor), `sel` (the selected rows and columns, or the whole pattern), and a
// few helpers: tbin and voices (bit patterns that become notes), euclid, ramp and sine, scale, a seeded random, and
// log. Nothing it does touches the song until it has finished without an error: the result is a list of edits.
import { KINDS, encodeCell, noteToken } from '../seq/cells.js';

// ---- bit patterns ----
const REST = '.0-~_', HIT = 'xX1';
const clean = s => String(s).replace(/[\s|]/g, '');

// A bit string as steps: { hit, level?, chance? }. A string that holds digits 2-9 or letters a-f is read as levels
// (1-F, a loudness for each hit); otherwise 1 and x are hits, 0 and . are rests, and ? is a hit half of the time.
export function parseSteps(text) {
  const s = clean(text), levels = /[2-9a-f]/i.test(s);
  return [...s].map(c => {
    if (levels && /[1-9a-f]/i.test(c)) return { hit: true, level: parseInt(c, 16) };
    if (HIT.includes(c)) return { hit: true };
    if (REST.includes(c)) return { hit: false };
    if (c === '?') return { hit: true, chance: 0.5 };
    throw new Error(`"${c}" is not a step in "${s}" (use x . 1 0 ? or the levels 1-F)`);
  });
}
const asBits = steps => steps.map(s => (s.hit ? 'x' : '.')).join('');
const stepsOf = v => (typeof v === 'string' ? parseSteps(v) : parseSteps(String(v)));
export const bitsOf = (num, len) => {
  if (!Number.isInteger(num) || num < 0) throw new Error(`bitsOf needs a whole number, not ${num}`);
  if (!Number.isInteger(len) || len < 1 || len > 53) throw new Error('the length of a number pattern is 1 to 53 steps');
  let s = '';
  for (let i = len - 1; i >= 0; i--) s += Math.floor(num / 2 ** i) % 2 ? 'x' : '.';
  return s;
};
const mod = (n, m) => ((n % m) + m) % m;
export const rot = (v, n = 1) => { const b = asBits(stepsOf(v)); return b ? b.slice(mod(n, b.length)) + b.slice(0, mod(n, b.length)) : b; };
export const inv = v => [...asBits(stepsOf(v))].map(c => (c === 'x' ? '.' : 'x')).join('');
export const rev = v => [...asBits(stepsOf(v))].reverse().join('');
const combine = (a, b, f) => {
  const x = asBits(stepsOf(a)), y = asBits(stepsOf(b)), n = Math.max(x.length, y.length);
  return Array.from({ length: n }, (_, i) => (f(x[i % x.length] === 'x', y[i % y.length] === 'x') ? 'x' : '.')).join('');
};
export const both = (a, b) => combine(a, b, (p, q) => p && q);
export const either = (a, b) => combine(a, b, (p, q) => p || q);
export const xor = (a, b) => combine(a, b, (p, q) => p !== q);

// Evenly spread hits (Bjorklund): euclid(3, 8) is x..x..x.
export function euclid(k, n, rotate = 0) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 0) throw new Error('euclid(hits, steps): both whole numbers, steps at least 1');
  let bits;
  if (k === 0) bits = Array(n).fill(0);
  else if (k >= n) bits = Array(n).fill(1);
  else {
    let a = Array.from({ length: k }, () => [1]), b = Array.from({ length: n - k }, () => [0]);
    while (b.length > 1) {
      const m = Math.min(a.length, b.length);
      const merged = a.slice(0, m).map((x, i) => x.concat(b[i]));
      const rest = a.length > b.length ? a.slice(m) : b.slice(m);
      a = merged; b = rest;
    }
    bits = [...a, ...b].flat();
  }
  const s = bits.map(v => (v ? 'x' : '.')).join('');
  return rotate ? rot(s, rotate) : s;
}

// ---- notes ----
// A tracker note name from a name or a MIDI number (a written C-4 is MIDI 60).
const noteOf = v => {
  let t = typeof v === 'number' ? noteToken(Math.round(v) - 12) : String(v).trim();
  t = t.length === 3 ? t[0].toUpperCase() + t.slice(1) : t;
  encodeCell(t, 'note');
  return t;
};
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicminor: [0, 2, 3, 5, 7, 8, 11], melodicminor: [0, 2, 3, 5, 7, 9, 11], majpent: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], whole: [0, 2, 4, 6, 8, 10],
};
const ROOTS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// scale('minor', 'A', 2) is the notes A-2 B-2 C-3 ...; a count of more than the scale has carries on into the next octave.
export function scale(name = 'major', root = 'C', octave = 3, count) {
  const key = String(name).toLowerCase().replace(/[^a-z]/g, ''), steps = SCALES[key];
  if (!steps) throw new Error(`no scale "${name}" (${Object.keys(SCALES).join(', ')})`);
  const m = /^([A-Ga-g])([#b]?)$/.exec(String(root).trim());
  if (!m) throw new Error(`"${root}" is not a root note (C, F#, Bb...)`);
  const base = octave * 12 + ROOTS[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), n = count ?? steps.length;
  return Array.from({ length: n }, (_, i) => noteToken(base + Math.floor(i / steps.length) * 12 + steps[i % steps.length]));
}
export const scaleNames = () => Object.keys(SCALES);

class Voices { constructor(lists) { this.lists = lists; } }
// A voice is one column's notes, in order: strings are split at spaces, numbers are MIDI notes, a rest is "..." and a
// note off is "===".
const voiceList = v => {
  const out = [];
  const walk = x => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'number') out.push(noteOf(x));
    else for (const t of String(x).split(/\s+/).filter(Boolean)) out.push(noteOf(t));
  };
  walk(v);
  if (!out.length) throw new Error('a voice needs at least one note');
  return out;
};
// A chord is the notes of one hit, one per note column: "C-3 E-3 G-3", "C-3+E-3+G-3", or a list.
const chordOf = v => {
  const toks = Array.isArray(v) ? v.flatMap(x => (typeof x === 'number' ? [noteOf(x)] : String(x).split(/[\s+]+/).filter(Boolean).map(noteOf))) : typeof v === 'number' ? [noteOf(v)] : String(v).split(/[\s+]+/).filter(Boolean).map(noteOf);
  if (!toks.length) throw new Error('a chord needs at least one note');
  return toks;
};

// ---- the seeded random ----
function makeRandom(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return next;
}

// ---- columns ----
const findCol = (cols, ref) => {
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || !cols[ref]) throw new Error(`there is no column ${ref} (this lane has ${cols.length})`);
    return ref;
  }
  const k = String(ref).toLowerCase();
  let i = cols.findIndex(c => [c.label, c.key, c.param, c.base, c.node && c.param ? `${c.node}.${c.param}` : null].some(v => v && String(v).toLowerCase() === k));
  if (i < 0 && k === 'note') i = cols.findIndex(c => c.token === 'note');
  if (i < 0 && k === 'vel') i = cols.findIndex(c => c.kind === 'vel');
  if (i < 0) throw new Error(`no column "${ref}" here (the columns are ${cols.map(c => c.label).join(', ')})`);
  return i;
};
const hexWidth = token => KINDS[token].width;

// What a script hands over as a cell, as the text the tracker stores: a name or text as it is, a number as a MIDI note
// in a note column or a hex value elsewhere, null or '' as an empty cell.
function cellToken(col, v) {
  if (v === null || v === undefined || v === '') return KINDS[col.token].blank;
  if (typeof v === 'number') {
    if (col.token === 'note') return noteOf(v);
    if (col.token === 'cmd') throw new Error('a command cell is written as six hex digits, such as "010040"');
    const w = hexWidth(col.token);
    return Math.max(0, Math.min(16 ** w - 1, Math.round(v))).toString(16).toUpperCase().padStart(w, '0');
  }
  const t = String(v).trim().toUpperCase();
  const fixed = col.token === 'note' && t.length === 3 ? t[0] + t.slice(1) : t;
  encodeCell(fixed, col.token);
  return fixed;
}

const FORBIDDEN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage', 'self', 'indexedDB', 'caches', 'navigator', 'Worker', 'SharedWorker', 'BroadcastChannel'];
const fmt = v => (typeof v === 'string' ? v : v === undefined ? 'undefined' : (() => { try { return typeof v === 'function' ? `[function ${v.name}]` : JSON.stringify(v) ?? String(v); } catch { return String(v); } })());

// request: { code, expr?, pattern: { name, lane, instrument, columns, rows }, selection?: { r0, r1, c0, c1 }, cursor?, seed? }
// result: { ok, edits: [{ row, col, token }], logs, seed, echo, value } or { ok: false, error: { message, line }, logs }
export function execute(req) {
  const { code, expr = false, pattern, selection = null, cursor = { row: 0, col: 0 } } = req;
  const logs = [];
  const seed = Number.isInteger(req.seed) ? req.seed : (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const columns = pattern.columns, nrows = pattern.rows.length;
  const rows = pattern.rows.map(r => r.slice());
  const written = new Set();
  const sel = selection ? { ...selection } : { r0: 0, r1: nrows - 1, c0: 0, c1: columns.length - 1 };
  sel.r0 = Math.max(0, sel.r0); sel.r1 = Math.min(nrows - 1, sel.r1);
  sel.rows = sel.r1 - sel.r0 + 1; sel.cols = sel.c1 - sel.c0 + 1; sel.any = !!selection;
  let seedNow = seed, rand = makeRandom(seedNow), stepDefault = 1, scratchNext = 0;   // scratch: each tbin goes to the next note column

  const put = (row, col, token) => { rows[row][col] = token; written.add(`${row}:${col}`); };
  const checkRow = row => {
    if (!Number.isInteger(row) || row < 0 || row >= nrows) throw new Error(`row ${row} is outside the pattern (0 to ${nrows - 1})`);
    return row;
  };
  const noteCols = columns.flatMap((c, i) => (c.token === 'note' ? [i] : []));

  const colApi = index => {
    const c = columns[index];
    const range = o => ({ from: Math.max(0, o?.from ?? sel.r0), to: Math.min(nrows - 1, o?.to ?? sel.r1), step: Math.max(1, o?.step ?? 1) });
    return {
      index, label: c.label, kind: c.kind,
      get: row => rows[checkRow(row)][index],
      set: (row, v) => { put(checkRow(row), index, cellToken(c, v)); },
      // fill(fn | list | "text", { from, to, step }): a function gets (i, count) and gives the value (undefined leaves the cell), a list or text is cycled
      fill(src, o) {
        const { from, to, step } = range(o), n = Math.floor((to - from) / step) + 1;
        const list = typeof src === 'function' ? null : Array.isArray(src) ? src : String(src).split(/\s+/).filter(Boolean);
        if (list && !list.length) throw new Error('fill needs something to fill with');
        for (let i = 0; i < n; i++) {
          const v = list ? list[i % list.length] : src(i, n);
          if (v !== undefined) put(from + i * step, index, cellToken(c, v));
        }
      },
      clear(o) { const { from, to, step } = range(o); for (let r = from; r <= to; r += step) put(r, index, KINDS[c.token].blank); },
    };
  };
  const pat = {
    name: pattern.name, lane: pattern.lane, instrument: pattern.instrument, length: nrows,
    columns: columns.map(c => c.label),
    get: (row, col) => rows[checkRow(row)][findCol(columns, col)],
    set: (row, col, v) => { const i = findCol(columns, col); put(checkRow(row), i, cellToken(columns[i], v)); },
    col: ref => colApi(findCol(columns, ref)),
    clear() { for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) put(r, c, KINDS[columns[c].token].blank); },
  };

  const tbin = (...args) => {
    let first = args.shift();
    if (typeof first === 'number') { const len = args.shift(); first = bitsOf(first, len); }
    let notes, o = {};
    for (const a of args) { if (a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Voices)) o = a; else notes = a; }
    const steps = stepsOf(first);
    if (!steps.length) throw new Error('tbin needs at least one step');
    const step = Math.max(1, Math.round(o.step ?? stepDefault)), at = o.at ?? sel.r0, to = Math.min(nrows - 1, o.to ?? sel.r1), loop = o.loop ?? true;
    // the note column the first note goes into: the selected one, or the first of the lane
    let start = req.scratch ? noteCols[scratchNext] : noteCols.includes(sel.c0) ? sel.c0 : columns[sel.c0]?.kind === 'vel' && noteCols.includes(sel.c0 - 1) ? sel.c0 - 1 : noteCols[0];
    if (start === undefined) throw new Error(req.scratch ? 'the scratch pattern has no free column left (8 at most)' : 'this lane has no note column');
    const slot = noteCols.indexOf(start);
    let voices = null, chords = null;
    if (notes instanceof Voices) voices = notes.lists;
    else chords = (Array.isArray(notes) ? notes : [notes ?? 'C-4']).map(chordOf);
    const width = voices ? voices.length : Math.max(...chords.map(c => c.length));
    if (slot + width > noteCols.length) throw new Error(`${width} note columns are needed from ${columns[start].label}, and the lane has ${noteCols.length - slot}`);
    const used = Array.from({ length: width }, (_, k) => noteCols[slot + k]);
    if (req.scratch) scratchNext += width;
    const velOf = i => (columns[i + 1]?.kind === 'vel' ? i + 1 : -1);
    if (o.clear) for (let r = at; r <= to; r++) for (const i of used) { put(r, i, KINDS.note.blank); if (velOf(i) >= 0) put(r, velOf(i), KINDS['2hex'].blank); }
    const vels = o.vel === undefined ? null : [].concat(o.vel);
    let hits = 0, designed = 0;
    for (let i = 0; ; i++) {
      if (!loop && i >= steps.length) break;
      const row = at + i * step;
      if (row > to) break;
      const s = steps[i % steps.length];
      const rest = () => { if (o.keep) return; for (const k of used) { put(row, k, KINDS.note.blank); if (velOf(k) >= 0) put(row, velOf(k), KINDS['2hex'].blank); } };   // a '.' empties the cell, unless keep: true
      if (!s.hit) { rest(); continue; }
      const n = designed++;
      if ((s.chance !== undefined && rand() >= s.chance) || (o.prob !== undefined && rand() >= o.prob)) { rest(); continue; }
      const toks = voices ? voices.map(l => l[n % l.length]) : chords[n % chords.length];
      toks.forEach((tok, k) => {
        if (tok === '...') return;
        put(row, used[k], tok);
        const vc = velOf(used[k]);
        if (vc < 0 || tok === '===') return;
        const level = s.level !== undefined ? s.level * 17 : vels ? vels[n % vels.length] : undefined;
        if (level !== undefined) put(row, vc, cellToken(columns[vc], typeof level === 'string' ? level.toUpperCase().padStart(2, '0') : level));
      });
      hits++;
    }
    return hits;
  };

  // scatter({ samples, hits | density, note, vel, offset, retrig, cmd, cmdChance, step, at, to, clear }): puts hits at random rows of the
  // selection. Each option is a value, a list (one is picked each time), { min, max } (a whole number in between) or a function.
  // samples go in the sampler's Smp column, offset and retrig in Off and Rtg (numbers 0 to 65535), cmd is a six-digit command cell
  // or a list of them (cmdChance of the hits get one). It returns the number of hits.
  const scatter = (o = {}) => {
    const at = o.at ?? sel.r0, to = Math.min(nrows - 1, o.to ?? sel.r1), step = Math.max(1, Math.round(o.step ?? stepDefault));
    const slots = [];
    for (let r = at; r <= to; r += step) slots.push(r);
    const hits = o.hits === undefined ? Math.round(slots.length * (o.density ?? 0.5)) : Math.min(Math.round(o.hits), slots.length);
    const chosen = [...slots];
    for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
    chosen.length = Math.max(0, hits); chosen.sort((a, b) => a - b);
    const maybe = (...refs) => { for (const r of refs) { try { return findCol(columns, r); } catch { /* next */ } } return -1; };
    const val = v => (typeof v === 'function' ? v() : Array.isArray(v) ? v[Math.floor(rand() * v.length)] : v && typeof v === 'object' ? v.min + Math.floor(rand() * (v.max - v.min + 1)) : v);
    const need = (name, i) => { if (i < 0) throw new Error(`scatter: this lane has no ${name} column`); return i; };
    const cNote = noteCols.includes(sel.c0) ? sel.c0 : noteCols[0];
    if (cNote === undefined) throw new Error('this lane has no note column');
    const cVel = columns[cNote + 1]?.kind === 'vel' ? cNote + 1 : -1;
    const cSmp = o.samples === undefined ? -1 : need('Smp (sample)', maybe('sampler.sample', 'Smp'));
    const cOff = o.offset === undefined ? -1 : need('Off (offset)', maybe('sampler.offset', 'Off'));
    const cRtg = o.retrig === undefined ? -1 : need('Rtg (retrigger)', maybe('sampler.retrig', 'Rtg'));
    const cCmd = o.cmd === undefined ? -1 : need('Cmd', columns.findIndex(c => c.token === 'cmd'));
    if (o.clear) for (const c of [cNote, cVel, cSmp, cOff, cRtg, cCmd]) if (c >= 0) for (let r = at; r <= to; r++) put(r, c, KINDS[columns[c].token].blank);
    for (const r of chosen) {
      put(r, cNote, cellToken(columns[cNote], val(o.note ?? 'C-4')));
      if (cVel >= 0 && o.vel !== undefined) put(r, cVel, cellToken(columns[cVel], val(o.vel)));
      if (cSmp >= 0) put(r, cSmp, cellToken(columns[cSmp], val(o.samples)));
      if (cOff >= 0) put(r, cOff, cellToken(columns[cOff], val(o.offset)));
      if (cRtg >= 0) put(r, cRtg, cellToken(columns[cRtg], val(o.retrig)));
      if (cCmd >= 0 && rand() < (o.cmdChance ?? 0.5)) put(r, cCmd, cellToken(columns[cCmd], val(o.cmd)));
    }
    return chosen.length;
  };

  const api = {
    pat, sel, cursor: { ...cursor }, scatter,
    tbin, voices: (...lists) => new Voices(lists.map(voiceList)),
    euclid, bitsOf, rot, inv, rev, both, either, xor,
    ramp: (a, b) => (i, n) => Math.round(n > 1 ? a + ((b - a) * i) / (n - 1) : a),
    sine: (lo, hi, cycles = 1) => (i, n) => Math.round(lo + ((hi - lo) * (1 + Math.sin((2 * Math.PI * cycles * i) / Math.max(n, 1)))) / 2),
    scale, note: noteOf, midi: v => { const t = noteOf(v); return (Number(t[2]) + 1) * 12 + ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'].indexOf(t.slice(0, 2)); },
    step: n => { const was = stepDefault; if (n !== undefined) { if (!Number.isInteger(n) || n < 1) throw new Error('step(n): a whole number of rows, 1 or more'); stepDefault = n; } return was; },
    seed: n => { if (n !== undefined) { seedNow = n >>> 0; rand = makeRandom(seedNow); } return seedNow; },
    rnd: (a, b) => (a === undefined ? rand() : b === undefined ? Math.floor(rand() * a) : a + Math.floor(rand() * (b - a + 1))),
    pick: list => list[Math.floor(rand() * list.length)],
    shuffle: list => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; },
    chance: p => rand() < p,
    log: (...a) => { if (logs.length < 200) logs.push(a.map(fmt).join(' ')); },
  };
  const names = [...Object.keys(api), 'console', ...FORBIDDEN];
  const values = [...Object.values(api), { log: api.log, warn: api.log, error: api.log }, ...FORBIDDEN.map(() => undefined)];

  try {
    let fn, isExpr = false;
    if (expr) { try { fn = new Function(...names, `"use strict";\nreturn (\n${code}\n);`); isExpr = true; } catch { /* statements, then */ } }
    fn ??= new Function(...names, `"use strict";\n${code}\n//# sourceURL=wt-script`);
    const value = fn(...values);
    const edits = [];
    for (const key of written) {
      const [row, col] = key.split(':').map(Number);
      if (rows[row][col] !== pattern.rows[row][col]) edits.push({ row, col, token: rows[row][col] });
    }
    edits.sort((a, b) => a.row - b.row || a.col - b.col);
    return { ok: true, edits, logs, seed: seedNow, echo: echoOf(edits, rows, columns), value: value === undefined || !isExpr ? undefined : fmt(value) };
  } catch (err) {
    return { ok: false, error: { message: String(err?.message ?? err), line: lineOf(err) }, logs };
  }
}

// For each note column that changed: the rows as x (a note), = (a note off) and . (nothing), in groups of four.
function echoOf(edits, rows, columns) {
  const out = [];
  for (const c of [...new Set(edits.map(e => e.col))]) {
    if (columns[c].token !== 'note') continue;
    const mine = edits.filter(e => e.col === c), lo = mine[0].row, hi = mine[mine.length - 1].row;
    if (hi - lo > 127) continue;
    let s = '';
    for (let r = lo; r <= hi; r++) s += (r > lo && (r - lo) % 4 === 0 ? ' ' : '') + (rows[r][c] === '...' ? '.' : rows[r][c] === '===' ? '=' : 'x');
    out.push(`${columns[c].label} ${lo}-${hi}: ${s}`);
  }
  return out;
}

// The line of the user's code an error came from, found in the stack and corrected for the wrapper lines of `new Function`.
let lineOffset = null;
const rawLine = err => {
  for (const l of String(err?.stack ?? '').split('\n')) {
    const m = /(?:wt-script|<anonymous>|Function):(\d+):\d+/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
};
function lineOf(err) {
  if (lineOffset === null) {
    try { new Function('"use strict";\nthrow new Error("probe")\n//# sourceURL=wt-script')(); } catch (e) { const r = rawLine(e); lineOffset = r === null ? 0 : r - 1; }
  }
  const r = rawLine(err);
  return r === null ? null : Math.max(1, r - (lineOffset ?? 0));
}
