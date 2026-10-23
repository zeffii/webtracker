// The master limiter: a lookahead peak limiter that keeps the mix under a ceiling without ever letting a peak through.
// Both channels share one gain, so the stereo image does not move. The gain it needs for each sample is found `look`
// samples ahead (the sound itself is delayed by that much), the lowest need within the window is held, it recovers at
// the release speed, and the result is smoothed over the window. The smoothing is what stops it clicking; because every
// value it averages is already low enough for the sample being output, the output cannot pass the ceiling.
// Peaks are sample peaks, not true peaks: a ceiling a little under 0 dB (the default is -0.3) leaves room for that.
export const LOOK_MS = 1.5;

export class Limiter {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.look = Math.max(8, Math.round(sampleRate * LOOK_MS / 1000));
    const L = this.look;
    this.dl = new Float32Array(L); this.dr = new Float32Array(L);   // the delayed sound
    this.need = new Float32Array(L).fill(1);                        // the gain each of the last L samples needs
    this.held = new Float32Array(L).fill(1);                        // the held gain, for the smoothing window
    this.pos = 0; this.sum = L; this.rel = 1;
  }

  get latency() { return this.look - 1; }

  // In place. boost in dB goes in before the limiter. Returns { reduction (dB, the most in this block), peak (dB, of the input after the boost) }.
  process(l, r, n, ceilingDb = -0.3, boostDb = 0, releaseMs = 120) {
    const { look: L, dl, dr, need, held } = this;
    const c = Math.pow(10, Math.min(0, ceilingDb) / 20), boost = Math.pow(10, boostDb / 20);
    const relA = 1 - Math.exp(-1 / (this.sr * Math.max(1, releaseMs) / 1000));
    let { pos, sum, rel } = this, low = 1, top = 0;
    for (let i = 0; i < n; i++) {
      const xl = l[i] * boost, xr = r[i] * boost, a = Math.max(Math.abs(xl), Math.abs(xr));
      if (a > top) top = a;
      need[pos] = a > c ? c / a : 1;
      let m = 1;
      for (let k = 0; k < L; k++) if (need[k] < m) m = need[k];
      rel = Math.min(m, rel + (1 - rel) * relA);
      sum += rel - held[pos]; held[pos] = rel;
      dl[pos] = xl; dr[pos] = xr;
      pos = pos + 1 === L ? 0 : pos + 1;   // the oldest sample is now where the next one goes
      const g = sum / L;
      if (g < low) low = g;
      l[i] = Math.max(-c, Math.min(c, dl[pos] * g));
      r[i] = Math.max(-c, Math.min(c, dr[pos] * g));
    }
    this.pos = pos; this.sum = sum; this.rel = rel;
    if (this.sum < 0) this.sum = sum = L;   // floating point drift can never leave it negative
    return { reduction: low < 1 ? -20 * Math.log10(low) : 0, peak: 20 * Math.log10(Math.max(1e-10, top)) };
  }
}
