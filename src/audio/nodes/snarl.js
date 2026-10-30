// Snarl: a monophonic, semi-modular style voice built around two resonant filters in a row.
//   VCO 1   saw, triangle, pulse or noise, with a pulse width
//   VCO 2   saw, square, pulse, or ring (VCO 1 multiplied by VCO 2, which gives bells and clangs)
//   mixer   VCO 1, VCO 2 and a noise generator
//   filters a high-pass and then a low-pass, each with its own cutoff and its own peak (resonance). With both peaks up and
//           the cutoffs close together the two peaks meet and the sound screams; `edge` pushes the signal into the second
//           filter harder, so it bites. The peaks ring by themselves but are kept in check by soft limits
//   EG 1    delay, attack, release: rises to the top and stays there while the key is held. It moves the pitch and both cutoffs
//   EG 2    attack, hold, decay, sustain, release: the amplifier
//   MG      a modulation generator (triangle, saw, ramp, square, random) on the pitch, both cutoffs and the level
//   plus portamento, key tracking for the filters and velocity.
// One voice. With the instrument's Voices above 1, every note gets its own copy of everything.
const SPEC = [
  { name: 'vco1wave', min: 0, max: 3, def: 0, int: true },      // 0 saw, 1 triangle, 2 pulse, 3 noise
  { name: 'vco1oct', min: 0, max: 3, def: 2, int: true },       // 32', 16', 8', 4'
  { name: 'vco1pw', min: 0, max: 1, def: 0.3 },
  { name: 'vco2wave', min: 0, max: 3, def: 0, int: true },      // 0 saw, 1 square, 2 pulse, 3 ring
  { name: 'vco2oct', min: 0, max: 3, def: 2, int: true },
  { name: 'vco2pw', min: 0, max: 1, def: 0.3 },
  { name: 'vco2pitch', min: -12, max: 12, def: 0 },             // semitones
  { name: 'detune', min: -100, max: 100, def: 8 },              // cents, on VCO 2
  { name: 'mix1', min: 0, max: 1, def: 0.8 },
  { name: 'mix2', min: 0, max: 1, def: 0.6 },
  { name: 'noise', min: 0, max: 1, def: 0 },
  { name: 'hpcut', min: 20, max: 8000, def: 60 },               // Hz, before the envelope and the MG
  { name: 'hppeak', min: 0, max: 1, def: 0.2 },
  { name: 'lpcut', min: 30, max: 18000, def: 1400 },
  { name: 'lppeak', min: 0, max: 1, def: 0.5 },
  { name: 'edge', min: 0, max: 1, def: 0.3 },
  { name: 'eg1delay', min: 0, max: 2000, def: 0 },              // ms
  { name: 'eg1attack', min: 1, max: 3000, def: 5 },
  { name: 'eg1release', min: 5, max: 5000, def: 300 },
  { name: 'eg1pitch', min: -1, max: 1, def: 0 },
  { name: 'eg1hp', min: -1, max: 1, def: 0 },
  { name: 'eg1lp', min: -1, max: 1, def: 0.4 },
  { name: 'attack', min: 1, max: 3000, def: 3 },               // EG 2, ms
  { name: 'hold', min: 0, max: 2000, def: 0 },
  { name: 'decay', min: 5, max: 5000, def: 400 },
  { name: 'sustain', min: 0, max: 1, def: 0.7 },
  { name: 'release', min: 5, max: 5000, def: 180 },
  { name: 'mgwave', min: 0, max: 4, def: 0, int: true },        // 0 triangle, 1 saw, 2 ramp, 3 square, 4 random
  { name: 'mgrate', min: 0.05, max: 60, def: 4 },               // Hz
  { name: 'mgpitch', min: 0, max: 1, def: 0 },
  { name: 'mghp', min: 0, max: 1, def: 0 },
  { name: 'mglp', min: 0, max: 1, def: 0 },
  { name: 'mgamp', min: 0, max: 1, def: 0 },
  { name: 'port', min: 0, max: 1000, def: 0 },                  // ms, 0 is off; only between notes that overlap
  { name: 'keytrack', min: 0, max: 1, def: 0.3 },
  { name: 'vel', min: 0, max: 1, def: 0.3 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const polyBlep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const clip = x => (x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x));   // a smooth tanh
const OCT = [-24, -12, 0, 12];
const signedSquare = x => Math.sign(x) * x * x;
const IDLE = 0, DELAY = 1, ATTACK = 2, HOLD = 3, DECAY = 4, SUSTAIN = 5, RELEASE = 6;

export default {
  type: 'snarl',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'snarl',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const sr = sampleRate;
    let heldNote = -1;   // the note the key is down for, so a late note off for an older note does not stop the new one
    let ph1 = 0, ph2 = 0, pitch = 48, target = 48, gate = false, active = false, pend = null, velocity = 1, glideMs = 0;
    let e1 = 0, st1 = IDLE, wait1 = 0, e2 = 0, st2 = IDLE, wait2 = 0;
    let mgPh = 0, held = 0, nz = 0, seed = 7777, dc = 0, dcx = 0;
    const f1 = [0, 0], f2 = [0, 0];   // the high-pass's and the low-pass's two states each
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    return {
      note(msg) {
        if (msg.type === 'noteOn') { pend = { note: msg.note, vel: Math.max(0, Math.min(1, msg.vel ?? 1)), off: false }; heldNote = msg.note; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') {
          if (msg.implied) return;                                                      // a new note in the same column takes over: no release
          if (msg.type === 'noteOff' && msg.note !== undefined && msg.note !== heldNote) return;   // a note off for an older note
          if (pend) pend.off = true;                                                    // the note on has not started yet (same block): it will, and let go at once
          else if (gate) { gate = false; if (st1 !== IDLE) st1 = RELEASE; if (st2 !== IDLE) st2 = RELEASE; }
        }
        else if (msg.type === 'noteCut') { gate = false; pend = null; active = false; e1 = e2 = 0; st1 = st2 = IDLE; f1.fill(0); f2.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        const ms = v => Math.max(1, v * 0.001 * sr);
        if (pend) {
          const legato = gate && active, port = g('port');
          velocity = pend.vel;
          if (legato && port > 0) { target = pend.note; glideMs = port; } else { pitch = target = pend.note; glideMs = 0; }
          st1 = DELAY; wait1 = ms(g('eg1delay')) * (g('eg1delay') > 0 ? 1 : 0); st2 = ATTACK;
          gate = !pend.off; active = true; pend = null;
        }
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const v1w = g('vco1wave') | 0, v2w = g('vco2wave') | 0, pw1 = 0.5 - 0.45 * g('vco1pw'), pw2 = 0.5 - 0.45 * g('vco2pw');
        const mix1 = g('mix1'), mix2 = g('mix2'), noiseMix = g('noise');
        const hpPeak = g('hppeak'), lpPeak = g('lppeak'), edge = 1 + g('edge') * 5;
        const kqH = 2 - 1.96 * hpPeak, kqL = 2 - 1.96 * lpPeak;
        const eg1pitch = signedSquare(g('eg1pitch')) * 24, eg1hp = signedSquare(g('eg1hp')) * 5, eg1lp = signedSquare(g('eg1lp')) * 5;
        const mgPitch = g('mgpitch') ** 2 * 12, mgHp = g('mghp') ** 2 * 4, mgLp = g('mglp') ** 2 * 4, mgAmp = g('mgamp');
        const mgWave = g('mgwave') | 0, mgStep = g('mgrate') / sr;
        const atk1 = ms(g('eg1attack')), rel1 = Math.exp(-6.9078 / ms(g('eg1release')));
        const atk2 = ms(g('attack')), hold2 = ms(g('hold')), dec2 = Math.exp(-6.9078 / ms(g('decay'))), sus = g('sustain'), rel2 = Math.exp(-6.9078 / ms(g('release')));
        const key = g('keytrack'), velGain = 1 - g('vel') + g('vel') * velocity, tune = g('tune');
        const o1Shift = OCT[g('vco1oct') | 0], o2Shift = OCT[g('vco2oct') | 0] + g('vco2pitch') + g('detune') / 100;
        const glideCoef = glideMs > 0 ? 1 - Math.exp(-3 / (sr * glideMs * 0.001)) : 1, level = g('level') * 0.8;
        let inc1 = 0, inc2 = 0, gH = 0, gL = 0, aH1 = 0, aH2 = 0, aH3 = 0, aL1 = 0, aL2 = 0, aL3 = 0, mg = 0;
        for (let i = 0; i < n; i++) {
          // the modulation generator
          mgPh += mgStep; if (mgPh >= 1) { mgPh -= 1; held = rnd(); }
          mg = mgWave === 0 ? (mgPh < 0.5 ? 4 * mgPh - 1 : 3 - 4 * mgPh) : mgWave === 1 ? 1 - 2 * mgPh : mgWave === 2 ? 2 * mgPh - 1 : mgWave === 3 ? (mgPh < 0.5 ? 1 : -1) : held;
          if (!gate) { if (st2 !== RELEASE && st2 !== IDLE) st2 = RELEASE; if (st1 === SUSTAIN) st1 = RELEASE; }   // the key is up: every envelope lets go, wherever it had got to
          // envelope 1: delay, rise, hold at the top while the key is down, fall on release
          if (st1 === DELAY) { if (--wait1 <= 0) st1 = ATTACK; }
          else if (st1 === ATTACK) { e1 += 1 / atk1; if (e1 >= 1) { e1 = 1; st1 = gate ? SUSTAIN : RELEASE; } }
          else if (st1 === RELEASE) { e1 *= rel1; if (e1 < 1e-4) { e1 = 0; st1 = IDLE; } }
          // envelope 2: the amplifier
          if (st2 === ATTACK) { e2 += 1 / atk2; if (e2 >= 1) { e2 = 1; wait2 = hold2; st2 = HOLD; } }
          else if (st2 === HOLD) { if (--wait2 <= 0) st2 = DECAY; }
          else if (st2 === DECAY) { e2 = sus + (e2 - sus) * dec2; if (Math.abs(e2 - sus) < 1e-4) st2 = SUSTAIN; }
          else if (st2 === RELEASE) { e2 *= rel2; if (e2 < 1e-4) { e2 = 0; st2 = IDLE; } }
          // the pitch and the filters' coefficients, every 8 samples
          if ((i & 7) === 0) {
            pitch += (target - pitch) * (glideCoef === 1 ? 1 : 1 - Math.pow(1 - glideCoef, 8));
            if (Math.abs(target - pitch) < 1e-3) pitch = target;
            const semis = pitch + tune + eg1pitch * e1 + mg * mgPitch;
            inc1 = 440 * Math.pow(2, (semis + o1Shift - 69) / 12) / sr;
            inc2 = 440 * Math.pow(2, (semis + o2Shift - 69) / 12) / sr;
            const track = key * (pitch - 60) / 12;
            const fcH = Math.min(0.45 * sr, Math.max(15, g('hpcut') * Math.pow(2, eg1hp * e1 + mg * mgHp + track)));
            const fcL = Math.min(0.45 * sr, Math.max(20, g('lpcut') * Math.pow(2, eg1lp * e1 + mg * mgLp + track)));
            gH = Math.tan(Math.PI * fcH / sr); aH1 = 1 / (1 + gH * (gH + kqH)); aH2 = gH * aH1; aH3 = gH * aH2;
            gL = Math.tan(Math.PI * fcL / sr); aL1 = 1 / (1 + gL * (gL + kqL)); aL2 = gL * aL1; aL3 = gL * aL2;
          }
          // the oscillators
          ph1 += inc1; if (ph1 >= 1) ph1 -= 1;
          let o1;
          if (v1w === 0) o1 = 2 * ph1 - 1 - polyBlep(ph1, inc1);
          else if (v1w === 1) o1 = ph1 < 0.5 ? 4 * ph1 - 1 : 3 - 4 * ph1;
          else if (v1w === 2) o1 = (ph1 < pw1 ? 1 : -1) + polyBlep(ph1, inc1) - polyBlep((ph1 + 1 - pw1) % 1, inc1);
          else o1 = rnd();
          ph2 += inc2; if (ph2 >= 1) ph2 -= 1;
          let o2;
          if (v2w === 0) o2 = 2 * ph2 - 1 - polyBlep(ph2, inc2);
          else if (v2w === 2) o2 = (ph2 < pw2 ? 1 : -1) + polyBlep(ph2, inc2) - polyBlep((ph2 + 1 - pw2) % 1, inc2);
          else o2 = (ph2 < 0.5 ? 1 : -1) + polyBlep(ph2, inc2) - polyBlep((ph2 + 0.5) % 1, inc2);   // square (also what rings with VCO 1)
          if (v2w === 3) o2 *= o1;
          const x = (o1 * mix1 + o2 * mix2 + rnd() * noiseMix) * 0.8;
          // the high-pass, then the low-pass: each a two-pole state variable filter, its states softly limited so that it rings but does not run away
          const hIn = clip(x * 1.4);
          const hh = (hIn - (kqH + gH) * f1[0] - f1[1]) * aH1, hb = gH * hh + f1[0], hl = gH * hb + f1[1];
          f1[0] = clip(gH * hh + hb); f1[1] = clip(gH * hb + hl);
          const lIn = clip(hh * edge);
          const lh = (lIn - (kqL + gL) * f2[0] - f2[1]) * aL1, lb = gL * lh + f2[0], ll = gL * lb + f2[1];
          f2[0] = clip(gL * lh + lb); f2[1] = clip(gL * lb + ll);
          const y = ll / Math.sqrt(edge) * 1.2;
          const o = y * e2 * velGain * (1 - mgAmp * 0.5 * (1 + mg));
          const r = o - dcx + 0.995 * dc; dcx = o; dc = r;
          outL[i] = outR[i] = r * level;
        }
        if (!Number.isFinite(dc + dcx + f1[0] + f1[1] + f2[0] + f2[1])) { f1.fill(0); f2.fill(0); dc = dcx = 0; }
        if (st2 === IDLE) { active = false; f1.fill(0); f2.fill(0); dc = dcx = 0; }
      },
    };
  },
};
