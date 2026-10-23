// urugraVerb: a smooth stereo reverb in the Arguru and Freeverb line (ported from ArguruInspiredReverb3Opto.gendsp).
// Four damped feedback combs per channel, the right channel read a little further back so the two sides differ, then six
// all-pass diffusers in series, then a gentle low-pass and a mid/side width stage. A very slow sine (about 0.11 Hz) moves
// the comb and all-pass read positions a little, which keeps the tail from ringing. The pre-delay sits inside the comb
// loops, as in the original, so it also lengthens each echo of the tail. out = in * dry + reverb * wet.
//   predelay  ms (in the loop)       size   room size, 0 small to 1 large   decay  feedback, 0.1 to 0.93 is used
//   damp      darkens the tail       mod    depth of the slow modulation    width  0 mono, 1 as it is, 2 wide
const SPEC = [
  { name: 'predelay', min: 1, max: 90, def: 18 },
  { name: 'size', min: 0, max: 1, def: 0.65 },
  { name: 'decay', min: 0, max: 1, def: 0.78 },
  { name: 'damp', min: 0, max: 1, def: 0.35 },
  { name: 'mod', min: 0, max: 1, def: 0.22 },
  { name: 'dry', min: 0, max: 1, def: 1 },
  { name: 'wet', min: 0, max: 1, def: 0.42 },
  { name: 'width', min: 0, max: 2, def: 1 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const COMB_A = [29.7, 37.1, 41.3, 43.7], COMB_B = [38, 41, 47, 53];   // delay in ms: A + size * B
const EXTRA = [-23, -29, -37, -43];            // how much further back the right channel reads, in samples
const MOD_L = [1.0, 0.8, -0.7, 1.05], MOD_R = [-0.6, -0.5, 0.45, -0.55];
const AP_A = [12.7, 9.3, 7.1, 5.9, 4.3, 3.1], AP_B = [9, 8, 7, 6, 5, 4];
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// one tap of a circular buffer at a fractional distance behind the write position, interpolated
const tap = (buf, size, pos, back) => {
  let r = pos - back;
  r -= Math.floor(r / size) * size;
  const k = r | 0, f = r - k;
  const a = buf[k], b = buf[k + 1 === size ? 0 : k + 1];
  return a + (b - a) * f;
};

export default {
  type: 'urugraVerb',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'urugraVerb',
  params: SPEC,
  create({ sampleRate }) {
    const SIZE = 1 << Math.ceil(Math.log2(Math.max(8192, sampleRate * 0.25)));   // a comb buffer: room for the longest delay and pre-delay at this rate
    const combL = Array.from({ length: 4 }, () => new Float32Array(SIZE)), combR = Array.from({ length: 4 }, () => new Float32Array(SIZE));
    const damp = [new Float64Array(4), new Float64Array(4)];
    let w = 0;
    const AP = 2048;
    const apL = Array.from({ length: 6 }, () => new Float32Array(AP)), apR = Array.from({ length: 6 }, () => new Float32Array(AP)), apPos = new Int32Array(6);
    let lpL = 0, lpR = 0, phase = 0;
    const ms = sampleRate * 0.001, glide = 1 - Math.exp(-1 / (sampleRate * 0.01));
    const dsNow = new Float64Array(4).fill(-1), apNow = new Float64Array(6).fill(-1);
    let pdNow = -1;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g_ = name => params[slots[P[name]]];
        const size = g_('size'), decay = g_('decay'), dampP = g_('damp'), mod = g_('mod'), dry = g_('dry'), wet = g_('wet'), width = g_('width');
        const pdT = clamp(g_('predelay') * ms, 1, 5000), fb = clamp(decay, 0.1, 0.93), dampK = clamp(dampP, 0.05, 0.9), g = clamp(0.5 + decay * 0.25, 0.4, 0.75);
        const dsT = COMB_A.map((a, i) => clamp((a + size * COMB_B[i]) * ms, 50, Math.min(7000, SIZE - 4000)));
        const apT = AP_A.map((a, i) => clamp((a + size * AP_B[i]) * ms, 20, 1800));
        if (pdNow < 0) { pdNow = pdT; for (let i = 0; i < 4; i++) dsNow[i] = dsT[i]; for (let i = 0; i < 6; i++) apNow[i] = apT[i]; }
        const modAmt = mod * 7.5, coeff = Math.exp(-2 * Math.PI * (4200 + (1 - dampK) * 6500) / sampleRate);
        for (let s = 0; s < n; s++) {
          const x1 = inL[s], x2 = inR[s];
          phase += 0.11 / sampleRate; if (phase > 1) phase -= 1;
          const modSig = Math.sin(phase * 2 * Math.PI);
          pdNow += (pdT - pdNow) * glide;
          let sumL = 0, sumR = 0;
          for (let c = 0; c < 4; c++) {
            dsNow[c] += (dsT[c] - dsNow[c]) * glide;
            const bl = combL[c], br = combR[c];
            const cl = tap(bl, SIZE, w, dsNow[c] + pdNow - modSig * modAmt * MOD_L[c]);
            const cr = tap(br, SIZE, w, dsNow[c] + pdNow - EXTRA[c] - modSig * modAmt * MOD_R[c]);
            damp[0][c] = cl * (1 - dampK) + damp[0][c] * dampK;
            damp[1][c] = cr * (1 - dampK) + damp[1][c] * dampK;
            bl[w] = x1 + damp[0][c] * fb; br[w] = x2 + damp[1][c] * fb;
            sumL += cl; sumR += cr;
          }
          if (++w === SIZE) w = 0;
          let l = sumL * 0.25, r = sumR * 0.25;
          for (let i = 0; i < 6; i++) {
            apNow[i] += (apT[i] - apNow[i]) * glide;
            const dly = apNow[i] + modSig * mod * 2.8, p = apPos[i];
            const bL = tap(apL[i], AP, p, dly), tL = l + g * bL;
            apL[i][p] = tL; l = bL - g * tL;
            const bR = tap(apR[i], AP, p, dly + 13 + i * 3.5), tR = r + g * bR;
            apR[i][p] = tR; r = bR - g * tR;
            apPos[i] = p + 1 === AP ? 0 : p + 1;
          }
          lpL = l + (lpL - l) * coeff; lpR = r + (lpR - r) * coeff;
          if (Math.abs(lpL) < 1e-20) lpL = 0;
          if (Math.abs(lpR) < 1e-20) lpR = 0;
          const mid = (lpL + lpR) * 0.5, side = (lpL - lpR) * 0.5 * width;
          outL[s] = x1 * dry + (mid + side) * wet;
          outR[s] = x2 * dry + (mid - side) * wet;
        }
        if (!Number.isFinite(lpL + lpR)) { lpL = lpR = 0; for (const b of [...combL, ...combR, ...apL, ...apR]) b.fill(0); damp[0].fill(0); damp[1].fill(0); }
      },
    };
  },
};
