// Pulsar synthesis (after Curtis Roads), shared by the `pulsar` synth and the `pulsetrain` source.
//
// A pulsar train is a short burst of sound, the pulsaret, fired over and over:
//   fundamental   how often a pulsaret starts (the pitch you hear as the note)
//   formant       how fast the pulsaret itself plays: one pass through its waveform takes 1 / formant seconds
//                 (the resonant peak you hear, which can sit anywhere, independent of the note)
//   duty          fundamental / formant: the share of each period the pulsaret fills. Under 1 the rest is silence;
//                 over 1 the next pulsaret cuts the last one off before it ends.
//   window        a drawn shape (0 to 1) laid over the pulsaret, so it fades in and out. Its drawing is the timbre's other half.
//   masking       `mask` drops a share of the pulsarets at random, `jitter` moves their start times, `scatter` throws each
//                 one to a random place in the stereo field: the rhythmic, glitchy side of the technique.
import { envelopeTable, readEnvelope, cleanSpline } from './bezier.js';

export const WAVES = ['sine', 'half sine', 'triangle', 'saw', 'square', 'noise'];
const TWO_PI = 2 * Math.PI;

// The pulsaret's waveform at q, one pass from 0 to 1 (white noise needs a draw from `rand`).
export function pulsaretWave(wave, q, rand) {
  switch (wave) {
    case 0: return Math.sin(TWO_PI * q);
    case 1: return Math.sin(Math.PI * q) * 2 - 1.273;   // the top half of a sine, with its average taken off
    case 2: return q < 0.25 ? 4 * q : q < 0.75 ? 2 - 4 * q : 4 * q - 4;
    case 3: return 2 * q - 1;
    case 4: return q < 0.5 ? 1 : -1;
    default: return rand() * 2 - 1;
  }
}

// A window that is a plain hump, until one is drawn.
export const DEFAULT_WINDOW = () => [{ x: 0, y: 0, l: null, r: [0.22, 0] }, { x: 0.5, y: 1, l: [-0.2, 0], r: [0.2, 0] }, { x: 1, y: 0, l: [-0.22, 0], r: null }];

export const windowTable = points => envelopeTable(cleanSpline(points, DEFAULT_WINDOW));

// One pulsar train. Call `step` once per sample; it returns the left and right values in `out`.
export class PulsarTrain {
  constructor() {
    this.table = windowTable(null);
    this.phase = 0;        // position in the current period, in periods (0 to `length`)
    this.length = 1;       // how long the current period is, in periods (1, moved by jitter)
    this.q = 2;            // how far into the pulsaret we are (above 1: not sounding)
    this.gl = 1; this.gr = 1;
    this.on = true;        // whether the current pulsaret is heard (masking)
    this.seed = 0x9e3779b9;
    this.out = [0, 0];
    this.rand = () => { this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5; return (this.seed >>> 0) / 4294967296; };
  }
  setWindow(points) { this.table = windowTable(points); }
  reset() { this.phase = 0; this.length = 1; this.q = 2; }
  // inc: fundamental / sampleRate; fInc: formant / sampleRate (both per sample); the rest are the settings
  step(inc, fInc, wave, mask, jitter, scatter) {
    this.phase += inc;
    if (this.phase >= this.length) {
      this.phase -= this.length;
      this.length = jitter > 0 ? 1 + (this.rand() * 2 - 1) * jitter * 0.5 : 1;
      this.q = inc > 0 ? Math.min(1, this.phase / inc) * fInc : 0;   // the pulsaret begins part way through this sample
      this.q = Math.min(this.q, 0.999);
      this.on = mask <= 0 || this.rand() >= mask;
      const pan = scatter > 0 ? (this.rand() * 2 - 1) * scatter : 0;   // -1 left, 1 right
      const a = ((pan + 1) * Math.PI) / 4;
      this.gl = Math.cos(a) * Math.SQRT2;   // equal power, both 1 at the centre
      this.gr = Math.sin(a) * Math.SQRT2;
    }
    let v = 0;
    if (this.q < 1) {
      if (this.on) v = pulsaretWave(wave, this.q, this.rand) * readEnvelope(this.table, this.q);
      this.q += fInc;
    }
    this.out[0] = v * this.gl; this.out[1] = v * this.gr;
    return this.out;
  }
}
