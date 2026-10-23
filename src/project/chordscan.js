// Chord and note transcription from a recording (a piano playing chords, say): the sample is cut into segments, and in each one
// the notes are found from the spectrum. Pure functions on the sample data, no state.
//   1. segments: at every onset (a new chord or note), or on a grid of beats at the recording's tempo
//   2. for each segment, the spectrum of its steady part (the first 40 ms, where the hammers knock, is skipped)
//   3. notes by harmonic salience: each candidate note is scored by the strength of its first six partials; the best is taken, its
//      partials are weakened so they are not found again as notes of their own, and the search goes on until what is left is weak
//   4. the chord's name from the notes, with the same naming the chord palette uses
import { fft } from './spectrogram.js';
import { detectOnsets } from './onsets.js';
import { detect, PC } from '../seq/chords.js';

const LOW = 36, HIGH = 96;   // MIDI C2 to C7: the notes looked for
const HARMONICS = 6;
const midiHz = n => 440 * 2 ** ((n - 69) / 12);

// The notes sounding in x (mono samples) from frame `from` for `len` frames: [{ midi, strength 0..1 }], loudest first.
export function notesIn(x, rate, from, len, { maxNotes = 5, threshold = 0.35 } = {}) {
  const size = len > 16384 ? 32768 : 16384;
  const n = Math.min(len, size);
  if (n < 2048) return [];
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  fft(re, im);
  const half = size / 2, mag = new Float64Array(half), hz = rate / size;
  for (let k = 1; k < half; k++) mag[k] = Math.sqrt(Math.hypot(re[k], im[k]));   // compressed: a quiet partial still counts
  const orig = Float64Array.from(mag);
  // the strongest bin within a quarter tone either side of f
  const near = (f, m = mag) => {
    const lo = Math.max(1, Math.floor(f * 2 ** (-0.5 / 12) / hz)), hi = Math.min(half - 1, Math.ceil(f * 2 ** (0.5 / 12) / hz));
    let best = 0, at = lo;
    for (let k = lo; k <= hi; k++) if (m[k] > best) { best = m[k]; at = k; }
    return [best, at];
  };
  const score = midi => {
    const f = midiHz(midi);
    let s = 0, first = 0, count = 0;
    for (let h = 1; h <= HARMONICS; h++) {
      if (f * h > rate * 0.45) break;
      const [m] = near(f * h);
      if (h === 1) first = m;
      s += m / Math.sqrt(h);
      count++;
    }
    return { s, first, count };
  };
  const found = [];
  let top = 0;
  for (let round = 0; round < maxNotes; round++) {
    let best = null;
    for (let midi = LOW; midi <= HIGH; midi++) {
      const { s, first } = score(midi);
      if (!best || s > best.s) best = { midi, s, first };
    }
    if (!best || best.s <= 0) break;
    if (round === 0) top = best.s;
    else if (best.s < top * threshold) break;
    // an octave error: the note one octave down has the same partials with the first one missing, so a strong second partial and a
    // weak first is the lower note's own second; keep the better supported of the two
    const lower = best.midi - 12;
    if (lower >= LOW) {
      const a = score(lower);
      if (a.s > best.s * 0.8 && a.first > best.first * 0.6) best = { midi: lower, s: a.s, first: a.first };
    }
    if (found.some(f => f.midi === best.midi)) break;
    found.push({ midi: best.midi, strength: best.s });
    const f = midiHz(best.midi);
    for (let h = 1; h <= HARMONICS; h++) {   // weaken this note's partials
      const [, k] = near(f * h);
      for (let j = Math.max(1, k - 2); j <= Math.min(half - 1, k + 2); j++) mag[j] *= 0.2;
    }
  }
  // the octave above a found note: its partials are the note's own even ones, which the search weakened. It is played too when
  // its first partial in the untouched spectrum is about as strong as the note's own (a lone note's second partial is weaker).
  // Low notes are left alone: a piano's lowest notes have a weak first partial and a strong second.
  for (const f of [...found]) {
    const up = f.midi + 12;
    if (f.midi < 48 || up > HIGH || found.length >= maxNotes || found.some(g => g.midi === up)) continue;
    const base = near(midiHz(f.midi), orig)[0], oct = near(midiHz(up), orig)[0], third = near(midiHz(up) * 1.5, orig)[0];
    if (base > 0 && oct / base > 0.7 && (oct + third) / base > 1.4) found.push({ midi: up, strength: f.strength * 0.5 });
  }
  found.sort((a, b) => b.strength - a.strength);
  const max = found[0]?.strength || 1;
  return found.map(f => ({ midi: f.midi, strength: f.strength / max })).sort((a, b) => a.midi - b.midi);
}

const stName = st => `${PC[((st % 12) + 12) % 12]}${Math.floor(st / 12) - 1}`;   // from a MIDI number: C-4 is 60 is "C4"
export const midiName = midi => stName(midi);

