// Impulse-response reverb: the sound is convolved with a recorded impulse response (a real room, hall, plate or spring,
// or anything else you load: any sample in the project can be the IR, mono or stereo). It is partitioned FFT
// convolution in three stages so long responses stay cheap: the first part of the response runs in blocks of 128
// samples, the middle in blocks of 1024, the tail in blocks of 4096 (spread out over the blocks in between, so no one
// block does a big share of the work). The whole thing sounds about 3 ms late, which a reverb hides; `predelay` adds
// to it. The response is cut at 8 seconds.
//   sample    which of the node's samples is the response (a pattern's Smp column can switch it)
//   size      stretches the response: below 1 a smaller, higher room; above 1 a larger, lower one
//   decay     fades the response out over this many seconds (10 leaves it as recorded)
//   predelay  ms before the reverb starts
//   lowcut, highcut, width  shape the wet sound; level in dB; mix is dry to wet
// A new sample, size or decay rebuilds the response in the background (a fraction of a second); the old one plays until
// the new one is ready.
import { fftPlan } from '../fft.js';

const SPEC = [
  { name: 'sample', min: 0, max: 255, def: 0, int: true },
  { name: 'size', min: 0.25, max: 2, def: 1 },
  { name: 'decay', min: 0.05, max: 10, def: 10 },
  { name: 'predelay', min: 0, max: 500, def: 0 },
  { name: 'lowcut', min: 20, max: 2000, def: 20 },
  { name: 'highcut', min: 1000, max: 20000, def: 20000 },
  { name: 'width', min: 0, max: 1.5, def: 1 },
  { name: 'level', min: -24, max: 12, def: 0 },
  { name: 'mix', min: 0, max: 1, def: 0.3 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const B1 = 128, B2 = 1024, B3 = 4096;
const MAX_P = [7, 7, Infinity];
const START = [0, 896, 8064];   // where each stage's part of the response begins (the 128-sample latency and each stage's delay come off the block sizes)
const MAX_SECONDS = 8;

// One stage: overlap-save partitioned convolution with block B; slow stages spread their output over the next block
class Stage {
  constructor(B, slow) {
    this.B = B; this.N = 2 * B; this.bins = B + 1; this.slow = slow; this.plan = fftPlan(2 * B);
    this.win = [new Float64Array(2 * B), new Float64Array(2 * B)];
    this.re = new Float64Array(2 * B); this.im = new Float64Array(2 * B);
    this.playing = [new Float32Array(B), new Float32Array(B)];
    this.done = [new Float32Array(B), new Float32Array(B)];   // a slow stage's finished block, waiting for the boundary
    this.yRe = [new Float64Array(B + 1), new Float64Array(B + 1)]; this.yIm = [new Float64Array(B + 1), new Float64Array(B + 1)];
    this.fill = 0; this.head = 0; this.P = 0; this.job = null;
    this.hRe = [null, null]; this.hIm = [null, null]; this.fRe = [null, null]; this.fIm = [null, null];
  }
  // a new response: its spectra, and an empty history
  install(P, hRe, hIm, fRe, fIm) {
    this.P = P; this.hRe = hRe; this.hIm = hIm; this.head = 0; this.job = null;
    this.fRe = fRe; this.fIm = fIm;
    for (let c = 0; c < 2; c++) { this.win[c].fill(0); this.playing[c].fill(0); this.done[c].fill(0); }
    this.fill = 0;
  }
  mac(c, k0, k1) {
    const { bins, P, head } = this, yRe = this.yRe[c], yIm = this.yIm[c], fRe = this.fRe[c], fIm = this.fIm[c], hRe = this.hRe[c], hIm = this.hIm[c];
    for (let k = k0; k < k1; k++) {
      const f = ((head - k + P) % P) * bins, h = k * bins;
      for (let b = 0; b < bins; b++) {
        const xr = fRe[f + b], xi = fIm[f + b], hr = hRe[h + b], hi = hIm[h + b];
        yRe[b] += xr * hr - xi * hi; yIm[b] += xr * hi + xi * hr;
      }
    }
  }
  finish(c, into) {   // inverse transform of the accumulated product; the second half is the valid output
    const { re, im, yRe, yIm, N, B } = this;
    for (let b = 0; b <= B; b++) { re[b] = yRe[c][b]; im[b] = yIm[c][b]; }
    for (let b = B + 1; b < N; b++) { re[b] = yRe[c][N - b]; im[b] = -yIm[c][N - b]; }
    this.plan.run(re, im, true);
    for (let i = 0; i < B; i++) into[i] = re[B + i];
  }
  boundary() {
    const { B, bins, re, im } = this;
    if (this.P === 0) { this.fill = 0; for (let c = 0; c < 2; c++) this.win[c].copyWithin(0, B, 2 * B); return; }
    this.head = (this.head + 1) % this.P;
    for (let c = 0; c < 2; c++) {
      re.set(this.win[c]); im.fill(0);
      this.plan.run(re, im);
      const at = this.head * bins, fRe = this.fRe[c], fIm = this.fIm[c];
      for (let b = 0; b < bins; b++) { fRe[at + b] = re[b]; fIm[at + b] = im[b]; }
      this.win[c].copyWithin(0, B, 2 * B);
    }
    if (this.slow) {
      for (let c = 0; c < 2; c++) this.playing[c].set(this.done[c]);   // the block started one boundary ago
      for (let c = 0; c < 2; c++) { this.yRe[c].fill(0); this.yIm[c].fill(0); }
      this.job = { k: 0, finished: false };
    } else {
      for (let c = 0; c < 2; c++) { this.yRe[c].fill(0); this.yIm[c].fill(0); this.mac(c, 0, this.P); this.finish(c, this.playing[c]); }
    }
    this.fill = 0;
  }
  // a slow stage works through its partitions as the block goes by, and is done by 70 percent of it
  advance() {
    const job = this.job;
    if (!job || job.finished) return;
    const target = this.fill >= this.B * 0.7 ? this.P : Math.floor(this.P * this.fill / (this.B * 0.7));
    if (target > job.k) { for (let c = 0; c < 2; c++) this.mac(c, job.k, target); job.k = target; }
    if (job.k >= this.P) { for (let c = 0; c < 2; c++) this.finish(c, this.done[c]); job.finished = true; }
  }
  run(inL, inR, accL, accR, n) {
    const { B } = this;
    let pos = 0;
    while (pos < n) {
      const take = Math.min(n - pos, B - this.fill), f = this.fill, wL = this.win[0], wR = this.win[1], pL = this.playing[0], pR = this.playing[1];
      for (let i = 0; i < take; i++) { wL[B + f + i] = inL[pos + i]; wR[B + f + i] = inR[pos + i]; accL[pos + i] += pL[f + i]; accR[pos + i] += pR[f + i]; }
      this.fill += take; pos += take;
      if (this.fill === B) this.boundary();
    }
    if (this.slow) this.advance();
  }
}

export default {
  type: 'convolver',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  samples: true,   // the impulse response is one of the node's samples, as for the sampler
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'convolver',
  params: SPEC,
  create({ sampleRate, maxBlock = 512 }) {
    const bank = [];
    const stages = [new Stage(B1, false), new Stage(B2, false), new Stage(B3, true)];
    let irVersion = 0, built = null, want = null, stable = 0, job = null;
    let wl = new Float32Array(maxBlock), wr = new Float32Array(maxBlock);
    const maxPre = Math.ceil(sampleRate * 0.5) + 1;
    const pre = [new Float32Array(maxPre), new Float32Array(maxPre)];
    let pw = 0;
    const lp = [0, 0, 0, 0], hp = [0, 0, 0, 0], hc = [0, 0, 0, 0];   // the wet filters: two one-pole stages of each, per channel
    const MAXLEN = Math.floor(MAX_SECONDS * sampleRate);

    // the response, rebuilt a little at a time: shaped (stretched, faded, normalised), then each stage's partitions transformed
    function* build(ir, size, decay) {
      const step = ir.ratio / size, srcLen = ir.data.length;
      const len = Math.max(1, Math.min(MAXLEN, Math.floor((srcLen - 1) / step)));
      const hs = [new Float32Array(len), ir.right ? new Float32Array(len) : null];
      const fade = decay < 10 ? 6.9078 / (decay * sampleRate) : 0;
      let energy = 0;
      for (let c = 0; c < (ir.right ? 2 : 1); c++) {
        const src = c ? ir.right : ir.data, dst = hs[c];
        for (let i0 = 0; i0 < len; i0 += 8192) {
          for (let i = i0; i < Math.min(len, i0 + 8192); i++) {
            const p = i * step, j = p | 0, f = p - j, v = (src[j] * (1 - f) + (src[j + 1] ?? 0) * f) * (fade ? Math.exp(-fade * i) : 1);
            dst[i] = v; energy += v * v;
          }
          yield;
        }
      }
      const gain = energy > 1e-12 ? ir.gain / Math.sqrt(energy / (ir.right ? 2 : 1)) : 0;   // the response carries as much energy as white noise would
      for (const h of hs) if (h) for (let i0 = 0; i0 < len; i0 += 16384) { for (let i = i0; i < Math.min(len, i0 + 16384); i++) h[i] *= gain; yield; }
      const L = [hs[0], hs[1] ?? hs[0]];
      const out = [];
      for (let s = 0; s < 3; s++) {
        const st = stages[s], B = st.B, bins = st.bins, count = len > START[s] ? Math.min(MAX_P[s], Math.ceil((len - START[s]) / B)) : 0;
        const hRe = [new Float32Array(count * bins), null], hIm = [new Float32Array(count * bins), null];
        if (ir.right) { hRe[1] = new Float32Array(count * bins); hIm[1] = new Float32Array(count * bins); }
        for (let c = 0; c < (ir.right ? 2 : 1); c++) {
          for (let k = 0; k < count; k++) {
            const a = START[s] + k * B, seg = L[c];
            st.re.fill(0); st.im.fill(0);
            for (let i = 0; i < B && a + i < len; i++) st.re[i] = seg[a + i];
            st.plan.run(st.re, st.im);
            for (let b = 0; b < bins; b++) { hRe[c][k * bins + b] = st.re[b]; hIm[c][k * bins + b] = st.im[b]; }
            yield;
          }
        }
        if (!ir.right) { hRe[1] = hRe[0]; hIm[1] = hIm[0]; }
        const size = Math.max(1, count) * bins;   // the input history, made now so the swap below does no allocating
        const fRe = [new Float32Array(size), new Float32Array(size)], fIm = [new Float32Array(size), new Float32Array(size)];
        out.push([count, hRe, hIm, fRe, fIm]);
        yield;
      }
      for (let s = 0; s < 3; s++) stages[s].install(...out[s]);
    }

    return {
      message(msg) {
        if (msg.type !== 'sample') return;
        bank[msg.slot | 0] = { data: msg.data, right: msg.right ?? null, ratio: msg.rate / sampleRate, gain: (msg.volume ?? 1) * (msg.globalVolume ?? 1) };
        irVersion++;
      },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        // is the wanted response the one that is built? it has to hold still for a moment before the work starts
        const slot = Math.max(0, Math.min(255, Math.floor(g('sample')) || 0));
        const sig = `${slot}|${g('size').toFixed(3)}|${g('decay').toFixed(2)}|${irVersion}`;
        if (sig !== want) { want = sig; stable = 0; if (job && job.sig !== sig) { job = null; built = null; } }
        else if (stable < 1000) stable++;
        if (!job && stable >= 12 && want !== built && bank[slot]) {
          job = { sig: want, it: build(bank[slot], g('size'), g('decay')) };
          built = want;
        }
        if (job && job.it.next().done) job = null;
        if (wl.length < n) { wl = new Float32Array(n); wr = new Float32Array(n); }
        wl.fill(0, 0, n); wr.fill(0, 0, n);
        for (const st of stages) st.run(inL, inR, wl, wr, n);
        const mix = g('mix'), level = Math.pow(10, g('level') / 20), width = g('width');
        const pd = Math.min(maxPre - 1, Math.round(g('predelay') * 0.001 * sampleRate));
        const aLow = 1 - Math.exp(-2 * Math.PI * g('lowcut') / sampleRate), aHigh = 1 - Math.exp(-2 * Math.PI * Math.min(g('highcut'), sampleRate * 0.45) / sampleRate);
        const useLow = g('lowcut') > 25, useHigh = g('highcut') < 19000;
        for (let i = 0; i < n; i++) {
          pre[0][pw] = wl[i]; pre[1][pw] = wr[i];
          let r = pw - pd; if (r < 0) r += maxPre;
          let l = pre[0][r], rr = pre[1][r];
          if (++pw === maxPre) pw = 0;
          if (width !== 1) { const m = (l + rr) * 0.5, s = (l - rr) * 0.5 * width; l = m + s; rr = m - s; }
          for (let c = 0; c < 2; c++) {
            let v = c ? rr : l;
            if (useLow) { lp[c * 2] += aLow * (v - lp[c * 2]); v -= lp[c * 2]; lp[c * 2 + 1] += aLow * (v - lp[c * 2 + 1]); v -= lp[c * 2 + 1]; }
            if (useHigh) { hc[c * 2] += aHigh * (v - hc[c * 2]); v = hc[c * 2]; hc[c * 2 + 1] += aHigh * (v - hc[c * 2 + 1]); v = hc[c * 2 + 1]; }
            const dry = c ? inR[i] : inL[i];
            (c ? outR : outL)[i] = dry * (1 - mix) + v * level * mix;
          }
        }
        if (!Number.isFinite(lp[0] + lp[1] + hc[0] + hc[1] + outL[0] + outR[0])) { lp.fill(0); hc.fill(0); }
      },
    };
  },
};
