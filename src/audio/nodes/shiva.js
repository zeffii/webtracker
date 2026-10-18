// Shiva delay: a stereo delay with up to 16 taps you place yourself. Each tap has a time (a fraction of
// `length`, so the whole pattern stretches with one parameter), a level and a pan, drawn in the tap view of the
// patcher panel and stored on the node as a flat list [time, level, pan, time, level, pan, ...]. The input is
// summed to mono into one line. The latest tap feeds back (through a lowpass, `damp`), so the pattern repeats
// every time it ends. Dry stays stereo.
export const MAX_TAPS = 16, MAX_LENGTH_MS = 2000;
export const DEFAULT_TAPS = [1, 2, 3, 4, 5, 6].flatMap((k, i) => [k / 6, Math.round(Math.pow(0.7, i) * 1000) / 1000, i % 2 ? 0.6 : -0.6]);

// Any stored list becomes whole, clamped triples, in the order given (at least one tap, at most MAX_TAPS).
export function normalizeTaps(points) {
  if (!Array.isArray(points) || points.length < 3 || !points.every(Number.isFinite)) return [...DEFAULT_TAPS];
  const out = [];
  for (let i = 0; i + 2 < points.length && out.length < MAX_TAPS * 3; i += 3) {
    out.push(Math.min(1, Math.max(0.001, points[i])), Math.min(1, Math.max(0, points[i + 1])), Math.min(1, Math.max(-1, points[i + 2])));
  }
  return out;
}

const LENGTH = 0, FEEDBACK = 1, DAMP = 2, MIX = 3;

export default {
  type: 'shiva',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'shiva',
  editor: 'taps',
  params: [
    { name: 'length', min: 20, max: MAX_LENGTH_MS, def: 600 },   // ms: where a tap at the far right of the view sits
    { name: 'feedback', min: 0, max: 0.95, def: 0.3 },
    { name: 'damp', min: 0, max: 1, def: 0.3 },                   // lowpass in the feedback path: 0 bright, 1 dark
    { name: 'mix', min: 0, max: 1, def: 0.4 },
  ],
  create({ sampleRate, data }) {
    const size = Math.ceil(sampleRate * MAX_LENGTH_MS / 1000) + 8;
    const buf = new Float32Array(size);
    let w = 0, lp = 0;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.03));
    const dly = new Float64Array(MAX_TAPS), gl = new Float64Array(MAX_TAPS), gr = new Float64Array(MAX_TAPS);
    const tt = new Float64Array(MAX_TAPS), tl = new Float64Array(MAX_TAPS), tr = new Float64Array(MAX_TAPS);
    let count = 0, latest = 0, fresh = true, len = -1;
    const load = points => {
      const t = normalizeTaps(points);
      count = t.length / 3;
      latest = 0;
      for (let k = 0; k < count; k++) {
        tt[k] = t[k * 3];
        const a = (t[k * 3 + 2] + 1) * Math.PI / 4;
        tl[k] = t[k * 3 + 1] * Math.SQRT2 * Math.cos(a);
        tr[k] = t[k * 3 + 1] * Math.SQRT2 * Math.sin(a);
        if (tt[k] > tt[latest]) latest = k;
      }
      for (let k = count; k < MAX_TAPS; k++) { tl[k] = 0; tr[k] = 0; }
    };
    load(data?.taps);
    return {
      message(msg) { if (msg.type === 'taps') load(msg.points); },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const target = Math.min(Math.max(params[slots[LENGTH]], 1), MAX_LENGTH_MS) * 0.001 * sampleRate;
        const fb = params[slots[FEEDBACK]], damp = params[slots[DAMP]], mix = params[slots[MIX]];
        const a = 1 - damp * 0.95;   // one-pole lowpass coefficient
        if (len < 0) len = target;
        if (fresh) { for (let k = 0; k < MAX_TAPS; k++) { dly[k] = tt[k] * target; gl[k] = tl[k]; gr[k] = tr[k]; } fresh = false; }
        for (let i = 0; i < n; i++) {
          len += (target - len) * slew;
          let wl = 0, wr = 0, last = 0;
          for (let k = 0; k < MAX_TAPS; k++) {
            gl[k] += (tl[k] - gl[k]) * slew;
            gr[k] += (tr[k] - gr[k]) * slew;
            dly[k] += (tt[k] * len - dly[k]) * slew;
            if (gl[k] < 1e-6 && gr[k] < 1e-6 && k >= count) continue;
            let r = w - Math.max(dly[k], 1);
            if (r < 0) r += size;
            const j = r | 0, f = r - j, j1 = j + 1 === size ? 0 : j + 1;
            const v = buf[j] + (buf[j1] - buf[j]) * f;
            wl += v * gl[k];
            wr += v * gr[k];
            if (k === latest) last = v;
          }
          const l = inL[i], r = inR[i];
          outL[i] = l + wl * mix;
          outR[i] = r + wr * mix;
          lp += (last - lp) * a;
          const v = (l + r) * 0.5 + lp * fb;
          buf[w] = Math.abs(v) < 1e-20 ? 0 : v;   // no slow denormals in a long tail
          if (++w === size) w = 0;
        }
      },
    };
  },
};
