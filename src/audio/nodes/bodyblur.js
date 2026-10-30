// Body blur: the sound is cut into frames, and each frame is split into its body (held tones: pads, voices, the sustain
// of a note) and its hits (attacks, clicks, consonants), the way the harmonic/percussive split does it. Only the body is
// smoothed; the hits go through untouched and come out in the same frame, so they stay exactly in time.
//
//   smooth  blurs the body's spectrum across frequency: the fine, gritty detail between harmonics melts away
//   time    lets each bin of the body follow a running average, which rounds the stair-steps of a crushed sound
//   round   a gentle high cut on the body only, for the fizz and aliasing that crushing leaves at the top
//   split   how firmly body and hits are told apart (1 soft, 8 nearly a switch)
//   quality standard, or eco: the split is worked out every other frame, for about half the CPU
//
// The body keeps its own phases, so pitch and articulation are kept. Stereo, each side on its own. Latency is one frame:
// 1024, 2048 or 4096 samples (`size`). The dry sound is delayed to match, so `mix` stays in time.
import { Analyser, Resynth, sizeOf, mirror, MAX_SIZE } from './stft.js';
import { Masker, maskSettings } from '../hpmask.js';

const SMOOTH = 0, TIME = 1, ROUND = 2, SPLIT = 3, SIZE = 4, QUALITY = 5, MIX = 6;
const LEAN = 3;   // the benefit of the doubt given to the body, so the quiet floor between harmonics counts as body
const LENGTH_MS = 250, WIDTH_HZ = 250;   // how long a tone must last, how wide a hit must be: the split's own defaults

export default {
  type: 'bodyblur',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'bodyblur',
  params: [
    { name: 'smooth', min: 0, max: 1, def: 0.4 },
    { name: 'time', min: 0, max: 500, def: 80 },       // ms: how long the running average takes to settle
    { name: 'round', min: 0, max: 1, def: 0.25 },
    { name: 'split', min: 1, max: 8, def: 2 },
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
    { name: 'quality', min: 0, max: 1, def: 0, int: true },   // 0 standard, 1 eco
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const bodyPart = new Float64Array(MAX_SIZE / 2 + 1);    // how much of each bin is body, this frame
    const mag = new Float64Array(MAX_SIZE / 2 + 1);         // the body's magnitudes
    const soft = new Float64Array(MAX_SIZE / 2 + 1);        // ... after the blur across frequency
    const sum = new Float64Array(MAX_SIZE / 2 + 2);         // running sums, for the blur
    let n = 0, ch = null;

    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({
        a: new Analyser(n), out: new Resynth(n), mask: new Masker(n),
        body: new Float64Array(n / 2 + 1),    // the split, kept for the frames that do not work it out (eco)
        avg: new Float64Array(n / 2 + 1), primed: false, count: 0,
      }));
    };

    // Blur across frequency: a box a few bins wide. The blur keeps the body's loudness (its energy), so a tone gets
    // wider rather than quieter.
    const blurAcross = (half, radius) => {
      sum[0] = 0;
      let before = 0, after = 0;
      for (let k = 0; k <= half; k++) { sum[k + 1] = sum[k] + mag[k]; before += mag[k] * mag[k]; }
      for (let k = 0; k <= half; k++) {
        const lo = Math.max(0, k - radius), hi = Math.min(half, k + radius);
        soft[k] = (sum[hi + 1] - sum[lo]) / (hi - lo + 1);
        after += soft[k] * soft[k];
      }
      const keep = after > 1e-18 ? Math.sqrt(before / after) : 1;
      for (let k = 0; k <= half; k++) soft[k] *= keep;
    };

    // One frame of one channel: the spectrum is in re and im.
    const frame = (c, p) => {
      const half = n >> 1, s = ch[c];
      s.mask.listen(re, im);
      if (!p.eco || s.count % 2 === 0) s.mask.body(p.split, s.body);
      s.count++;
      for (let k = 0; k <= half; k++) mag[k] = Math.hypot(re[k], im[k]) * s.body[k];   // the body's magnitudes
      if (p.radius > 0) blurAcross(half, p.radius); else for (let k = 0; k <= half; k++) soft[k] = mag[k];
      if (!s.primed) { s.avg.set(soft.subarray(0, half + 1)); s.primed = true; }
      else for (let k = 0; k <= half; k++) s.avg[k] = p.a * s.avg[k] + (1 - p.a) * soft[k];   // blur across time
      for (let k = 0; k <= half; k++) {
        const m = Math.hypot(re[k], im[k]), body = s.avg[k] * p.cut[k];
        const unit = m > 1e-12 ? body / m : 0, hit = 1 - s.body[k];   // the body keeps the bin's own phase; the hit is left as it is
        re[k] = re[k] * hit + re[k] * unit;
        im[k] = im[k] * hit + im[k] * unit;
      }
      mirror(re, im, n);
      s.out.add(re, im, s.a.t);
    };

    let cutFor = -1, cutRound = -1, cut = null;   // the high cut's gain for every bin, worked out when `round` or the frame length changes
    const highCut = round => {
      if (cutFor === n && cutRound === round) return cut;
      cutFor = n; cutRound = round; cut = new Float64Array(n / 2 + 1);
      const corner = 800 + 19200 * (1 - round) * (1 - round);
      for (let k = 0; k < cut.length; k++) { const f = (k * sampleRate) / n; cut[k] = round <= 0 ? 1 : 1 / Math.sqrt(1 + (f / corner) * (f / corner)); }
      return cut;
    };

    return {
      process(inputs, outputs, count, params, slots) {
        const want = sizeOf(params[slots[SIZE]]);
        if (want !== n) start(want);
        const hop = n / 4, mix = params[slots[MIX]], time = params[slots[TIME]];
        const p = {
          split: maskSettings(sampleRate, n, LENGTH_MS, WIDTH_HZ, params[slots[SPLIT]], LEAN),
          radius: Math.round(params[slots[SMOOTH]] * 8),   // bins each side
          a: time < 1 ? 0 : Math.exp(-hop / (sampleRate * time * 0.001)),
          cut: highCut(params[slots[ROUND]]),
          eco: params[slots[QUALITY]] >= 0.5,
        };
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], o = outputs[0][c];
          for (let i = 0; i < count; i++) {
            if (s.a.push(x[i])) { s.a.fill(re, im); frame(c, p); }
            const wet = s.out.take(s.a.t), dry = s.a.delayed();
            o[i] = dry + (wet - dry) * mix;
          }
        }
      },
    };
  },
};
