// The geometry and the small formulas behind four cheap effects that come from how sound behaves in a room and around a head. The nodes
// use them to make the sound, the panels use the same ones to draw it, so what is drawn is what is heard.
//   Reflections  the image-source method for a box of a room: a wall turns into a mirror, and a reflection into a copy of the source
//                on the other side of it. Each copy is a tap of one delay line: its delay is the way it travelled, its level falls with
//                that distance and with every wall it hit, and it comes from the direction of the copy.
//   Head pan     the sound reaches the far ear later (interaural time difference, Woodworth's formula) and duller and quieter (the head
//                shadows it); a source behind is duller in both ears (the outer ear).
//   Haas         a short delay on one side: it moves the image to the other side and, summed to mono, makes a comb of notches.
//   Ring         the sidebands of a ring modulator: every partial of the input appears at the carrier plus it and the carrier minus it.

export const SPEED = 343;   // m/s, the speed of sound in air at about 20 C
export const MAX_STRINGS = 12;

// ---- reflections ----

export const MAX_TAPS = 32;
const ORDER = 3;   // reflections counted: the images of up to three wall hits (62 of them)

// The room: w x d x h metres. s and l are the source and the listener, each { x, y } as a fraction 0..1 of the floor; both sit at ear height
// (1.5 m, or the middle of a low room). The listener faces +y. absorb 0..1 is how much of the sound a wall takes each time it hits.
// Returns the reflections sorted by the way they come: [{ delay (s), gain (relative to the direct sound), pan (-1 left .. 1 right), order, from: { x, y } (metres) }]
// and `direct` (s), the delay of the direct sound itself (not a tap: it is the dry sound).
export function reflections({ w, d, h, s, l, absorb = 0.3 }, taps = 16) {
  const z = Math.min(1.5, h / 2), sx = s.x * w, sy = s.y * d, lx = l.x * w, ly = l.y * d;
  const dist0 = Math.max(0.3, Math.hypot(sx - lx, sy - ly));
  const keep = 1 - Math.min(0.98, Math.max(0, absorb));
  const list = [];
  const axis = (n, size, at) => (n % 2 === 0 ? n * size + at : n * size + size - at);
  for (let nx = -ORDER; nx <= ORDER; nx++) for (let ny = -ORDER; ny <= ORDER; ny++) for (let nz = -ORDER; nz <= ORDER; nz++) {
    const order = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
    if (order === 0 || order > ORDER) continue;
    const x = axis(nx, w, sx), y = axis(ny, d, sy), zz = axis(nz, h, z);
    const dx = x - lx, dy = y - ly, dz = zz - z, dist = Math.max(0.3, Math.hypot(dx, dy, dz));
    const flat = Math.hypot(dx, dy);
    list.push({ delay: dist / SPEED, gain: dist0 / dist * Math.pow(keep, order), pan: flat < 1e-6 ? 0 : dx / flat, order, from: { x, y } });
  }
  list.sort((a, b) => a.delay - b.delay);
  return { direct: dist0 / SPEED, list: list.slice(0, Math.max(1, Math.min(MAX_TAPS, Math.round(taps)))) };
}

// ---- head pan ----

export const HEAD_MAX_ILD = 7;   // dB, the far ear at 90 degrees with the head shadow all the way up

// For a source at `angle` degrees (0 in front, 90 on the right, 180 behind, -90 on the left) and `distance` m, with a head of `head` cm and
// the head shadow at `shadow` 0..1: how the sound reaches each ear.
//   far: 'l' or 'r' (the ear away from the source), itd (seconds the far ear is late), farGain, farCut (Hz, the far ear's low-pass),
//   rearCut (Hz, the low-pass both ears get for a source behind), gain (the level from the distance, 1 at one metre).
export function headOf({ angle, distance = 1, head = 17.5, shadow = 1 }) {
  const th = angle * Math.PI / 180, side = Math.sin(th), phi = Math.asin(Math.min(1, Math.abs(side)));   // the angle from the straight-ahead / straight-behind line
  const a = head / 200;   // radius, m
  const itd = (a / SPEED) * (phi + Math.sin(phi));
  const s = shadow * Math.abs(side);
  const behind = Math.max(0, -Math.cos(th));   // 0 in front or at the side, 1 straight behind
  return {
    far: side >= 0 ? 'l' : 'r', itd,
    farGain: Math.pow(10, -HEAD_MAX_ILD * s / 20),
    farCut: 20000 * (1 - s) + 1700 * s,
    rearCut: 20000 * (1 - behind * shadow) + 5000 * behind * shadow,
    gain: 1 / Math.min(20, Math.max(0.5, distance)),
  };
}

// ---- Haas ----

// The level response of a sound plus a copy of it `ms` later at `gain`, summed to mono (what a mono speaker would play), at `hz`.
export const combResponse = (hz, ms, gain) => Math.hypot(1 + gain * Math.cos(2 * Math.PI * hz * ms / 1000), gain * Math.sin(2 * Math.PI * hz * ms / 1000));

