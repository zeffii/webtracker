// Spectral islands: the piano roll's "add islands", as an effect. The sound is cut into long overlapping frames, and in
// each the peak inside every loud blob of the spectrum is found; a thin ridge of sound around each peak is kept and the
// rest (the shoulders of the blobs, the smear between the notes, the hiss) is turned down. Pitched sound comes out
// cleaner and thinner, with the notes standing alone, and a noisy recording of a chord is easier to hear.
//   contrast  sharpens first: the quiet part of the spectrum falls away and the blobs get edges.
//   islands   how far everything off a peak is turned down.
//   depth     the most it is turned down, in dB.
//   smooth    how slowly each frequency's gain changes from frame to frame; low is more watery, high is smoother.
// The frames are long (the notes need to be told apart) and so this adds a lot of delay: from about 43 ms to 340 ms
// at 48 kHz (`size`). The dry sound is delayed to match, so `mix` stays in time. Stereo, each side on its own.
import { Analyser, Resynth, mirror, peakOf } from './stft.js';
import { IslandMask } from '../islandcore.js';

export const SIZES = [2048, 4096, 8192, 16384];
export const sizeOf = value => SIZES[Math.min(3, Math.max(0, Math.round(value)))];
const CONTRAST = 0, ISLANDS = 1, DEPTH = 2, SMOOTH = 3, MIX = 4, SIZE = 5;
const REF_FALL = 12;   // dB per second the loudest-heard level falls by, so a quiet part after a loud one is still seen

export default {
  type: 'islands',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'islands',
  latency: p => sizeOf(p.size) - 1,   // one frame
  params: [
    { name: 'contrast', min: 0, max: 1, def: 0.5 },
    { name: 'islands', min: 0, max: 1, def: 0.7 },
    { name: 'depth', min: 6, max: 80, def: 40 },       // dB
    { name: 'smooth', min: 0, max: 0.95, def: 0.5 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'size', min: 0, max: 3, def: 1, int: true },   // frame length: 2048, 4096, 8192, 16384 samples
  ],
  create({ sampleRate }) {
    const re = new Float64Array(16384), im = new Float64Array(16384);
    let n = 0, ch = null;
    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({ a: new Analyser(n), r: new Resynth(n), mask: new IslandMask(n), ref: -Infinity }));
    };
    const frame = (c, p) => {
      const s = ch[c];
      const top = s.mask.measure(re, im, peakOf(n));
      s.ref = Math.max(top, s.ref - REF_FALL * (n / 4) / sampleRate);
      s.mask.decide(s.ref, p);
      s.mask.apply(re, im);
      mirror(re, im, n);
      s.r.add(re, im, s.a.t);
    };
    return {
      process(inputs, outputs, count, params, slots) {
        const size = sizeOf(params[slots[SIZE]]);
        if (size !== n) start(size);
        const mix = params[slots[MIX]];
        const p = { contrast: params[slots[CONTRAST]], islands: params[slots[ISLANDS]], depth: params[slots[DEPTH]], smooth: params[slots[SMOOTH]] };
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], y = outputs[0][c];
          for (let i = 0; i < count; i++) {
            if (s.a.push(x[i])) { s.a.fill(re, im); frame(c, p); }
            const dry = s.a.delayed(), wet = s.r.take(s.a.t);
            y[i] = dry + (wet - dry) * mix;
          }
        }
      },
    };
  },
};
