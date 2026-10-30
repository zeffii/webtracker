// Shared by the spectral effects (spectral dynamics, cross synthesis, the harmonic/percussive split): the sound is cut
// into overlapping Hann-windowed frames, a quarter of a frame apart, each frame is turned into a spectrum, and after the
// effect has changed the spectrum the frames are turned back into sound and overlapped (Hann again: four frames add
// up to 1.5, which `Resynth` divides out). One `Analyser` listens to one signal; one `Resynth` makes one output.
// The dry sound, `delayed()`, comes out one frame late, to match.
//
//   const a = new Analyser(2048), r = new Resynth(2048);
//   for each sample: if (a.push(x)) { a.fill(re, im); ...change bins 0..n/2...; mirror(re, im, n); r.add(re, im, a.t); }
//                    out = r.take(a.t);  dry = a.delayed();
import { fftPlan } from '../fft.js';

export const SIZES = [1024, 2048, 4096];   // the frame lengths the `size` parameter chooses between
export const MAX_SIZE = 4096;

const windows = new Map();
function hann(n) {
  let w = windows.get(n);
  if (!w) { w = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); windows.set(n, w); }
  return w;
}

// The frame length for a `size` parameter value (0, 1, 2).
export const sizeOf = value => SIZES[Math.min(2, Math.max(0, Math.round(value)))];

// A sine of amplitude 1 comes out of `fill` with a peak of this height (the sum of the window, halved).
export const peakOf = n => n / 4;

export class Analyser {
  constructor(n) {
    this.n = n; this.hop = n / 4; this.t = 0;
    this.buf = new Float32Array(n);
    this.window = hann(n); this.plan = fftPlan(n);
  }
  // One sample in. True when a frame is due (every hop, once a whole frame has been heard).
  push(x) {
    this.buf[this.t % this.n] = x;
    this.t++;
    return this.t >= this.n && this.t % this.hop === 0;
  }
  // The latest frame as a spectrum: re and im hold bins 0 to n - 1 (the top half mirrors the bottom).
  fill(re, im) {
    const { n, t, buf, window } = this;
    for (let j = 0; j < n; j++) { re[j] = buf[(t - n + j) % n] * window[j]; im[j] = 0; }
    this.plan.run(re, im);
  }
  // The sample that went in one frame ago: the dry sound, in time with the frames' output.
  delayed() { return this.buf[this.t % this.n]; }
}

export class Resynth {
  constructor(n) {
    this.n = n;
    this.acc = new Float32Array(n * 2);
    this.window = hann(n); this.plan = fftPlan(n);
  }
  // Turns a spectrum back into sound (re and im are used up) and adds the frame in; `t` is the analyser's clock.
  add(re, im, t) {
    const { n, acc, window } = this, mask = n * 2 - 1;
    this.plan.run(re, im, true);
    for (let j = 0; j < n; j++) acc[(t - n + j + n * 2) & mask] += (re[j] * window[j]) / 1.5;
  }
  // The finished sample for this moment (and the place is cleared for the next frames).
  take(t) {
    if (t < this.n) return 0;
    const at = (t - this.n + this.n * 2) & (this.n * 2 - 1), v = this.acc[at];
    this.acc[at] = 0;
    return v;
  }
  clear() { this.acc.fill(0); }
}

// Fills the top half of a spectrum from its bottom half (bins 0 to n/2), so it turns back into real sound.
export function mirror(re, im, n) {
  const half = n >> 1;
  im[0] = 0; im[half] = 0;
  for (let k = 1; k < half; k++) { re[n - k] = re[k]; im[n - k] = -im[k]; }
}
