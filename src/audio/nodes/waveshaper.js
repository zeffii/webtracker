// Waveshaper: y = curve(x * drive), the curve a table you draw (see the curve editor in the
// patcher panel), read with linear interpolation. Inputs beyond +-1 are clipped to the ends
// of the table. oversample 0, 1, 2 runs it at 1x, 2x or 4x to cut the aliasing; the dry signal
// is delayed to match. out = (dry * (1 - mix) + wet * mix) * level. Stereo in and out.
import { CURVE_POINTS, normalizeCurve } from './curves.js';
import { Delay, Oversampler } from './oversample.js';

const DRIVE = 0, MIX = 1, OVERSAMPLE = 2, LEVEL = 3;

export default {
  type: 'waveshaper',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'waveshaper',
  editor: 'curve',   // the patcher panel offers the curve editor for this node
  params: [
    { name: 'drive', min: 0.1, max: 24, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'oversample', min: 0, max: 2, def: 1, int: true },   // 0: 1x, 1: 2x, 2: 4x
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ data }) {
    let table = normalizeCurve(data?.curve);
    const shape = x => {
      const p = (Math.min(Math.max(x, -1), 1) + 1) * 0.5 * (CURVE_POINTS - 1);
      const k = p | 0, f = p - k, k1 = k + 1 < CURVE_POINTS ? k + 1 : k;
      return table[k] + (table[k1] - table[k]) * f;
    };
    // one oversampler per factor and channel, so switching the setting needs no allocation
    const chains = [1, 2, 4].map(f => [new Oversampler(f), new Oversampler(f)]);
    const delays = [new Delay(48), new Delay(48)];
    return {
      message(msg) { if (msg.type === 'curve') table = normalizeCurve(msg.points); },
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const drive = params[slots[DRIVE]], mix = params[slots[MIX]], level = params[slots[LEVEL]];
        const mode = Math.min(2, Math.max(0, Math.round(params[slots[OVERSAMPLE]])));
        for (let c = 0; c < 2; c++) {
          const chain = chains[mode][c], x = ins[c], out = outs[c], delay = delays[c];
          const wait = chain.latency;
          const run = v => shape(v * drive);
          for (let i = 0; i < n; i++) {
            const wet = chain.run(x[i], run);
            const dry = delay.push(x[i], wait);
            out[i] = (dry + (wet - dry) * mix) * level;
          }
        }
      },
    };
  },
};
