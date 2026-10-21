// Fourpole: a synth after the design of Fuzzpilz's Buzz machine Orange Kid.
// Two table oscillators (ten waves, mixed 1+2, 1-2, 2-1, 1*2, 1/2, 2/1), two linear ADSRs, a vibrato, glide, and four
// resonant two-pole filters (lowpass or highpass, each able to slave to filter 1) in eight routings. What an envelope
// moves follows the machine's law: modulated = normal * (1 + amount * envelope). One voice (put it behind `voices`).
//
// Waves are 32768-point tables read without interpolation, like the original: sine, triangle, square, up saw, down saw,
// three "sawoids", and two seeded noises (the same seed gives the same wave). Every wave but the sine is smoothed by four
// passes of a gentle lowpass. Phase start/end choose the part of the table one cycle plays; its mean is removed.
// Cutoff Hz = cut/1000 * the Cutoff Limit (a frequency, or a multiple or fraction of the note that is playing).
// Times are in ms (the original's 1.01^((v-2000)/10) scale); the envelope amounts are -1..1 about "none" (the original's
// 16384 centre). Filter cut and res keep the original's integer scales so a Buzz preset maps straight across:
// cut 0..1000 (1001 on filters 2-4 = slave), res 50..1000 for a Q of res/50 (49 on filters 2-4 = slave).

const N = 32768, MASK = N - 1;
const P = {};
const SPEC = [
  { name: 'wave1', min: 0, max: 9, def: 0, int: true },        // sine, triangle, square, upsaw, downsaw, sawoid 1-3, noise 1, noise 2
  { name: 'wave2', min: 0, max: 10, def: 10, int: true },      // as wave 1; 10 is off
  { name: 'seed', min: 0, max: 65534, def: 1, int: true },     // seed of the two noise waves
  { name: 'phase', min: 0, max: 1, def: 0 },                   // phase of oscillator 2 against 1, in cycles
  { name: 'transpose', min: -36, max: 36, def: 0, int: true }, // semitones, oscillator 2 against 1
  { name: 'detune', min: -100, max: 100, def: 0 },             // cents, oscillator 2 against 1
  { name: 'mix', min: 0, max: 5, def: 0, int: true },          // 1+2, 1-2, 2-1, 1*2, 1/2, 2/1
  { name: 'pstart', min: 0, max: 1, def: 0 },                  // part of the wave table one cycle plays
  { name: 'pend', min: 0, max: 1, def: 1 },
  { name: 'atk', min: 0.14, max: 46000, def: 16 },             // envelope 1 (amplitude), ms
  { name: 'dec', min: 0.14, max: 46000, def: 64 },
  { name: 'sus', min: 0, max: 1, def: 0.25 },
  { name: 'rel', min: 0.14, max: 46000, def: 64 },
  { name: 'atk2', min: 0.14, max: 46000, def: 16 },            // envelope 2 (modulation), ms
  { name: 'dec2', min: 0.14, max: 46000, def: 64 },
  { name: 'sus2', min: 0, max: 1, def: 0.25 },
  { name: 'rel2', min: 0.14, max: 46000, def: 64 },
  { name: 'f1type', min: 0, max: 2, def: 1, int: true },       // off, lowpass, highpass
  { name: 'f1cut', min: 0, max: 1000, def: 1000, int: true },
  { name: 'f1res', min: 50, max: 1000, def: 50, int: true },
  { name: 'f2type', min: 0, max: 3, def: 0, int: true },       // off, slave, lowpass, highpass
  { name: 'f2cut', min: 0, max: 1001, def: 1001, int: true },
  { name: 'f2res', min: 49, max: 1000, def: 49, int: true },
  { name: 'f3type', min: 0, max: 3, def: 0, int: true },
  { name: 'f3cut', min: 0, max: 1001, def: 1001, int: true },
  { name: 'f3res', min: 49, max: 1000, def: 49, int: true },
  { name: 'f4type', min: 0, max: 3, def: 0, int: true },
  { name: 'f4cut', min: 0, max: 1001, def: 1001, int: true },
  { name: 'f4res', min: 49, max: 1000, def: 49, int: true },
  { name: 'route', min: 0, max: 7, def: 0, int: true },        // 1>2>3>4, 1+2>3>4, 1>2>3+4, 1>2+3>4, 1>2+3+4, 1+2>3+4, 1+2+3>4, 1+2+3+4
  { name: 'limit', min: 0, max: 13, def: 0, int: true },       // what a cutoff of 100% means: 22050 12000 6000 3000 1500 750 325 Hz, note, x2, x3, x4, /2, /3, /4
  { name: 'inertia', min: 0, max: 8192, def: 0 },              // ms the filters take to follow a change
  { name: 'glide', min: 0, max: 8192, def: 0 },                // ms
  { name: 'vibdepth', min: -1, max: 1, def: 0 },               // vibrato depth (cubic: small values are subtle)
  { name: 'vibrate', min: 0, max: 22, def: 5 },                // Hz
  { name: 'e1vr', min: -1, max: 1, def: 0 },                   // envelope 1 -> vibrato rate, depth, cutoff, resonance, pitch
  { name: 'e1vd', min: -1, max: 1, def: 0 },
  { name: 'e1cut', min: -1, max: 4, def: 0 },
  { name: 'e1res', min: -1, max: 4, def: 0 },
  { name: 'e1pit', min: -1, max: 4, def: 0 },
  { name: 'e2vr', min: -1, max: 1, def: 0 },                   // envelope 2 -> the same, and amplitude
  { name: 'e2vd', min: -1, max: 1, def: 0 },
  { name: 'e2cut', min: -1, max: 4, def: 0 },
  { name: 'e2res', min: -1, max: 4, def: 0 },
  { name: 'e2pit', min: -1, max: 4, def: 0 },
  { name: 'e2amp', min: -1, max: 4, def: 0 },
  { name: 'tuning', min: 420, max: 460, def: 440 },            // Hz of A
  { name: 'detail', min: 1, max: 256, def: 16, int: true },    // samples between modulation updates
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 2, def: 0.5 },
];
SPEC.forEach((s, i) => { P[s.name] = i; });

