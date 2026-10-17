// Parametric equaliser, stereo: a low cut, a low shelf, three peaking bands, a high shelf and a high cut
// (RBJ biquads; the cuts are second-order Butterworth, 12 dB per octave). A band with 0 dB gain is skipped,
// the low cut is off at 20 Hz and the high cut at 20 kHz. The selected node draws its response curve, each
// band's own curve and a dot for every band in the patcher (`curves` below feeds that drawing).
const BANDS = 5;
const KINDS = ['lowshelf', 'peak', 'peak', 'peak', 'highshelf'];
const FREQS = [100, 350, 1200, 3500, 9000];
const SPEC = [
  { name: 'lowcut', min: 20, max: 1000, def: 20 },
  { name: 'highcut', min: 1000, max: 20000, def: 20000 },
];
for (let k = 1; k <= BANDS; k++) {
  SPEC.push(
    { name: `f${k}`, min: 20, max: 20000, def: FREQS[k - 1] },
    { name: `g${k}`, min: -18, max: 18, def: 0 },     // dB
    { name: `q${k}`, min: 0.2, max: 10, def: k === 1 || k === BANDS ? 0.71 : 1 },
  );
}
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// Normalised biquad [b0, b1, b2, a1, a2] (RBJ cookbook).
export function biquad(kind, f, gainDb, q, sr) {
  const w = 2 * Math.PI * Math.min(Math.max(f, 5), sr * 0.45) / sr, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40), alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'peak') {
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else if (kind === 'lowshelf' || kind === 'highshelf') {
    const t = 2 * Math.sqrt(A) * alpha, lo = kind === 'lowshelf', s = lo ? 1 : -1;
    b0 = A * ((A + 1) - s * (A - 1) * cw + t);
    b1 = s * 2 * A * ((A - 1) - s * (A + 1) * cw);
    b2 = A * ((A + 1) - s * (A - 1) * cw - t);
    a0 = (A + 1) + s * (A - 1) * cw + t;
    a1 = -s * 2 * ((A - 1) + s * (A + 1) * cw);
    a2 = (A + 1) + s * (A - 1) * cw - t;
  } else if (kind === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {   // lowpass
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// Gain in dB of a biquad at a frequency.
export function magnitudeDb(c, f, sr) {
  const w = 2 * Math.PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2);
  const dr = 1 + c[3] * c1 + c[4] * c2, di = -(c[3] * s1 + c[4] * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
}

// The active bands for a set of values (by parameter name): { f, gain, kind, coef, db(f) }.
export function bandCurves(value, sr = 48000) {
  const out = [];
  const lowcut = value('lowcut'), highcut = value('highcut');
  if (lowcut > 20.5) out.push({ kind: 'highpass', f: lowcut, gain: 0, coef: biquad('highpass', lowcut, 0, Math.SQRT1_2, sr), cut: true, slot: 0 });
  for (let k = 1; k <= BANDS; k++) {
    const gain = value(`g${k}`);
    out.push({ kind: KINDS[k - 1], f: value(`f${k}`), gain, coef: biquad(KINDS[k - 1], value(`f${k}`), gain, value(`q${k}`), sr), band: k, slot: k, off: Math.abs(gain) < 0.01 });
  }
  if (highcut < 19990) out.push({ kind: 'lowpass', f: highcut, gain: 0, coef: biquad('lowpass', highcut, 0, Math.SQRT1_2, sr), cut: true, slot: BANDS + 1 });
  for (const b of out) b.db = f => magnitudeDb(b.coef, f, sr);
  return out;
}

export default {
  type: 'eq',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'eq',
  curves: bandCurves,   // for the response drawing
  params: SPEC,
  create({ sampleRate }) {
    const MAX = BANDS + 2;
    const z1 = [new Float64Array(MAX), new Float64Array(MAX)], z2 = [new Float64Array(MAX), new Float64Array(MAX)];
    return {
      process(inputs, outputs, n, params, slots) {
        const value = name => params[slots[P[name]]];
        const all = bandCurves(value, sampleRate), stages = all.filter(b => b.cut || !b.off);
        for (let ch = 0; ch < 2; ch++) {
          const x = inputs[0][ch], y = outputs[0][ch];
          if (x !== y) y.set(x.subarray(0, n), 0);
          for (let si = 0; si < MAX; si++) if (!stages.some(s => s.slot === si)) { z1[ch][si] = 0; z2[ch][si] = 0; }   // a stage that is off keeps no tail
          for (const s of stages) {
            const si = s.slot, [b0, b1, b2, a1, a2] = s.coef;
            let s1 = z1[ch][si], s2 = z2[ch][si];
            for (let i = 0; i < n; i++) {   // transposed direct form II
              const v = y[i], o = b0 * v + s1;
              s1 = b1 * v - a1 * o + s2;
              s2 = b2 * v - a2 * o;
              y[i] = o;
            }
            z1[ch][si] = Math.abs(s1) < 1e-20 ? 0 : s1; z2[ch][si] = Math.abs(s2) < 1e-20 ? 0 : s2;
          }
        }
      },
    };
  },
};
