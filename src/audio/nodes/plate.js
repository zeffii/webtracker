// Plate reverb after Dattorro's design: a pre-delay and bandwidth filter, four input allpasses, and a "figure of
// eight" tank of two branches that feed each other, each with a slowly modulated allpass, a long delay, a damping
// lowpass and a second allpass. The outputs are summed from taps all over the tank, so the sound is dense and bright
// from the first instant, with none of the separate early reflections of a room. out = dry * (1 - mix) + wet * mix.
const PREDELAY = 0, BANDWIDTH = 1, DECAY = 2, DAMP = 3, DIFFUSION = 4, MOD = 5, WIDTH = 6, MIX = 7;
const REF = 29761;   // the sample rate the published delay lengths are for
const INPUT_AP = [142, 107, 379, 277];
const TANK = { l: [672, 4453, 1800, 3720], r: [908, 4217, 2656, 3163] };   // modulated allpass, delay, allpass, delay
const TAPS_L = [['r1', 266, 1], ['r1', 2974, 1], ['r3', 1913, -1], ['r4', 1996, 1], ['l1', 1990, -1], ['l3', 187, -1], ['l4', 1066, -1]];
const TAPS_R = [['l1', 353, 1], ['l1', 3627, 1], ['l3', 1228, -1], ['l4', 2673, 1], ['r1', 2111, -1], ['r3', 335, -1], ['r4', 121, -1]];

