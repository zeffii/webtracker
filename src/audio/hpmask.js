// Tells the held part of a sound from its hits, bin by bin, frame by frame (used by the harmonic/percussive split and by
// the body blur). The spectrum is a picture: frequency up, time across. A held tone is a horizontal line in it, a hit is a
// vertical stripe. A median along time keeps the lines, a median along frequency keeps the stripes, and the two decide how
// much of each bin is body (the tone) and how much is hit.
//
//   const mask = new Masker(n);                       // one for each channel; n is the frame length
//   mask.listen(re, im);                              // every frame: the spectrum, so the history is complete
//   mask.body({ frames, bins, sharp }, out);          // out[k] = how much of bin k is body, 0 to 1 (bins 0 to n/2)
export const MAX_FRAMES = 25, MAX_BINS = 25;   // the longest medians: more costs a lot and changes little

// An odd count, at least 3 and at most `max`, nearest to `v`.
export const odd = (v, max) => Math.max(3, Math.min(max, Math.round(v) | 1));

// The settings for a frame length `n`: how many frames a held tone must last, how many bins wide a hit must be.
// `lean` above 1 gives the benefit of the doubt to the body: where the two medians are close (the quiet floor between
// harmonics), more of it counts as body. Real hits are far apart in the two medians and stay hits.
export const maskSettings = (sampleRate, n, lengthMs, widthHz, sharp, lean = 1) => ({
  frames: odd((lengthMs * 0.001 * sampleRate) / (n / 4), MAX_FRAMES),
  bins: odd(widthHz / (sampleRate / n), MAX_BINS),
  sharp, lean,
});

export class Masker {
  constructor(n) {
    this.top = n / 2 + 1;
    this.history = new Float32Array(MAX_FRAMES * this.top);   // the last frames' magnitudes, round and round
    this.frames = 0;
    this.mag = new Float64Array(this.top);
    this.along = new Float64Array(this.top);
    this.across = new Float64Array(this.top);
    this.pick = new Float64Array(MAX_FRAMES);
  }

  // The middle value of the first `count` numbers of `pick` (a small insertion sort: the lists are short).
  middle(count) {
    const pick = this.pick;
    for (let i = 1; i < count; i++) { const v = pick[i]; let j = i - 1; while (j >= 0 && pick[j] > v) { pick[j + 1] = pick[j]; j--; } pick[j + 1] = v; }
    return pick[count >> 1];
  }

  // Keeps this frame's magnitudes.
  listen(re, im) {
    const { top, mag } = this;
    for (let k = 0; k < top; k++) mag[k] = Math.hypot(re[k], im[k]);
    this.history.set(mag, (this.frames % MAX_FRAMES) * top);
    this.frames++;
  }

  // How much of each bin of the latest frame is body.
  body(p, out) {
    const { top, mag, along, across, pick, history } = this, half = top - 1, have = Math.min(this.frames, p.frames);
    for (let k = 0; k <= half; k++) {   // along time: the last frames of this bin
      for (let f = 0; f < have; f++) pick[f] = history[((this.frames - 1 - f + MAX_FRAMES * 4) % MAX_FRAMES) * top + k];
      along[k] = this.middle(have);
    }
    const reach = p.bins >> 1;
    for (let k = 0; k <= half; k++) {   // across frequency: this frame's neighbours of the bin
      const lo = Math.max(0, k - reach), hi = Math.min(half, k + reach);
      let count = 0;
      for (let j = lo; j <= hi; j++) pick[count++] = mag[j];
      across[k] = this.middle(count);
    }
    for (let k = 0; k <= half; k++) {
      const h = Math.pow(along[k] * p.lean, p.sharp), q = Math.pow(across[k], p.sharp), total = h + q;
      out[k] = total > 1e-12 ? h / total : 0.5;
    }
  }
}
