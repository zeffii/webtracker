// twin: two multimode filters that can run one after the other, side by side, or anywhere between; the second can be locked to the first at a
// ratio (or follow the pitch of the sound), with drive and tilt in front, a noise and feedback source, an envelope follower and an LFO on
// each filter, and a dry/wet mix. Each filter is a 12 dB/oct zero-delay state-variable filter with a soft-clipped band state (so a high
// resonance stays bounded and sings) and its own low, band and high levels from -1 to 1 (negative levels give notch-like shapes).
//
// Wire an envelope or LFO node into mod1 / mod2 (octaves, sample by sample) for the filters' own envelopes; the follower and LFO here are
// the built-in ones. The shape of the response is drawn by twinresponse.js, which the panel and the tests share.
const IN_DRIVE = 0, TILT = 1, TILT_FREQ = 2, TRIGGER = 3, CUT1 = 4, RES1 = 5, LOW1 = 6, BAND1 = 7, HIGH1 = 8, CUT2 = 9, RES2 = 10, LOW2 = 11, BAND2 = 12, HIGH2 = 13,
  BLEND = 14, LOCK = 15, RATIO = 16, DETUNE = 17, TRACK = 18, TRANSPOSE = 19, LFO_RATE = 20, LFO_SHAPE = 21, LFO1 = 22, LFO2 = 23,
  F_ATTACK = 24, F_RELEASE = 25, F_SENS = 26, FOL1 = 27, FOL2 = 28, NOISE = 29, FEEDBACK = 30, FB_SOURCE = 31, MIX = 32, LEVEL = 33;

const clip = x => x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x);   // smooth tanh-like, exact at +-3
let V1 = 0, V2 = 0;
// One TPT state-variable step on state array st at offset o; leaves band in V1 and low in V2.
function step(st, o, x, a1, a2, a3) {
  const v3 = x - st[o + 1];
  let v1 = a1 * st[o] + a2 * v3;
  v1 = 2 * clip(0.5 * v1);
  const v2 = st[o + 1] + a2 * st[o] + a3 * v3;
  st[o] = 2 * v1 - st[o];
  st[o + 1] = 2 * v2 - st[o + 1];
  V1 = v1; V2 = v2;
}

