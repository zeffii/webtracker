// Duette: a monophonic two-oscillator analogue-style voice with a resonant filter, one envelope and one LFO.
//   VCO 1  saw, triangle or square; SHAPE adds wave-folded harmonics (saw, triangle) or narrows the pulse (square)
//   VCO 2  saw, triangle or noise, 16' to 2' and +-1200 cents; SHAPE likewise (on noise it darkens it); `mod` syncs it to VCO 1 or
//          ring-modulates it with VCO 1
//   mixer  the two levels; then a resonant two-pole low-pass filter that rings by itself, then DRIVE
//   EG     one attack/decay envelope that is also the amplifier: A/D (a note is a blip), A/G/D (held for the gate, `decay` is the
//          release) or GATE (the amplifier is the gate itself, the target still moves with attack and decay). Its target is the
//          pitch of both oscillators, of VCO 2 alone, or the cutoff, by `egint` (negative turns it over)
//   LFO    saw, triangle or square at FAST (0.5 Hz to 2.8 kHz), SLOW (0.05 to 28 Hz) or 1-SHOT (it stops after half a cycle), on
//          the pitch, the shapes or the cutoff
//   plus portamento (always, or only when notes overlap), a per-note slide (the Sld column), cutoff key tracking and velocity.
// A slide, like the 303's, keeps the gate up: the envelope does not restart and the pitch glides to the new note.
const SPEC = [
  { name: 'vco1wave', min: 0, max: 2, def: 0, int: true },     // 0 saw, 1 triangle, 2 square
  { name: 'vco1shape', min: 0, max: 1, def: 0 },
  { name: 'vco2wave', min: 0, max: 2, def: 0, int: true },     // 0 saw, 1 triangle, 2 noise
  { name: 'vco2oct', min: 0, max: 3, def: 1, int: true },      // 16', 8', 4', 2'
  { name: 'vco2pitch', min: -1200, max: 1200, def: 6 },        // cents
  { name: 'vco2shape', min: 0, max: 1, def: 0 },
  { name: 'mod', min: 0, max: 2, def: 0, int: true },          // 0 off, 1 sync, 2 ring
  { name: 'mix1', min: 0, max: 1, def: 0.8 },
  { name: 'mix2', min: 0, max: 1, def: 0.7 },
  { name: 'cutoff', min: 30, max: 18000, def: 1800 },          // Hz, before the envelope and LFO
  { name: 'res', min: 0, max: 1, def: 0.35 },
  { name: 'egtype', min: 0, max: 2, def: 0, int: true },       // 0 A/D, 1 A/G/D, 2 GATE
  { name: 'attack', min: 1, max: 3000, def: 2 },               // ms
  { name: 'decay', min: 5, max: 5000, def: 380 },              // ms to fall 60 dB; the release in A/G/D
  { name: 'egint', min: -1, max: 1, def: 0.45 },
  { name: 'egtarget', min: 0, max: 2, def: 2, int: true },     // 0 pitch, 1 pitch 2, 2 cutoff
  { name: 'lfowave', min: 0, max: 2, def: 1, int: true },      // 0 saw, 1 triangle, 2 square
  { name: 'lfomode', min: 0, max: 2, def: 1, int: true },      // 0 fast, 1 slow, 2 1-shot
  { name: 'lforate', min: 0, max: 1, def: 0.45 },
  { name: 'lfoint', min: 0, max: 1, def: 0 },
  { name: 'lfotarget', min: 0, max: 2, def: 2, int: true },    // 0 pitch, 1 shape, 2 cutoff
  { name: 'drive', min: 0, max: 1, def: 0.2 },
  { name: 'port', min: 0, max: 1000, def: 0 },                 // ms, 0 is off
  { name: 'portmode', min: 0, max: 1, def: 0, int: true },     // 0 auto (legato only), 1 always
  { name: 'slide', min: 1, max: 500, def: 60 },                // ms, for a note with the Sld flag
  { name: 'keytrack', min: 0, max: 1, def: 0 },
  { name: 'cutvel', min: 0, max: 1, def: 0 },
  { name: 'ampvel', min: 0, max: 1, def: 0.3 },
  { name: 'tune', min: -48, max: 48, def: 0 },                 // semitones
  { name: 'level', min: 0, max: 1, def: 0.7 },
  { name: 'sld', min: 0, max: 1, def: 0, int: true },          // the Sld column: 1 slides into the note
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const polyBlep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const clip = x => (x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x));   // a smooth tanh
const fold = x => { x = (x + 1) % 4; if (x < 0) x += 4; return (x < 2 ? x : 4 - x) - 1; };   // a triangle fold of any size into -1..1
const IDLE = 0, ATTACK = 1, HELD = 2, DECAY = 3;
const OCT = [-12, 0, 12, 24];
const FAST = [0.5, 2800], SLOW = [0.05, 28];

