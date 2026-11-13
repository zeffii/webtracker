// Carve: a spectral mixer stage for mastering. Every lane is looked at in short windows (a 4096-sample FFT, a new one every 1024 samples).
// In each band of the spectrum the loudest lane keeps its level and the quieter lanes that overlap it are dipped, so they stop masking and
// cancelling each other. A "lead" lane is never dipped: the others give way to it. The lanes are then added, still in the spectrum, and
// come out as one signal. It costs a delay of one window (N samples), and nothing at all when it is off.
//
// Use: push(id, left, right, n, lead) for each lane of a block, then pull(outL, outR, n, amount, depth, focus) once.
import { fftPlan } from './fft.js';

export const CARVE_N = 4096, CARVE_HOP = 1024;
const F0 = 40;   // the lowest band edge, in Hz (everything below belongs to the first band)

export class Carve {
  constructor(sampleRate, maxBlock = 512) {
    this.sr = sampleRate; this.maxBlock = maxBlock;
    this.plan = fftPlan(CARVE_N);
    this.win = new Float64Array(CARVE_N);
    for (let i = 0; i < CARVE_N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / CARVE_N));   // sqrt-hann: used going in and coming out
    this.lanes = new Map();   // id -> { l, r (input rings), stage: [l, r], staged, lead, re, im, band: Float64Array of smoothed energies }
    this.reset();
    this.sumRe = new Float64Array(CARVE_N); this.sumIm = new Float64Array(CARVE_N);
    this.bandOf = null; this.bpo = 0;
  }

  reset() {
    this.w = 0;
    this.outL = new Float64Array(CARVE_N); this.outR = new Float64Array(CARVE_N);
    for (const lane of this.lanes.values()) { lane.l.fill(0); lane.r.fill(0); lane.band.fill(0); lane.staged = false; }
  }

  lane(id) {
    let s = this.lanes.get(id);
    if (!s) {
      s = { l: new Float32Array(CARVE_N), r: new Float32Array(CARVE_N), sl: new Float32Array(this.maxBlock), sr: new Float32Array(this.maxBlock), staged: false, lead: false,
            re: new Float64Array(CARVE_N), im: new Float64Array(CARVE_N), band: new Float64Array(128), db: new Float64Array(128) };
      this.lanes.set(id, s);
    }
    return s;
  }

  drop(id) { this.lanes.delete(id); }

  push(id, left, right, n, lead) {
    const s = this.lane(id);
    s.sl.set(left.subarray(0, n)); s.sr.set(right.subarray(0, n)); s.staged = true; s.lead = !!lead;
  }

  // the band of each bin for a number of bands per octave (kept until it changes)
  layout(bpo) {
    if (this.bpo === bpo) return;
    this.bpo = bpo;
    const half = CARVE_N / 2, map = this.bandOf = new Float32Array(half + 1);   // fractional band position of each bin
    let top = 0;
    for (let k = 0; k <= half; k++) {
      const f = Math.max(k, 0.5) * this.sr / CARVE_N;
      map[k] = f <= F0 ? 0 : bpo * Math.log2(f / F0);
      top = Math.max(top, map[k]);
    }
    this.bands = Math.min(127, Math.floor(top) + 1);
  }

  // one window: look at every lane, work out how far each is dipped in each band, add them in the spectrum, and add the result to the output rings
  frame(amount, depth, bpo) {
    const N = CARVE_N, half = N / 2, at = this.w % N, win = this.win, { re: sr, im: si } = { re: this.sumRe, im: this.sumIm };
    this.layout(bpo);
    const bands = this.bands, map = this.bandOf, list = [...this.lanes.values()];
    sr.fill(0); si.fill(0);
    for (const s of list) {
      for (let i = 0; i < N; i++) { const p = (at + i) % N; s.re[i] = s.l[p] * win[i]; s.im[i] = s.r[p] * win[i]; }
      this.plan.run(s.re, s.im, false);
      const e = s.cur ??= new Float64Array(128); e.fill(0);
      for (let k = 0; k <= half; k++) {
        const j = (N - k) % N, ar = s.re[k], ai = s.im[k], br = s.re[j], bi = s.im[j];
        // left = (X[k] + conj X[N-k]) / 2, right = (X[k] - conj X[N-k]) / 2i
        const lr = (ar + br) / 2, li = (ai - bi) / 2, rr = (ai + bi) / 2, ri = (br - ar) / 2;
        e[Math.min(bands - 1, Math.floor(map[k]))] += lr * lr + li * li + rr * rr + ri * ri;
      }
      for (let b = 0; b < bands; b++) s.band[b] += (e[b] - s.band[b]) * (e[b] > s.band[b] ? 0.7 : 0.25);   // quick to rise, slower to let go
    }
    // the dip of every lane in every band, in dB (0 or below)
    const K = 10 / Math.LN10;
    for (const s of list) {
      for (let b = 0; b < bands; b++) {
        let rival = 0;
        for (const o of list) if (o !== s) rival = Math.max(rival, o.band[b] * (o.lead ? 4 : 1));
        const own = s.band[b];
        let d = 0;
        if (!s.lead && rival > 1) { const over = K * Math.log(rival / (own + 1)); if (over > 0) d = -amount * depth * (1 - Math.exp(-over / 6)); }
        s.db[b] = d;
      }
    }
    for (const s of list) {
      const { re, im, db } = s;
      for (let k = 0; k <= half; k++) {
        const p = Math.max(0, map[k] - 0.5), b0 = Math.min(bands - 1, Math.floor(p)), b1 = Math.min(bands - 1, b0 + 1), t = p - Math.floor(p);
        const g = 10 ** ((db[b0] + (db[b1] - db[b0]) * t) / 20);
        sr[k] += re[k] * g; si[k] += im[k] * g;
        if (k > 0 && k < half) { sr[N - k] += re[N - k] * g; si[N - k] += im[N - k] * g; }
      }
    }
    this.plan.run(sr, si, true);
    for (let i = 0; i < N; i++) { const p = (at + i) % N; this.outL[p] += sr[i] * win[i] * 0.5; this.outR[p] += si[i] * win[i] * 0.5; }
  }

  // Takes what was pushed since the last pull (a lane that did not push is silent) and writes the carved sum of the same length, one window late.
  pull(left, right, n, amount, depth, focus) {
    const N = CARVE_N, bpo = 1 + 5 * Math.max(0, Math.min(1, focus));
    for (let i = 0; i < n; i++) {
      for (const s of this.lanes.values()) {
        const p = this.w % N;
        if (s.staged) { s.l[p] = s.sl[i]; s.r[p] = s.sr[i]; } else { s.l[p] = 0; s.r[p] = 0; }
      }
      this.w++;
      if (this.w >= N && this.w % CARVE_HOP === 0) this.frame(amount, depth, bpo);
      if (this.w >= N) {
        const a = (this.w - N) % N;
        left[i] = this.outL[a]; right[i] = this.outR[a];
        this.outL[a] = 0; this.outR[a] = 0;
      } else { left[i] = 0; right[i] = 0; }
    }
    for (const s of this.lanes.values()) s.staged = false;
  }
}
