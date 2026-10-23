// Multiband compressor, stereo: the sound is split into four bands (low, low mid, high mid, high) at three crossovers,
// the way the `split` node does it (24 dB per octave, phase-aligned, so with nothing compressed the bands add back to
// the original), each band is compressed on its own, and they are added together again. Every band has its own threshold,
// ratio, attack, release and gain; the knee is shared. Each band is stereo-linked (the louder channel drives it, both get
// the same gain), so the stereo image does not shift. `solo` lets you hear one band alone to set it up. `mix` blends
// with the dry sound, for parallel compression; `out` is the gain at the end.
import { Channel } from './split.js';

const DB = 20 / Math.LN10, LIN = Math.LN10 / 20;
const BANDS = ['low', 'lowmid', 'highmid', 'high'];
const PER = ['Thresh', 'Ratio', 'Attack', 'Release', 'Gain'];
const SHARED = ['f1', 'f2', 'f3', 'knee', 'solo', 'mix', 'out'];
const DEFAULTS = [
  [-22, 3, 30, 200, 0],   // low: a slow attack lets the front of a kick through
  [-22, 3, 18, 150, 0],
  [-24, 3, 8, 110, 0],
  [-26, 3, 3, 80, 0],     // high: quick, to catch hats and sibilance
];

export default {
  type: 'mbcomp',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'mbcomp',
  params: [
    { name: 'f1', min: 30, max: 2000, def: 120 },       // Hz, crossovers
    { name: 'f2', min: 100, max: 8000, def: 800 },
    { name: 'f3', min: 500, max: 18000, def: 5000 },
    { name: 'knee', min: 0, max: 24, def: 6 },           // dB
    { name: 'solo', min: 0, max: 4, def: 0, int: true }, // 0 all, 1 to 4 one band alone
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'out', min: -24, max: 24, def: 0 },          // dB
    ...BANDS.flatMap((b, k) => [
      { name: `${b}Thresh`, min: -60, max: 0, def: DEFAULTS[k][0] },          // dB
      { name: `${b}Ratio`, min: 1, max: 20, def: DEFAULTS[k][1] },
      { name: `${b}Attack`, min: 0.1, max: 200, def: DEFAULTS[k][2] },        // ms
      { name: `${b}Release`, min: 5, max: 2000, def: DEFAULTS[k][3] },        // ms
      { name: `${b}Gain`, min: -24, max: 24, def: DEFAULTS[k][4] },           // dB, after compression
    ]),
  ],
  create({ sampleRate, maxBlock = 512 }) {
    const ch = [new Channel(), new Channel()];
    const bandL = BANDS.map(() => new Float32Array(maxBlock)), bandR = BANDS.map(() => new Float32Array(maxBlock));
    const reduction = new Float64Array(4);   // dB, 0 or below, per band
    let f = null;
    const coef = ms => Math.exp(-1 / (ms * 0.001 * sampleRate));
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const f1 = params[slots[0]], f2 = Math.max(params[slots[1]], f1 * 1.1), f3 = Math.max(params[slots[2]], f2 * 1.1);
        if (!f) f = [f1, f2, f3];
        const slew = 1 - Math.exp(-n / (sampleRate * 0.02));
        f[0] += (f1 - f[0]) * slew; f[1] += (f2 - f[1]) * slew; f[2] += (f3 - f[2]) * slew;
        const g = f.map(v => Math.tan(Math.PI * Math.min(Math.max(v, 10), sampleRate * 0.45) / sampleRate));
        for (let c = 0; c < 2; c++) {
          const channel = ch[c], x = c ? inR : inL, bands = c ? bandR : bandL;
          channel.set(g[0], g[1], g[2]);
          for (let i = 0; i < n; i++) channel.run(x[i], bands, i);
          for (const s of channel.all) s.flush();
        }
        const W = params[slots[3]], solo = Math.round(params[slots[4]]), mix = params[slots[5]], out = Math.exp(params[slots[6]] * LIN);
        for (let b = 0; b < 4; b++) {
          const o = SHARED.length + b * PER.length;
          const T = params[slots[o]], R = Math.max(1, params[slots[o + 1]]), ca = coef(params[slots[o + 2]]), cr = coef(params[slots[o + 3]]), makeup = Math.exp(params[slots[o + 4]] * LIN);
          const L = bandL[b], Rr = bandR[b];
          let red = reduction[b];
          const active = solo === 0 || solo === b + 1;
          for (let i = 0; i < n; i++) {
            const level = DB * Math.log(Math.max(Math.abs(L[i]), Math.abs(Rr[i]), 1e-9)), over = level - T;
            let target;
            if (2 * over < -W) target = 0;
            else if (W > 0 && 2 * Math.abs(over) <= W) target = (1 / R - 1) * (over + W / 2) ** 2 / (2 * W);
            else target = over / R - over;
            red = target < red ? target + (red - target) * ca : target + (red - target) * cr;
            const gain = active ? Math.exp(red * LIN) * makeup : 0;
            L[i] *= gain; Rr[i] *= gain;
          }
          reduction[b] = Math.abs(red) < 1e-9 ? 0 : red;
        }
        for (let i = 0; i < n; i++) {
          const l = bandL[0][i] + bandL[1][i] + bandL[2][i] + bandL[3][i], r = bandR[0][i] + bandR[1][i] + bandR[2][i] + bandR[3][i];
          outL[i] = (inL[i] + (l - inL[i]) * mix) * out;
          outR[i] = (inR[i] + (r - inR[i]) * mix) * out;
        }
      },
    };
  },
};
