// Multiband saturator, stereo: the sound is split into four bands (low, low mid, high mid, high) at three crossovers, the way
// the `split` node does it (24 dB per octave, phase-aligned, so with nothing changed the bands add back to the original), each
// band is saturated on its own, and they are added together again. Every band has its own drive and gain, so the lows can be
// warmed gently while the highs get a bite, without the lows turning the highs to mush (which is what happens when one
// curve gets the whole sound). `type`, `bias` and `quality` are shared (see saturator.js and saturation.js). `solo` lets you
// hear one band alone. `mix` blends with the dry sound and `out` is the level at the end.
import { Channel } from './split.js';
import { Stage, settings, makeDelay, offsetK, TYPES, QUALITY, qualityOf, dbToGain } from './saturation.js';

const BANDS = ['low', 'lowmid', 'highmid', 'high'];
const SHARED = ['f1', 'f2', 'f3', 'type', 'bias', 'solo', 'mix', 'out', 'quality'];
const PER = ['Drive', 'Gain'];
const DEFAULT_DRIVE = [6, 8, 10, 12];   // dB: gentler on the lows

export default {
  type: 'mbsat',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'mbsat',
  params: [
    { name: 'f1', min: 30, max: 2000, def: 120 },        // Hz, crossovers
    { name: 'f2', min: 100, max: 8000, def: 800 },
    { name: 'f3', min: 500, max: 18000, def: 5000 },
    { name: 'type', min: 0, max: 3, def: 0, int: true },  // soft, tape, tube, clip
    { name: 'bias', min: -1, max: 1, def: 0 },
    { name: 'solo', min: 0, max: 4, def: 0, int: true },  // 0 all, 1 to 4 one band alone
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'out', min: -24, max: 12, def: 0 },           // dB
    { name: 'quality', min: 0, max: 2, def: 0, int: true },   // standard, eco, hq
    ...BANDS.flatMap((b, k) => [
      { name: `${b}Drive`, min: 0, max: 36, def: DEFAULT_DRIVE[k] },   // dB
      { name: `${b}Gain`, min: -24, max: 12, def: 0 },                  // dB, after the curve
    ]),
  ],
  create({ sampleRate, maxBlock = 512 }) {
    const split = [new Channel(), new Channel()];
    const bandL = BANDS.map(() => new Float32Array(maxBlock)), bandR = BANDS.map(() => new Float32Array(maxBlock));
    const stages = [0, 1].map(() => BANDS.map(() => new Stage())), dryDelay = [makeDelay(), makeDelay()];
    const hpK = offsetK(sampleRate);
    const sums = [new Float64Array(maxBlock), new Float64Array(maxBlock)];
    let f = null;
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const f1 = params[slots[0]], f2 = Math.max(params[slots[1]], f1 * 1.1), f3 = Math.max(params[slots[2]], f2 * 1.1);
        if (!f) f = [f1, f2, f3];
        const slew = 1 - Math.exp(-n / (sampleRate * 0.02));
        f[0] += (f1 - f[0]) * slew; f[1] += (f2 - f[1]) * slew; f[2] += (f3 - f[2]) * slew;
        const g = f.map(v => Math.tan(Math.PI * Math.min(Math.max(v, 10), sampleRate * 0.45) / sampleRate));
        for (let c = 0; c < 2; c++) {
          const channel = split[c], x = ins[c], bands = c ? bandR : bandL;
          channel.set(g[0], g[1], g[2]);
          for (let i = 0; i < n; i++) channel.run(x[i], bands, i);
          for (const s of channel.all) s.flush();
        }
        const type = params[slots[3]], bias = params[slots[4]], solo = Math.round(params[slots[5]]), mix = params[slots[6]], out = dbToGain(params[slots[7]]);
        const quality = qualityOf(params[slots[8]]);
        const wait = stages[0][0].latency(quality);
        sums[0].fill(0, 0, n); sums[1].fill(0, 0, n);
        for (let b = 0; b < 4; b++) {
          const o = SHARED.length + b * PER.length;
          const s = settings(type, params[slots[o]], bias), gain = dbToGain(params[slots[o + 1]]);
          const active = solo === 0 || solo === b + 1;
          for (let c = 0; c < 2; c++) {
            const band = c ? bandR[b] : bandL[b], stage = stages[c][b], sum = sums[c];
            for (let i = 0; i < n; i++) {
              const wet = stage.run(band[i], s, quality, hpK);   // every band runs, soloed or not, so the filters keep their state
              if (active) sum[i] += wet * gain;
            }
          }
        }
        for (let c = 0; c < 2; c++) {
          const x = ins[c], y = outs[c], sum = sums[c];
          for (let i = 0; i < n; i++) {
            const dry = dryDelay[c].push(x[i], wait);
            y[i] = (dry + (sum[i] - dry) * mix) * out;
          }
        }
      },
    };
  },
};
export { TYPES, QUALITY };