// The chord a set of MIDI notes makes: its name, or the note names when the palette has none for them.
export function chordName(midis) {
  if (!midis.length) return '';
  const st = midis.map(m => m - 12);   // the palette counts C-4 as 48
  const d = detect(st);
  if (d) return d.name;
  return midis.length === 1 ? PC[midis[0] % 12] : midis.map(m => PC[m % 12]).join(' ');
}

// Segments of x between frames from and to: [{ frame0, frame1 }]. split: 'onsets', or a number of beats at `bpm`.
export function segmentsOf(data, right, rate, { from, to, split = 'onsets', bpm = 120, sensitivity = 0.5 } = {}) {
  const segs = [];
  if (split === 'onsets') {
    const level = (f0, f1) => { let sum = 0, n = 0; for (let i = Math.max(0, f0); i < Math.min(data.length, f1); i++) { const v = right ? (data[i] + right[i]) / 2 : data[i]; sum += v * v; n++; } return Math.sqrt(sum / Math.max(1, n)); };
    const ms = t => Math.round(t * rate / 1000);
    // a new chord or note is a real onset when the sound gets clearly louder at once; a ripple in a ringing chord is not
    let marks = detectOnsets(data, right, rate, { from, to, sensitivity, minGapMs: 150 }).filter(m => level(m + ms(10), m + ms(70)) > 1.35 * level(m - ms(70), m - ms(10)));
    if (!marks.length || marks[0] - from > 0.15 * rate) marks = [from, ...marks];
    marks.forEach((m, i) => segs.push({ frame0: m, frame1: i + 1 < marks.length ? marks[i + 1] : to }));
  } else {
    const len = Math.round(split * 60 / bpm * rate);
    for (let f = from; f + len * 0.5 <= to; f += len) segs.push({ frame0: f, frame1: Math.min(to, f + len) });
  }
  return segs.filter(s => s.frame1 - s.frame0 >= 0.06 * rate);
}

// The whole job. Returns { segments: [{ frame0, frame1, notes: [midi], name, strengths }] }.
export function scanChords(data, right, rate, opts = {}) {
  const { from = 0, to = data.length, maxNotes = 5, threshold = 0.35, limit = 128 } = opts;
  const mono = new Float32Array(to - from);
  for (let i = 0; i < mono.length; i++) mono[i] = right ? (data[from + i] + right[from + i]) / 2 : data[from + i];
  const segs = segmentsOf(data, right, rate, { ...opts, from, to }).slice(0, limit);
  const segments = [];
  const rms = (a, b) => { let sum = 0; for (let i = a; i < b; i++) sum += mono[i] * mono[i]; return Math.sqrt(sum / Math.max(1, b - a)); };
  const levels = segs.map(s => rms(Math.max(0, s.frame0 - from), Math.min(mono.length, s.frame0 - from + Math.min(s.frame1 - s.frame0, Math.round(0.3 * rate)))));
  const loud = Math.max(0, ...levels);
  for (const [si, s] of segs.entries()) {
    if (levels[si] < loud * 0.1) continue;   // silence, or a tail with nothing new in it
    const skip = Math.min(Math.round(0.04 * rate), Math.floor((s.frame1 - s.frame0) / 3));
    const start = s.frame0 + skip - from, len = Math.min(s.frame1 - s.frame0 - skip, Math.round(0.6 * rate));
    const found = notesIn(mono, rate, start, len, { maxNotes, threshold });
    if (!found.length) continue;
    const notes = found.map(f => f.midi);
    segments.push({ frame0: s.frame0, frame1: s.frame1, notes, strengths: found.map(f => f.strength), name: chordName(notes) });
  }
  return { segments };
}

// Cells for a pattern: where each segment goes in ticks (the first at tick 0), and the note tokens in the columns.
//   segments: from scanChords; tps: ticks per second of the recording's tempo; cols: how many note columns the lane has
// Returns { rows: the pattern's length, items: [{ tick, col, token }] } with `token` as a note name 'C#4' (C-4 is MIDI 60) or '===' (off).
export function patternFrom(segments, rate, { tps, cols, noteToken }) {
  if (!segments.length) return { rows: 0, items: [] };
  const t0 = segments[0].frame0;
  const tickOf = f => Math.round((f - t0) / rate * tps);
  const items = [];
  let used = 0, rows = 1;
  segments.forEach((s, i) => {
    const tick = tickOf(s.frame0), end = Math.max(tick + 1, tickOf(s.frame1));
    const next = segments[i + 1] ? tickOf(segments[i + 1].frame0) : Infinity;
    const notes = s.notes.slice(0, cols);
    notes.forEach((m, c) => items.push({ tick, col: c, token: noteToken(m - 12) }));
    for (let c = notes.length; c < used; c++) items.push({ tick, col: c, token: '===' });   // the columns the last chord used and this one does not
    used = Math.max(notes.length, 0);
    if (end < next) { for (let c = 0; c < notes.length; c++) items.push({ tick: end, col: c, token: '===' }); used = 0; }
    rows = Math.max(rows, (end < next ? end : tick) + 1);
  });
  return { rows, items };
}