// ---- ring modulation ----

// The partials a ring modulator makes of a tone at `f0` with `harmonics` partials, with the carrier at `fc`: each partial n f0 gives
// |n f0 - fc| and n f0 + fc (a difference below zero is folded back up). Returns [{ hz, partial, kind: 'sum' | 'diff' }], sorted.
export function sidebands(f0, fc, harmonics = 6) {
  const out = [];
  for (let n = 1; n <= harmonics; n++) {
    out.push({ hz: Math.abs(n * f0 - fc), partial: n, kind: 'diff' }, { hz: n * f0 + fc, partial: n, kind: 'sum' });
  }
  return out.sort((a, b) => a.hz - b.hz);
}

// The carrier's value at a phase 0..1 for the four waves: sine, triangle, square and saw. All run -1 to 1.
export function carrierAt(phase, wave) {
  switch (wave) {
    case 1: return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    case 2: return phase < 0.5 ? 1 : -1;
    case 3: return 2 * phase - 1;
    default: return Math.sin(2 * Math.PI * phase);
  }
}

// ---- sympathetic strings ----

export const CHORDS = [
  { name: 'open', steps: [0, 7] },
  { name: 'major', steps: [0, 4, 7] },
  { name: 'minor', steps: [0, 3, 7] },
  { name: 'maj7', steps: [0, 4, 7, 11] },
  { name: 'min7', steps: [0, 3, 7, 10] },
  { name: 'sus4', steps: [0, 5, 7] },
  { name: 'dim', steps: [0, 3, 6, 9] },
  { name: 'whole', steps: [0, 2, 4, 6, 8, 10] },
];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = m => `${NOTE_NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// The pitches of the strings: the chord's notes from the root, climbing through the octaves, `count` of them (MIDI note numbers).
export function stringsOf(root, chord, count) {
  const steps = CHORDS[Math.max(0, Math.min(CHORDS.length - 1, Math.round(chord)))].steps, out = [];
  for (let i = 0; out.length < Math.max(1, Math.round(count)); i++) out.push(Math.round(root) + 12 * Math.floor(i / steps.length) + steps[i % steps.length]);
  return out;
}

// Follow notes: the strings for a bag of notes (MIDI numbers, newest first). Each note gets the nearest piano string to each of its first
// `partials` harmonics (1 the note, 2 the octave, 3 the twelfth ...), lowest harmonics and newest notes first, no pitch twice, at most `count`.
export function wantedStrings(bag, partials, count) {
  const out = [];
  for (let h = 1; h <= Math.max(1, Math.round(partials)); h++) for (const m of bag) {
    const p = Math.round(m + 12 * Math.log2(h));
    if (p >= 24 && p <= 120 && !out.includes(p)) out.push(p);
  }
  return out.slice(0, Math.max(1, Math.round(count)));
}

// ---- note pan ----

export const PAN_STYLES = ['keyboard', 'fan', 'alternate', 'random', 'cluster', 'mirror'];
export const PAN_SHAPES = ['swing', 'triangle', 'orbit'];
const fract = v => v - Math.floor(v);
const hashNote = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// Where a note sits before any rotation: -1 (hard left) to 1 (hard right).
//   note  its pitch (MIDI), seq  its place in the order the notes were played (0, 1, 2 ...),
//   held  the notes held now, in the order they were played (including this one while it is held)
export function panPlace(style, note, seq, held) {
  const clampX = v => Math.max(-1, Math.min(1, v));
  const at = held.indexOf(note);
  switch (PAN_STYLES[Math.max(0, Math.min(PAN_STYLES.length - 1, Math.round(style)))]) {
    case 'fan': return held.length < 2 || at < 0 ? 0 : -1 + 2 * at / (held.length - 1);
    case 'alternate': return seq % 2 === 0 ? -1 : 1;
    case 'random': return hashNote(note) * 2 - 1;
    case 'cluster': return held.length ? clampX((note - held.reduce((a, b) => a + b, 0) / held.length) / 12) : 0;
    case 'mirror': return (seq % 2 ? 1 : -1) * Math.max(0.15, Math.min(1, Math.abs(note - 60) / 30));
    default: return clampX((note - 60) / 30);
  }
}

// The swing or turn added to a place: phase is in cycles (unwrapped), amp 0 to 1 (the swing reaches amp x 180 degrees either way). Radians.
export function panRotation(shape, phase, amp) {
  const f = fract(phase);
  switch (Math.round(shape)) {
    case 1: return amp * Math.PI * (f < 0.5 ? 4 * f - 1 : 3 - 4 * f);
    case 2: return 2 * Math.PI * f;
    default: return amp * Math.PI * Math.sin(2 * Math.PI * phase);
  }
}

// How a position round the head (radians, 0 in front, +90 degrees on the right) sounds: pan -1..1, behind 0..1 (1 straight behind).
export const orbitOf = angle => ({ pan: Math.sin(angle), behind: Math.max(0, -Math.cos(angle)) });
