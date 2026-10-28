// Amp: a valve amplifier chain in one node, from the guitar in to the speaker out. Stereo in and out, two independent sides.
//
//   in -> trim, coupling highpass, bright -> PREAMP: 1 to 4 valve stages, each with its own gain, an asymmetric curve, a
//   coupling highpass and a lowpass; later stages are pushed harder, which is where gain sounds come from
//   -> TONE STACK: bass, mid and treble, three voicings -> POWER STAGE: a symmetrical push-pull curve whose headroom sags
//   when the signal is loud (the supply gives) -> depth and presence, the low and high end the output stage feeds back
//   -> CABINET: a speaker and its box as a few filters (open, closed or a stack), or none -> level, mix.
//
// The two curves run at 1x, 2x or 4x (`oversample`) so the harmonics they make do not fold back. The dry signal for mix is
// delayed to match. Everything but the curves is linear and runs at the normal rate.
import { Delay, Oversampler } from './oversample.js';

const GAIN = 0, STAGES = 1, BRIGHT = 2, BIAS = 3, BASS = 4, MID = 5, TREBLE = 6, VOICING = 7, MASTER = 8, SAG = 9, PRESENCE = 10, DEPTH = 11, CAB = 12, CABTONE = 13, LEVEL = 14, MIX = 15, OVERSAMPLE = 16;

export const VOICINGS = ['scooped', 'cutting', 'chiming'];
export const CABS = ['none', 'open 1x12', 'closed 2x12', 'stack 4x12'];

// Where the tone controls work, per voicing: the bass shelf, the mid peak (frequency and width) and the treble shelf.
const STACKS = [
  { bass: 100, mid: 420, q: 0.6, treble: 3500 },
  { bass: 170, mid: 650, q: 0.8, treble: 2600 },
  { bass: 130, mid: 1200, q: 0.7, treble: 4200 },
];

// The speaker, as filters: [type, frequency Hz, width (Q), gain dB]. The lowpasses at the end carry the cabinet's top.
const CAB_FILTERS = [
  [],
  [['hp', 85, 0.7, 0], ['peak', 120, 1.2, 3], ['peak', 2400, 1, 4], ['lp', 5500, 0.7, 0], ['lp', 5500, 0.7, 0]],
  [['hp', 70, 0.7, 0], ['peak', 110, 1, 5], ['peak', 1800, 0.9, 3], ['peak', 3300, 1.4, 2], ['lp', 5000, 0.7, 0], ['lp', 5000, 0.7, 0]],
  [['hp', 75, 0.7, 0], ['peak', 100, 0.9, 4], ['peak', 750, 0.8, -2], ['peak', 2600, 1.4, 5], ['lp', 4500, 0.7, 0], ['lp', 4500, 0.7, 0]],
];
const CAB_SLOTS = 6;

const TWO_PI = 2 * Math.PI;
const db = x => 10 ** (x / 20);

// One biquad (direct form II transposed). set() takes the coefficients; the state stays.
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  set([b0, b1, b2, a1, a2]) { this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2; }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

const THROUGH = [1, 0, 0, 0, 0];
// RBJ cookbook filters: [b0, b1, b2, a1, a2], already divided by a0.
function coefficients(type, f, q, gainDb, sr) {
  const fc = Math.max(10, Math.min(sr * 0.45, f)), w = TWO_PI * fc / sr, cs = Math.cos(w), sn = Math.sin(w);
  const A = 10 ** (gainDb / 40), alpha = sn / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
    case 'low': {
      const r = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cs + r); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - r);
      a0 = (A + 1) + (A - 1) * cs + r; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - r; break;
    }
    default: {   // 'high'
      const r = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r);
      a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

const onePole = (f, sr) => 1 - Math.exp(-TWO_PI * Math.min(f, sr * 0.45) / sr);

// The preamp at the oversampled rate: the gain stages one after the other, with their filters. tick() is the curve the
// oversampler calls for every (oversampled) sample.
class Preamp {
  gains = [1, 1, 1, 1]; stages = 2; bias = 0.3; norm = 1;
  hp = [0, 0, 0, 0]; lp = [0, 0, 0, 0];
  hpK = [0, 0, 0, 0]; lpK = 0;
  tick = x => {
    for (let i = 0; i < this.stages; i++) {
      x *= this.gains[i];
      this.hp[i] += (x - this.hp[i]) * this.hpK[i];   // the coupling capacitor: no steady offset goes on to the next stage
      x -= this.hp[i];
      const b = i === 0 ? this.bias : this.bias * 0.7;
      x = (Math.tanh(x + b) - Math.tanh(b)) / (1 - Math.tanh(b) ** 2);   // the valve: unity gain for small signals, rounder on the top than the bottom
      this.lp[i] += (x - this.lp[i]) * this.lpK;     // the stage's own top end
      x = this.lp[i];
    }
    return x;
  };
}

// The power stage at the oversampled rate: a symmetrical curve whose gain falls while the level is high (sag).
class Power {
  g = 1; norm = 1; sag = 0; env = 0; atk = 0; rel = 0;
  tick = x => {
    const a = Math.abs(x);
    this.env += (a - this.env) * (a > this.env ? this.atk : this.rel);
    const g = this.g / (1 + this.sag * 2 * this.env);
    return Math.tanh(x * g) * this.norm;
  };
}

