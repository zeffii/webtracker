// Oscillator. Silent until the first note. Monophonic: one voice per instrument, and
// the last note sets the pitch. A note restarts the phase at the phase parameter
// (reset = 1), so every hit starts the same way, which is what a bass drum needs; the
// sync input does the same on a rising edge (above 0.5). Waves are naive, so the
// saw, square and the shapes with corners alias at high pitch.
// Waves: 0 sine, 1 saw, 2 square, 3 triangle, 4 pulse (its width is `width`), 5 half sine (the top half of a sine, the
// bottom flat), 6 rectified sine (all the humps the same way up), 7 staircase (a saw in eight steps), 8 drawn (a single
// cycle drawn by hand in the panel, read with linear interpolation).
import { WAVE_POINTS, normalizeWave } from './waves.js';
const FREQ = 0, TUNE = 1, WAVE = 2, TRACK = 3, RESET = 4, PHASE = 5, LEVEL = 6, WIDTH = 7;
const HALF_SINE_MEAN = 1 / Math.PI;   // the average of the half sine (before doubling), taken off so the wave sits on zero
const TWO_PI = 2 * Math.PI, LN2 = Math.LN2;

export default {
  type: 'osc',
  inputs: ['fm', 'sync'],   // fm is in octaves, per sample
  outputs: ['out'],
  category: 'Sources',
  generator: true,   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'osc',
  kinds: { fm: 'control', sync: 'control' },   // ports are audio unless listed
  editor: 'oscwave',   // the patcher panel offers the drawing of the `drawn` wave
  params: [
    { name: 'freq', min: 1, max: 20000, def: 440 },   // Hz, used when track is 0
    { name: 'tune', min: -48, max: 48, def: 0 },      // semitones
    { name: 'wave', min: 0, max: 8, def: 0, int: true },         // 0 sine, 1 saw, 2 square, 3 triangle, 4 pulse, 5 half sine, 6 rectified sine, 7 staircase, 8 drawn
    { name: 'track', min: 0, max: 1, def: 1, int: true },        // 1: pitch follows the note
    { name: 'reset', min: 0, max: 1, def: 1, int: true },        // 1: a note restarts the phase
    { name: 'phase', min: 0, max: 1, def: 0 },        // where a restart begins, in cycles
    { name: 'level', min: 0, max: 1, def: 1 },
    { name: 'width', min: 0.02, max: 0.98, def: 0.5 },   // how much of the cycle the pulse is high
  ],
  create({ sampleRate, connected, data }) {
    let table = normalizeWave(data?.wave);
    const fmOn = connected[0], syncOn = connected[1];
    let phase = 0, note = 60, started = false, pendingReset = false, prevSync = 0;
    return {
      message(msg) { if (msg.type === 'wave') table = normalizeWave(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; started = true; pendingReset = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        if (!started) { out.fill(0, 0, n); return; }
        const fm = inputs[0], sync = inputs[1];
        const tune = params[slots[TUNE]], restart = params[slots[PHASE]];
        const base = (params[slots[TRACK]] >= 0.5
          ? 440 * Math.pow(2, (note + tune - 69) / 12)
          : params[slots[FREQ]] * Math.pow(2, tune / 12)) / sampleRate;
        const wave = Math.round(params[slots[WAVE]]), level = params[slots[LEVEL]], width = params[slots[WIDTH]];
        if (pendingReset && params[slots[RESET]] >= 0.5) phase = restart;
        pendingReset = false;
        for (let i = 0; i < n; i++) {
          if (syncOn) {
            const s = sync[i];
            if (s > 0.5 && prevSync <= 0.5) phase = restart;
            prevSync = s;
          }
          let v;
          if (wave === 0) v = Math.sin(TWO_PI * phase);
          else if (wave === 1) v = 2 * phase - 1;
          else if (wave === 2) v = phase < 0.5 ? 1 : -1;
          else if (wave === 3) v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
          else if (wave === 4) v = phase < width ? 1 : -1;
          else if (wave === 5) v = (phase < 0.5 ? Math.sin(TWO_PI * phase) : 0) * 2 - 2 * HALF_SINE_MEAN;
          else if (wave === 6) v = Math.abs(Math.sin(TWO_PI * phase)) * 2 - 1;
          else if (wave === 7) v = Math.floor(phase * 8) / 3.5 - 1;
          else { const x = phase * WAVE_POINTS, j = x | 0, f = x - j; v = table[j] + (table[(j + 1) & (WAVE_POINTS - 1)] - table[j]) * f; }
          out[i] = v * level;
          phase += fmOn ? base * Math.exp(fm[i] * LN2) : base;
          if (phase >= 1) phase -= Math.floor(phase);
        }
      },
    };
  },
};
