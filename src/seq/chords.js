// Chord arithmetic for the chord palette. A note is "st": the semitone count above C-0, the same number the pattern's
// note cells use (noteSemitones in cells.js), so C-4 is 48. Everything here is pure; the popup and the pattern view use it.

export const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CELL_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export const spell = st => `${CELL_NAMES[st % 12]}${Math.floor(st / 12)}`;   // as the pattern writes it: C-4, F#3

// label: what follows the root in a chord name; iv: the intervals above the root, in semitones
export const QUALITIES = [
  { id: 'maj', label: '', iv: [0, 4, 7] }, { id: 'min', label: 'm', iv: [0, 3, 7] },
  { id: '7', label: '7', iv: [0, 4, 7, 10] }, { id: 'maj7', label: 'maj7', iv: [0, 4, 7, 11] }, { id: 'm7', label: 'm7', iv: [0, 3, 7, 10] },
  { id: '6', label: '6', iv: [0, 4, 7, 9] }, { id: 'm6', label: 'm6', iv: [0, 3, 7, 9] },
  { id: 'sus2', label: 'sus2', iv: [0, 2, 7] }, { id: 'sus4', label: 'sus4', iv: [0, 5, 7] },
  { id: 'dim', label: 'dim', iv: [0, 3, 6] }, { id: 'aug', label: 'aug', iv: [0, 4, 8] },
  { id: 'add9', label: 'add9', iv: [0, 4, 7, 14] }, { id: '9', label: '9', iv: [0, 4, 7, 10, 14] }, { id: 'm9', label: 'm9', iv: [0, 3, 7, 10, 14] },
];

export const SCALES = {
  off: null,
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10],
};
export const scaleSet = (keyPc, id) => (SCALES[id] ? new Set(SCALES[id].map(i => (i + keyPc) % 12)) : null);

const INTERVALS = ['root', '♭9', '9', '♭3', '3', '4 / 11', '♯11 / ♭5', '5', '♭6 / ♭13', '6 / 13', '♭7', '7'];
export const intervalName = (st, rootPc) => INTERVALS[(((st - rootPc) % 12) + 12) % 12];

const uniq = a => [...new Set(a)];
const asc = a => [...a].sort((x, y) => x - y);
export const sameNotes = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

// The name of a chord if its notes make one the palette knows: { root (a pitch class), quality, name, bass } or null.
// The lowest note is tried as the root first, so an inversion is named as a slash chord (C/E).
export function detect(notes) {
  if (notes.length < 3) return null;
  const s = asc(notes), bass = s[0] % 12, pcs = uniq(s.map(n => n % 12));
  const roots = [bass, ...pcs.filter(p => p !== bass)];
  for (const root of roots) {
    const have = asc(uniq(pcs.map(p => (p - root + 12) % 12)));
    for (const q of QUALITIES) {
      const want = asc(uniq(q.iv.map(i => i % 12)));
      if (want.length === have.length && want.every((v, i) => v === have[i])) {
        const name = `${PC[root]}${q.label}${root === bass ? '' : `/${PC[bass]}`}`;
        return { root, quality: q.id, name, bass };
      }
    }
  }
  return null;
}

// The chord tones stacked close together upward from a root note.
const stack = (rootSt, ivs) => asc(ivs.map(i => rootSt + i));

// The voicings of a chord: the root position and its inversions, the drops and a spread one, all built from the same
// pitch classes (doubled notes become single) and placed around the register of the lowest note.
export function voicings(notes) {
  const s = asc(notes);
  if (!s.length) return [];
  const det = detect(s), rootPc = det ? det.root : s[0] % 12;
  const pcs = uniq(s.map(n => n % 12)), n = pcs.length;
  const tones = asc(pcs.map(p => (p - rootPc + 12) % 12));
  const low = s[0], rootSt = low - ((((low - rootPc) % 12) + 12) % 12);
  const close = stack(rootSt, tones);
  const out = [{ id: 'root', name: 'Root position', notes: close }];
  const ord = ['1st', '2nd', '3rd', '4th'];
  for (let k = 1; k < n && k <= ord.length; k++) out.push({ id: `inv${k}`, name: `${ord[k - 1]} inversion`, notes: asc([...close.slice(k), ...close.slice(0, k).map(x => x + 12)]) });
  if (n >= 4) {
    const d2 = [...close]; d2[n - 2] -= 12;
    out.push({ id: 'drop2', name: 'Drop 2', notes: asc(d2) });
    const d3 = [...close]; d3[n - 3] -= 12;
    out.push({ id: 'drop3', name: 'Drop 3', notes: asc(d3) });
  }
  if (n >= 3) {
    const spread = [close[0] - 12];
    for (let i = 2; i < n; i += 2) spread.push(close[i]);
    for (let i = 1; i < n; i += 2) spread.push(close[i] + 12);
    out.push({ id: 'spread', name: 'Spread', notes: asc(spread) });
  }
  return out.filter(v => v.notes[0] >= 0);
}

// The same chord with another quality, built up from the lowest note.
export const setQuality = (notes, q) => stack(asc(notes)[0], q.iv);

// The next note of a scale above or below (the next semitone when there is no scale).
export function stepScale(note, dir, set) {
  if (!set) return note + dir;
  for (let k = 1; k <= 12; k++) if (set.has((((note + dir * k) % 12) + 12) % 12)) return note + dir * k;
  return note + dir;
}

// Where one voice of the chord could go: a semitone or two either way and the scale's neighbouring notes, with what each
// does to the chord. set is the scale as a Set of pitch classes (or null).
export function candidates(notes, idx, set) {
  const s = asc(notes), cur = s[idx], det = detect(s), rootPc = det ? det.root : s[0] % 12;
  const picks = new Set([cur - 2, cur - 1, cur + 1, cur + 2, stepScale(cur, 1, set), stepScale(cur, -1, set), stepScale(stepScale(cur, 1, set), 1, set), stepScale(stepScale(cur, -1, set), -1, set)]);
  const out = [];
  for (const note of picks) {
    if (note === cur || note < 0 || s.includes(note)) continue;
    const next = asc(s.map((m, i) => (i === idx ? note : m)));
    out.push({ note, interval: intervalName(note, rootPc), inScale: set ? set.has(((note % 12) + 12) % 12) : null, chord: detect(next)?.name ?? '', notes: next });
  }
  return out.sort((a, b) => a.note - b.note);
}

// Revoices a chord so each of its notes moves as little as possible from the previous chord's notes. Returns the new
// notes (ascending), or null when the two chords have different numbers of notes.
export function voiceLead(prev, next) {
  const p = asc(prev), pcs = uniq(next.map(n => ((n % 12) + 12) % 12));
  if (pcs.length !== p.length) return null;
  const lo = p[0] - 8, hi = p[p.length - 1] + 8;
  const options = pcs.map(pc => { const o = []; for (let m = Math.max(0, lo); m <= hi; m++) if (m % 12 === pc) o.push(m); return o; });
  let best = null, bestCost = Infinity;
  const pick = [];
  const go = i => {
    if (i === options.length) {
      const s = asc(pick), cost = s.reduce((a, m, k) => a + Math.abs(m - p[k]), 0) * 100 + Math.abs(s[0] - p[0]);
      if (cost < bestCost) { bestCost = cost; best = s; }
      return;
    }
    for (const m of options[i]) { pick[i] = m; go(i + 1); }
  };
  go(0);
  return best;
}

export const movement = (a, b) => { const x = asc(a), y = asc(b); return x.length === y.length ? x.reduce((t, m, i) => t + Math.abs(m - y[i]), 0) : null; };
