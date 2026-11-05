// The west-coast building blocks, shared by the wavefolder, pluck gate and west-coast voice nodes, so the voice
// sounds the same as the same parts patched by hand.

export const FOLD_GAIN = 10;   // how many times louder the wave is pushed into the folder at fold = 1
const HALF_PI = Math.PI / 2;

// The wave folder: a wave pushed past the edge turns round and comes back, like a sine, once for each time it overshoots.
// `amount` 0..1 sets how hard the wave is pushed (1 to 11 times), `offset` moves it off centre first, so the folds
// come out uneven (that adds the even harmonics).
export function foldWave(v, amount, offset) {
  return Math.sin((1 + amount * FOLD_GAIN) * (v + offset) * HALF_PI);
}

// Takes out the slow drift a folded, off-centre wave carries. About 4 Hz at 48 kHz.
export class DcBlock {
  x = 0; y = 0;
  run(v) {
    const out = v - this.x + 0.9995 * this.y;
    this.x = v; this.y = Math.abs(out) < 1e-18 ? 0 : out;
    return this.y;
  }
  reset() { this.x = 0; this.y = 0; }
}

// The pluck gate: a vactrol (a lamp and a photocell) that opens quickly and lets go slowly, driving a low-pass filter
// and the gain together. A struck sound dies with its top end first. mode 0: both, 1: gain only, 2: filter only.
const SUB_BLOCK = 8, FMIN = 25;
export class PluckGate {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.level = 0;                  // the vactrol, 0..1 (the fast part and the slow part together)
    this.fast = 0; this.slow = 0;
    this.s1 = 0; this.s2 = 0;        // the filter's state
    this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 2;
    this.fmax = 8000; this.mode = 0; this.openCoef = 0.1; this.closeCoef = 0.001; this.count = 0;
  }
  // once per block. bright 0..1 is the highest cutoff (200 Hz to 25 kHz); `semis` is how far the cutoff is moved
  // by the note's pitch (already multiplied by tracking).
  set({ mode, bright, res, openMs, closeMs, semis = 0 }) {
    this.mode = mode;
    this.k = 2 - 2 * Math.min(0.95, Math.max(0, res));
    this.fmax = Math.min(this.sr * 0.45, 200 * Math.pow(2, bright * 7) * Math.pow(2, semis / 12));
    this.openCoef = 1 - Math.exp(-1 / (this.sr * Math.max(0.05, openMs) * 0.001));
    this.closeCoef = 1 - Math.exp(-1 / (this.sr * Math.max(1, closeMs) * 0.001));
    this.slowCoef = 1 - Math.exp(-1 / (this.sr * Math.max(1, closeMs) * 0.004));   // the photocell's slow part lets go four times slower
  }
  get idle() { return this.level < 1e-5; }
  reset() { this.level = 0; this.fast = 0; this.slow = 0; this.s1 = 0; this.s2 = 0; }
  // one sample of sound in; `strike` 0..1 is how hard the lamp is lit
  run(x, strike) {
    this.fast += (strike - this.fast) * (strike > this.fast ? this.openCoef : this.closeCoef);
    this.slow += (strike - this.slow) * (strike > this.slow ? this.openCoef : this.slowCoef);
    const lvl = this.level = this.fast * 0.75 + this.slow * 0.25;
    if (this.mode === 1) return x * Math.pow(lvl, 1.4);
    if ((this.count++ & (SUB_BLOCK - 1)) === 0) {
      const fc = FMIN * Math.pow(this.fmax / FMIN, Math.min(1, Math.pow(lvl, 0.7)));
      const g = Math.tan(Math.PI * Math.min(this.sr * 0.45, fc) / this.sr);
      this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    }
    const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    if (Math.abs(this.s1) < 1e-18) this.s1 = 0;
    if (Math.abs(this.s2) < 1e-18) this.s2 = 0;
    return this.mode === 2 ? v2 : v2 * Math.pow(lvl, 1.4);
  }
}
