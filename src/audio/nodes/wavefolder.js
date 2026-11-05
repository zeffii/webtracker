// Wave folder: the louder the wave is pushed in, the more times it turns round at the edge and comes back, so a plain
// sine grows harmonics. `symmetry` moves the wave off centre first, so the folds are uneven and add the even harmonics.
// The `fold` input (control, added to the amount) lets an envelope or LFO sweep the timbre. The folder runs at 2x or
// 4x the rate (`oversample`) to keep the new harmonics from folding back as aliasing; the dry signal is delayed to match.
import { Delay, Oversampler } from './oversample.js';
import { oversampleLatency } from '../latency.js';
import { foldWave, DcBlock } from '../westcore.js';

const FOLD = 0, SYMMETRY = 1, DRIVE = 2, MIX = 3, OVERSAMPLE = 4, LEVEL = 5;

export default {
  type: 'wavefolder',
  inputs: ['in', 'fold'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', fold: 'control', out: 'stereo' },
  shape: 'box',
  glyph: 'wavefolder',
  latency: p => oversampleLatency([1, 2, 4][Math.min(2, Math.max(0, Math.round(p.oversample)))]),
  params: [
    { name: 'fold', min: 0, max: 1, def: 0.4 },
    { name: 'symmetry', min: -1, max: 1, def: 0 },
    { name: 'drive', min: 0.1, max: 4, def: 1 },        // input gain before the folder
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'oversample', min: 0, max: 2, def: 1, int: true },   // 0: 1x, 1: 2x, 2: 4x
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ connected }) {
    const foldOn = connected[1];
    const chains = [1, 2, 4].map(f => [new Oversampler(f), new Oversampler(f)]);
    const delays = [new Delay(48), new Delay(48)];
    const dc = [new DcBlock(), new DcBlock()];
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0], mod = inputs[1];
        const base = params[slots[FOLD]], sym = params[slots[SYMMETRY]] * 0.6, drive = params[slots[DRIVE]];
        const mix = params[slots[MIX]], level = params[slots[LEVEL]];
        const mode = Math.min(2, Math.max(0, Math.round(params[slots[OVERSAMPLE]])));
        for (let c = 0; c < 2; c++) {
          const chain = chains[mode][c], x = ins[c], out = outs[c], delay = delays[c];
          const wait = chain.latency;
          for (let i = 0; i < n; i++) {
            const amount = Math.max(0, Math.min(1, base + (foldOn ? mod[i] : 0)));
            const wet = dc[c].run(chain.run(x[i], v => foldWave(v * drive, amount, sym)));
            const dry = delay.push(x[i], wait);
            out[i] = (dry + (wet - dry) * mix) * level;
          }
        }
      },
    };
  },
};
