// Harmonic / percussive split: the sound's spectrum is drawn as a picture (frequency up, time across). Held notes make
// horizontal lines, hits and clicks make vertical ones. A median taken along time keeps the lines (the harmonic part),
// a median taken along frequency keeps the stripes (the percussive part), and the two decide, bin by bin, how much of the
// sound goes to each output. The masks add up to one, so wiring both outputs back together gives the sound again
// (one frame late). Stereo, each side on its own. Latency is one frame: 1024, 2048 or 4096 samples (`size`).
//
//   harm  the tones: pads, bass, voices, the body of a note
//   perc  the hits: drums, plucks' attacks, consonants
//
// `length` is how long a held tone must last to count as harmonic, `width` how wide a hit must be (in Hz) to count as
// percussive, `sharp` how hard the two are told apart (1 soft, 8 nearly a switch).
import { Analyser, Resynth, sizeOf, mirror, MAX_SIZE } from './stft.js';
import { Masker, maskSettings } from '../hpmask.js';

const LENGTH = 0, WIDTH = 1, SHARP = 2, SIZE = 3;

export default {
  type: 'hpss',
  inputs: ['in'],
  outputs: ['harm', 'perc'],
  category: 'Effects',
  kinds: { in: 'stereo', harm: 'stereo', perc: 'stereo' },
  shape: 'box',
  glyph: 'hpss',
  params: [
    { name: 'length', min: 40, max: 600, def: 250 },    // ms: how long a held tone lasts, for the median along time
    { name: 'width', min: 50, max: 800, def: 250 },     // Hz: how wide a hit is, for the median along frequency
    { name: 'sharp', min: 1, max: 8, def: 2 },          // the mask's exponent
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
  ],
  create({ sampleRate }) {
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const reP = new Float64Array(MAX_SIZE), imP = new Float64Array(MAX_SIZE);
    const body = new Float64Array(MAX_SIZE / 2 + 1);
    let n = 0, ch = null;

    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({ a: new Analyser(n), harm: new Resynth(n), perc: new Resynth(n), mask: new Masker(n) }));
    };

    // One frame of one channel: the spectrum is in re and im.
    const frame = (c, p) => {
      const half = n >> 1, s = ch[c];
      s.mask.listen(re, im);
      s.mask.body(p, body);
      for (let k = 0; k <= half; k++) {
        const mh = body[k], mp = 1 - mh;
        reP[k] = re[k] * mp; imP[k] = im[k] * mp;
        re[k] *= mh; im[k] *= mh;
      }
      mirror(re, im, n); mirror(reP, imP, n);
      s.harm.add(re, im, s.a.t); s.perc.add(reP, imP, s.a.t);
    };

    return {
      process(inputs, outputs, count, params, slots) {
        const want = sizeOf(params[slots[SIZE]]);
        if (want !== n) start(want);
        const p = maskSettings(sampleRate, n, params[slots[LENGTH]], params[slots[WIDTH]], params[slots[SHARP]]);
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], h = outputs[0][c], q = outputs[1][c];
          for (let i = 0; i < count; i++) {
            if (s.a.push(x[i])) { s.a.fill(re, im); frame(c, p); }
            h[i] = s.harm.take(s.a.t); q[i] = s.perc.take(s.a.t);
          }
        }
      },
    };
  },
};
