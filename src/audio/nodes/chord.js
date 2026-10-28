// Chord: sits in an instrument's graph (no wires) and turns every note it is given into a chord. The chords are typed as
// names ("F# 13sus", "Dm7/C") into 256 slots, 00 to FF, and the Chd column of the pattern says which slot a note plays.
// A slot left empty plays the note as it is. Like the arp, it takes the notes before the voices do (see GraphRuntime.note),
// so the pattern, the keyboard and MIDI all play chords.
//
// The chord is absolute: C-4 in the pattern and F#-2 play the same notes, as typed, with the root in octave `octave`
// (Oct column). With `follow` on, the chord moves with the note instead: C4 plays it as typed, D4 a tone higher.
// `strum` spreads the notes out in time, a few ms apart, from the lowest or from the highest.
import { parseChord, chordNotes } from '../../seq/chordname.js';

const CHORD = 0, OCTAVE = 1, INVERSION = 2, NOTES = 3, STRUM = 4, DIRECTION = 5, FOLLOW = 6, LEVEL = 7;

export const SLOTS = 256;
export const slotKey = i => i.toString(16).toUpperCase().padStart(2, '0');

export default {
  type: 'chord',
  inputs: [],
  outputs: [],
  category: 'Control',
  shared: true,       // one for the instrument, never copied for each voice
  noteFilter: true,   // the runtime gives it the instrument's notes first, and plays what it makes
  editor: 'chord',    // the 256 chord names, and the list of what can be typed
  shape: 'rounded',
  glyph: 'chord',
  params: [
    { name: 'chord', min: 0, max: 255, def: 0, int: true },         // which slot plays (the Chd column)
    { name: 'octave', min: 0, max: 15, def: 4, int: true },         // the octave of the chord's root (the Oct column); C4 is middle C
    { name: 'inversion', min: 0, max: 6, def: 0, int: true },       // the lowest notes move up an octave, this many of them
    { name: 'notes', min: 1, max: 8, def: 8, int: true },           // at most this many notes (the fifth goes first, then the highest)
    { name: 'strum', min: 0, max: 120, def: 0 },                    // ms between one note and the next
    { name: 'direction', min: 0, max: 1, def: 0, int: true },       // 0 from the lowest note, 1 from the highest
    { name: 'follow', min: 0, max: 1, def: 0, int: true },          // 1: the chord moves with the note played (C4 plays it as typed)
    { name: 'level', min: 0, max: 1, def: 1 },                      // scales the velocity
  ],
  create({ sampleRate, data, notes }) {
    const send = msg => notes?.(msg);
    let parsed = new Map();                // slot -> parsed chord, only for the slots that have a name
    const load = slots => {
      parsed = new Map();
      for (const [key, name] of Object.entries(slots ?? {})) {
        const i = Number.parseInt(key, 16);
        if (Number.isInteger(i) && i >= 0 && i < SLOTS && String(name).trim()) { const c = parseChord(name); if (!c.error) parsed.set(i, c); }
      }
    };
    load(data?.chords);
    const held = new Map();                // incoming note -> the notes started for it
    let pending = [];                      // { note, vel, at, owner }: strummed notes not yet started; `at` in samples from the stream start
    let clockSamples = 0;

    const stop = owner => {
      pending = pending.filter(p => p.owner !== owner);
      for (const n of held.get(owner) ?? []) send({ type: 'noteOff', note: n });
      held.delete(owner);
    };

    return {
      message(msg) { if (msg.type === 'chords') load(msg.points); },
      input(msg, params, slots) {
        const p = i => params[slots[i]];
        if (msg.type === 'noteOn') {
          stop(msg.note);
          const chord = parsed.get(Math.max(0, Math.min(SLOTS - 1, Math.round(p(CHORD)))));
          let list;
          if (!chord) list = [msg.note];
          else {
            list = chordNotes(chord, { octave: Math.round(p(OCTAVE)), inversion: Math.round(p(INVERSION)), max: Math.round(p(NOTES)) });
            if (p(FOLLOW) >= 0.5) {
              const shift = msg.note - 60;
              list = list.map(n => n + shift).filter(n => n >= 0 && n <= 127);
            }
          }
          if (p(DIRECTION) >= 0.5) list = [...list].reverse();
          const gap = Math.round(p(STRUM) * sampleRate / 1000);
          const vel = Math.max(0.01, Math.min(1, (msg.vel ?? 1) * p(LEVEL)));
          const started = [];
          list.forEach((n, k) => {
            if (started.includes(n)) return;
            started.push(n);
            if (k === 0 || gap === 0) send({ type: 'noteOn', note: n, vel });
            else pending.push({ note: n, vel, at: clockSamples + k * gap, owner: msg.note });
          });
          held.set(msg.note, started);
        } else if (msg.type === 'noteOff') {
          stop(msg.note);
        } else if (msg.type === 'allOff') {
          pending = []; held.clear(); send(msg);
        } else if (msg.type === 'noteCut') {
          pending = []; held.clear(); send(msg);
        }
      },
      process(inputs, outputs, n) {
        if (pending.length) {
          const due = pending.filter(q => q.at < clockSamples + n);
          if (due.length) {
            pending = pending.filter(q => q.at >= clockSamples + n);
            for (const q of due) send({ type: 'noteOn', note: q.note, vel: q.vel });
          }
        }
        clockSamples += n;
      },
    };
  },
};