export default {
  type: 'duette',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one voice for the instrument
  shape: 'rounded',
  glyph: 'duette',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, clock }) {
    const sr = sampleRate, stamps = clock?.stamps ?? new Uint32Array(1024);
    let ph1 = 0, ph2 = 0, pitch = 48, target = 48, note = 48, gate = false, active = false, pend = null, velocity = 1, stage = IDLE, eg = 0, vca = 0, gateEnv = 0;
    let lfoPh = 0, lfoDone = false, lfoOn = 0, s1 = 0, s2 = 0, dc = 0, dcx = 0, seed = 22222, nz = 0, lastS = -1, hadNote = false;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    return {
      note(msg) {
        if (msg.type === 'noteOn') pend = { note: msg.note, vel: Math.max(0, Math.min(1, msg.vel ?? 1)) };
        else if (msg.type === 'noteOff') { if (!msg.implied && gate) { gate = false; if (stage !== IDLE) stage = DECAY; } }
        else if (msg.type === 'allOff') { if (gate) { gate = false; if (stage !== IDLE) stage = DECAY; } }
        else if (msg.type === 'noteCut') { gate = false; active = false; pend = null; vca = eg = gateEnv = 0; stage = IDLE; s1 = s2 = dc = dcx = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        const sStamp = stamps[slots[P.sld]];
        const slideFlag = sStamp !== lastS && (lastS !== -1 || sStamp > 0) && g('sld') >= 1;   // did this row write the flag?
        lastS = sStamp;
        const egtype = g('egtype'), port = g('port'), portAlways = g('portmode') >= 1;
        if (pend) {
          const legato = gate && active;
          note = pend.note; velocity = pend.vel;
          const glide = slideFlag && legato ? g('slide') : port > 0 && (portAlways || legato) ? port : 0;
          if (glide > 0) target = note; else { pitch = target = note; }
          if (!(slideFlag && legato)) { stage = ATTACK; if (egtype !== 1 || !legato) eg = Math.min(eg, 0.0); if (lfoOn === 0 || g('lfomode') === 2) { lfoPh = 0; lfoDone = false; } }
          lfoOn = 1; gate = true; active = true; hadNote = true; pend = null;
          this.glideMs = glide;
        }
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const v1w = g('vco1wave') | 0, v2w = g('vco2wave') | 0, mod = g('mod') | 0;
        const sh1 = g('vco1shape'), sh2 = g('vco2shape'), mix1 = g('mix1'), mix2 = g('mix2');
        const cutoff = g('cutoff'), res = g('res'), drive = g('drive'), level = g('level') * 0.8;
        const egint = g('egint'), egtarget = g('egtarget') | 0, egOct = Math.sign(egint) * egint * egint * 5;
        const lwave = g('lfowave') | 0, lmode = g('lfomode') | 0, lint = g('lfoint'), ltarget = g('lfotarget') | 0;
        const [r0, r1] = lmode === 0 ? FAST : SLOW, lfoHz = r0 * Math.pow(r1 / r0, g('lforate'));
        const atk = Math.max(1e-4, g('attack') * 0.001 * sr), decCoef = Math.exp(-6.9078 / (sr * g('decay') * 0.001));
        const glideCoef = (this.glideMs ?? 0) > 0 ? 1 - Math.exp(-3 / (sr * this.glideMs * 0.001)) : 1;
        const tune = g('tune') + (g('vco2pitch') / 100) * 0, key = g('keytrack'), cutvel = g('cutvel'), ampvel = g('ampvel');
        const velGain = 1 - ampvel + ampvel * velocity, driveGain = 1 + drive * 9;
        const kq = 2 - 1.96 * res;   // the filter's damping: 2 is none, near 0 rings by itself
        let inc1 = 0, inc2 = 0, gg = 0, a1 = 0, a2 = 0, a3 = 0, lfoV = 0;
        const lfoStep = lfoHz / sr;
        for (let i = 0; i < n; i++) {
          // the LFO
          if (!(lmode === 2 && lfoDone)) { lfoPh += lfoStep; if (lmode === 2 ? lfoPh >= 0.5 : lfoPh >= 1) { if (lmode === 2) { lfoPh = 0.5; lfoDone = true; } else lfoPh -= 1; } }
          lfoV = lwave === 0 ? 1 - 2 * lfoPh : lwave === 1 ? (lfoPh < 0.5 ? 4 * lfoPh - 1 : 3 - 4 * lfoPh) : (lfoPh < 0.5 ? 1 : -1);
          // the envelope: it is the amplifier too
          if (stage === ATTACK) { eg += 1 / atk; if (eg >= 1) { eg = 1; stage = egtype === 1 ? HELD : DECAY; if (egtype === 1 && !gate) stage = DECAY; } }
          else if (stage === DECAY) { eg *= decCoef; if (eg < 1e-4) { eg = 0; stage = IDLE; } }
          else if (stage === HELD && !gate) stage = DECAY;
          if (egtype === 2) { gateEnv += ((gate ? 1 : 0) - gateEnv) * 0.01; vca = gateEnv; } else vca = eg;
          if (egtype === 0 && stage === DECAY && !gate) { /* A/D ignores the note off */ }
          // the pitch, then the coefficients, every 8 samples
          if ((i & 7) === 0) {
            pitch += (target - pitch) * (glideCoef === 1 ? 1 : 1 - Math.pow(1 - glideCoef, 8));
            if (Math.abs(target - pitch) < 1e-3) pitch = target;
            const lfoSemis = ltarget === 0 ? lfoV * lint * lint * 24 : 0, egSemis = egtarget === 0 ? egOct * eg * 12 : 0, egSemis2 = egtarget === 1 ? egOct * eg * 12 : 0;
            inc1 = 440 * Math.pow(2, (pitch + tune + lfoSemis + egSemis - 69) / 12) / sr;
            inc2 = 440 * Math.pow(2, (pitch + tune + OCT[g('vco2oct') | 0] + g('vco2pitch') / 100 + lfoSemis + egSemis + egSemis2 - 69) / 12) / sr;
            const octs = (egtarget === 2 ? egOct * eg : 0) + (ltarget === 2 ? lfoV * lint * lint * 4 : 0) + key * (pitch - 60) / 12 + cutvel * (velocity - 0.5) * 3;
            const fc = Math.min(0.45 * sr, Math.max(20, cutoff * Math.pow(2, octs)));
            gg = Math.tan(Math.PI * fc / sr);
            a1 = 1 / (1 + gg * (gg + kq)); a2 = gg * a1; a3 = gg * a2;
          }
          const shapeMod = ltarget === 1 ? lfoV * lint * 0.5 : 0;
          const s1v = Math.min(1, Math.max(0, sh1 + shapeMod)), s2v = Math.min(1, Math.max(0, sh2 + shapeMod));
          // VCO 1
          ph1 += inc1; let wrapped = false;
          if (ph1 >= 1) { ph1 -= 1; wrapped = true; }
          const damp1 = 1 - Math.min(1, inc1 * 14);   // folding aliases, so it fades out towards the top of the keyboard
          let o1;
          if (v1w === 0) o1 = fold((2 * ph1 - 1 - polyBlep(ph1, inc1)) * (1 + 4 * s1v * damp1));
          else if (v1w === 1) o1 = fold((ph1 < 0.5 ? 4 * ph1 - 1 : 3 - 4 * ph1) * (1 + 4 * s1v * damp1));
          else { const duty = 0.5 - 0.45 * s1v; o1 = (ph1 < duty ? 1 : -1) + polyBlep(ph1, inc1) - polyBlep((ph1 + 1 - duty) % 1, inc1); }
          // VCO 2
          if (mod === 1 && wrapped) ph2 = ph1 * (inc2 / inc1) % 1;   // sync: it restarts with VCO 1
          else { ph2 += inc2; if (ph2 >= 1) ph2 -= 1; }
          const damp2 = 1 - Math.min(1, inc2 * 14);
          let o2;
          if (v2w === 0) o2 = fold((2 * ph2 - 1 - polyBlep(ph2, inc2)) * (1 + 4 * s2v * damp2));
          else if (v2w === 1) o2 = fold((ph2 < 0.5 ? 4 * ph2 - 1 : 3 - 4 * ph2) * (1 + 4 * s2v * damp2));
          else { const w = rnd(), k = 0.05 + 0.95 * (1 - s2v) * (1 - s2v); nz += (w - nz) * k; o2 = nz * (0.6 + 0.4 * s2v) * 1.4; }
          if (mod === 2) o2 *= o1;
          const x = (o1 * mix1 + o2 * mix2) * 0.9;
          // the filter: a two-pole state-variable low-pass, with soft limits on its states so that it rings but does not run away
          const xin = clip(x * 1.4);
          const hp = (xin - (kq + gg) * s1 - s2) * a1;
          const bp = gg * hp + s1, lp = gg * bp + s2;
          s1 = clip(gg * hp + bp); s2 = clip(gg * bp + lp);
          let y = lp;
          y = drive > 0 ? clip(y * driveGain) / Math.sqrt(driveGain) * 1.3 : y;
          const o = y * vca * velGain;
          const r = o - dcx + 0.995 * dc; dcx = o; dc = r;
          outL[i] = outR[i] = r * level;
        }
        if (!Number.isFinite(dc + dcx + s1 + s2)) { s1 = s2 = dc = dcx = 0; }
        if (stage === IDLE && !gate && vca < 1e-5 && Math.abs(gateEnv) < 1e-5) { active = false; s1 = s2 = dc = dcx = 0; }
      },
    };
  },
};