export default {
  type: 'plate',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'plate',
  params: [
    { name: 'predelay', min: 0, max: 200, def: 0 },       // ms
    { name: 'bandwidth', min: 0, max: 1, def: 0.8 },      // brightness of what goes in
    { name: 'decay', min: 0.2, max: 20, def: 2 },         // seconds to fall by 60 dB
    { name: 'damp', min: 0, max: 1, def: 0.3 },
    { name: 'diffusion', min: 0, max: 1, def: 0.8 },
    { name: 'mod', min: 0, max: 1, def: 0.4 },
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.3 },
  ],
  create({ sampleRate }) {
    const k = sampleRate / REF;
    const len = d => Math.max(2, Math.round(d * k));
    const maxExc = 16 * Math.max(1, k);
    const line = length => ({ buf: new Float32Array(length), w: 0 });
    const preSize = Math.ceil(0.2 * sampleRate) + 4, pre = new Float32Array(preSize);
    let pw = 0;
    const inAp = INPUT_AP.map(d => line(len(d)));
    const mk = t => ({ m: line(len(t[0]) + Math.ceil(maxExc) + 4), a: len(t[0]), d1: line(len(t[1])), lp: 0, ap: line(len(t[2])), d2: line(len(t[3])) });
    const L = mk(TANK.l), R = mk(TANK.r);
    const by = { l1: L.d1, l3: L.ap, l4: L.d2, r1: R.d1, r3: R.ap, r4: R.d2 };
    const tapsL = TAPS_L.map(([n, d, s]) => ({ ln: by[n], d: Math.min(by[n].buf.length - 1, len(d)), s }));
    const tapsR = TAPS_R.map(([n, d, s]) => ({ ln: by[n], d: Math.min(by[n].buf.length - 1, len(d)), s }));
    let inLp = 0, lEnd = 0, rEnd = 0, preCur = -1;
    const phase = [0.1, 0.6], rate = [0.9 / sampleRate, 1.1 / sampleRate];
    const at = [0, 0], step = [0, 0];
    const tap = (ln, d) => { let i = ln.w - d; if (i < 0) i += ln.buf.length; return ln.buf[i]; };
    const branch = (B, x, j, gt1, gt2, damp, decay) => {
      // modulated allpass: its read position wanders a few samples
      const m = B.m, size = m.buf.length;
      let rd = m.w - (B.a + at[j]);
      while (rd < 0) rd += size;
      const ki = rd | 0, f = rd - ki, k1 = ki + 1 === size ? 0 : ki + 1;
      const delayed = m.buf[ki] + (m.buf[k1] - m.buf[ki]) * f;
      const v = x - gt1 * delayed;
      m.buf[m.w] = Math.abs(v) < 1e-20 ? 0 : v;
      if (++m.w === size) m.w = 0;
      at[j] += step[j];
      let y = gt1 * v + delayed;
      const d1 = B.d1, o1 = d1.buf[d1.w];
      d1.buf[d1.w] = y; if (++d1.w === d1.buf.length) d1.w = 0;
      B.lp += (1 - damp) * (o1 - B.lp); y = B.lp * decay;
      const ap = B.ap, ad = ap.buf[ap.w], av = y - gt2 * ad;
      ap.buf[ap.w] = Math.abs(av) < 1e-20 ? 0 : av;
      if (++ap.w === ap.buf.length) ap.w = 0;
      y = gt2 * av + ad;
      const d2 = B.d2, o2 = d2.buf[d2.w];
      d2.buf[d2.w] = y; if (++d2.w === d2.buf.length) d2.w = 0;
      return o2;
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const preTarget = Math.min(params[slots[PREDELAY]] * sampleRate / 1000, preSize - 3);
        const bw = 0.1 + 0.899 * params[slots[BANDWIDTH]] ** 2;
        const damp = 0.9 * params[slots[DAMP]];
        const dif = params[slots[DIFFUSION]], g1 = 0.4 + 0.35 * dif, g2 = 0.3 + 0.32 * dif, gt1 = 0.35 + 0.35 * dif, gt2 = 0.25 + 0.25 * dif;
        const rt60 = params[slots[DECAY]];
        const half = (len(TANK.l[0]) + len(TANK.l[1]) + len(TANK.l[2]) + len(TANK.l[3])) / sampleRate;   // one branch's trip round the tank
        const decay = Math.min(0.9995, Math.pow(10, -3 * half / rt60));
        const exc = params[slots[MOD]] * maxExc, width = params[slots[WIDTH]], mix = params[slots[MIX]];
        if (preCur < 0) preCur = preTarget;
        const inv = 1 / n;
        for (let j = 0; j < 2; j++) {
          const a0 = exc * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase[j]));
          phase[j] += rate[j] * n; if (phase[j] >= 1) phase[j] -= 1;
          const a1 = exc * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase[j]));
          at[j] = a0; step[j] = (a1 - a0) * inv;
        }
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          preCur += (preTarget - preCur) * 0.001;
          pre[pw] = (l + r) * 0.5;
          let rp = pw - preCur;
          if (rp < 0) rp += preSize;
          const pk = rp | 0, pf = rp - pk;
          let x = pre[pk] + (pre[pk + 1 === preSize ? 0 : pk + 1] - pre[pk]) * pf;
          if (++pw === preSize) pw = 0;
          inLp += bw * (x - inLp); x = inLp;
          for (let q = 0; q < 4; q++) {
            const ln = inAp[q], g = q < 2 ? g1 : g2;
            const delayed = ln.buf[ln.w], v = x - g * delayed;
            ln.buf[ln.w] = Math.abs(v) < 1e-20 ? 0 : v;
            x = g * v + delayed;
            if (++ln.w === ln.buf.length) ln.w = 0;
          }
          // the two branches work on what the other produced one sample ago
          const nl = branch(L, x + rEnd, 0, gt1, gt2, damp, decay), nr = branch(R, x + lEnd, 1, gt1, gt2, damp, decay);
          lEnd = nl; rEnd = nr;
          let wl = 0, wr = 0;
          for (let q = 0; q < tapsL.length; q++) { wl += tapsL[q].s * tap(tapsL[q].ln, tapsL[q].d); wr += tapsR[q].s * tap(tapsR[q].ln, tapsR[q].d); }
          wl *= 0.6; wr *= 0.6;
          const mid = (wl + wr) * 0.5;
          wl = mid + (wl - mid) * width; wr = mid + (wr - mid) * width;
          outL[i] = l + (wl - l) * mix;
          outR[i] = r + (wr - r) * mix;
        }
      },
    };
  },
};
