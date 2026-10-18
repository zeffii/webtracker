// White noise. Silent until the first note, like the oscillator; note cut silences it again. A note restarts the
// noise from the same seed, so every hit is the same hit (a snare that never changes under your hands). Set `seed`
// to a different number for a different texture. Uniform white noise: the level is its peak.
const LEVEL = 0, SEED = 1, RESTART = 2;

export default {
  type: 'noise',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'noise',
  kinds: { out: 'audio' },
  params: [
    { name: 'level', min: 0, max: 1, def: 1 },
    { name: 'seed', min: 1, max: 9999, def: 1, int: true },
    { name: 'restart', min: 0, max: 1, def: 1, int: true },   // 1: a note starts the noise over, so each hit is identical
  ],
  create() {
    let state = 0x9e3779b9, started = false, pending = false;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { started = true; pending = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        if (!started) { out.fill(0, 0, n); return; }
        if (pending) {
          pending = false;
          if (params[slots[RESTART]] >= 0.5) state = (Math.round(params[slots[SEED]]) * 2654435761) >>> 0 || 1;
        }
        const level = params[slots[LEVEL]];
        let s = state;
        for (let i = 0; i < n; i++) {
          s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
          out[i] = ((s / 2147483648) - 1) * level;
        }
        state = s;
      },
    };
  },
};
