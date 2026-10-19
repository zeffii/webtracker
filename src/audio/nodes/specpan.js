// Spectral panner: the sound is split into ten bands (a subtractive split, so with no panning the bands add back to
// the input) and each band gets its own place in the stereo field. A shape picks the pattern across the
// spectrum, `spread` how far bands move from where they are, `rotate` slides the pattern along the bands (it can be
// modulated or written from a pattern for a moving image), and everything below `lowMono` Hz is made mono, which keeps
// kick and bass solid. A band moves by blending its own stereo image toward its mono sum placed at the pan position.
const SHAPE = 0, SPREAD = 1, ROTATE = 2, LOWMONO = 3, MIX = 4, B1 = 5;
const BANDS = 10, CUTS = BANDS - 1;
const F_LOW = 150, F_HIGH = 10000;
export const SHAPES = ['alternate', 'sweep', 'wave', 'custom'];

// The pan position (-1 left to 1 right) of every band for a shape and a rotation; `custom` reads the band values.
export function bandPans(shape, rotate, custom, out = new Float64Array(BANDS)) {
  for (let k = 0; k < BANDS; k++) {
    const t = k / (BANDS - 1);
    if (shape === 0) out[k] = Math.cos(Math.PI * (k + BANDS * rotate));
    else if (shape === 1) { const f = (k + 0.5) / BANDS + rotate; out[k] = 2 * (f - Math.floor(f)) - 1; }
    else if (shape === 2) out[k] = Math.sin(4 * Math.PI * (t + rotate));
    else { const p = (((k + BANDS * rotate) % BANDS) + BANDS) % BANDS, a = Math.floor(p), f = p - a; out[k] = custom[a] + (custom[(a + 1) % BANDS] - custom[a]) * f; }
  }
  return out;
}

export const crossovers = () => Array.from({ length: CUTS }, (_, i) => F_LOW * Math.pow(F_HIGH / F_LOW, i / (CUTS - 1)));

const lowpass = (f, sr, high = false) => {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (high ? 1 + c : 1 - c) / 2 / a0, b1 = (high ? -(1 + c) : 1 - c) / a0;
  return [b0, b1, b0, -2 * c / a0, (1 - al) / a0];
};

export default {
  type: 'specpan',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'specpan',
  params: [
    { name: 'shape', min: 0, max: 3, def: 0, int: true },
    { name: 'spread', min: 0, max: 1, def: 0.6 },
    { name: 'rotate', min: -1, max: 1, def: 0 },
    { name: 'lowMono', min: 20, max: 400, def: 100 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    ...Array.from({ length: BANDS }, (_, i) => ({ name: `b${i + 1}`, min: -1, max: 1, def: 0 })),
  ],
  create({ sampleRate }) {
    const cuts = crossovers().map(f => lowpass(f, sampleRate));
    // biquad states per channel: [z1, z2] for each cut, then the low-mono filter
    const zl = new Float64Array(CUTS * 4 + 8), zr = new Float64Array(CUTS * 4 + 8);   // two stages (24 dB/oct) for every crossover; the low-mono split is a Linkwitz-Riley pair
    let lowF = -1, low = lowpass(100, sampleRate), high = lowpass(100, sampleRate, true);
    // per band, the four gains of out = aL*bl + bL*br (left) and aR*bl + bR*br... folded onto the lowpass outputs
    const cur = new Float64Array(BANDS * 4), target = new Float64Array(BANDS * 4), pans = new Float64Array(BANDS), custom = new Float64Array(BANDS);
    const lpL = new Float64Array(BANDS), lpR = new Float64Array(BANDS), coef = new Float64Array((BANDS + 1) * 4);
    let started = false;
    const tick = (c, z, o, x) => { const y = c[0] * x + z[o]; z[o] = c[1] * x - c[3] * y + z[o + 1]; z[o + 1] = c[2] * x - c[4] * y; return y; };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const shape = Math.round(params[slots[SHAPE]]), spread = params[slots[SPREAD]], mix = params[slots[MIX]];
        const lf = params[slots[LOWMONO]];
        if (lf !== lowF) { lowF = lf; low = lowpass(lf, sampleRate); high = lowpass(lf, sampleRate, true); }
        for (let k = 0; k < BANDS; k++) custom[k] = params[slots[B1 + k]];
        bandPans(shape, params[slots[ROTATE]], custom, pans);
        // band k, with weight w and position p: left = bl*(1-w+0.5*w*gl) + br*0.5*w*gl; right = br*(1-w+0.5*w*gr) + bl*0.5*w*gr
        for (let k = 0; k < BANDS; k++) {
          const p = Math.max(-1, Math.min(1, pans[k])), w = Math.min(1, Math.abs(p) * spread), a = (p + 1) * Math.PI / 4;
          const gl = Math.SQRT2 * Math.cos(a), gr = Math.SQRT2 * Math.sin(a);
          target[k * 4] = 1 - w + 0.5 * w * gl; target[k * 4 + 1] = 0.5 * w * gl;
          target[k * 4 + 2] = 0.5 * w * gr; target[k * 4 + 3] = 1 - w + 0.5 * w * gr;
        }
        if (!started) { cur.set(target); started = true; } else for (let i = 0; i < cur.length; i++) cur[i] += (target[i] - cur[i]) * 0.3;
        // c_k are the gains of band k (LP_k - LP_k-1); folded onto LP_k: (c_k - c_k+1), the top band takes the input itself
        for (let k = 0; k <= BANDS - 1; k++) for (let j = 0; j < 4; j++) coef[k * 4 + j] = cur[k * 4 + j] - (k + 1 < BANDS ? cur[(k + 1) * 4 + j] : 0);
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          const lo = tick(low, zl, CUTS * 4 + 2, tick(low, zl, CUTS * 4, l)), ro = tick(low, zr, CUTS * 4 + 2, tick(low, zr, CUTS * 4, r)), m = (lo + ro) * 0.5;
          const xl = tick(high, zl, CUTS * 4 + 6, tick(high, zl, CUTS * 4 + 4, l)), xr = tick(high, zr, CUTS * 4 + 6, tick(high, zr, CUTS * 4 + 4, r));
          for (let k = 0; k < CUTS; k++) { lpL[k] = tick(cuts[k], zl, k * 4 + 2, tick(cuts[k], zl, k * 4, xl)); lpR[k] = tick(cuts[k], zr, k * 4 + 2, tick(cuts[k], zr, k * 4, xr)); }
          lpL[CUTS] = xl; lpR[CUTS] = xr;
          let ol = m, or = m;
          for (let k = 0; k < BANDS; k++) {
            const a = coef[k * 4], b = coef[k * 4 + 1], c = coef[k * 4 + 2], d = coef[k * 4 + 3];
            ol += a * lpL[k] + b * lpR[k];
            or += c * lpL[k] + d * lpR[k];
          }
          outL[i] = l + (ol - l) * mix;
          outR[i] = r + (or - r) * mix;
        }
        for (let i = 0; i < zl.length; i++) { if (Math.abs(zl[i]) < 1e-20) zl[i] = 0; if (Math.abs(zr[i]) < 1e-20) zr[i] = 0; }
      },
    };
  },
};
