// Chords for the script engine: chord names to notes, roman numerals to chord names, the circle of fifths, and a small
// progression generator. Plain functions with no DOM. A "name" is what the chord node reads ("Am7", "F#13sus", "C/E");
// notes are MIDI numbers, which the script library turns into tracker notes (60 is the written C-4).
import { parseChord, chordNotes } from '../seq/chordname.js';

// ---- the circle ----
// The major keys in fifths, going clockwise (the sharp side), with the flat spellings the way they are usually written.
export const CIRCLE = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]);   // F Bb Eb Ab Db: the major keys that are written with flats
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const mod12 = n => ((n % 12) + 12) % 12;

// "Am7" or "F#" into { root: 9, rest: 'm7' }; throws with the name in the message when it does not start with a note.
function splitName(name) {
  const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(String(name).trim());
  if (!m) throw new Error(`"${name}" does not start with a note name (A to G, then # or b)`);
  const key = m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b');
  return { root: PITCH[key], rest: m[3] };
}
const isMinorName = rest => /^(m(?!aj)|min|-)/i.test(rest.trim()) && !/^maj/i.test(rest.trim());
const spell = (pc, flats) => (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
// Whether a key is written with flats: its relative major decides (A minor is C major, D minor is F major, and so on).
const usesFlats = (rootPc, minor) => FLAT_KEYS.has(mod12(minor ? rootPc + 3 : rootPc));

// ---- one chord ----
// chord('Am7', { octave: 3, inversion: 0, spread: 'close', max: 8 }) gives the notes as a string for tbin: "A-3 C-4 E-4 G-4".
export function chordMidi(name, o = {}) {
  const parsed = parseChord(name);
  if (parsed.error) throw new Error(`chord "${name}": ${parsed.error}`);
  let notes = chordNotes(parsed, { octave: o.octave ?? 3, inversion: o.inversion ?? 0, max: o.max ?? 8 });
  const spread = o.spread ?? 'close';
  if (spread === 'open' && notes.length >= 3) { const [a, b, ...rest] = notes; notes = [a, ...rest, b + 12]; }     // the second note goes to the top
  else if (spread === 'drop2' && notes.length >= 4) { const i = notes.length - 2; notes = [notes[i] - 12, ...notes.filter((_, k) => k !== i)]; }   // the second from the top drops an octave
  else if (spread !== 'close' && spread !== 'open' && spread !== 'drop2') throw new Error(`spread is close, open or drop2, not "${spread}"`);
  return notes;
}

// ---- a list of chords ----
// The chords as MIDI note lists. With lead: true each chord is put in the inversion and octave that moves the notes the
// least from the chord before, so the progression glides rather than jumps.
export function chordList(names, o = {}) {
  const out = [];
  let prev = null;
  for (const name of names) {
    let notes = chordMidi(name, o);
    if (o.lead && prev) {
      let best = notes, bestCost = Infinity;
      for (let inv = 0; inv < notes.length; inv++) {
        const turned = [...notes.slice(inv), ...notes.slice(0, inv).map(n => n + 12)];
        for (const shift of [-24, -12, 0, 12, 24]) {
          const cand = turned.map(n => n + shift);
          const cost = motion(prev, cand);
          if (cost < bestCost) { bestCost = cost; best = cand; }
        }
      }
      notes = best.sort((a, b) => a - b);
    }
    out.push(notes);
    prev = notes;
  }
  return out;
}
// How far the notes travel from one chord to the next: each new note goes to the nearest old one.
const motion = (a, b) => b.reduce((sum, n) => sum + Math.min(...a.map(m => Math.abs(m - n))), 0) + Math.abs(mean(a) - mean(b));
const mean = list => list.reduce((s, n) => s + n, 0) / list.length;

// Chord names from a string ("Am7 Fmaj7 C G", or "Am7 | E min9 (11) | C" when a name has spaces) or a list.
export function namesOf(src) {
  if (Array.isArray(src)) return src.map(String);
  const s = String(src).trim();
  const parts = /[|,]/.test(s) ? s.split(/[|,]/) : s.split(/\s+/);
  const out = parts.map(p => p.trim()).filter(Boolean);
  if (!out.length) throw new Error('chords needs at least one chord name');
  return out;
}

// ---- roman numerals ----
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
};
const NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

