// The piano roll of a sample: an annotation layer over the waveform / spectrogram for transcribing by ear and by eye.
// Pure functions on plain data, no drawing and no state of their own. A roll is stored on the sample as `sample.roll`:
//
//   start, end   the frames the virtual pattern spans (the S and E markers)
//   rows         how many rows that span is cut into (the grid drawn in the time domain)
//   a4, cents    the master tuning: A4 in Hz and a fine offset in cents, for recordings that are not at 440
//   lo, hi       the lowest and highest MIDI note the pitch axis shows
//   notes        [{ from, to, midi }]: frames, so changing the row count keeps the notes where they were heard
//
// Every change returns a new roll (the sample's undo history keeps references to the old one).

export const MIN_ROWS = 1, MAX_ROWS = 256;
export const LOWEST = 12, HIGHEST = 120;   // C0 to C9: what lo and hi can be set to

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const byTime = (a, b) => a.from - b.from || a.midi - b.midi;

export function defaultRoll(frames) {
  return { start: 0, end: Math.max(1, frames), rows: 16, a4: 440, cents: 0, lo: 36, hi: 96, notes: [] };
}

// A roll with every field in range (an old or hand-edited file may hold anything).
export function cleanRoll(roll, frames) {
  const d = defaultRoll(frames), r = { ...d, ...(roll ?? {}) };
  const start = clamp(Math.round(r.start), 0, Math.max(0, frames - 1)), end = clamp(Math.round(r.end), start + 1, Math.max(start + 1, frames));
  const lo = clamp(Math.round(r.lo), LOWEST, HIGHEST - 12), hi = clamp(Math.round(r.hi), lo + 12, HIGHEST);
  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .filter(n => Number.isFinite(n?.from) && Number.isFinite(n?.to) && Number.isFinite(n?.midi))
    .map(n => ({ from: Math.max(0, Math.round(n.from)), to: Math.max(Math.round(n.from) + 1, Math.round(n.to)), midi: clamp(Math.round(n.midi), 0, 127) }))
    .sort(byTime);
  return {
    start, end, lo, hi, notes,
    rows: clamp(Math.round(r.rows) || d.rows, MIN_ROWS, MAX_ROWS),
    a4: clamp(Number(r.a4) || 440, 380, 500),
    cents: clamp(Number(r.cents) || 0, -100, 100),
  };
}

export const withFields = (roll, fields, frames) => cleanRoll({ ...roll, ...fields }, frames);

// ---- tuning ----

// The frequency of a MIDI note under the roll's tuning (A4 = MIDI 69).
export const hzOf = (roll, midi) => roll.a4 * 2 ** (roll.cents / 1200) * 2 ** ((midi - 69) / 12);
// The MIDI note (fractional) a frequency is under the roll's tuning.
export const midiOf = (roll, hz) => 69 + 12 * Math.log2(hz / (roll.a4 * 2 ** (roll.cents / 1200)));

// ---- the time grid ----

export const rowLength = roll => (roll.end - roll.start) / roll.rows;
export const rowFrame = (roll, row) => Math.round(roll.start + row * rowLength(roll));
// The row a frame falls in, fractional (0 at the S marker, `rows` at the E marker).
export const rowAt = (roll, frame) => (frame - roll.start) / rowLength(roll);
// A frame moved to the nearest row line.
export const snapFrame = (roll, frame) => rowFrame(roll, Math.round(rowAt(roll, frame)));

// ---- notes ----

const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export const noteLabel = midi => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function addNote(roll, note) {
  const n = { from: Math.round(note.from), to: Math.max(Math.round(note.from) + 1, Math.round(note.to)), midi: clamp(Math.round(note.midi), 0, 127) };
  return { ...roll, notes: [...roll.notes, n].sort(byTime) };
}
export function replaceNote(roll, index, note) {
  const notes = roll.notes.slice();
  notes[index] = { from: Math.round(note.from), to: Math.max(Math.round(note.from) + 1, Math.round(note.to)), midi: clamp(Math.round(note.midi), 0, 127) };
  return { ...roll, notes: notes.sort(byTime) };
}
export const removeNote = (roll, index) => ({ ...roll, notes: roll.notes.filter((_, i) => i !== index) });