// ---- wave tables (shared by every voice) ---------------------------------------------------------------------------
const cache = new Map();
const lowpass4 = t => {   // RBJ lowpass, w0 = 0.002 pi, Q 0.5, four passes
  const w0 = 0.002 * Math.PI, c = Math.cos(w0), al = Math.sin(w0), a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = 2 * c / a0, a2 = -(1 - al) / a0;
  for (let p = 0; p < 4; p++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < N; i++) {
      const x = t[i], y = b0 * x + b1 * x1 + b0 * x2 + a1 * y1 + a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; t[i] = y;
    }
  }
};
const tri = new Float64Array(N);
for (let i = 0; i < N; i++) tri[i] = i < 8192 ? i / 8192 : i < 16384 ? (16384 - i) / 8192 : -tri[i - 16384];
const makeRand = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; }; };
const build = (wave, seed) => {
  const key = wave >= 8 ? `${wave}:${seed}` : String(wave);
  let e = cache.get(key);
  if (e) return e;
  const t = new Float64Array(N);
  if (wave === 0) for (let i = 0; i < N; i++) t[i] = Math.sin(Math.PI * i / 16384);
  else if (wave === 7) for (let i = 0; i < N; i++) t[i] = Math.cos(Math.PI * i / 32768);
  else {
    if (wave === 1) t.set(tri);
    else if (wave === 2) for (let i = 0; i < N; i++) t[i] = i < 16384 ? 1 : -1;
    else if (wave === 3) for (let i = 0; i < N; i++) t[i] = (i - 16384) / 16384;
    else if (wave === 4) for (let i = 0; i < N; i++) t[i] = (16384 - i) / 16384;
    else if (wave === 5 || wave === 6) {
      for (let i = 0; i < 16384; i++) t[i] = i < 8192 ? (wave === 5 ? i / 8192 : (i - 16384) * 3 / 32768) : (8192 - i) / 8192;
      for (let i = 16384; i < N; i++) t[i] = -t[i - 16384];
    } else if (wave === 8) { const r = makeRand(seed); for (let i = 0; i < N; i++) t[i] = r() / 16384 - 1; }
    else {   // noise 2: five random points, cosine-joined, mirrored
      const r = makeRand(seed), pt = []; for (let k = 0; k < 5; k++) pt.push(r() / 16384 - 1);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4096; j++) t[k * 4096 + j] = pt[k + 1] + (pt[k] - pt[k + 1]) * (1 + Math.cos(Math.PI * j / 4096)) / 2;
      for (let i = 16384; i < N; i++) t[i] = t[N - 1 - i];
      let m = 0; for (let i = 0; i < N; i++) m += t[i]; m /= N; for (let i = 0; i < N; i++) t[i] -= m;
    }
    lowpass4(t);
    if (wave >= 8) { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(t[i])); if (m > 0) for (let i = 0; i < N; i++) t[i] /= m; }   // the smoothing leaves noise very quiet; bring it to full scale
  }
  const prefix = new Float64Array(N + 1);   // so the mean of any window is one subtraction
  for (let i = 0; i < N; i++) prefix[i + 1] = prefix[i] + t[i];
  e = { t, prefix };
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, e);
  return e;
};

