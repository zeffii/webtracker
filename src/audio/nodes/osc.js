// Oscillator. Silent until the first note. Monophonic: one voice per instrument, and
// the last note sets the pitch. A note restarts the phase at the phase parameter
// (reset = 1), so every hit starts the same way, which is what a bass drum needs; the
// sync input does the same on a rising edge (above 0.5). Waves are naive, so the
// saw and square alias at high pitch.
const FREQ = 0, TUNE = 1, WAVE = 2, TRACK = 3, RESET = 4, PHASE = 5, LEVEL = 6;
const TWO_PI = 2 * Math.PI, LN2 = Math.LN2;

export default {
  type: 'osc',
  inputs: ['fm', 'sync'],   // fm is in octaves, per sample
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'osc',
  kinds: { fm: 'control', sync: 'control' },   // ports are audio unless listed
  params: [
    { name: 'freq', min: 1, max: 20000, def: 440 },   // Hz, used when track is 0
    { name: 'tune', min: -48, max: 48, def: 0 },      // semitones
    { name: 'wave', min: 0, max: 3, def: 0, int: true },         // 0 sine, 1 saw, 2 square, 3 triangle
    { name: 'track', min: 0, max: 1, def: 1, int: true },        // 1: pitch follows the note
    { name: 'reset', min: 0, max: 1, def: 1, int: true },        // 1: a note restarts the phase
    { name: 'phase', min: 0, max: 1, def: 0 },        // where a restart begins, in cycles
    { name: 'level', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate, connected }) {
    const fmOn = connected[0], syncOn = connected[1];
    let phase = 0, note = 60, started = false, pendingReset = false, prevSync = 0;
    return {
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
        const wave = Math.round(params[slots[WAVE]]), level = params[slots[LEVEL]];
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
          else v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
          out[i] = v * level;
          phase += fmOn ? base * Math.exp(fm[i] * LN2) : base;
          if (phase >= 1) phase -= Math.floor(phase);
        }
      },
    };
  },
};
