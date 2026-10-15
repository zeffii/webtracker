// Distortion: the signal is driven into a clipping curve, then a one-pole lowpass (`tone`) takes the
// fizz off. mode 0 is soft (tanh), 1 hard clip, 2 tube (asymmetric, so it adds even harmonics) and 3 fuzz
// (a hard, squared-off curve). It runs at 1x, 2x or 4x (`oversample` 0, 1, 2) to cut the aliasing; the dry
// signal is delayed to match. out = (dry * (1 - mix) + wet * mix) * level. Stereo in and out.
import { Delay, Oversampler } from './oversample.js';

const DRIVE = 0, TONE = 1, MODE = 2, MIX = 3, LEVEL = 4, OVERSAMPLE = 5;

const SHAPES = [
  x => Math.tanh(x),
  x => (x > 1 ? 1 : x < -1 ? -1 : x),
  x => (x >= 0 ? Math.tanh(x) : Math.tanh(x * 0.6) / 0.6 * 0.8),
  x => Math.tanh(x * 6) * (1 - 0.15 * Math.exp(-Math.abs(x) * 3)),
];

export default {
  type: 'distortion',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'distortion',
  params: [
    { name: 'drive', min: 0.1, max: 40, def: 4, scale: 'log' },
    { name: 'tone', min: 300, max: 20000, def: 8000, scale: 'log' },   // Hz, the lowpass after the clipper
    { name: 'mode', min: 0, max: 3, def: 0, int: true },               // 0 soft, 1 hard, 2 tube, 3 fuzz
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'level', min: 0, max: 2, def: 0.7 },
    { name: 'oversample', min: 0, max: 2, def: 1, int: true },         // 0: 1x, 1: 2x, 2: 4x
  ],
  create({ sampleRate }) {
    const chains = [1, 2, 4].map(f => [new Oversampler(f), new Oversampler(f)]);
    const delays = [new Delay(48), new Delay(48)];
    const lp = [0, 0], hp = [0, 0], hpIn = [0, 0];   // tone filter state; a gentle highpass removes the offset the tube curve makes
    const hpK = 1 - Math.exp(-2 * Math.PI * 12 / sampleRate);
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const drive = params[slots[DRIVE]], mix = params[slots[MIX]], level = params[slots[LEVEL]];
        const toneK = 1 - Math.exp(-2 * Math.PI * Math.min(params[slots[TONE]], sampleRate * 0.45) / sampleRate);
        const shape = SHAPES[Math.min(3, Math.max(0, Math.round(params[slots[MODE]])))];
        const mode = Math.min(2, Math.max(0, Math.round(params[slots[OVERSAMPLE]])));
        for (let c = 0; c < 2; c++) {
          const chain = chains[mode][c], x = ins[c], out = outs[c], delay = delays[c];
          const wait = chain.latency;
          const run = v => shape(v * drive);
          for (let i = 0; i < n; i++) {
            let wet = chain.run(x[i], run);
            hp[c] += (wet - hp[c]) * hpK;     // follows the offset
            wet -= hp[c];
            lp[c] += (wet - lp[c]) * toneK;
            wet = lp[c];
            const dry = delay.push(x[i], wait);
            out[i] = (dry + (wet - dry) * mix) * level;
          }
        }
      },
    };
  },
};
