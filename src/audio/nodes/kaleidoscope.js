// Kaleidoscope: a spectral effect that arrays a band of the sound across the whole range, like the facets of a kaleidoscope. You choose a
// band (from `low` to `high` Hz, drawn as a lit strip on the panel's spectrum). The band is repeated up and down the range in steps of its
// own width, so a copy of a two-octave band sits two octaves higher or lower than the source. With `mode` mirror every second copy is read
// backwards (intervals turn upside down inside it, and the seams join without a step); with repeat they all run the same way. With the
// third mode, overtone, there are no tiles: the band is copied to the overtone series instead (x2, x3, x4 ... of each tone's own frequency,
// and the undertones x1/2, x1/3 ... below), so the copies bunch together going up, the way the partials of a note do.
//   rotate  slides the pattern along the range, in band widths (a slow sweep turns the kaleidoscope)
//   copies  0 fills the whole range; N keeps the source tile and N copies either side
//   stretch (overtone) pulls the multiples off the whole numbers, upward, like a stiff string or a bell
//   decay   (overtone) how fast the higher copies get quieter: 0 all as loud as the source, 0.5 as 1/n, 1 as 1/n squared
//   edge    how far in semitones the tiles fade at their seams where the ends do not match (repeat mode, and the last copy)
//   level   the level of the arrayed sound
//   mix     dry against arrayed
//   size    the frame length: 1024, 2048 or 4096 samples (longer is cleaner in the low range and later)
// The work is done on the spectrum frame by frame (the same machinery as the spectral dynamics and the harmonic/percussive split), so the
// latency is one frame. Stereo, each side on its own. While its panel is open the node reports the spectrum it hears and the spectrum it makes,
// about twenty times a second, for the picture.
import { Analyser, Resynth, sizeOf, mirror, peakOf, MAX_SIZE } from './stft.js';
import { Kaleidoscoper, pictureOf } from '../kalcore.js';

const LOW = 0, HIGH = 1, MODE = 2, ROTATE = 3, COPIES = 4, EDGE = 5, LEVEL = 6, MIX = 7, SIZE = 8, STRETCH = 9, DECAY = 10;
const POINTS = 200;       // values in the picture
const REPORT_EVERY = 4;   // frames between two pictures
const WATCH_SECONDS = 3;  // the panel asks again every second; without it the node stops reporting

export default {
  type: 'kaleidoscope',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'kaleidoscope',
  editor: 'kaleidoscope',
  latency: p => sizeOf(p.size) - 1,   // one frame
  params: [
    { name: 'low', min: 40, max: 8000, def: 440 },       // Hz: the bottom of the band
    { name: 'high', min: 60, max: 16000, def: 1760 },    // Hz: the top of the band
    { name: 'mode', min: 0, max: 2, def: 0, int: true },   // 0 mirror, 1 repeat, 2 overtone
    { name: 'rotate', min: -1, max: 1, def: 0 },         // band widths
    { name: 'copies', min: 0, max: 8, def: 0, int: true },   // 0: fill the range
    { name: 'edge', min: 0, max: 6, def: 0.5 },          // semitones
    { name: 'level', min: -24, max: 12, def: -6 },        // dB
    { name: 'mix', min: 0, max: 1, def: 0.7 },
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // 1024, 2048, 4096 samples
    { name: 'stretch', min: 0, max: 1, def: 0 },         // overtone mode: how far the multiples are pulled off the whole numbers
    { name: 'decay', min: 0, max: 1, def: 0.5 },         // overtone mode: how fast the higher copies get quieter
  ],
  create({ sampleRate, emit }) {
    const re = new Float64Array(MAX_SIZE), im = new Float64Array(MAX_SIZE);
    const reW = new Float64Array(MAX_SIZE), imW = new Float64Array(MAX_SIZE);
    const reD = new Float64Array(MAX_SIZE), imD = new Float64Array(MAX_SIZE);   // the dry frame, for the picture
    let n = 0, ch = null, watchLeft = 0, frames = 0;

    const start = size => { n = size; ch = [0, 1].map(() => ({ a: new Analyser(n), r: new Resynth(n), k: new Kaleidoscoper(n, sampleRate) })); };

    const report = () => {
      const input = pictureOf(reD, imD, n, sampleRate, peakOf(n), new Float32Array(POINTS));
      const output = pictureOf(reW, imW, n, sampleRate, peakOf(n), new Float32Array(POINTS));
      emit({ type: 'kal', input, output }, [input.buffer, output.buffer]);
    };

    return {
      message(msg) { if (msg.type === 'watch') watchLeft = WATCH_SECONDS * sampleRate; },
      process(inputs, outputs, count, params, slots) {
        const want = sizeOf(params[slots[SIZE]]);
        if (want !== n) start(want);
        const settings = { low: params[slots[LOW]], high: params[slots[HIGH]], mode: Math.round(params[slots[MODE]]), rotate: params[slots[ROTATE]], copies: Math.round(params[slots[COPIES]]), edge: params[slots[EDGE]], level: Math.pow(10, params[slots[LEVEL]] / 20), stretch: params[slots[STRETCH]], decay: params[slots[DECAY]] };
        const mix = params[slots[MIX]], half = n >> 1;
        const reporting = watchLeft > 0 && emit;
        if (watchLeft > 0) watchLeft -= count;
        for (let c = 0; c < 2; c++) {
          const s = ch[c], x = inputs[0][c], y = outputs[0][c];
          for (let i = 0; i < count; i++) {
            if (s.a.push(x[i])) {
              s.a.fill(re, im);
              s.k.run(re, im, reW, imW, settings);
              if (c === 0 && reporting && ++frames % REPORT_EVERY === 0) { reD.set(re.subarray(0, half + 1)); imD.set(im.subarray(0, half + 1)); report(); }
              for (let k = 0; k <= half; k++) { re[k] += (reW[k] - re[k]) * mix; im[k] += (imW[k] - im[k]) * mix; }
              mirror(re, im, n);
              s.r.add(re, im, s.a.t);
            }
            y[i] = s.r.take(s.a.t);
          }
        }
      },
    };
  },
};
