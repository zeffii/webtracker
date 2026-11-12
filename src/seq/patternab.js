// The A/B scratch copy behind the pattern window. B starts as a copy of a pattern (A) and can be changed freely without touching the
// song; it can be played on its own, set back to A, or kept (the owner writes it over A, or into a new pattern).
//
// Pure helpers (rows are arrays of cell tokens, one array per row, as the patterns hold them):
//   copyRows(rows)                       a deep enough copy
//   shiftToken(token, d)                 a note token d semitones away, or null (not a note, or out of range)
//   shiftCell(rows, t, ci, d)            rows with that one note moved
//   shiftRow(rows, t, columns, d)        rows with every note of row t moved (a chord moves as one)
//   setToken(rows, t, ci, token)         rows with one cell replaced
//   diffCells(a, b)                      the cells that differ: a Set of "t,ci"
//   noteEvents(rows, columns)            what each row does to the notes: [[{ on, col, midi, vel }...] per row]
//
// createAudition(...) plays rows in a loop through note on and off callbacks (a few tests of a chord, not sample-accurate).
import { noteSemitones, noteToken } from './cells.js';

export const copyRows = rows => rows.map(r => r.slice());

export function shiftToken(token, d) {
  const s = noteSemitones(token);
  if (s === null) return null;
  const to = s + d;
  if (to < 0 || to + 12 > 127) return null;
  return noteToken(to);
}

export function setToken(rows, t, ci, token) {
  if (!rows[t] || rows[t][ci] === token) return rows;
  const out = rows.slice();
  out[t] = rows[t].slice(); out[t][ci] = token;
  return out;
}

export function shiftCell(rows, t, ci, d) {
  const to = shiftToken(rows[t]?.[ci], d);
  return to === null ? rows : setToken(rows, t, ci, to);
}

export function shiftRow(rows, t, columns, d) {
  let out = rows;
  columns.forEach((c, ci) => { if (c.kind === 'note') out = shiftCell(out, t, ci, d); });
  return out;
}

export function diffCells(a, b) {
  const out = new Set();
  const n = Math.max(a.length, b.length);
  for (let t = 0; t < n; t++) {
    const ra = a[t] ?? [], rb = b[t] ?? [];
    for (let ci = 0; ci < Math.max(ra.length, rb.length); ci++) if (ra[ci] !== rb[ci]) out.add(`${t},${ci}`);
  }
  return out;
}

// A velocity column follows its note column (a 2-digit hex column labelled V...). Without one, or while it is blank, notes play
// at the last velocity set in that column (the first one at full).
const velocityColumn = (columns, ci) => {
  const v = columns[ci + 1];
  return v && v.token === '2hex' && (v.kind === 'vel' || /^v/i.test(`${v.label ?? ''}`)) ? ci + 1 : -1;
};

export function noteEvents(rows, columns) {
  const last = new Map();
  return rows.map(row => {
    const events = [];
    columns.forEach((c, ci) => {
      if (c.kind !== 'note') return;
      const token = row[ci], s = noteSemitones(token);
      if (s !== null) {
        const vc = velocityColumn(columns, ci), hex = vc >= 0 ? row[vc] : '..';
        if (/^[0-9a-f]{2}$/i.test(hex ?? '')) last.set(ci, parseInt(hex, 16) / 255);
        events.push({ on: true, col: ci, midi: s + 12, vel: last.get(ci) ?? 1 });
      } else if (token === '===' || token === '^^^') events.push({ on: false, col: ci });
    });
    return events;
  });
}

// Plays rows in a loop, a row per tick. voice = { on(midi, vel), off(midi), tickMs() }. Drive it with advance(now), from a timer:
// it plays every row that is due and returns the milliseconds until the next one. A new note in a column ends that column's
// last note first, and so does a note off. stop() ends everything that is sounding.
export function createAudition(voice) {
  let state = null;
  const release = col => { const m = state.held.get(col); if (m !== undefined) { voice.off(m); state.held.delete(col); } };
  return {
    get playing() { return !!state; },
    get row() { return state ? state.row : -1; },
    start(rows, columns, now, from = 0) {
      this.stop();
      state = { events: noteEvents(rows, columns), row: from - 1, next: now, held: new Map() };
    },
    // Swap the rows being played without a break (flipping between A and B keeps the position).
    swap(rows, columns) {
      if (!state) return;
      state.events = noteEvents(rows, columns);
      state.held.forEach((m, col) => { voice.off(m); state.held.delete(col); });
    },
    advance(now) {
      if (!state) return 0;
      while (now >= state.next) {
        state.row = (state.row + 1) % state.events.length;
        for (const e of state.events[state.row]) {
          release(e.col);
          if (e.on) { voice.on(e.midi, e.vel); state.held.set(e.col, e.midi); }
        }
        state.next += voice.tickMs();
      }
      return state.next - now;
    },
    stop() {
      if (!state) return;
      state.held.forEach(m => voice.off(m));
      state = null;
    },
  };
}
