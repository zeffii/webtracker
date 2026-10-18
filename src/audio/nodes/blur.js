// Spectral blur: the sound is cut into overlapping frames, each is turned into a spectrum (an FFT), the spectrum is
// blurred like an image, and the frames are turned back into sound and overlapped. `freq` blurs across frequency
// (the fine detail of the harmonics melts into a breathy wash), `time` blurs across time (each bin follows a slow
// running average, so attacks smear and sounds bloom), and `freeze` stops the running average where it is, so the
// sound hangs in the air. `phase` goes from the sound's own phases (keeps the pitch and some of the articulation)
// to random ones (a smooth, pad-like smear). The dry sound is delayed to match the frames, so `mix` stays in time.
// Stereo, the two sides blurred separately. Latency is one frame: 1024, 2048 or 4096 samples (`size`).
const SIZES = [1024, 2048, 4096], MAX = 4096;
const FREQ = 0, TIME = 1, FREEZE = 2, PHASE = 3, SIZE = 4, MIX = 5;

const tables = new Map();
function twiddles(n) {
  let t = tables.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2), rev: new Uint16Array(n) };
    for (let k = 0; k < n / 2; k++) { t.cos[k] = Math.cos((2 * Math.PI * k) / n); t.sin[k] = Math.sin((2 * Math.PI * k) / n); }
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); t.rev[i] = r; }
    tables.set(n, t);
  }
  return t;
}
// radix-2 FFT in place; inverse flips the sign of the exponent (the caller scales)
function fft(re, im, n, inverse) {
  const { cos, sin, rev } = twiddles(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w], wi = sign * sin[w];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

export default {
  type: 'blur',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'blur',
  params: [
    { name: 'freq', min: 0, max: 1, def: 0.3 },
    { name: 'time', min: 0, max: 5000, def: 400 },     // ms: how long the running average takes to settle
    { name: 'freeze', min: 0, max: 1, def: 0, int: true },
    { name: 'phase', min: 0, max: 1, def: 0 },         // 0 the sound's own phases, 1 random
    { name: 'size', min: 0, max: 2, def: 1, int: true },   // frame length: 1024, 2048, 4096 samples
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    const inb = [new Float32Array(MAX), new Float32Array(MAX)];
    const acc = [new Float32Array(MAX * 2), new Float32Array(MAX * 2)];
    const smooth = [new Float64Array(MAX / 2 + 1), new Float64Array(MAX / 2 + 1)];
    const primed = [false, false];
    // per channel, per bin: the phase heard last, and how far it moves each frame (measured from the input), so a frozen sound keeps its pitch
    const outPh = [new Float64Array(MAX / 2 + 1), new Float64Array(MAX / 2 + 1)], lastPh = [new Float64Array(MAX / 2 + 1), new Float64Array(MAX / 2 + 1)], adv = [new Float64Array(MAX / 2 + 1), new Float64Array(MAX / 2 + 1)];
    const re = new Float64Array(MAX), im = new Float64Array(MAX), mag = new Float64Array(MAX / 2 + 1), ph = new Float64Array(MAX / 2 + 1);
    const pre = new Float64Array(MAX / 2 + 2);
    const windows = new Map();
    let n = 2048, hop = 512, t = 0, seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const windowFor = size => {
      let w = windows.get(size);
      if (!w) { w = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)); windows.set(size, w); }
      return w;
    };
    const reset = size => {
      n = size; hop = size / 4; t = 0;
      for (let c = 0; c < 2; c++) { inb[c].fill(0); acc[c].fill(0); smooth[c].fill(0); primed[c] = false; outPh[c].fill(0); lastPh[c].fill(0); adv[c].fill(0); }
    };
    // one frame of one channel: the last n input samples in, the blurred frame added to the output
    const frame = (c, p) => {
      const w = windowFor(n), half = n >> 1;
      for (let j = 0; j < n; j++) { re[j] = inb[c][(t - n + j) % n] * w[j]; im[j] = 0; }
      fft(re, im, n, false);
      for (let k = 0; k <= half; k++) { mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); }
      // blur across frequency: a box whose width grows with the bin, as pitch does
      if (p.freq > 0) {
        pre[0] = 0;
        for (let k = 0; k <= half; k++) pre[k + 1] = pre[k] + mag[k];
        const blurred = re;   // (re is free until the inverse)
        for (let k = 0; k <= half; k++) {
          const r = Math.min(half, Math.floor(p.freq * (1 + k * 0.12)));
          const lo = Math.max(0, k - r), hi = Math.min(half, k + r);
          blurred[k] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
        }
        for (let k = 0; k <= half; k++) mag[k] = blurred[k];
      }
      // blur across time: every bin follows a running average
      const s = smooth[c];
      if (!primed[c]) { for (let k = 0; k <= half; k++) s[k] = mag[k]; primed[c] = true; }
      else if (!p.freeze) { const a = p.a; for (let k = 0; k <= half; k++) s[k] = a * s[k] + (1 - a) * mag[k]; }
      const o = outPh[c], lp = lastPh[c], av = adv[c], expect = (2 * Math.PI * hop) / n;
      for (let k = 0; k <= half; k++) {
        if (p.freeze) o[k] += av[k];
        else {   // the phase that really advanced from the last frame: the bin's own advance plus the deviation, wrapped
          let d = ph[k] - lp[k] - expect * k;
          d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
          av[k] = expect * k + d; o[k] = ph[k];
        }
        lp[k] = ph[k];
      }
      for (let k = 0; k <= half; k++) {
        const m = s[k], angle = o[k] + p.phase * (rnd() * 2 - 1) * Math.PI;
        re[k] = m * Math.cos(angle); im[k] = m * Math.sin(angle);
        if (k > 0 && k < half) { re[n - k] = re[k]; im[n - k] = -im[k]; }
      }
      im[0] = 0; im[half] = 0;
      fft(re, im, n, true);
      const scale = 1 / (n * 1.5);   // the inverse's 1/n, and the Hann-squared overlap of four frames (1.5)
      const out = acc[c];
      for (let j = 0; j < n; j++) out[(t - n + j + MAX * 2) & (MAX * 2 - 1)] += re[j] * w[j] * scale;
    };
    return {
      process(inputs, outputs, count, params, slots) {
        const want = SIZES[Math.min(2, Math.max(0, Math.round(params[slots[SIZE]])))];
        if (want !== n) reset(want);
        const mix = params[slots[MIX]];
        const p = {
          freq: params[slots[FREQ]] * 24,
          freeze: params[slots[FREEZE]] >= 0.5,
          phase: params[slots[PHASE]],
          a: params[slots[TIME]] < 1 ? 0 : Math.exp(-hop / (sampleRate * params[slots[TIME]] * 0.001)),
        };
        for (let i = 0; i < count; i++) {
          const idx = t % n;
          inb[0][idx] = inputs[0][0][i]; inb[1][idx] = inputs[0][1][i];
          t++;
          if (t >= n && t % hop === 0) { frame(0, p); frame(1, p); }
          const back = t % n;   // the sample that went in one frame ago, to match the delay of the blurred sound
          const at = (t - n + MAX * 2) & (MAX * 2 - 1);
          for (let c = 0; c < 2; c++) {
            const dry = inb[c][back], wet = t >= n ? acc[c][at] : 0;
            acc[c][at] = 0;
            outputs[0][c][i] = dry + (wet - dry) * mix;
          }
        }
      },
    };
  },
};