export default {
  type: 'amp',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'amp',
  params: [
    { name: 'gain', min: 0, max: 10, def: 5 },                        // the preamp: 0 is clean, 10 is a wall
    { name: 'stages', min: 1, max: 4, def: 2, int: true },            // valve stages in the preamp
    { name: 'bright', min: 0, max: 1, def: 0 },                       // a treble lift in front of the gain, strongest at low gain
    { name: 'bias', min: 0, max: 1, def: 0.3 },                       // how lopsided the valve is: more is more even harmonics
    { name: 'bass', min: 0, max: 10, def: 5 },                        // 5 is flat
    { name: 'mid', min: 0, max: 10, def: 5 },
    { name: 'treble', min: 0, max: 10, def: 5 },
    { name: 'voicing', min: 0, max: 2, def: 1, int: true },           // where the three tone controls work
    { name: 'master', min: 0, max: 10, def: 4 },                      // how hard the power stage is driven
    { name: 'sag', min: 0, max: 1, def: 0.4 },                        // how much the power stage gives under load
    { name: 'presence', min: 0, max: 10, def: 3 },                    // the top end of the output stage
    { name: 'depth', min: 0, max: 10, def: 3 },                       // the low end of the output stage
    { name: 'cab', min: 0, max: 3, def: 1, int: true },               // 0 none, 1 open 1x12, 2 closed 2x12, 3 stack 4x12
    { name: 'cabtone', min: 0, max: 1, def: 0.5 },                    // darker to brighter speaker
    { name: 'level', min: 0, max: 2, def: 0.7 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'oversample', min: 0, max: 2, def: 1, int: true },        // 0: 1x, 1: 2x, 2: 4x
  ],
  create({ sampleRate }) {
    const factors = [1, 2, 4];
    const sides = [0, 1].map(() => ({
      os1: factors.map(f => new Oversampler(f)), os2: factors.map(f => new Oversampler(f)),
      pre: new Preamp(), power: new Power(),
      delay: new Delay(160),
      inHp: 0, bright: 0, dc: 0,
      tone: [new Biquad(), new Biquad(), new Biquad()], out: [new Biquad(), new Biquad()],
      cab: Array.from({ length: CAB_SLOTS }, () => new Biquad()),
    }));
    return {
      process(inputs, outputs, n, params, slots) {
        const p = i => params[slots[i]];
        const gain = p(GAIN), stages = Math.min(4, Math.max(1, Math.round(p(STAGES))));
        const os = Math.min(2, Math.max(0, Math.round(p(OVERSAMPLE)))), rate = sampleRate * factors[os];
        const mix = p(MIX), level = p(LEVEL), bright = p(BRIGHT);
        // preamp: the gain knob spreads over the stages, so more stages are harder driven, not just louder
        const total = (gain / 10) * 52;                    // dB across the whole preamp
        const perStage = db(total / stages);
        const stack = STACKS[Math.min(2, Math.max(0, Math.round(p(VOICING))))];
        const knob = v => ((v - 5) / 5) * 14;              // 0 to 10 knob, 5 flat: plus or minus 14 dB
        const toneCoefs = [coefficients('low', stack.bass, 0.7, knob(p(BASS)), sampleRate), coefficients('peak', stack.mid, stack.q, knob(p(MID)), sampleRate), coefficients('high', stack.treble, 0.7, knob(p(TREBLE)), sampleRate)];
        const outCoefs = [coefficients('low', 95, 0.7, (p(DEPTH) / 10) * 8, sampleRate), coefficients('high', 4500, 0.7, (p(PRESENCE) / 10) * 9, sampleRate)];
        const cabIndex = Math.min(3, Math.max(0, Math.round(p(CAB))));
        const cabTone = p(CABTONE), cabSpec = CAB_FILTERS[cabIndex];
        const cabCoefs = Array.from({ length: CAB_SLOTS }, (_, i) => {
          const s = cabSpec[i];
          if (!s) return THROUGH;
          const [type, f, q, g] = s;
          return coefficients(type, type === 'lp' ? f * (0.7 + 0.6 * cabTone) : f, q, type === 'peak' && f > 1000 ? g * (0.5 + cabTone) : g, sampleRate);
        });
        const g0 = 0.5 + (p(MASTER) / 10) * 7.5;
        const inK = onePole(28, sampleRate), brightK = onePole(1500, sampleRate);
        const brightAmount = bright * 1.6 * (1 - gain / 10);
        for (let c = 0; c < 2; c++) {
          const s = sides[c], x = inputs[0][c], out = outputs[0][c];
          const pre = s.pre, pw = s.power;
          pre.stages = stages; pre.bias = p(BIAS);
          for (let i = 0; i < 4; i++) {
            pre.gains[i] = perStage * (i === 0 ? 1 : 1.15);   // the later stages hit a little harder
            pre.hpK[i] = onePole(35 * 1.8 ** i, rate);
          }
          pre.lpK = onePole(11000, rate);
          pw.g = g0; pw.norm = 1 / g0 ** 0.6; pw.sag = p(SAG);
          pw.atk = onePole(160, rate); pw.rel = onePole(7, rate);
          s.tone.forEach((b, i) => b.set(toneCoefs[i]));
          s.out.forEach((b, i) => b.set(outCoefs[i]));
          s.cab.forEach((b, i) => b.set(cabCoefs[i]));
          const o1 = s.os1[os], o2 = s.os2[os], wait = o1.latency + o2.latency;
          for (let i = 0; i < n; i++) {
            const dry = x[i];
            let v = dry;
            s.inHp += (v - s.inHp) * inK; v -= s.inHp;                  // the input coupling
            s.bright += (v - s.bright) * brightK; v += (v - s.bright) * brightAmount;
            v = o1.run(v, pre.tick);
            for (let k = 0; k < 3; k++) v = s.tone[k].run(v);
            v = o2.run(v, pw.tick);
            v = s.out[0].run(v); v = s.out[1].run(v);
            if (cabIndex > 0) for (let k = 0; k < CAB_SLOTS; k++) v = s.cab[k].run(v);
            const d = s.delay.push(dry, wait);
            out[i] = (d + (v - d) * mix) * level;
          }
        }
      },
    };
  },
};
