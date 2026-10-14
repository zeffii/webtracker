// Feed-forward compressor with a soft knee, stereo-linked: the louder channel drives the
// detector and both channels get the same gain. The gain reduction is smoothed in dB with
// separate attack and release times. mix blends in the dry signal for parallel compression.
const THRESHOLD = 0, RATIO = 1, ATTACK = 2, RELEASE = 3, KNEE = 4, MAKEUP = 5, MIX = 6;
const DB = 20 / Math.LN10, LIN = Math.LN10 / 20;   // dB per neper, and its inverse

export default {
  type: 'compressor',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'compressor',
  params: [
    { name: 'threshold', min: -60, max: 0, def: -18 },   // dB
    { name: 'ratio', min: 1, max: 20, def: 4 },
    { name: 'attack', min: 0.1, max: 200, def: 10 },     // ms
    { name: 'release', min: 5, max: 2000, def: 150 },    // ms
    { name: 'knee', min: 0, max: 24, def: 6 },           // dB
    { name: 'makeup', min: 0, max: 24, def: 0 },         // dB
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    let reduction = 0;   // gain reduction in dB, 0 or below
    const coef = ms => Math.exp(-1 / (ms * 0.001 * sampleRate));
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const T = params[slots[THRESHOLD]], R = Math.max(1, params[slots[RATIO]]), W = params[slots[KNEE]];
        const ca = coef(params[slots[ATTACK]]), cr = coef(params[slots[RELEASE]]);
        const makeup = Math.exp(params[slots[MAKEUP]] * LIN), mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          const level = DB * Math.log(Math.max(Math.abs(l), Math.abs(r), 1e-9));   // dBFS
          const over = level - T;
          let target;   // wanted gain change in dB
          if (2 * over < -W) target = 0;
          else if (W > 0 && 2 * Math.abs(over) <= W) target = (1 / R - 1) * (over + W / 2) ** 2 / (2 * W);
          else target = over / R - over;
          reduction = target < reduction ? target + (reduction - target) * ca : target + (reduction - target) * cr;
          const g = Math.exp(reduction * LIN) * makeup;
          outL[i] = l + (l * g - l) * mix;
          outR[i] = r + (r * g - r) * mix;
        }
        if (Math.abs(reduction) < 1e-9) reduction = 0;
      },
    };
  },
};
