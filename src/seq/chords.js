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

// A likely name for any set of notes, even when no chord of the palette matches exactly. Every pitch class is tried as the root with
// every quality, and the fit is scored: chord tones found count for, chord tones missing (a fifth may be left out, little is lost) and
// extra notes (the incidentals) count against. The extras are written after the name as added or altered notes: Am7(add11), C7(b9).
// Returns { name, exact, alts } where alts are other names that fit nearly as well, or null for fewer than two different notes.
export const FLAT_PC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const EXTRA = { 1: 'b9', 2: 'add9', 3: '#9', 5: 'add11', 6: '#11', 8: 'b13', 9: 'add13', 10: 'b7', 11: 'maj7' };   // by semitones above the root
const simple = QUALITIES.map(q => q.id);

// True when the notes sit better in a flat key (F, Bb, Eb, Ab, Db, Gb or their minors) than in a sharp one: the names then use flats.
export function prefersFlats(notes) {
  const pcs = new Set(notes.map(n => ((n % 12) + 12) % 12));
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  let best = -1, bestKey = 0;
  for (let k = 0; k < 12; k++) {
    const fit = MAJOR.filter(i => pcs.has((i + k) % 12)).length - 0.1 * (pcs.size - MAJOR.filter(i => pcs.has((i + k) % 12)).length) + (pcs.has(k) ? 0.2 : 0);   // C major wins ties, then the sharp keys
    if (fit > best + 1e-9) { best = fit; bestKey = k; }
  }
  return [5, 10, 3, 8, 1, 6].includes(bestKey);
}

export function suggest(notes, { flats = false } = {}) {
  const s = asc(notes), pcs = uniq(s.map(n => ((n % 12) + 12) % 12));
  if (pcs.length < 2) return null;
  const names = flats ? FLAT_PC : PC;
  if (pcs.length === 2 && (pcs[1] - pcs[0] === 7 || pcs[1] - pcs[0] === 5)) return { name: `${names[pcs[1] - pcs[0] === 7 ? pcs[0] : pcs[1]]}5`, exact: true, alts: [] };   // a fifth: a power chord
  const bass = pcs.includes(s[0] % 12) ? s[0] % 12 : pcs[0];
  const fits = [];
  for (const root of pcs) {
    const have = new Set(pcs.map(p => (p - root + 12) % 12));
    QUALITIES.forEach((q, qi) => {
      const tones = new Set(q.iv.map(i => i % 12)), got = [...tones].filter(t => have.has(t)), missing = [...tones].filter(t => !have.has(t));
      const extra = [...have].filter(t => !tones.has(t));
      if (!tones.has(3) && !tones.has(4) && !tones.has(2) && !tones.has(5)) return;
      if (got.length < Math.min(3, tones.size)) return;
      // the third (or its replacement) must be there: a fifth or a seventh alone does not make a chord of this kind
      const third = [3, 4, 2, 5].find(t => tones.has(t));
      if (!have.has(third)) return;
      const score = got.length * 3 - missing.reduce((t, m) => t + (m === 7 ? 0.5 : 2.5), 0) - extra.length * 1.2 + (root === bass ? 1 : 0) - qi * 0.02;
      const parts = extra.map(t => EXTRA[t] ?? '').filter(Boolean), gone = missing.includes(7) ? ['no5'] : [];
      const tail = [...parts, ...gone];
      const name = `${names[root]}${q.label}${tail.length ? `(${tail.join(',')})` : ''}${root === bass ? '' : `/${names[bass]}`}`;
      fits.push({ name, score, exact: !extra.length && !missing.length });
    });
  }
  if (!fits.length) return null;
  fits.sort((a, b) => b.score - a.score);
  const top = fits[0], seen = new Set([top.name]), alts = [];
  for (const f of fits.slice(1)) if (f.score >= top.score - 1.2 && !seen.has(f.name) && alts.length < 2) { seen.add(f.name); alts.push(f.name); }
  return { name: top.name, exact: top.exact, alts };
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