// The notes sounding at a frame, sorted ascending by pitch.
export const notesAtFrame = (roll, frame) => roll.notes.filter(n => n.from <= frame && n.to > frame).sort((a, b) => a.midi - b.midi);

// The notes sounding in a row (the chord heard at that virtual tick), sorted ascending by pitch: any note that overlaps the row.
export function notesAtRow(roll, row) {
  const a = rowFrame(roll, row), b = rowFrame(roll, row + 1);
  return roll.notes.filter(n => n.from < b && n.to > a).sort((x, y) => x.midi - y.midi);
}

// The note at a frame and pitch (the topmost when they overlap), as its index, or -1.
export function noteAt(roll, frame, midi) {
  for (let i = roll.notes.length - 1; i >= 0; i--) {
    const n = roll.notes[i];
    if (n.midi === midi && n.from <= frame && n.to > frame) return i;
  }
  return -1;
}

// What the overtones of the sounding notes say about a pitch at a frame: the closest harmonic (2nd to 8th) of a note
// sounding there that lands within `cents` of it, as { note, harmonic, off } (off in cents), or null. A note you are
// about to add that this finds may only be an overtone stacked on a lower note.
export function overtoneOf(roll, frame, midi, cents = 35, top = 8) {
  let best = null;
  for (const n of roll.notes) {
    if (!(n.from <= frame && n.to > frame) || n.midi >= midi) continue;
    for (let h = 2; h <= top; h++) {
      const off = (n.midi + 12 * Math.log2(h) - midi) * 100;
      if (Math.abs(off) <= cents && (!best || Math.abs(off) < Math.abs(best.off))) best = { note: n, harmonic: h, off };
    }
  }
  return best;
}

// ---- writing into a pattern ----

// Cells for a new pattern of `roll.rows` rows. Each note starts on the row nearest its start and ends on the row nearest its end
// (at least one row later). On every row, the notes starting there are put into free note columns in ascending order of pitch,
// lowest in the first free column; a note still held keeps its column. A column whose note ends gets an off ('===') unless a
// new note takes it on that row. Notes that start past the E marker, or that find no free column, are left out.
//   cols: how many note columns the lane has; noteToken(semitones): the cell text for a note (C-4 is 48, as in chordscan.js)
// Returns { rows, items: [{ tick, col, token }], dropped }.
export function rollToPattern(roll, { cols, noteToken }) {
  const rows = roll.rows, items = [];
  const timed = roll.notes
    .map(n => { const a = Math.max(0, Math.round(rowAt(roll, n.from))); return { midi: n.midi, a, b: Math.max(a + 1, Math.round(rowAt(roll, n.to))) }; })
    .filter(n => n.a < rows);
  let dropped = roll.notes.length - timed.length;
  const busy = new Array(cols).fill(null);   // the note each column holds now: { midi, b }
  for (let r = 0; r < rows; r++) {
    const freed = new Set();
    busy.forEach((n, c) => { if (n && n.b <= r) { busy[c] = null; freed.add(c); } });
    const starting = timed.filter(n => n.a === r).sort((x, y) => x.midi - y.midi);
    for (const n of starting) {
      const c = busy.findIndex(x => x === null);
      if (c < 0) { dropped++; continue; }
      busy[c] = n;
      freed.delete(c);
      items.push({ tick: r, col: c, token: noteToken(n.midi - 12) });
    }
    for (const c of freed) items.push({ tick: r, col: c, token: '===' });
  }
  items.sort((x, y) => x.tick - y.tick || x.col - y.col);
  return { rows, items, dropped };
}

// The name of the next transcribed pattern in a lane: '<index in hex> transcribe <n>', n one more than the highest the lane has.
export function transcribeName(index, existingNames) {
  const n = 1 + existingNames.reduce((top, s) => Math.max(top, Number(/ transcribe (\d+)$/.exec(s ?? '')?.[1] ?? 0)), 0);
  return `${index.toString(16).toUpperCase().padStart(2, '0')} transcribe ${n}`;
}