// ---- parts -----------------------------------------------------------------------------------------------------------
const LIMITS = [22050, 12000, 6000, 3000, 1500, 750, 325];
const NOTE_MULT = [1, 2, 3, 4, 1 / 2, 1 / 3, 1 / 4];
const ROUTES = [   // for each route: stages of filter indices; the outputs of one stage are summed and feed the next
  [[0], [1], [2], [3]], [[0, 1], [2], [3]], [[0], [1], [2, 3]], [[0], [1, 2], [3]],
  [[0], [1, 2, 3]], [[0, 1], [2, 3]], [[0, 1, 2], [3]], [[0, 1, 2, 3]],
];
class Env {   // linear ADSR over 0..1; release falls at the rate that would empty it in `rel` samples
  constructor() { this.stage = 0; this.level = 0; this.a = 1; this.d = 1; this.s = 0; this.r = 1; }
  set(sr, atk, dec, sus, rel) {
    const ms = sr * 0.001;
    this.a = 1 / Math.max(1, atk * ms); this.d = (1 - sus) / Math.max(1, dec * ms); this.s = sus; this.r = 1 / Math.max(1, rel * ms);
  }
  on() { this.stage = 1; }
  off() { if (this.stage) this.stage = 4; }
  cut() { this.stage = 0; this.level = 0; }
  next() {
    switch (this.stage) {
      case 1: this.level += this.a; if (this.level >= 1) { this.level = 1; this.stage = 2; } break;
      case 2: this.level -= this.d; if (this.level <= this.s) { this.level = this.s; this.stage = 3; } break;
      case 4: this.level -= this.r; if (this.level < 1 / 2048) { this.level = 0; this.stage = 0; } break;
    }
    return this.level;
  }
}