// One numeral as a chord name in a key: ('vi', C, major) is Am, ('bVII', A, minor) is G. (Slashes are handled by prog.)
function numeral(token, keyPc, mode, flats) {
  const m = /^([b#♭♯]?)(vii|vi|iv|v|iii|ii|i)(.*)$/i.exec(token);
  if (!m) throw new Error(`"${token}" is not a roman numeral (I to VII, in capitals for major chords: I vi IV V, bVII, V7, ii7, vii°, V/ii)`);
  const [, accidental, roman, tail] = m;
  const degree = NUMERALS.indexOf(roman.toLowerCase());
  const steps = MODES[mode];
  let pc = keyPc + steps[degree] + (accidental === 'b' || accidental === '♭' ? -1 : accidental === '#' || accidental === '♯' ? 1 : 0);
  let minor = roman === roman.toLowerCase();
  let rest = tail;
  if (/^(°|o|dim)/.test(rest)) rest = rest.replace(/^(°|o|dim)/, 'dim');
  else if (/^ø/.test(rest)) rest = rest.replace(/^ø7?/, 'm7b5');
  else if (/^\+/.test(rest)) rest = rest.replace(/^\+/, 'aug');
  else if (minor && !rest && !accidental) {
    // a lower-case numeral on a note whose triad is diminished in the scale (vii in major, ii in minor) is the diminished chord
    const third = mod12(steps[(degree + 2) % 7] - steps[degree]), fifth = mod12(steps[(degree + 4) % 7] - steps[degree]);
    if (third === 3 && fifth === 6) rest = 'dim', minor = false;
  }
  const quality = rest.startsWith('dim') || rest.startsWith('aug') || rest.startsWith('m7b5') ? '' : minor ? 'm' : '';
  return `${spell(pc, flats)}${quality}${rest}`;
}

// prog('I vi IV V', 'C', 'major') is ['C', 'Am', 'F', 'G']. The mode is any of major, minor, dorian, phrygian, lydian,
// mixolydian, locrian. A numeral can carry a seventh or other ending (V7, ii7, Imaj7, vii°, viiø) and a flat or sharp in
// front (bVII), and X/Y plays the X of Y's key (V7/ii is the dominant of the ii chord).
export function prog(text, key = 'C', mode = 'major') {
  const m = String(mode).toLowerCase().replace(/[^a-z]/g, '');
  if (!MODES[m]) throw new Error(`no mode "${mode}" (${Object.keys(MODES).join(', ')})`);
  const { root, rest } = splitName(key);
  const keyMinor = isMinorName(rest) || m === 'minor';
  const flats = usesFlats(root, keyMinor || m === 'phrygian' || m === 'dorian' || m === 'locrian');
  return String(text).trim().split(/[\s|,]+/).filter(Boolean).map(token => {
    const slash = /^(.*)\/(b?#?(?:vii|vi|iv|v|iii|ii|i))$/i.exec(token);
    if (slash) {
      // the chord on the right is only the key to play in: its root, then the left numeral in that key, as if it were major
      const target = numeral(slash[2], root, m, flats);
      const t = splitName(target);
      return numeral(slash[1], t.root, 'major', flats);
    }
    return numeral(token, root, m, flats);
  });
}

// ---- the circle of fifths ----
const circlePos = pc => CIRCLE.findIndex(n => PITCH[n] === mod12(pc));
// fifths('C', 4) is C G D A; a negative count goes the other way (the flat side): fifths('C', -3) is C F Bb.
export function fifths(start = 'C', n = 12) {
  const { root } = splitName(start);
  const at = circlePos(root), dir = n < 0 ? -1 : 1;
  return Array.from({ length: Math.abs(n) }, (_, i) => CIRCLE[mod12(at + dir * i)]);
}
// cycle('C', 4, '7') is C7 F7 Bb7 Eb7: the roots fall a fifth each time, the way a lot of jazz and soul moves.
export function cycle(start = 'C', n = 4, quality = '') {
  const { root } = splitName(start);
  const at = circlePos(root);
  return Array.from({ length: n }, (_, i) => `${CIRCLE[mod12(at - i)]}${quality}`);
}
// relative('C') is Am and relative('Am') is C.
export function relative(name) {
  const { root, rest } = splitName(name);
  if (isMinorName(rest)) return spell(root + 3, usesFlats(root + 3, false));
  return `${spell(root - 3, usesFlats(root, false))}m`;
}
// parallel('C') is Cm and parallel('Cm') is C.
export function parallel(name) {
  const { root, rest } = splitName(name);
  const flats = usesFlats(root, !isMinorName(rest));
  return isMinorName(rest) ? spell(root, flats) : `${spell(root, flats)}m`;
}
// The triads of a key: ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'] for C, ['Am', 'Bdim', 'C', ...] for Am.
export function triads(key = 'C') {
  const { root, rest } = splitName(key);
  const minor = isMinorName(rest), steps = MODES[minor ? 'minor' : 'major'], flats = usesFlats(root, minor);
  return steps.map((s, d) => {
    const third = mod12(steps[(d + 2) % 7] - s), fifth = mod12(steps[(d + 4) % 7] - s);
    const q = third === 4 ? (fifth === 7 ? '' : 'aug') : fifth === 7 ? 'm' : 'dim';
    return `${spell(root + s, flats)}${q}`;
  });
}
// neighbours('C') is G F Am Em Dm: the chords next to a key on the circle, the safe places to go next.
export function neighbours(key = 'C') {
  const t = triads(key), minor = isMinorName(splitName(key).rest);
  const pick = minor ? [4, 3, 2, 6, 5] : [4, 3, 5, 2, 1];   // v iv III VII VI  or  V IV vi iii ii
  return pick.map(i => t[i]);
}
// dom('D') is A7, the chord that leads into D (a fifth above it).
export function dom(target) {
  const { root } = splitName(target);
  const at = circlePos(root);
  return `${CIRCLE[mod12(at + 1)]}7`;
}
// tritone('G7') is Db7: the chord a tritone away that leads to the same place.
export function tritone(name) {
  const { root, rest } = splitName(name);
  return `${spell(root + 6, true)}${rest}`;
}
// pivot('C', 'G') is the triads that two keys share (C Em G Am), the chords to change key on.
export function pivot(a, b) {
  const tb = new Set(triads(b));
  return triads(a).filter(c => tb.has(c));
}

// ---- the progression generator ----
// For each chord, the chords that may follow and how likely each is. A progression walks these, then bends to land on the
// home chord at the end: two chords from the end it heads for a chord that resolves, and the last is the home chord.
const MOVES = {
  pop: {
    major: { I: { vi: 3, IV: 3, V: 2, ii: 1, iii: 1 }, ii: { V: 5, IV: 1, vii: 0.3 }, iii: { vi: 3, IV: 2 }, IV: { V: 3, I: 2, ii: 2, vi: 1 }, V: { I: 5, vi: 2, IV: 1 }, vi: { IV: 3, ii: 3, V: 2, iii: 1 }, vii: { I: 4, iii: 1 } },
    minor: { i: { VI: 3, VII: 3, iv: 2, v: 1, III: 1 }, III: { VII: 3, VI: 2, iv: 2 }, iv: { v: 2, VII: 2, i: 2, VI: 1 }, v: { i: 4, VI: 2 }, VI: { VII: 3, III: 2, iv: 1, v: 1 }, VII: { i: 4, III: 2, VI: 1 } },
  },
  jazz: {
    major: { I: { vi: 3, ii: 2, IV: 2, iii: 1 }, iii: { vi: 5, IV: 1 }, vi: { ii: 5, IV: 1 }, ii: { V: 6 }, V: { I: 5, vi: 1 }, IV: { V: 2, ii: 2, I: 1 } },
    minor: { i: { iv: 2, VI: 2, ii: 3 }, ii: { V: 6 }, V: { i: 5, VI: 1 }, iv: { V: 2, VII: 2, i: 1 }, VI: { ii: 3, iv: 2, V: 1 }, VII: { III: 3, i: 2 }, III: { VI: 3, iv: 1 } },
  },
  techno: {
    major: { I: { V: 3, vi: 2, IV: 1 }, V: { I: 5 }, vi: { I: 4, IV: 1 }, IV: { I: 5 } },
    minor: { i: { VII: 3, VI: 2, v: 1 }, VII: { i: 5 }, VI: { i: 4, VII: 2 }, v: { i: 5 } },
  },
};
const HOME = { major: 'I', minor: 'i' };
// The chords whose next chord can be the home chord (the ones that "resolve").
const resolves = (table, home) => Object.keys(table).filter(c => c !== home && table[c][home] >= 2);
// Which seventh each numeral takes when sevenths are on.
const SEVENTH = {
  major: { I: 'maj7', ii: '7', iii: '7', IV: 'maj7', V: '7', vi: '7', vii: 'ø' },
  minor: { i: '7', ii: 'ø', III: 'maj7', iv: '7', v: '7', V: '7', VI: 'maj7', VII: '7' },
};

// progression(length, key, mode, { style: 'pop' | 'jazz' | 'techno', sevenths, spice, seed }): chord names, starting on the
// home chord and ending on it. The seed is the random function the script gives it. spice (0 to 1) is how often a chord
// is swapped for the dominant of the chord after it.
export function progression(rand, length = 4, key = 'C', mode = 'major', o = {}) {
  if (!Number.isInteger(length) || length < 2 || length > 64) throw new Error('progression(length, key, mode): length is a whole number from 2 to 64');
  const style = o.style ?? 'pop', kind = String(mode).toLowerCase() === 'minor' ? 'minor' : 'major';
  if (!MOVES[style]) throw new Error(`style is ${Object.keys(MOVES).join(', ')}, not "${style}"`);
  const table = MOVES[style][kind], home = HOME[kind];
  const pre = resolves(table, home);
  const seq = [home];
  const choose = weights => {
    const entries = Object.entries(weights).filter(([, w]) => w > 0), total = entries.reduce((s, [, w]) => s + w, 0);
    if (!entries.length) return null;
    let r = rand() * total;
    for (const [c, w] of entries) { r -= w; if (r <= 0) return c; }
    return entries[entries.length - 1][0];
  };
  while (seq.length < length - 1) {
    const here = seq[seq.length - 1], left = length - 2 - seq.length;   // chords still to place after this one, before the last
    const next = { ...table[here] };
    delete next[here];
    for (const c of Object.keys(next)) {
      if (!table[c]) delete next[c];                                    // a chord with nowhere to go cannot be used
      else if (left === 0 && !pre.includes(c)) delete next[c];         // the chord before the last must resolve (and is never home itself)
      else if (c === home) next[c] *= 0.25;                             // coming home early is allowed, but rarely
      else if (left === 1 && !Object.keys(table[c]).some(n => pre.includes(n))) delete next[c];   // and the one before that must lead to one
    }
    seq.push(choose(next) ?? pre[0] ?? home);
  }
  seq.push(home);
  const names = [];
  const sev = o.sevenths ?? style === 'jazz', spice = o.spice ?? 0;
  for (let i = 0; i < seq.length; i++) {
    const token = seq[i];
    const next = seq[i + 1];
    if (spice > 0 && next && i > 0 && next !== home && rand() < spice) names.push(prog(`V7/${next}`, key, mode)[0]);
    else names.push(prog(sev ? token + (SEVENTH[kind][token] ?? '') : token, key, mode)[0]);
  }
  return names;
}
