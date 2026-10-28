// Chord names to notes: "F# 13sus", "Eb 9sus4", "E min9(11)", "G Major 7th", "Db 7#9(no5)", "C/E".
// The name is read left to right in small pieces (see PIECES); each piece changes one part of the chord: the third, the
// fifth, the seventh, how far the stack of extensions goes, or an added, altered or left-out note. The notes are then
// the distances in semitones above the root, so the same chord can be placed in any octave.

const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Where each degree sits above the root, as written in a plain (major scale) chord; 9, 11 and 13 are an octave up.
const DEGREE = { 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 10, 9: 14, 11: 17, 13: 21 };

const flat = s => s.replace(/♯/g, '#').replace(/♭/g, 'b');
const pitchClass = (letter, sign) => (LETTER[letter.toLowerCase()] + (sign === '#' ? 1 : sign === 'b' ? -1 : 0) + 12) % 12;

// "C4" for a note number (60 is C4, the usual middle C).
export const noteName = n => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

// The syntax shown beside the editor: [what, how to write it]. Kept here so it cannot drift from the parser below.
export const SYNTAX = [
  ['Root', 'A to G, then # or b: C, F#, Eb, Bb. Lower case works too.'],
  ['Major', 'nothing, or maj, Maj, Major, M, Δ: C, Cmaj, CM'],
  ['Minor', 'm, min, minor, mi, -: Cm, Cmin, C-'],
  ['Diminished', 'dim, diminished, °, o: Cdim, C°7 (the fully diminished seventh)'],
  ['Half diminished', 'ø, half-dim, or m7b5: Cø7, Cm7b5'],
  ['Augmented', 'aug, augmented, +: Caug, C+7'],
  ['Power chord', '5: C5 (root and fifth)'],
  ['Sixth', '6, 6th, m6, 6/9 or 69 (sixth and ninth)'],
  ['Seventh', '7, 7th: C7 (dominant), Cm7, Cmaj7, CΔ7, CmMaj7 (minor with a major seventh), Cdom7'],
  ['Ninth, 11th, 13th', '9, 11, 13 (each includes the sevenths and the notes below it; 11th and 13th leave out what clashes): C9, Cm11, CMaj13'],
  ['Suspended', 'sus, sus4, sus2: they replace the third. C7sus4, F#13sus'],
  ['Added notes', 'add9, add11, add4, add2, or in brackets: Cmin9(11), C(add13)'],
  ['Altered notes', 'b5 #5 b9 #9 #11 b13, with or without brackets: C7#9, C7(#9#5), Cmaj7#11, C7b9'],
  ['Altered dominant', 'alt: C7alt (third, seventh, b9, #9, b13)'],
  ['Left out', 'no3, no5, omit5, in brackets or not: C7#9(no5), C9no3'],
  ['Bass note (slash)', 'a note below the chord: C/E, Am7/G, D/F#'],
  ['Spacing', 'spaces and brackets are free: "E min9 (11)" is "Emin9(11)"'],
];