export default {
  type: 'fourpole',
  inputs: ['pitch', 'cut'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'atk2', dec: 'dec2', sus: 'sus2', rel: 'rel2' }],
  shape: 'rounded',
  glyph: 'fourpole',
  kinds: { pitch: 'control', cut: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const sr = sampleRate, pitchOn = connected[0], cutOn = connected[1];
    const e1 = new Env(), e2 = new Env();
    const x1 = new Float64Array(4), x2 = new Float64Array(4), y1 = new Float64Array(4), y2 = new Float64Array(4);
    const b0 = new Float64Array(4), b1 = new Float64Array(4), a1 = new Float64Array(4), a2 = new Float64Array(4), hp = new Uint8Array(4), on = new Uint8Array(4);
    const cutHz = new Float64Array(4), qNow = new Float64Array(4);
    let ph1 = 0, ph2 = 0, lfo = 0, note = 60, pos = 60, velocity = 1, active = false;
    const reset = () => { x1.fill(0); x2.fill(0); y1.fill(0); y2.fill(0); qNow.fill(0); ph1 = ph2 = lfo = 0; };
    const coef = (i, hz, q, hpass) => {
      const w0 = 2 * Math.PI * hz / sr, c = Math.cos(w0), al = Math.sin(w0) / q, a0 = 1 + al;
      b0[i] = (1 - c) / 2 / a0; b1[i] = (1 - c) / a0; a1[i] = 2 * c / a0; a2[i] = -(1 - al) / a0; hp[i] = hpass ? 1 : 0;
    };
    const run = (i, x) => {
      const y = b0[i] * x + b1[i] * x1[i] + b0[i] * x2[i] + a1[i] * y1[i] + a2[i] * y2[i];
      x2[i] = x1[i]; x1[i] = x; y2[i] = y1[i]; const v = Math.abs(y) < 1e-18 ? 0 : y; y1[i] = v;
      return hp[i] ? x - v : v;
    };
    let cnt = 0, tabs1 = null, tabs2 = null, k1 = '', mean1 = 0, mean2 = 0, mixMode = 0;
    let amp = 0, m1 = 0, m2 = 0, inc = 0;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          if (!active || e1.stage === 0) { reset(); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1; active = true;
          e1.on(); e2.on(); cnt = 0;
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { e1.off(); e2.off(); }
        else if (msg.type === 'noteCut') { e1.cut(); e2.cut(); active = false; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active || (e1.stage === 0)) { outL.fill(0, 0, n); outR.fill(0, 0, n); active = false; return; }
        const g = name => params[slots[P[name]]];
        e1.set(sr, g('atk'), g('dec'), g('sus'), g('rel'));
        e2.set(sr, g('atk2'), g('dec2'), g('sus2'), g('rel2'));
        const w1 = Math.round(g('wave1')), w2 = Math.round(g('wave2')), seed = Math.round(g('seed'));
        const ps = Math.min(g('pstart'), g('pend')), pe = Math.max(g('pstart'), g('pend'));
        const lo = Math.min(N - 1, Math.floor(ps * N)), hi = Math.max(lo + 1, Math.min(N, Math.ceil(pe * N)));
        const span = hi - lo;
        const kk = `${w1}:${w2}:${seed}`;
        if (kk !== k1) { k1 = kk; tabs1 = build(w1, seed); tabs2 = w2 < 10 ? build(w2, seed) : null; }
        mean1 = (tabs1.prefix[hi] - tabs1.prefix[lo]) / span;
        mean2 = tabs2 ? (tabs2.prefix[hi] - tabs2.prefix[lo]) / span : 0;
        const T1 = tabs1.t, T2 = tabs2 ? tabs2.t : null;
        mixMode = Math.round(g('mix'));
        const tuning = g('tuning'), detail = Math.max(1, Math.round(g('detail')));
        const transpose = g('transpose') + g('detune') / 100, phOff = g('phase');
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sr * glideMs * 0.001 / 3))); else pos = note;
        const vd0 = g('vibdepth'), vibDepth = 0.95 * vd0 * vd0 * vd0, vibRate = g('vibrate');
        const e1vr = g('e1vr'), e1vd = g('e1vd'), e1cut = g('e1cut'), e1res = g('e1res'), e1pit = g('e1pit');
        const e2vr = g('e2vr'), e2vd = g('e2vd'), e2cut = g('e2cut'), e2res = g('e2res'), e2pit = g('e2pit'), e2amp = g('e2amp');
        const route = ROUTES[Math.round(g('route'))], limit = Math.round(g('limit'));
        const inertia = g('inertia');
        const level = g('level') * (1 - g('vel') + g('vel') * velocity);
        const ft = name => { const t = g(name); return t === 0 ? 0 : t === 1 ? -1 : t - 1; };   // 0 off, -1 slave, 1 lowpass, 2 highpass
        const types = [g('f1type'), ft('f2type'), ft('f3type'), ft('f4type')];
        const cuts = [g('f1cut'), g('f2cut'), g('f3cut'), g('f4cut')], ress = [g('f1res'), g('f2res'), g('f3res'), g('f4res')];
        const baseHz = tuning * Math.pow(2, (pos - 69) / 12);
        const pitchIn = inputs[0], cutIn = inputs[1];
        for (let i = 0; i < n; i++) {
          const a = e1.next(), b = e2.next();
          if (cnt === 0) {
            cnt = detail;
            const vr = vibRate * (1 + e1vr * a) * (1 + e2vr * b), vd = vibDepth * (1 + e1vd * a) * (1 + e2vd * b);
            m1 = vd; m2 = vr;
            const pm = (1 + e1pit * a) * (1 + e2pit * b);
            const fm = pitchOn ? Math.pow(2, pitchIn[i]) : 1;
            inc = baseHz * pm * fm / sr;
            amp = a * (1 + e2amp * b);
            const noteHz = baseHz * pm * fm;
            const cm = (1 + e1cut * a) * (1 + e2cut * b) * (cutOn ? Math.pow(2, cutIn[i]) : 1), rm = (1 + e1res * a) * (1 + e2res * b);
            const maxHz = limit < 7 ? LIMITS[limit] : noteHz * NOTE_MULT[limit - 7];
            const k = inertia > 0 ? 1 - Math.exp(-detail / (sr * inertia * 0.001)) : 1;
            for (let f = 0; f < 4; f++) {
              const ty = types[f] < 0 ? types[0] : types[f];
              on[f] = ty > 0 ? 1 : 0;
              if (!on[f]) continue;
              const cp = f > 0 && cuts[f] > 1000 ? cuts[0] : cuts[f], rp = f > 0 && ress[f] < 50 ? ress[0] : ress[f];
              const hz = Math.min(Math.min(22000, sr * 0.49), Math.max(20, cp / 1000 * maxHz * cm));
              const q = Math.min(127, Math.max(1, rp * 0.02 * rm));
              if (qNow[f] > 0) { cutHz[f] += (hz - cutHz[f]) * k; qNow[f] += (q - qNow[f]) * k; }
              else { cutHz[f] = hz; qNow[f] = q; }
              coef(f, cutHz[f], qNow[f], ty === 2);
            }
          }
          cnt--;
          // oscillators
          lfo += m2 / sr; if (lfo >= 1) lfo -= 1;
          const step = inc * (1 + m1 * Math.sin(2 * Math.PI * lfo));
          const s1 = T1[Math.min(N - 1, (lo + ph1 * span) | 0)] - mean1;
          let v = s1;
          if (T2) {
            let p2 = ph2 + phOff; p2 -= Math.floor(p2);
            const s2 = T2[Math.min(N - 1, (lo + p2 * span) | 0)] - mean2;
            const den = (d) => (Math.abs(d) < 0.01 ? (d < 0 ? -0.01 : 0.01) : d);
            switch (mixMode) {
              case 0: v = s1 + s2; break;
              case 1: v = s1 - s2; break;
              case 2: v = s2 - s1; break;
              case 3: v = s1 * s2; break;
              case 4: v = Math.max(-4, Math.min(4, s1 / den(s2))); break;
              default: v = Math.max(-4, Math.min(4, s2 / den(s1)));
            }
          }
          ph1 += step; ph1 -= Math.floor(ph1);
          ph2 += step * Math.pow(2, transpose / 12); ph2 -= Math.floor(ph2);
          // filters
          let x = v;
          for (const stage of route) {
            let sum = 0, any = false;
            for (const f of stage) if (on[f]) { sum += run(f, x); any = true; }
            if (any) x = sum;
          }
          const o = x * amp * level;
          outL[i] = o; outR[i] = o;
        }
      },
    };
  },
};
