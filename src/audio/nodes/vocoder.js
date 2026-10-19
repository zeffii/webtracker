// Vocoder: the spectrum of the `voice` input is measured in a bank of bandpass filters, and each band's loudness is
// imposed on the same band of the `carrier` input (or of a built-in buzz when nothing is wired to carrier).
// Bands are log-spaced between low and high; analysis and synthesis are two-pole TPT bandpasses, two in series each.
// `shift` moves the synthesis bands up or down against the analysis bands (formant shift), `sibilance` lets the
// voice's own highs through so consonants stay crisp.
const BANDS = 0, LOW = 1, HIGH = 2, Q = 3, ATT = 4, REL = 5, SHIFT = 6, SIB = 7, TUNE = 8, NOISE = 9, LEVEL = 10;
const MAXB = 32;

export default {
  type: 'vocoder',
  inputs: ['voice', 'carrier'],
  outputs: ['out'],
  category: 'Effects',
  shape: 'box',
  glyph: 'bands',
  params: [
    { name: 'bands', min: 4, max: 32, def: 16, int: true },
    { name: 'low', min: 40, max: 1000, def: 120 },
    { name: 'high', min: 2000, max: 18000, def: 8000 },
    { name: 'q', min: 1, max: 20, def: 5 },
    { name: 'attack', min: 0.5, max: 50, def: 3 },
    { name: 'release', min: 5, max: 500, def: 60 },
    { name: 'shift', min: -12, max: 12, def: 0 },
    { name: 'sibilance', min: 0, max: 1, def: 0.4 },
    { name: 'tune', min: 30, max: 800, def: 110 },
    { name: 'noise', min: 0, max: 1, def: 0.15 },
    { name: 'level', min: 0, max: 4, def: 1 },
  ],
  create({ sampleRate }) {
    const sr = sampleRate;
    // per band: analysis (two stages) and synthesis (two stages) states [ic1, ic2] and coefficients [a1, a2, a3, k]
    const aS = new Float64Array(MAXB * 4), sS = new Float64Array(MAXB * 4), env = new Float64Array(MAXB);
    const aC = new Float64Array(MAXB * 4), sC = new Float64Array(MAXB * 4);
    const hp = new Float64Array(2);
    let key = '', nb = 0, phase = 0, rng = 12345;
    const coef = (arr, o, f, q) => {
      const g = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr), k = 1 / q, a1 = 1 / (1 + g * (g + k));
      arr[o] = a1; arr[o + 1] = g * a1; arr[o + 2] = g * g * a1; arr[o + 3] = k;
    };
    // one bandpass step with unity peak gain; c holds coefficients at offset co, s the two states at offset so
    const bp = (c, co, s, so, x) => {
      const v3 = x - s[so + 1], v1 = c[co] * s[so] + c[co + 1] * v3, v2 = s[so + 1] + c[co + 1] * s[so] + c[co + 2] * v3;
      s[so] = 2 * v1 - s[so]; s[so + 1] = 2 * v2 - s[so + 1];
      return v1 * c[co + 3];
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const voice = inputs[0], carrier = inputs[1], out = outputs[0];
        if (!voice) { out.fill(0, 0, n); return; }
        const bands = Math.round(params[slots[BANDS]]), low = params[slots[LOW]], high = Math.max(params[slots[HIGH]], low * 2);
        const q = params[slots[Q]], shift = params[slots[SHIFT]], sib = params[slots[SIB]];
        const k = `${bands}|${low}|${high}|${q}|${shift}`;
        if (k !== key) {
          key = k; nb = bands;
          const ratio = Math.pow(high / low, 1 / Math.max(bands - 1, 1)), sh = Math.pow(2, shift / 12);
          // wider bands when there are fewer of them, so the spectrum stays covered
          const qq = q * Math.min(1, 16 / bands) * Math.max(1, Math.sqrt(bands / 16));
          for (let b = 0; b < bands; b++) {
            const f = low * Math.pow(ratio, b);
            coef(aC, b * 4, f, qq); coef(sC, b * 4, f * sh, qq);
          }
          aS.fill(0); sS.fill(0);
        }
        const att = Math.exp(-1 / (sr * params[slots[ATT]] / 1000)), rel = Math.exp(-1 / (sr * params[slots[REL]] / 1000));
        const level = params[slots[LEVEL]] * 10 * Math.sqrt(16 / bands), hz = params[slots[TUNE]], noiseAmt = params[slots[NOISE]];
        const dt = hz / sr, gHp = Math.tan(Math.PI * 5000 / sr), hk = 1.4142, ha1 = 1 / (1 + gHp * (gHp + hk));
        for (let i = 0; i < n; i++) {
          const x = voice[i];
          let c;
          if (carrier) c = carrier[i];
          else {   // built-in carrier: a band-limited sawtooth plus noise
            phase += dt; if (phase >= 1) phase -= 1;
            let saw = 2 * phase - 1;
            if (phase < dt) { const t = phase / dt; saw -= t + t - t * t - 1; }
            else if (phase > 1 - dt) { const t = (phase - 1) / dt; saw -= t * t + t + t + 1; }
            rng = (rng * 1664525 + 1013904223) >>> 0;
            c = saw * 0.6 + noiseAmt * 0.6 * (rng / 2147483648 - 1);
          }
          let sum = 0;
          for (let b = 0; b < nb; b++) {
            const o = b * 4;
            let a = bp(aC, o, aS, o, x); a = bp(aC, o, aS, o + 2, a);
            const r = a < 0 ? -a : a, e = env[b];
            env[b] = r > e ? r + att * (e - r) : r + rel * (e - r);
            let s = bp(sC, o, sS, o, c); s = bp(sC, o, sS, o + 2, s);
            sum += s * env[b];
          }
          // highs of the voice, straight through (a highpass at 5 kHz)
          const v3 = x - hp[1], v1 = ha1 * hp[0] + gHp * ha1 * v3, v2 = hp[1] + gHp * ha1 * hp[0] + gHp * gHp * ha1 * v3;
          hp[0] = 2 * v1 - hp[0]; hp[1] = 2 * v2 - hp[1];
          const high5 = x - hk * v1 - v2;
          out[i] = sum * level + high5 * sib;
        }
      },
    };
  },
};
