// Spectral compressor with a tilt: a compressor for every frequency bin at once. Each bin's level is compared with the
// threshold, and a bin that is over it is turned down by the ratio, so a loud boom or a harsh ring is pressed back to
// the level of the rest while the quiet parts stay where they are (a bin under the threshold is left alone). The gain of
// each bin follows the level with an attack and a release, and is smoothed across neighbouring bins so that it does not
// sound like a rain of tiny whistles. `tilt` then leans the whole spectrum, in dB for each octave about 1 kHz: positive
// brightens, negative darkens. The dry sound is delayed to match, so `mix` stays in time. Stereo, each side on its own.
// Latency is one frame: 1024, 2048 or 4096 samples (`size`).
import { Analyser, Resynth, sizeOf, mirror, peakOf, MAX_SIZE } from './stft.js';

const THRESH = 0, RATIO = 1, TILT = 2, ATTACK = 3, RELEASE = 4, SMOOTH = 5, MAKEUP = 6, MIX = 7, SIZE = 8;

export default {
  type: 'specdyn',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'specdyn',
  latency: p => sizeOf(p.size) - 1,   // one frame
  params: [
    { name: 'threshold', min: -80, max: 0, def: -36 },   // dB (full scale is 0): bins louder than this are turned down
    { name: 'ratio', min: 1, max: 20, def: 4 },          // 4 means 4 dB over the threshold comes out 1 dB over
    { name: 'tilt', min: -6, max: 6, def: 0 },           // dB per octave about 1 kHz
    { name: 'attack', min: 1, max: 500, def: 20 },       // ms
    { name: 'release', min: 10, max: 3000, def: 250 },   // ms
    { name: 'smooth', min: 0, max: 1, def: 0.3 },        // how far the gain is averaged across neighbouring bins
    { name: 'makeup', min: -12, max: 24, def: 0 },       // dB
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
  ],
  create({ sampleRate }) {
    const bins = MAX_SIZE / 2 + 1;
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const want = new Float64Array(bins), soft = new Float64Array(bins);
    let n = 0, ch = null;

    const start = size => {
      n = size;
      ch = [0, 1].map(() => ({ a: new Analyser(n), r: new Resynth(n), gain: new Float64Array(bins) }));   // gain: each bin's gain now, in dB
    };

    const frame = (c, p) => {
      const half = n >> 1, s = ch[c], peak = peakOf(n), binHz = sampleRate / n;
      for (let k = 0; k <= half; k++) {
        const level = 20 * Math.log10(Math.hypot(re[k], im[k]) / peak + 1e-9);
        const over = level - p.threshold;
        want[k] = over > 0 ? -over * (1 - 1 / p.ratio) : 0;
      }
      const reach = p.reach;   // average the wanted gains across neighbours
      for (let k = 0; k <= half; k++) {
        if (reach === 0) { soft[k] = want[k]; continue; }
        let sum = 0, count = 0;
        for (let j = Math.max(0, k - reach); j <= Math.min(half, k + reach); j++) { sum += want[j]; count++; }
        soft[k] = sum / count;
      }
      for (let k = 0; k <= half; k++) {
        const g = s.gain[k], a = soft[k] < g ? p.attack : p.release;   // more reduction is the attack
        s.gain[k] = a * g + (1 - a) * soft[k];
        const tilt = k === 0 ? 0 : p.tilt * Math.log2((k * binHz) / 1000);
        const f = Math.pow(10, (s.gain[k] + tilt + p.makeup) / 20);
        re[k] *= f; im[k] *= f;
      }
      mirror(re, im, n);
      s.r.add(re, im, s.a.t);
    };

    return {
      process(inputs, outputs, count, params, slots) {
        const size = sizeOf(params[slots[SIZE]]);
        if (size !== n) start(size);
        const hop = n / 4, mix = params[slots[MIX]];
        const p = {
          threshold: params[slots[THRESH]], ratio: Math.max(1, params[slots[RATIO]]),
          tilt: params[slots[TILT]], makeup: params[slots[MAKEUP]],
          attack: Math.exp(-hop / (sampleRate * params[slots[ATTACK]] * 0.001)),
          release: Math.exp(-hop / (sampleRate * params[slots[RELEASE]] * 0.001)),
          reach: Math.round(params[slots[SMOOTH]] * 8),
        };
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