export default {
  type: 'twin',
  inputs: ['in', 'mod1', 'mod2'],   // mod1 and mod2 are in octaves, applied sample by sample to filter 1 and filter 2
  outputs: ['out'],
  dual: true,
  category: 'Effects',
  shape: 'box',
  glyph: 'lowpass',
  editor: 'twin',   // the panel: the response of the pair, with the overtones above each cutoff
  kinds: { mod1: 'control', mod2: 'control' },
  params: [
    { name: 'drive', min: 0, max: 1, def: 0 },
    { name: 'tilt', min: -12, max: 12, def: 0 },
    { name: 'tiltfreq', min: 200, max: 8000, def: 2000 },
    { name: 'trigger', min: -60, max: 0, def: -30 },
    { name: 'cutoff1', min: 20, max: 18000, def: 1500 },
    { name: 'res1', min: 0, max: 1, def: 0.25 },
    { name: 'low1', min: -1, max: 1, def: 1 },
    { name: 'band1', min: -1, max: 1, def: 0 },
    { name: 'high1', min: -1, max: 1, def: 0 },
    { name: 'cutoff2', min: 20, max: 18000, def: 1500 },
    { name: 'res2', min: 0, max: 1, def: 0.25 },
    { name: 'low2', min: -1, max: 1, def: 1 },
    { name: 'band2', min: -1, max: 1, def: 0 },
    { name: 'high2', min: -1, max: 1, def: 0 },
    { name: 'blend', min: 0, max: 1, def: 0 },
    { name: 'lock', min: 0, max: 1, def: 0, int: true },
    { name: 'ratio', min: 0.25, max: 4, def: 1.5 },
    { name: 'detune', min: -100, max: 100, def: 0 },
    { name: 'track', min: 0, max: 1, def: 0, int: true },
    { name: 'transpose', min: -24, max: 24, def: 0, int: true },
    { name: 'lforate', min: 0.02, max: 40, def: 0.4 },
    { name: 'lfoshape', min: 0, max: 3, def: 0, int: true },
    { name: 'lfo1', min: -1, max: 1, def: 0 },
    { name: 'lfo2', min: -1, max: 1, def: 0 },
    { name: 'fattack', min: 1, max: 200, def: 5 },
    { name: 'frelease', min: 10, max: 2000, def: 120 },
    { name: 'fsens', min: 0, max: 1, def: 0.5 },
    { name: 'fol1', min: -1, max: 1, def: 0 },
    { name: 'fol2', min: -1, max: 1, def: 0 },
    { name: 'noise', min: 0, max: 1, def: 0 },
    { name: 'feedback', min: 0, max: 1, def: 0 },
    { name: 'fbsource', min: 0, max: 1, def: 0, int: true },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ sampleRate }) {
    const sr = sampleRate, cs = 1 - Math.exp(-4 / (sr * 0.004));
    const st = new Float64Array(4);   // 0 filter 1, 2 filter 2
    let fc1 = -1, fc2 = -1, rng = 22222, noiseRng = 7777;
    let lfoPhase = 0, env = 0, tiltLow = 0, fb = 0;
    // the pitch follower: positive-going zero crossings of the low-passed input, accepted when two in a row agree
    let pLow = 0, peak = 0, positive = false, sinceCross = 0, pitch = 0, candidate = 0, pitchSeen = false;
    const pLowCoef = 1 - Math.exp(-2 * Math.PI * 1500 / sr), minPeriod = sr / 2000, maxPeriod = sr / 40;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0], mod1 = inputs[1], mod2 = inputs[2];
        const P = i => params[slots[i]];
        const drive = P(IN_DRIVE), pre = 1 + drive * 9, post = 1 / (1 + drive * 2), driven = drive > 0.001;
        const tilt = P(TILT), tilted = tilt !== 0, tiltCoef = 1 - Math.exp(-2 * Math.PI * Math.min(P(TILT_FREQ), sr * 0.4) / sr);
        const gLow = Math.pow(10, -tilt / 40), gHigh = Math.pow(10, tilt / 40);
        const trigger = P(TRIGGER), sens = P(F_SENS);
        const cut1 = P(CUT1), cut2 = P(CUT2), res1 = Math.min(Math.max(P(RES1), 0), 1), res2 = Math.min(Math.max(P(RES2), 0), 1);
        const l1 = P(LOW1), b1 = P(BAND1), h1 = P(HIGH1), l2 = P(LOW2), b2 = P(BAND2), h2 = P(HIGH2);
        const blend = Math.min(Math.max(P(BLEND), 0), 1), lock = Math.round(P(LOCK)) === 1, ratio = P(RATIO), detune = Math.pow(2, P(DETUNE) / 1200);
        const track = Math.round(P(TRACK)) === 1, transpose = Math.pow(2, Math.round(P(TRANSPOSE)) / 12);
        const lfoStep = P(LFO_RATE) * 4 / sr, lfoShape = Math.round(P(LFO_SHAPE)), lfo1 = P(LFO1) * 2, lfo2 = P(LFO2) * 2;
        const attack = 1 - Math.exp(-1 / (sr * P(F_ATTACK) / 1000)), release = 1 - Math.exp(-1 / (sr * P(F_RELEASE) / 1000));
        const fol1 = P(FOL1) * 3, fol2 = P(FOL2) * 3;
        const noiseAmt = P(NOISE) * 0.5, feedback = P(FEEDBACK) * 0.9, fbFinal = Math.round(P(FB_SOURCE)) === 1;
        const mix = P(MIX), level = P(LEVEL);
        const k1 = 2 - 2.04 * res1, kb1 = Math.max(k1, 0.02), k2 = 2 - 2.04 * res2, kb2 = Math.max(k2, 0.02);
        const kick1 = res1 > 0.97 ? 1e-5 : 0, kick2 = res2 > 0.97 ? 1e-5 : 0;
        const wetLevel = 1 / (1 + blend);
        for (let i = 0; i < n; i += 4) {
          const m = Math.min(4, n - i);
          // the LFO and the follower at the start of the block
          let lfo;
          const ph = lfoPhase;
          if (lfoShape === 0) lfo = Math.sin(2 * Math.PI * ph);
          else if (lfoShape === 1) lfo = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
          else if (lfoShape === 2) lfo = 1 - 2 * ph;
          else lfo = ph < 0.5 ? 1 : -1;
          lfoPhase += lfoStep; if (lfoPhase >= 1) lfoPhase -= Math.floor(lfoPhase);
          const db = 20 * Math.log10(env + 1e-9);
          const level01 = Math.min(Math.max((db - trigger) / 30 * (0.5 + sens), 0), 1.5);
          // the two cutoffs this block
          let tracked = 0;
          if (track && pitchSeen) tracked = Math.min(Math.max(pitch * transpose, 20), 18000);
          const base1 = tracked > 0 && lock ? tracked / ratio : cut1;
          const o1 = Math.max(-8, Math.min(8, (mod1 ? mod1[i] : 0) + lfo * lfo1 + level01 * fol1));
          const o2 = Math.max(-8, Math.min(8, (mod2 ? mod2[i] : 0) + lfo * lfo2 + level01 * fol2));
          const t1 = base1 * Math.pow(2, o1);
          const t2 = lock ? t1 * ratio * detune * Math.pow(2, o2) : (tracked > 0 ? tracked : cut2) * detune * Math.pow(2, o2);
          if (fc1 < 0) { fc1 = t1; fc2 = t2; }
          fc1 += (t1 - fc1) * cs; fc2 += (t2 - fc2) * cs;
          const f1 = Math.min(Math.max(fc1, 5), sr * 0.45), f2 = Math.min(Math.max(fc2, 5), sr * 0.45);
          const g1 = Math.tan(Math.PI * f1 / sr), a11 = 1 / (1 + g1 * (g1 + k1)), a12 = g1 * a11, a13 = g1 * a12;
          const g2 = Math.tan(Math.PI * f2 / sr), a21 = 1 / (1 + g2 * (g2 + k2)), a22 = g2 * a21, a23 = g2 * a22;
          for (let j = i; j < i + m; j++) {
            const dry = input[j];
            // the follower and the pitch follower listen to the dry input
            const a = Math.abs(dry);
            env += (a - env) * (a > env ? attack : release);
            pLow += (dry - pLow) * pLowCoef;
            peak = Math.max(Math.abs(pLow), peak * 0.9995);
            const th = peak * 0.25;
            sinceCross++;
            if (!positive && pLow > th && peak > 0.002) {
              positive = true;
              if (sinceCross >= minPeriod && sinceCross <= maxPeriod) {
                const p = sr / sinceCross;
                if (pitch > 0 && Math.abs(Math.log2(p / pitch)) < 0.3) { pitch += (p - pitch) * 0.35; candidate = 0; }
                else if (candidate > 0 && Math.abs(Math.log2(p / candidate)) < 0.15) { pitch = p; candidate = 0; pitchSeen = true; }
                else candidate = p;
                if (pitch > 0) pitchSeen = true;
              }
              sinceCross = 0;
            } else if (positive && pLow < -th) positive = false;
            if (sinceCross > sr) sinceCross = sr;
            // the front end: noise and feedback join, then drive and tilt
            rng = (rng * 1664525 + 1013904223) >>> 0;
            noiseRng = (noiseRng * 69069 + 1) >>> 0;
            let x = dry;
            if (noiseAmt > 0) x += (noiseRng / 4294967296 - 0.5) * 2 * noiseAmt;
            if (feedback > 0) x += feedback * clip(fb);
            if (driven) x = clip(pre * x) * post;
            if (tilted) { tiltLow += (x - tiltLow) * tiltCoef; x = tiltLow * gLow + (x - tiltLow) * gHigh; }
            if (kick1 && l1 + b1 + h1 !== 0) x += (rng / 4294967296 - 0.5) * kick1;
            // filter 1
            step(st, 0, x, a11, a12, a13);
            const y1 = l1 * V2 + b1 * kb1 * V1 + h1 * (x - k1 * V1 - V2);
            // filter 2 hears filter 1 and the input in the proportion the blend says
            let x2 = x + (y1 - x) * (1 - blend);
            if (kick2) x2 += (rng / 4294967296 - 0.5) * kick2;
            step(st, 2, x2, a21, a22, a23);
            const y2 = l2 * V2 + b2 * kb2 * V1 + h2 * (x2 - k2 * V1 - V2);
            const y = (blend * y1 + y2) * wetLevel;
            fb = fbFinal ? y : y1;
            out[j] = (dry + (y - dry) * mix) * level;
          }
        }
        for (let q = 0; q < 4; q++) if (Math.abs(st[q]) < 1e-20) st[q] = 0;
        if (Math.abs(tiltLow) < 1e-20) tiltLow = 0;
        if (Math.abs(fb) < 1e-20) fb = 0;
        if (Math.abs(env) < 1e-20) env = 0;
      },
    };
  },
};
