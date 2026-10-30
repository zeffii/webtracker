// What a Chord node's text means, and how its notes get their volumes. No dependencies on the audio thread or the editor, so both can use it.
//
//   "A min7", "F# 13sus", "G7"      a chord by name, as in the Chord machine (see src/seq/chordname.js)
//   "A2 C3 E3 G3", "57 60 64 67"     the notes themselves, written as C-4 = middle C (MIDI 60) or as numbers
//   "A2@100 C3@60 E3@80 G3@50"       the same, each note with its own volume in percent
//
// The notes come out lowest first. A volume belongs to a place in that order (the lowest note, the next one up, ...), not to a pitch,
// so one set of volumes fits chords of any size.

import { parseChord, chordNotes } from '../seq/chordname.js';

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export const MAX_VOICES = 8;

// "C-4", "A2", "Db3", "60" -> a MIDI number, or null. C-4 is 60, the way the Chord machine writes it.
export function parseNoteName(tok) {
  if (/^\d{1,3}$/.test(tok)) { const n = Number(tok); return n <= 127 ? n : null; }
  const m = /^([A-Ga-g])([#b-]?)(-?\d)$/.exec(tok);
  if (!m) return null;
  const n = (Number(m[3]) + 1) * 12 + PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n >= 0 && n <= 127 ? n : null;
}

// { notes: [lowest ... highest], inline: [percent or null for each], name, error }. An empty text is no notes and no error.
export function parseChordText(text, { octave = 4, inversion = 0, max = MAX_VOICES } = {}) {
  const src = String(text ?? '').trim();
  if (!src) return { notes: [], inline: [], name: '', error: null };
  const toks = src.split(/[\s,]+/).filter(Boolean);
  const read = toks.map(t => { const [n, w] = t.split('@'); const v = parseNoteName(n); return v === null ? null : { v, w: w === undefined || w === '' ? null : Math.max(0, Math.min(100, Number(w))) }; });
  const single = toks.length === 1 ? parseChord(src) : null;
  if (read.every(Boolean) && !(single && !single.error)) {
    const list = read.map((r, i) => ({ ...r, i })).sort((a, b) => a.v - b.v || a.i - b.i).slice(0, max);
    return { notes: list.map(r => r.v), inline: list.map(r => (Number.isFinite(r.w) ? r.w : null)), name: toks.join(' '), error: null };
  }
  const chord = parseChord(src);
  if (chord.error) return { notes: [], inline: [], name: src, error: chord.error };
  const notes = chordNotes(chord, { octave, inversion, max }).slice().sort((a, b) => a - b);
  return { notes, inline: notes.map(() => null), name: src, error: null };
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// The volume of each note, 0 to 1. `base` is the volumes in percent by place (missing ones are 100), tilt runs -1 (the low notes loud) to 1 (the high
// ones loud), variation 0 to 1 nudges every note by a random amount, level scales the lot.
export function voice(count, base, { tilt = 0, variation = 0, level = 1 } = {}, rand = Math.random) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let w = (Number.isFinite(base?.[i]) ? base[i] : 100) / 100;
    const pos = count > 1 ? i / (count - 1) : 0.5;
    w *= clamp(1 + tilt * (pos * 2 - 1), 0, 2);
    if (variation > 0) w *= clamp(1 + variation * (rand() * 2 - 1) * 0.7, 0, 1.5);
    out.push(clamp(w * level, 0, 1));
  }
  return out;
}

// What the keyboard under a Chord node shows: the notes and their volumes as the node would play them without any randomness.
export function chordView(data, params) {
  const p = parseChordText(data?.text, { octave: Math.round(params?.octave ?? 4), inversion: Math.round(params?.inversion ?? 0), max: Math.round(params?.notes ?? 6) });
  const base = p.notes.map((_, i) => p.inline[i] ?? data?.weights?.[i] ?? 100);
  return { ...p, base, vels: voice(p.notes.length, base, { tilt: params?.tilt ?? 0, level: params?.level ?? 1 }) };
}
