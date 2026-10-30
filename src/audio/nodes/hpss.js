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

const LENGTH = 0, WIDTH = 1, SHARP = 2, SIZE = 3;
const MAX_FRAMES = 25, MAX_BINS = 25;   // the longest medians: more costs a lot and changes little

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
    const bins = MAX_SIZE / 2 + 1;
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const reP = new Float64Array(MAX_SIZE), imP = new Float64Array(MAX_SIZE);
    const mag = new Float64Array(bins), across = new Float64Array(bins), along = new Float64Array(bins);
    const pick = new Float64Array(MAX_FRAMES);
    let n = 0, ch = null;

    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({
        a: new Analyser(n), harm: new Resynth(n), perc: new Resynth(n),
        history: new Float32Array(MAX_FRAMES * (n / 2 + 1)), frames: 0,   // the last frames' magnitudes, round and round
      }));
    };
    // The middle value of the first `count` numbers of `pick` (a small insertion sort: the lists are short).
    const middle = count => {
      for (let i = 1; i < count; i++) { const v = pick[i]; let j = i - 1; while (j >= 0 && pick[j] > v) { pick[j + 1] = pick[j]; j--; } pick[j + 1] = v; }
      return pick[count >> 1];
    };
    const odd = (v, max) => Math.max(3, Math.min(max, Math.round(v) | 1));

    // One frame of one channel: the spectrum is in re and im.
    const frame = (c, p) => {
      const half = n >> 1, top = half + 1, s = ch[c];
      for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]);
      const slot = s.frames % MAX_FRAMES;
      s.history.set(mag.subarray(0, top), slot * top);
      s.frames++;
      const have = Math.min(s.frames, p.frames);
      for (let k = 0; k <= half; k++) {   // along time: the last frames of this bin
        for (let f = 0; f < have; f++) pick[f] = s.history[((s.frames - 1 - f + MAX_FRAMES * 4) % MAX_FRAMES) * top + k];
        along[k] = middle(have);
      }
      const reach = p.bins >> 1;
      for (let k = 0; k <= half; k++) {   // across frequency: this frame's neighbours of the bin
        const lo = Math.max(0, k - reach), hi = Math.min(half, k + reach);
        let count = 0;
        for (let j = lo; j <= hi; j++) pick[count++] = mag[j];
        across[k] = middle(count);
      }
      for (let k = 0; k <= half; k++) {
        const h = Math.pow(along[k], p.sharp), q = Math.pow(across[k], p.sharp), total = h + q;
        const mh = total > 1e-12 ? h / total : 0.5, mp = 1 - mh;
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
        const hop = n / 4;
        const p = {
          frames: odd((params[slots[LENGTH]] * 0.001 * sampleRate) / hop, MAX_FRAMES),
          bins: odd(params[slots[WIDTH]] / (sampleRate / n), MAX_BINS),
          sharp: params[slots[SHARP]],
        };
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
