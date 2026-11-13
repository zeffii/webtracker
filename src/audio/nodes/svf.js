// A two-pole low-pass filter that stays stable while its cutoff is swept quickly (a state variable filter in the
// trapezoidal form). set() once per block, or every few samples while the cutoff moves; next() per sample.
export class LowPassSvf {
  constructor(sampleRate) { this.sampleRate = sampleRate; this.s1 = 0; this.s2 = 0; this.set(20000, 0); }

  // cutoff in Hz; resonance 0 (none) to 1 (just short of ringing on its own)
  set(cutoff, resonance) {
    const g = Math.tan(Math.PI * Math.min(0.49, Math.max(10, cutoff) / this.sampleRate));
    const k = 2 - 1.96 * Math.min(1, Math.max(0, resonance));
    this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }

  reset() { this.s1 = 0; this.s2 = 0; }

  next(input) {
    const v3 = input - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    return v2;
  }
}
