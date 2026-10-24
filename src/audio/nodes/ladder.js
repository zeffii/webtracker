// ladder: a four-pole (24 dB) resonant lowpass with a built-in LFO and a dry/wet mix, made to sit in a chain and be swept.
// Zero-delay feedback, tanh-style saturation in front of the poles, and a resonance that reaches self-oscillation.
// The LFO rate is on a log scale (0.01 to 20 Hz), so the slow end, where most sweeps live, has plenty of room.
const CUT = 0, RES = 1, DRIVE = 2, RATE = 3, DEPTH = 4, SHAPE = 5, MIX = 6, LEVEL = 7;

const sat = x => { const x2 = x * x; return x > 3 ? 1 : x < -3 ? -1 : x * (27 + x2) / (27 + 9 * x2); };
const flush = v => (Math.abs(v) < 1e-18 ? 0 : v);

export default {
  type: 'ladder',
  inputs: ['in', 'mod'],   // mod is in octaves, added to the LFO and applied block by block
  outputs: ['out'],
  dual: true,
  category: 'Effects',
  shape: 'box',
  glyph: 'lowpass',
  kinds: { mod: 'control' },
  params: [
    { name: 'cutoff', min: 20, max: 18000, def: 1200 },
    { name: 'resonance', min: 0, max: 1, def: 0.3 },
    { name: 'drive', min: 0, max: 1, def: 0.2 },
    { name: 'rate', min: 0.01, max: 20, def: 0.5 },   // Hz, log
    { name: 'depth', min: 0, max: 4, def: 0 },   // octaves either side of the cutoff
    { name: 'shape', min: 0, max: 3, def: 0, int: true },   // sine, triangle, saw down, square
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ sampleRate }) {
    const sr = sampleRate, cs = 1 - Math.exp(-4 / (sr * 0.004)), ms = 1 - Math.exp(-1 / (sr * 0.02));
    const s = new Float64Array(4);
    let phase = 0, fc = -1, mixNow = -1, lvl = -1;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0], mod = inputs[1];
        const base = params[slots[CUT]], res = Math.min(Math.max(params[slots[RES]], 0), 1);
        const drive = 1 + params[slots[DRIVE]] * 5, inc = params[slots[RATE]] / sr, depth = params[slots[DEPTH]];
        const shape = Math.round(params[slots[SHAPE]]), mixT = params[slots[MIX]], levT = params[slots[LEVEL]];
        const k = res * 4.3, comp = 1 + res * 0.6, wet = 1 + res * res * 4, kick = res > 0.97 ? 1e-5 : 0;
        if (mixNow < 0) { mixNow = mixT; lvl = levT; }
        for (let i = 0; i < n; i += 4) {
          const m = Math.min(4, n - i);
          let v;
          if (shape === 0) v = Math.sin(2 * Math.PI * phase);
          else if (shape === 1) v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
          else if (shape === 2) v = 1 - 2 * phase;
          else v = phase < 0.5 ? 1 : -1;
          phase += inc * m; if (phase >= 1) phase -= 1;
          let oct = v * depth;
          if (mod) oct += Math.max(-8, Math.min(8, mod[i]));
          const target = base * Math.pow(2, oct);
          if (fc < 0) fc = target;
          fc += (target - fc) * cs;
          const gg = Math.tan(Math.PI * Math.min(Math.max(fc, 5), sr * 0.45) / sr);
          const G = gg / (1 + gg), G2 = G * G, G3 = G2 * G, G4 = G2 * G2, h = 1 - G, norm = 1 / (1 + k * G4);
          for (let j = i; j < i + m; j++) {
            mixNow += (mixT - mixNow) * ms; lvl += (levT - lvl) * ms;
            const dry = input[j];
            const S1 = h * s[0], S2 = h * s[1], S3 = h * s[2], S4 = h * s[3];
            const sigma = G3 * S1 + G2 * S2 + G * S3 + S4;
            const x1 = sat(((dry + kick) * comp * drive - k * sigma) * norm);
            const y1 = G * x1 + S1, y2 = G * y1 + S2, y3 = G * y2 + S3, y4 = G * y3 + S4;
            s[0] = flush(2 * y1 - s[0]); s[1] = flush(2 * y2 - s[1]); s[2] = flush(2 * y3 - s[2]); s[3] = flush(2 * y4 - s[3]);
            out[j] = (dry + (y4 * wet / drive - dry) * mixNow) * lvl;
          }
        }
      },
    };
  },
};
