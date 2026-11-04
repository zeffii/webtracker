// Stereo phaser: a chain of first-order allpass stages whose corner frequency is swept by an lfo
// (`depth` octaves either side of `freq`). Added to the dry signal, each pair of stages makes one notch.
// `feedback` feeds the last stage back to the first for a sharper, more vocal sweep (negative values
// give the hollow, inverted sound). The right channel's lfo is offset by `width` (a quarter cycle at 1).
// out = dry + wet * mix, so mix 1 is the deepest notches.
const RATE = 0, DEPTH = 1, FREQ = 2, STAGES = 3, FEEDBACK = 4, WIDTH = 5, MIX = 6, PHASE = 7, GLIDE = 8;
const MAX_STAGES = 12;

export default {
  type: 'phaser',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'phaser',
  params: [
    { name: 'rate', min: 0.02, max: 10, def: 0.4 },                    // Hz
    { name: 'depth', min: 0, max: 4, def: 2 },                         // octaves each way
    { name: 'freq', min: 100, max: 4000, def: 800, scale: 'log' },     // Hz, centre of the sweep
    { name: 'stages', min: 2, max: MAX_STAGES, def: 6, int: true },    // two stages per notch
    { name: 'feedback', min: -0.95, max: 0.95, def: 0.4 },
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.5 },
    { name: 'phase', min: 0, max: 1, def: 0 },   // where in its cycle the sweep restarts when a pattern writes this (the sweep then runs on)
    { name: 'glide', min: 0, max: 500, def: 20 },   // ms: how long the sweep takes to slide to a written phase (0 jumps, which can click)
  ],
  create({ sampleRate, clock }) {
    const z = [new Float64Array(MAX_STAGES), new Float64Array(MAX_STAGES)];
    const last = [0, 0];
    let phase = 0;
    const stamps = clock?.stamps;   // counts every pattern write to a parameter, even of the same value
    let err = 0, decay = 0;   // the gap between the sweep and where it is heading, shrinking to nothing so a phase write slides
    let seen = 0;   // a fresh node starts at phase 0 anyway, so a write made before its first block still counts
    const top = sampleRate * 0.45;
    return {
      process(inputs, outputs, n, params, slots) {
        if (stamps) {   // a write to `phase` (a Phs column in the pattern) puts the sweep at that point in its cycle, then it runs on
          const stamp = stamps[slots[PHASE]];
          if (stamp !== seen) {
            const target = params[slots[PHASE]] % 1, d = phase + err - target, g = params[slots[GLIDE]];
            err = g > 0 ? d - Math.round(d) : 0;
            phase = target;
            decay = Math.exp(-3 / (sampleRate * g / 1000 + 1));
          }
          seen = stamp;
        }
        const ins = inputs[0], outs = outputs[0];
        const inc = params[slots[RATE]] / sampleRate, depth = params[slots[DEPTH]], centre = params[slots[FREQ]];
        const stages = Math.max(2, Math.min(MAX_STAGES, Math.round(params[slots[STAGES]])));
        const fb = params[slots[FEEDBACK]], offset = 0.25 * params[slots[WIDTH]], mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < 2; c++) {
            const lfo = Math.sin(2 * Math.PI * (phase + err + (c ? offset : 0)));
            const f = Math.min(top, Math.max(20, centre * 2 ** (depth * lfo)));
            const t = Math.tan(Math.PI * f / sampleRate), a = (t - 1) / (t + 1);
            const dry = ins[c][i], state = z[c];
            let x = dry + fb * last[c];
            for (let s = 0; s < stages; s++) {
              const y = a * x + state[s];
              state[s] = x - a * y;
              x = y;
            }
            last[c] = Math.abs(x) < 1e-20 ? 0 : x;
            outs[c][i] = dry + x * mix;
          }
          err = Math.abs(err) < 1e-7 ? 0 : err * decay;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
