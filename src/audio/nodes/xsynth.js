// Cross synthesis: the spectral shape of the `mod` input is laid over the sound at `in`. Both are cut into frames and
// turned into spectra. The broad shape of each (its envelope, found by averaging neighbouring bins: the formants of a
// voice, the colour of a drum) is measured, the carrier's own shape is taken away and the modulator's put in its
// place, and the carrier keeps its own phases, so its pitch and texture stay. A voice on `mod` makes a pad or noise
// talk; a drum loop on `mod` makes a sustained chord chop and boom to it. It is smoother than a vocoder, with no
// bands to hear. Where the modulator is silent the carrier is silent too. Stereo, each side on its own.
//   amount  how much of the modulator's shape is used (0 none, 1 all)
//   smooth  how broad the shape is taken to be: small keeps the modulator's finer detail, large only its broad colour
//   detail  also lend the modulator's own fine structure (its harmonics), so a pitched voice makes noise pitched
// Latency is one frame: 1024, 2048 or 4096 samples (`size`).
import { Analyser, Resynth, sizeOf, mirror, MAX_SIZE } from './stft.js';

const AMOUNT = 0, SMOOTH = 1, DETAIL = 2, MIX = 3, SIZE = 4;
const BOOST = 30;   // the most any bin is lifted, in dB, so a quiet carrier is not blown up by a loud modulator

export default {
  type: 'xsynth',
  inputs: ['in', 'mod'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', mod: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'xsynth',
  latency: p => sizeOf(p.size) - 1,   // one frame
  params: [
    { name: 'amount', min: 0, max: 1, def: 1 },
    { name: 'smooth', min: 0, max: 1, def: 0.3 },
    { name: 'detail', min: 0, max: 1, def: 0 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
  ],
  create({ sampleRate }) {
    const bins = MAX_SIZE / 2 + 1;
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const reM = new Float64Array(MAX_SIZE), imM = new Float64Array(MAX_SIZE);
    const magC = new Float64Array(bins), magM = new Float64Array(bins), envC = new Float64Array(bins), envM = new Float64Array(bins);
    const sum = new Float64Array(bins + 1);
    let n = 0, ch = null;

    const start = size => { n = size; ch = [0, 1].map(() => ({ carrier: new Analyser(n), mod: new Analyser(n), out: new Resynth(n) })); };

    // The broad shape of a magnitude spectrum: a box average whose width grows with the bin, as pitch does.
    const envelope = (mag, out, half, smooth) => {
      sum[0] = 0;
      for (let k = 0; k <= half; k++) sum[k + 1] = sum[k] + mag[k];
      for (let k = 0; k <= half; k++) {
        const r = Math.max(1, Math.floor(smooth * (2 + k * 0.06)));
        const lo = Math.max(0, k - r), hi = Math.min(half, k + r);
        out[k] = (sum[hi + 1] - sum[lo]) / (hi - lo + 1);
      }
    };

    const frame = (c, p) => {
      const half = n >> 1, s = ch[c], floor = n * 1e-6, limit = Math.pow(10, BOOST / 20);
      s.mod.fill(reM, imM);
      for (let k = 0; k <= half; k++) { magC[k] = Math.hypot(re[k], im[k]); magM[k] = Math.hypot(reM[k], imM[k]); }
      envelope(magC, envC, half, p.smooth); envelope(magM, envM, half, p.smooth);
      for (let k = 0; k <= half; k++) {
        let g = Math.pow((envM[k] + floor) / (envC[k] + floor), p.amount);
        if (p.detail > 0) g *= Math.pow((magM[k] + floor) / (envM[k] + floor), p.detail);
        g = Math.min(limit, g);
        re[k] *= g; im[k] *= g;
      }
      mirror(re, im, n);
      s.out.add(re, im, s.carrier.t);
    };

    return {
      process(inputs, outputs, count, params, slots) {
        const size = sizeOf(params[slots[SIZE]]);
        if (size !== n) start(size);
        const mix = params[slots[MIX]];
        const p = { amount: params[slots[AMOUNT]], smooth: params[slots[SMOOTH]] * 6, detail: params[slots[DETAIL]] };
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], m = inputs[1][c], y = outputs[0][c];
          for (let i = 0; i < count; i++) {
            s.mod.push(m[i]);
            if (s.carrier.push(x[i])) { s.carrier.fill(re, im); frame(c, p); }
            const dry = s.carrier.delayed(), wet = s.out.take(s.carrier.t);
            y[i] = dry + (wet - dry) * mix;
          }
        }
      },
    };
  },
};
