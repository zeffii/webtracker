// Hall reverb: a feedback delay network of eight lines with a Householder mixing matrix
// (lossless, so the decay is set only by the per-line gains), a lowpass in every line for
// the damping, slow modulation of the read positions against metallic ringing, and a
// chain of four allpass diffusers plus a pre-delay on the way in. The input is summed
// to mono; the two outputs take different sign patterns of the lines, which makes the
// wet signal stereo. out = dry * (1 - mix) + wet * mix.
const SIZE = 0, DECAY = 1, DAMP = 2, PREDELAY = 3, DIFFUSION = 4, MOD = 5, WIDTH = 6, MIX = 7;
const LINES = 8;
const BASE_MS = [29.7, 37.1, 41.1, 43.7, 53.0, 61.3, 67.7, 73.9];
const DIFFUSERS_44K = [142, 107, 379, 277];
const SIGN_IN = Float64Array.of(1, -1, 1, -1, -1, 1, -1, 1);
const SIGN_L = Float64Array.of(1, 1, -1, -1, 1, 1, -1, -1), SIGN_R = Float64Array.of(1, -1, 1, -1, -1, 1, -1, 1);

export default {
  type: 'hall',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'hall',
  params: [
    { name: 'size', min: 0.5, max: 2, def: 1 },
    { name: 'decay', min: 0.2, max: 20, def: 2.5 },    // seconds to fall by 60 dB
    { name: 'damp', min: 0, max: 1, def: 0.4 },
    { name: 'predelay', min: 0, max: 200, def: 20 },   // ms
    { name: 'diffusion', min: 0, max: 1, def: 0.7 },
    { name: 'mod', min: 0, max: 1, def: 0.3 },
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.3 },
  ],
  create({ sampleRate }) {
    const ms = sampleRate / 1000;
    const maxDepth = 40 * sampleRate / 48000;
    const size = Math.ceil(BASE_MS[LINES - 1] * 2 * ms + maxDepth) + 8;
    const lines = new Float32Array(LINES * size);   // the eight lines one after another
    const damp = new Float64Array(LINES), phase = Float64Array.from({ length: LINES }, (_, i) => i / LINES);
    const rate = Float64Array.from({ length: LINES }, (_, i) => (0.31 + 0.037 * i) / sampleRate);
    const gain = new Float64Array(LINES), len = new Float64Array(LINES), y = new Float64Array(LINES), at = new Float64Array(LINES), step = new Float64Array(LINES);
    let w = 0;
    const preSize = Math.ceil(0.2 * sampleRate) + 4, pre = new Float32Array(preSize);
    let pw = 0, preCur = -1;
    const diff = DIFFUSERS_44K.map(d => {
      const length = Math.max(2, Math.round(d * sampleRate / 44100));
      return { buf: new Float32Array(length), pos: 0, length };
    });
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.05));
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const sz = params[slots[SIZE]], rt60 = params[slots[DECAY]];
        const fc = Math.max(800, 20000 * (1 - params[slots[DAMP]]) ** 2);
        const lpCoef = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
        const preTarget = Math.min(params[slots[PREDELAY]] * ms, preSize - 3);
        const g = 0.15 + 0.5 * params[slots[DIFFUSION]];
        const depth = params[slots[MOD]] * maxDepth, width = params[slots[WIDTH]], mix = params[slots[MIX]];
        for (let k = 0; k < LINES; k++) {
          len[k] = BASE_MS[k] * sz * ms;
          gain[k] = Math.pow(10, (-3 * len[k]) / (sampleRate * rt60));   // 60 dB down after rt60 seconds
        }
        if (preCur < 0) preCur = preTarget;
        // The modulation moves a few times a second, so its sine is worked out at the start and end of the block and the
        // read position slides between them, instead of eight sines for every sample.
        const inv = 1 / n;
        for (let k = 0; k < LINES; k++) {
          const a0 = len[k] + depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase[k]));
          phase[k] += rate[k] * n; if (phase[k] >= 1) phase[k] -= 1;
          const a1 = len[k] + depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase[k]));
          at[k] = a0; step[k] = (a1 - a0) * inv;
        }
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          preCur += (preTarget - preCur) * slew;
          pre[pw] = (l + r) * 0.5;
          let rp = pw - preCur;
          if (rp < 0) rp += preSize;
          const pk = rp | 0, pf = rp - pk;
          let x = pre[pk] + (pre[pk + 1 === preSize ? 0 : pk + 1] - pre[pk]) * pf;
          if (++pw === preSize) pw = 0;
          for (let q = 0; q < diff.length; q++) {   // Schroeder allpass: v = x - g * v[n-D]; y = g * v + v[n-D]
            const d = diff[q];
            const delayed = d.buf[d.pos], v = x - g * delayed;
            d.buf[d.pos] = Math.abs(v) < 1e-20 ? 0 : v;
            x = g * v + delayed;
            if (++d.pos === d.length) d.pos = 0;
          }
          let sum = 0, wl = 0, wr = 0;
          for (let k = 0; k < LINES; k++) {
            let rr = w - at[k];
            if (rr < 0) rr += size;
            const o = k * size, ki = rr | 0, f = rr - ki, k1 = ki + 1 === size ? 0 : ki + 1;
            const a0 = lines[o + ki];
            const v = a0 + (lines[o + k1] - a0) * f;
            at[k] += step[k];
            const dk = damp[k] + lpCoef * (v - damp[k]);
            damp[k] = dk;
            const yk = gain[k] * dk;
            y[k] = yk;
            sum += yk;
            wl += SIGN_L[k] * dk;
            wr += SIGN_R[k] * dk;
          }
          const mixTerm = (2 / LINES) * sum;
          for (let k = 0; k < LINES; k++) {
            const v = x * 0.35 * SIGN_IN[k] + y[k] - mixTerm;   // Householder: y - (2/N) * sum
            lines[k * size + w] = Math.abs(v) < 1e-20 ? 0 : v;
          }
          if (++w === size) w = 0;
          wl *= 0.5; wr *= 0.5;
          const mid = (wl + wr) * 0.5;
          wl = mid + (wl - mid) * width; wr = mid + (wr - mid) * width;
          outL[i] = l + (wl - l) * mix;
          outR[i] = r + (wr - r) * mix;
        }
      },
    };
  },
};