// Reads a chord name. Gives { root, bass, offsets, name } (root and bass are pitch classes 0 to 11, bass is null without a
// slash, offsets are semitones above the root, low to high) or { error } with a short reason.
export function parseChord(text) {
  let src = flat(String(text ?? '')).trim();
  if (!src) return { error: 'empty' };
  const head = /^([A-Ga-g])([#b]?)\s*/.exec(src);
  if (!head) return { error: 'start with a note name, A to G' };
  const root = pitchClass(head[1], head[2]);
  let rest = src.slice(head[0].length);
  let bass = null;
  const slash = /\s*\/\s*([A-Ga-g])([#b]?)\s*$/.exec(rest);
  if (slash) { bass = pitchClass(slash[1], slash[2]); rest = rest.slice(0, slash.index); }

  const s = { third: 4, fifth: 7, seventh: null, reach: 0, sixth: false, added: new Set(), omit: new Set(), altered: [], alt: false, power: false };
  let depth = 0;
  const take = (re, fn) => {
    const m = re.exec(rest);
    if (!m) return false;
    rest = rest.slice(m[0].length).replace(/^[\s,]+/, '');
    fn(m);
    return true;
  };
  const reach = d => { s.reach = Math.max(s.reach, d); };
  // The pieces, tried in this order; the first that matches the start of what is left is used. Order matters: 'maj' before
  // 'm', and the altered notes before the plain numbers.
  const PIECES = [
    [/^\(/, () => { depth++; }],
    [/^\)/, () => { depth = Math.max(0, depth - 1); }],
    [/^(?:no|omit)\s*(3|5)/i, m => s.omit.add(Number(m[1]))],
    [/^(?:add\s*)?([#b])\s*(5|9|11|13)(?!\d)/, m => s.altered.push([m[1] === '#' ? 1 : -1, Number(m[2])])],
    [/^(?:half[- ]?dim(?:inished)?|ø)\s*(7|9|11|13)?/i, m => { s.third = 3; s.fifth = 6; s.seventh = 10; reach(Number(m[1] ?? 7)); }],
    [/^(?:dim(?:inished)?|°|o(?![a-z]))\s*(7|9|11|13)?/i, m => { s.third = 3; s.fifth = 6; if (m[1]) { s.seventh = 9; reach(Number(m[1])); } }],
    [/^(?:aug(?:mented)?|\+)/i, () => { s.fifth = 8; }],
    [/^(?:[Mm]ajor|[Mm]aj|MAJ|M|\u0394|\u25B3)(?![a-z])\s*(?:(7|9|11|13)(?:th)?)?/, m => { if (m[1]) { s.seventh = 11; reach(Number(m[1])); } }],
    [/^(?:[Mm]inor|[Mm]in|MIN|[Mm]i|m|-)(?![a-z])/, () => { s.third = 3; }],
    [/^dom(?:inant)?/i, () => {}],
    [/^alt(?:ered)?/i, () => { s.alt = true; reach(7); }],
    [/^sus\s*2/i, () => { s.third = 2; }],
    [/^sus\s*4?/i, () => { s.third = 5; }],
    [/^6\s*\/\s*9|^69/, () => { s.sixth = true; s.added.add(14); }],
    [/^add\s*(2|4|6|9|11|13)/i, m => s.added.add({ 2: 14, 4: 17, 6: 9, 9: 14, 11: 17, 13: 21 }[Number(m[1])])],
    [/^(13|11|9|7)(?:th)?/, m => { if (depth) { const d = Number(m[1]); if (d === 7) reach(7); else s.added.add(DEGREE[d]); } else reach(Number(m[1])); }],
    [/^6(?:th)?/, () => { s.sixth = true; }],
    [/^5(?!\d)/, () => { s.power = true; }],
  ];
  let guard = 0;
  while (rest.length && guard++ < 60) {
    rest = rest.replace(/^[\s,]+/, '');
    if (!rest.length) break;
    if (!PIECES.some(([re, fn]) => take(re, fn))) return { error: `cannot read "${rest.slice(0, 10)}"` };
  }

  const steps = new Set([0]);
  if (s.power) { s.omit.add(3); }
  if (!s.omit.has(3)) steps.add(s.third);
  if (!s.omit.has(5)) steps.add(s.fifth);
  if (s.sixth) steps.add(9);
  if (s.reach >= 7) steps.add(s.seventh ?? 10);
  if (s.reach >= 9) steps.add(14);
  if (s.reach >= 11) steps.add(17);
  if (s.reach >= 13) steps.add(21);
  if (s.reach >= 11 && s.third === 5) steps.delete(17);   // the fourth is already there
  if (s.reach >= 13) steps.delete(17);                     // a 13th chord leaves out the 11th, which fights the third
  if (s.alt) { steps.delete(7); for (const d of [13, 15, 20]) steps.add(d); }
  for (const d of s.added) steps.add(d);
  for (const [dir, d] of s.altered) {
    if (d === 5) { steps.delete(7); steps.delete(6); steps.delete(8); steps.add(7 + dir); } else {
      steps.delete(DEGREE[d]); steps.add(DEGREE[d] + dir);
    }
  }
  if (s.omit.has(5)) { steps.delete(7); }
  const offsets = [...steps].sort((a, b) => a - b);
  return { root, bass, offsets, name: NAMES[root] };
}

// The notes of a chord as note numbers. `octave` is the one of the root (C4 is 60); `inversion` lifts the lowest notes an
// octave; `bass`-note chords (C/E) get the bass below the lowest note; `max` limits the count (the fifth goes first, then the
// highest notes).
export function chordNotes(chord, { octave = 4, inversion = 0, max = 8 } = {}) {
  if (!chord || chord.error) return [];
  const base = 12 * (octave + 1) + chord.root;
  let notes = chord.offsets.map(o => base + o);
  while (notes.length > max && notes.length > 1) {
    const five = notes.findIndex(n => n - base === 7);
    notes.splice(five >= 0 ? five : notes.length - 1, 1);
  }
  for (let i = 0; i < inversion && notes.length > 1; i++) notes.push(notes.shift() + 12);
  if (chord.bass !== null) {
    let b = notes[0] - ((notes[0] - chord.bass + 1200) % 12 || 12);   // the bass note just below the lowest note
    if (notes[0] - b < 3) b -= 12;                                      // a second or less below would be muddy: an octave lower
    notes = [b, ...notes];
  }
  while (notes.some(n => n > 127)) notes = notes.map(n => n - 12);
  while (notes.some(n => n < 0)) notes = notes.map(n => n + 12);
  return notes;
}
