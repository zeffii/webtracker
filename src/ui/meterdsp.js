// The arithmetic behind the meters: K-weighted loudness (ITU-R BS.1770, in LUFS), stereo correlation, and the spectrum of a
// block of output as a number of log-spaced bands, with the share of side energy per band.
import { fft } from '../project/spectrogram.js';
import { crossovers } from '../audio/nodes/specpan.js';

const biquad = (b0, b1, b2, a1, a2) => ({ b0, b1, b2, a1, a2, z1: 0, z2: 0 });
const run = (f, x) => { const y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; return y; };

// The two K-weighting stages for a sample rate: a high shelf (the head), then a high-pass.
export function kFilters(fs) {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs); const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
  const shelf = biquad((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  K = Math.tan(Math.PI * f1 / fs);
  const d = 1 + K / Q1 + K * K, high = biquad(1, -2, 1, 2 * (K * K - 1) / d, (1 - K / Q1 + K * K) / d);
  return [shelf, high];
}

// Momentary (400 ms) and short-term (3 s) loudness of a stereo stream fed in blocks.
export function createLoudness(fs) {
  const chans = [kFilters(fs), kFilters(fs)], blocks = [];
  let total = 0;
  const window = sec => {
    let e = 0, n = 0;
    for (let i = blocks.length - 1; i >= 0 && n < sec * fs; i--) { e += blocks[i][0]; n += blocks[i][1]; }
    return n ? -0.691 + 10 * Math.log10(Math.max(1e-12, e / n)) : -Infinity;
  };
  return {
    push(l, r, n) {
      let e = 0;
      for (let i = 0; i < n; i++) {
        let a = l[i], b = r[i];
        for (const f of chans[0]) a = run(f, a);
        for (const f of chans[1]) b = run(f, b);
        e += a * a + b * b;
      }
      blocks.push([e, n]); total += n;
      while (total - blocks[0][1] > 3 * fs) total -= blocks.shift()[1];
    },
    momentary: () => window(0.4),
    short: () => window(3),
  };
}

// Correlation of left and right, smoothed: +1 mono, 0 unrelated, -1 out of phase.
export function createCorrelation(fs, seconds = 0.3) {
  let ll = 0, rr = 0, lr = 0;
  const k = Math.exp(-1 / (fs * seconds));
  return {
    push(l, r, n) { for (let i = 0; i < n; i++) { ll = ll * k + l[i] * l[i]; rr = rr * k + r[i] * r[i]; lr = lr * k + l[i] * r[i]; } },
    value: () => (ll > 1e-12 && rr > 1e-12 ? Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr))) : 1),
  };
}

export const SPEC_N = 4096, BANDS = 96, WIDTH_BANDS = 10;
const hann = Float32Array.from({ length: SPEC_N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SPEC_N - 1)));

// The spectrum of the last SPEC_N frames: `db` (BANDS log-spaced values from 20 Hz to 20 kHz, in dB below a full-scale sine)
// and `width` (WIDTH_BANDS values, 0 mono to 1 all side, between the spectral panner's crossovers).
export function createAnalyser(fs) {
  const mr = new Float64Array(SPEC_N), mi = new Float64Array(SPEC_N), sr = new Float64Array(SPEC_N), si = new Float64Array(SPEC_N);
  const edge = i => 20 * Math.pow(1000, i / BANDS), bin = f => f * SPEC_N / fs;
  const cuts = [0, ...crossovers(), Infinity].map(f => (Number.isFinite(f) ? bin(f) : SPEC_N / 2));
  const db = new Float32Array(BANDS), width = new Float32Array(WIDTH_BANDS);
  return {
    db, width,
    // l, r: the newest SPEC_N frames, oldest first
    run(l, r) {
      for (let i = 0; i < SPEC_N; i++) { mr[i] = (l[i] + r[i]) * 0.5 * hann[i]; sr[i] = (l[i] - r[i]) * 0.5 * hann[i]; }
      mi.fill(0); si.fill(0); fft(mr, mi); fft(sr, si);
      const norm = SPEC_N / 4;   // a full-scale sine reads 0 dB
      for (let b = 0; b < BANDS; b++) {
        const lo = Math.max(1, Math.floor(bin(edge(b)))), hi = Math.max(lo, Math.min(SPEC_N / 2 - 1, Math.ceil(bin(edge(b + 1)))));
        let peak = 0;
        for (let k = lo; k <= hi; k++) peak = Math.max(peak, Math.hypot(mr[k], mi[k]) / norm);   // M is the mean of L and R, so a mono sine of amplitude 1 has M amplitude 1
        db[b] = 20 * Math.log10(Math.max(1e-7, peak));
      }
      for (let w = 0; w < WIDTH_BANDS; w++) {
        const lo = Math.max(1, Math.floor(cuts[w])), hi = Math.max(lo + 1, Math.floor(cuts[w + 1]));
        let m = 0, s = 0;
        for (let k = lo; k < hi; k++) { m += mr[k] * mr[k] + mi[k] * mi[k]; s += sr[k] * sr[k] + si[k] * si[k]; }
        width[w] = m + s > 1e-12 ? s / (m + s) : 0;
      }
    },
  };
}
