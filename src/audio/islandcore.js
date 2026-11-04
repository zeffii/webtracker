// The island pass on a spectrum: the same idea as the piano roll's "add islands", but acting on sound. For one frame of
// a spectrum it finds the peak inside every loud blob, keeps a thin ridge of the sound around each peak, and turns the
// rest down (the blobs' shoulders, the neighbouring smear, the hiss between the partials). Only the pass that decides
// each bin's gain lives here; `islands.js` (the node) and `islandrender.js` (the offline resampler) cut the sound into
// frames and put it back together.
//
// Brightness is the picture's: a bin's level in dB below the loudest sound heard, over an 80 dB range, 0 to 1.
//   contrast  an S-curve on that brightness; what falls below the pivot is turned down, what is above is left alone.
//   islands   how far everything off a peak's ridge is turned down (up to `depth` dB).
//   smooth    how slowly each bin's gain changes from one frame to the next, so peaks that flicker do not warble.
// Distances are in semitones, so a peak is found the same way at 100 Hz and at 5 kHz.

export const RANGE_DB = 80;
const BLOB = 0.4;        // brightness a bin needs, after contrast, to count as part of a blob
const MID = 0.55;        // the brightness the contrast curve pivots on
const GROW = semis => 2 ** (semis / 12) - 1;   // how many bins a distance in semitones is, per bin of frequency
const MAINLOBE = 1.5;     // bins: a Hann window spreads even a pure sine over about this many either side, and the ridge has to cover it
const SMOOTH_W = GROW(0.5), REACH_W = GROW(0.75), SIGMA_W = GROW(0.32);

export class IslandMask {
  constructor(n) {
    this.n = n; this.half = n >> 1;
    const bins = this.half + 2;
    this.db = new Float64Array(bins);       // each bin's level in dB, set by `measure`
    this.bright = new Float64Array(bins);
    this.col = new Float64Array(bins);
    this.prefix = new Float64Array(bins + 1);
    this.ridge = new Float32Array(bins);
    this.gain = new Float64Array(bins);     // each bin's gain now, in dB (what the frame is multiplied by)
    this.primed = false;
    this.cands = new Int32Array(bins);
  }

  // The level of every bin of a spectrum in dB (`peak` is the height a full-scale sine reaches); returns the loudest.
  measure(re, im, peak) {
    let top = -Infinity;
    for (let k = 0; k <= this.half; k++) {
      const level = 20 * Math.log10(Math.hypot(re[k], im[k]) / peak + 1e-9);
      this.db[k] = level;
      if (level > top) top = level;
    }
    return top;
  }

  // Works out the gain of every bin from the levels `measure` found. `ref` is the loudest level to count brightness from.
  decide(ref, { contrast, islands, depth, smooth }) {
    const { half, db, bright, col, prefix, ridge, cands } = this;
    const k = 2 + 22 * contrast * contrast, f = v => 1 / (1 + Math.exp(-k * (v - MID))), lo = f(0), span = f(1) - lo;
    const floor = ref - RANGE_DB;
    const cut = new Float64Array(half + 1);   // the contrast curve's own turn-down, in dB
    for (let i = 0; i <= half; i++) {
      const b = Math.min(1, Math.max(0, (db[i] - floor) / RANGE_DB));
      let b2 = b;
      if (contrast > 0) { b2 = (f(b) - lo) / span; cut[i] = Math.min(0, (b2 - b) * RANGE_DB); }
      bright[i] = b2;
    }
    ridge.fill(0, 0, half + 1);
    if (islands > 0) {
      prefix[0] = 0;
      for (let i = 0; i <= half; i++) prefix[i + 1] = prefix[i] + bright[i];
      for (let i = 0; i <= half; i++) {   // average over about half a semitone either side
        const w = Math.max(1, Math.round(i * SMOOTH_W)), a = Math.max(0, i - w), b = Math.min(half, i + w);
        col[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
      }
      let count = 0;
      for (let i = 1; i < half; i++) if (col[i] >= BLOB && col[i] >= col[i - 1] && col[i] > col[i + 1]) cands[count++] = i;
      for (let c = 0; c < count; c++) {   // a peak must be the loudest within about three quarters of a semitone either side
        const i = cands[c], reach = Math.max(2, Math.round(i * REACH_W));
        let top = true;
        for (let j = c - 1; j >= 0 && i - cands[j] <= reach; j--) if (col[cands[j]] >= col[i]) { top = false; break; }
        for (let j = c + 1; top && j < count && cands[j] - i <= reach; j++) if (col[cands[j]] > col[i]) top = false;
        if (!top) continue;
        const sigma = Math.max(MAINLOBE, i * SIGMA_W), span2 = Math.ceil(sigma * 4.5);
        for (let j = Math.max(0, i - span2); j <= Math.min(half, i + span2); j++) {
          const g = Math.exp(-0.5 * ((j - i) / sigma) ** 2);
          if (g > ridge[j]) ridge[j] = g;
        }
      }
    }
    for (let i = 0; i <= half; i++) {
      const target = cut[i] - islands * depth * (1 - ridge[i]);
      this.gain[i] = this.primed ? smooth * this.gain[i] + (1 - smooth) * target : target;
    }
    this.primed = true;
  }

  // Multiplies bins 0 to n/2 of a spectrum by the gains (the caller mirrors the top half).
  apply(re, im) {
    for (let k = 0; k <= this.half; k++) { const g = 10 ** (this.gain[k] / 20); re[k] *= g; im[k] *= g; }
  }
}
