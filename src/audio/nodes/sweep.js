// sweep: one knob that filters "as if it had always been part of the signal". At 0 the sound is untouched. Turning down
// closes a lowpass from the top of the spectrum, turning up opens a highpass from the bottom; the resonance grows in with
// the distance from the middle, and the first few percent fade the filter in, so there is never a dry/wet seam to hear.
// A zero-delay state-variable filter, one or two stages (12 or 24 dB). `mod` adds to the knob (a full swing is 1.0).
const SWEEP = 0, RES = 1, SLOPE = 2;
const LO = 20, HI = 18000, FADE = 0.05;

const clip = x => x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x);
const flush = v => (Math.abs(v) < 1e-18 ? 0 : v);

export default {
  type: 'sweep',
  inputs: ['in', 'mod'],
  outputs: ['out'],
  dual: true,
  category: 'Effects',
  shape: 'box',
  glyph: 'lowpass',
  kinds: { mod: 'control' },
  params: [
    { name: 'sweep', min: -1, max: 1, def: 0 },   // below 0 lowpass, above 0 highpass
    { name: 'resonance', min: 0, max: 1, def: 0.25 },
    { name: 'slope', min: 0, max: 1, def: 0, int: true },   // 12 dB, 24 dB
  ],
  create({ sampleRate }) {
    const sr = sampleRate, ss = 1 - Math.exp(-1 / (sr * 0.012));
    const st = new Float64Array(4);   // two stages of (ic1, ic2)
    let cur = null;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0], mod = inputs[1];
        const target = params[slots[SWEEP]], res = Math.min(Math.max(params[slots[RES]], 0), 1), two = params[slots[SLOPE]] >= 0.5;
        if (cur === null) cur = target;
        for (let i = 0; i < n; i += 4) {
          const m = Math.min(4, n - i);
          const goal = Math.max(-1, Math.min(1, target + (mod ? mod[i] : 0)));
          cur += (goal - cur) * Math.min(1, ss * 4);
          const a = Math.abs(cur), low = cur < 0;
          const fc = low ? 20000 * Math.pow(40 / 20000, a) : LO * Math.pow(HI / LO, a);
          const wet = Math.min(1, a / FADE), q = res * Math.min(1, a * 3);
          const g = Math.tan(Math.PI * Math.min(Math.max(fc, 5), sr * 0.45) / sr), k = 2 - 1.95 * q;
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          const b1 = 1 / (1 + g * (g + 1.4)), b2 = g * b1, b3 = g * b2;
          for (let j = i; j < i + m; j++) {
            const x = input[j];
            if (wet === 0) { out[j] = x; continue; }   // exactly untouched in the middle
            let v3 = x - st[1], v1 = 2 * clip(0.5 * (a1 * st[0] + a2 * v3));
            let v2 = st[1] + a2 * st[0] + a3 * v3;
            st[0] = flush(2 * v1 - st[0]); st[1] = flush(2 * v2 - st[1]);
            let y = low ? v2 : x - k * v1 - v2;
            if (two) {
              v3 = y - st[3];
              const w1 = b1 * st[2] + b2 * v3, w2 = st[3] + b2 * st[2] + b3 * v3;
              st[2] = flush(2 * w1 - st[2]); st[3] = flush(2 * w2 - st[3]);
              y = low ? w2 : y - 1.4 * w1 - w2;
            }
            out[j] = x + (y - x) * wet;
          }
        }
      },
    };
  },
};
