// Piano 2: a piano as one coupled mechanical system, not a sound with a piano's envelope.
//
//   hammer    a mass on a nonlinear felt spring (force grows as compression to the power 2.5 to 3.3, with the felt's hysteresis,
//             so the blow has a sharp onset and a long soft tail). It presses on the string, the string gives way and pushes back,
//             and the waves that return from the string's ends reach the hammer while it is still there. It can bounce and touch
//             twice. A hard blow is shorter and brighter by physics, not by a filter; a high note's hammer is on the string for
//             longer than a period and so shapes the note differently from a low one's.
//   strings   waveguides: one loop of delay for the whole string, struck at a point (`pos`) where the hammer reads and drives the
//             waves going both ways (this makes the comb of missing harmonics by itself), a fractional-delay allpass, a chain of
//             allpasses that bends the high partials sharp (stiffness, `inharm`), and a lowpass in the loop (`bright`). One string
//             in the bass, two in the middle, three in the treble, tuned a little apart (`detune`).
//   bridge    every string ends on the same bridge, and the bridge is moved by the strings and by nothing else. Its give is the
//             soundboard: dozens of damped resonances (`board` is how far it gives). Because the strings drive one bridge, they
//             are coupled: all three moving together lose their energy to the board quickly (the prompt sound), the ones moving
//             against each other hardly at all (the after sound), so the two-stage decay and the beating come out of the coupling;
//             there is no envelope. The sound is what the bridge does, and a string partial that lands near a board resonance
//             rings a little differently from its neighbours, which is the unevenness of a real piano. The junction is solved
//             exactly (the board is a passive admittance), so it can not blow up.
//   phantom   a stretched string is a little longer when it swings wide. That makes extra partials at sums and differences of the
//             real ones, which is the metallic ping of the low notes. A small nonlinear term on the bridge force.
//   sympathy  three more strings, at the octave above and below and at the twelfth above, which are not struck but ring when
//             the bridge excites them. The dampers hold them nearly still until the pedal comes down.
//   una       the soft pedal: the hammer misses one string of three.
//   variance  every blow is a little different (hammer position, felt, tuning), the same way every time a note is struck from the
//             same state, but different from note to note.
//   thump, knock, pedal, release   as in the piano: the key's thud, the damper's tick, and the damper falling.
//
// Monophonic like the other synths: the voices node gives each key its own copy. A note costs about as much as a Pogue voice
// (the board is 40 resonances; at quality eco it is 16 and the sympathetic strings are left out).
const SPEC = [
  { name: 'decay', min: 0.5, max: 40, def: 14 },         // seconds for the after sound to fall 60 dB at middle C (bass rings longer, treble shorter)
  { name: 'hard', min: 0, max: 1, def: 0.6 },
  { name: 'pos', min: 0.04, max: 0.5, def: 0.12 },
  { name: 'bright', min: 0, max: 1, def: 0.75 },
  { name: 'inharm', min: 0, max: 1, def: 0.5 },
  { name: 'detune', min: 0, max: 15, def: 2.2 },         // cents between the strings of a note
  { name: 'board', min: 0, max: 1, def: 0.45 },           // how far the bridge gives: the coupling of the strings and the soundboard
  { name: 'phantom', min: 0, max: 1, def: 0.3 },
  { name: 'sympathy', min: 0, max: 1, def: 0.3 },
  { name: 'una', min: 0, max: 1, def: 0 },
  { name: 'variance', min: 0, max: 1, def: 0.3 },
  { name: 'thump', min: 0, max: 1, def: 0.25 },
  { name: 'knock', min: 0, max: 1, def: 0.3 },
  { name: 'width', min: 0, max: 1, def: 0.5 },
  { name: 'pedal', min: 0, max: 1, def: 0 },
  { name: 'release', min: 20, max: 3000, def: 250 },     // ms the damper takes to still a released string
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.7 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'quality', min: 0, max: 1, def: 0, int: true },   // 0 standard, 1 eco
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SIZE = 1 << 14, MASK = SIZE - 1, SECTIONS = 3, MAXSTR = 6, STRUCK = 3;
const DRY = 0.5;   // how much of the strings' own motion is heard besides what the board makes of it
const MODES = 40, MODES_ECO = 16, COUPLING = 0.03, HAMMER_SUB = 6, HAMMER_SECONDS = 0.03;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// phase delay, in samples, of the first order allpass (a + z^-1) / (1 + a z^-1) at angular frequency w
const allpassDelay = (a, w) => {
  const num = Math.atan2(-Math.sin(w), a + Math.cos(w)), den = Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  return -(num - den) / w;
};

// The first blow of a high note is a spike far above the rest of the note; past 0.6 it is bent smoothly towards 1 instead of clipping.
const softClip = x => { const a = Math.abs(x); return a < 0.6 ? x : Math.sign(x) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4)); };

// piecewise linear table lookup
function lookup(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return table.at(-1)[1];
}

// ---- the hammer ------------------------------------------------------------------------------------------------------------
const HAMMER_MASS = [[21, 9e-3], [48, 5.5e-3], [60, 4e-3], [84, 2.8e-3], [108, 2e-3]];   // kg by key, from measurements of grand pianos
const FELT_K = [[21, 4e8], [48, 2e9], [60, 4.5e9], [84, 1.5e10], [108, 4e10]];            // the felt's stiffness, N/m^p, by key
const HAMMER_SPEED = 4;        // m/s at velocity 1
const FELT_HYSTERESIS = 1.2e-4; // s: the felt pushes harder while it is being squeezed than while it springs back
// the string's impedance (kg/s) by key: a heavy bass string resists more than a fine treble one
const stringImpedance = midi => clamp(0.65 * Math.pow(2, -(midi - 60) / 24), 0.05, 6);

// ---- the soundboard: modal admittance --------------------------------------------------------------------------------------
// A mode is a bandpass with 0 dB at its peak (RBJ), which is a passive admittance; their weighted sum is passive too. Frequency,
// Q and weight are fixed by the mode's index, so every note meets the same board. The modes crowd up the spectrum like a plate's.
function boardMode(j, count, fs) {
  const t = j / (count - 1);
  const f = Math.min(0.45 * fs, 70 * Math.pow(6500 / 70, Math.pow(t, 0.85)) * (1 + 0.06 * Math.sin(j * 2.7 + 0.4)));
  const q = 7 + 5 * Math.sin(j * 1.3 + 0.5) + 16 * (1 - t) ** 2;
  const weight = Math.pow(f / 300, -0.25) * (0.6 + 0.4 * Math.cos(j * 1.7));
  const w0 = 2 * Math.PI * f / fs, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
  return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, weight };
}

export default {
  type: 'piano2',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'piano2',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const fs = sampleRate, pitchOn = connected[0];
    const buf = Array.from({ length: MAXSTR }, () => new Float64Array(SIZE));
    // per string: the interpolating allpass, the stiffness chain, the loop lowpass, the loop gains and the strike taps
    const ia = new Float64Array(MAXSTR), ix = new Float64Array(MAXSTR), iy = new Float64Array(MAXSTR), lp = new Float64Array(MAXSTR), lc = new Float64Array(MAXSTR);
    const dispA = new Float64Array(MAXSTR), dx = new Float64Array(MAXSTR * SECTIONS), dy = new Float64Array(MAXSTR * SECTIONS);
    const delay = new Int32Array(MAXSTR), tap = new Int32Array(MAXSTR);
    const loopOpen = new Float64Array(MAXSTR), loopDamped = new Float64Array(MAXSTR), loopSym = new Float64Array(MAXSTR);
    const share = new Float64Array(MAXSTR);        // the hammer's share of the blow on each struck string
    const arrive = new Float64Array(MAXSTR);       // the wave reaching the bridge from each string
    const loopNow = new Float64Array(MAXSTR), zw = new Float64Array(MAXSTR);   // this block's loop gains, and each string's weight on the bridge
    let ns = 0, nt = 0, w = 0;
    let note = 60, velocity = 1, active = false, keyUp = false, damped = false, pending = false;
    // the hammer
    let hamOn = false, hamAge = 0, hamEnd = 0, yh = 0, vh = 0, ys = 0, hamMass = 0.004, hamK = 1e9, hamP = 2.8, hamZ = 0.65, hamKappa = 1, hamTotal = 1, lastForce = 0;
    // the board: modal states (x1 x2 y1 y2 per mode)
    const modes = Array.from({ length: MODES }, (_, j) => boardMode(j, MODES, fs));
    const mx1 = new Float64Array(MODES), mx2 = new Float64Array(MODES), my1 = new Float64Array(MODES), my2 = new Float64Array(MODES);
    const mb0 = new Float64Array(MODES), mb2 = new Float64Array(MODES), ma1 = new Float64Array(MODES), ma2 = new Float64Array(MODES), mc = new Float64Array(MODES);
    const modeOf = (count) => { for (let j = 0; j < count; j++) { const m = modes[Math.round(j * (MODES - 1) / Math.max(1, count - 1))]; mb0[j] = m.b0; mb2[j] = m.b2; ma1[j] = m.a1; ma2[j] = m.a2; mc[j] = m.weight; } let s = 0; for (let j = 0; j < count; j++) s += mc[j]; for (let j = 0; j < count; j++) mc[j] /= s; };
    let modeCount = 0;
    const dcCoef = 1 - Math.exp(-2 * Math.PI * 30 / fs);
    let seed = 0x2545f491;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    let thumpEnv = 0, thumpDecay = 0, thumpAmp = 0, thumpLp = 0, knockEnv = 0, knockLp = 0;
    let dcState = 0, nonlinHp = 0, nonlinEnv = 1e-6, loud = 1, quiet = 0, panL = 1, panR = 1, k = 0, outAmp = 1;

    // Tune string s to frequency f (note number midiS) with the given 60 dB decay time (seconds) and brightness.
    const tuneString = (s, f, midiS, t60, cUser, stiff) => {
      const T0 = fs / f, w0 = 2 * Math.PI * f / fs, N6 = 6;
      const B = stiff * 2 * 4e-4 * Math.pow(2, (midiS - 60) / 18);
      const want = 0.5 * Math.log2(1 + B * N6 * N6);
      const got = a => -Math.log2(1 + SECTIONS * (allpassDelay(a, N6 * w0) - allpassDelay(a, w0)) / T0);
      let lo = 0, hi = T0 > 40 ? 0.95 : 0.4;
      for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (got(-mid) < want) lo = mid; else hi = mid; }
      dispA[s] = -lo;
      const target = Math.pow(10, -3 * (T0 / fs) / t60);
      const mag = c => (1 - c) / Math.hypot(1 - c * Math.cos(w0), c * Math.sin(w0));
      let c = cUser;
      if (mag(c) < target / 0.99995) { let a = 0, b = c; for (let it = 0; it < 24; it++) { const mid = (a + b) / 2; if (mag(mid) >= target / 0.99995) a = mid; else b = mid; } c = a; }
      lc[s] = c;
      const lpDelay = Math.atan2(c * Math.sin(w0), 1 - c * Math.cos(w0)) / w0;
      const D = T0 - lpDelay - SECTIONS * allpassDelay(dispA[s], w0);
      const Dint = Math.max(8, Math.floor(D - 0.5));
      let d = D - Dint;
      for (let it = 0; it < 4; it++) d += (D - Dint) - allpassDelay((1 - d) / (1 + d), w0);
      d = clamp(d, 0.3, 1.9);
      ia[s] = (1 - d) / (1 + d);
      delay[s] = Dint;
      loopOpen[s] = Math.min(0.99995, target / mag(c));
      return mag(c);
    };

    // Set everything up for a note with the current parameters.
    const strike = (g, pitchOct) => {
      const quality = g('quality') >= 0.5, variance = g('variance');
      const midi = note + g('tune') + pitchOct * 12;
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const pf = clamp((midi - 21) / 87, 0, 1);
      ns = midi < 31 ? 1 : midi < 48 ? 2 : 3;
      const tuned = [];   // [frequency ratio, note offset] for the sympathetic strings
      if (!quality) for (const r of [2, 3, 0.5]) if (f0 * r < 0.4 * fs && f0 * r > 20) tuned.push(r);
      nt = ns + tuned.length;
      const cUser = 0.62 + (0.03 - 0.62) * g('bright');
      const t60 = clamp(g('decay') * Math.pow(2, -(midi - 60) / 36), 0.3, 40);
      const spread = ns === 1 ? [0] : ns === 2 ? [-1, 1] : [-1, 0, 1];
      for (let s = 0; s < MAXSTR; s++) { buf[s].fill(0); ix[s] = iy[s] = lp[s] = 0; }
      dx.fill(0); dy.fill(0);
      const detune = g('detune');
      const spreadOf = [rand() * variance, rand() * variance, rand() * variance];
      for (let s = 0; s < ns; s++) {
        const cents = spread[s] * detune * (1 + 0.5 * spreadOf[s]) + 0.6 * spreadOf[s] * detune;
        const f = f0 * Math.pow(2, cents / 1200);
        tuneString(s, f, midi, t60 * (1 + 0.15 * spreadOf[s]), cUser, g('inharm'));
        loopDamped[s] = Math.min(loopOpen[s], Math.pow(10, -3 * (1 / f) / (g('release') * 0.001)));
      }
      for (let i = 0; i < tuned.length; i++) {
        const s = ns + i, r = tuned[i], fs2 = f0 * r;
        const mag = tuneString(s, fs2, midi + 12 * Math.log2(r), t60 * 1.2, cUser, g('inharm'));
        loopSym[s] = Math.min(0.99995, Math.pow(10, -3 * (1 / fs2) / 0.8) / mag);   // held nearly still: 0.8 s to fall 60 dB
        loopDamped[s] = loopSym[s];
      }
      // the hammer: which way the blow is shared among the strings, where it strikes, how hard
      const una = g('una');
      let total = 0, sq = 0;
      for (let s = 0; s < ns; s++) { share[s] = ns === 3 && s === 2 ? 1 - una : 1; total += share[s]; sq += share[s] * share[s]; }
      for (let s = 0; s < ns; s++) share[s] = share[s] / Math.max(total, 1e-6);
      hamKappa = sq / Math.max(total * total, 1e-6);
      hamTotal = total;
      const pos = clamp(g('pos') * (1 + 0.25 * variance * rand()), 0.03, 0.5);
      for (let s = 0; s < ns; s++) tap[s] = Math.max(1, Math.round(pos * delay[s] / 2));
      const vm = 1 - g('vel') + g('vel') * velocity;
      hamMass = lookup(HAMMER_MASS, midi);
      hamP = 2.5 + 0.8 * pf;
      hamK = lookup(FELT_K, midi) * Math.exp(3.66 * (g('hard') - 0.5)) * (1 + 0.06 * variance * rand());
      hamZ = stringImpedance(midi);
      yh = ys = 0; vh = Math.max(0.05, vm) * HAMMER_SPEED * (0.4 + 0.6 * vm); lastForce = 0;
      hamOn = true; hamAge = 0; hamEnd = Math.round(HAMMER_SECONDS * fs);
      for (let j = 0; j < MODES; j++) mx1[j] = mx2[j] = my1[j] = my2[j] = 0;
      modeCount = quality ? MODES_ECO : MODES; modeOf(modeCount);
      nonlinHp = 0; nonlinEnv = 1e-6; dcState = 0;
      thumpEnv = 1; thumpDecay = Math.exp(-1 / (0.012 * fs)); thumpAmp = g('thump') * vm * vm * 0.5;
      knockEnv = 0; knockLp = 0;
      outAmp = NORM(pf);
      const place = 0.5 + (pf - 0.5) * g('width');
      panL = Math.cos(place * Math.PI / 2) * Math.SQRT2; panR = Math.sin(place * Math.PI / 2) * Math.SQRT2;
      damped = false; quiet = 0; k = 0;
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; active = true; keyUp = false; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') keyUp = true;
        else if (msg.type === 'noteCut') { active = false; keyUp = false; hamOn = false; ns = nt = 0; for (const b of buf) b.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        if (pending) { pending = false; strike(g, pitchOn ? inputs[0][0] : 0); }
        const pedalDown = g('pedal') >= 0.5;
        if (keyUp && !damped && !pedalDown) { damped = true; knockEnv = 1; }   // the damper falls, or the pedal comes up
        const level = g('level') * 2, phantom = g('phantom'), knock = g('knock') * 0.08;
        const zeta = 0.002 + g("board") * COUPLING;
        const symWeight = g('sympathy') * 0.5;
        // the strings' loop gains: struck strings are open, or damped once the key is up; the others are held still without the pedal
        for (let s = 0; s < ns; s++) loopNow[s] = damped ? loopDamped[s] : loopOpen[s];
        for (let s = ns; s < nt; s++) loopNow[s] = pedalDown ? loopOpen[s] : loopSym[s];
        for (let s = 0; s < ns; s++) zw[s] = 1;
        for (let s = ns; s < nt; s++) zw[s] = symWeight;
        let zTotal = 0; for (let s = 0; s < nt; s++) zTotal += zw[s];
        let b0t = 0; for (let j = 0; j < modeCount; j++) b0t += mc[j] * mb0[j];
        let peak = 0;
        const dtS = 1 / (fs * HAMMER_SUB);
        for (let i = 0; i < n; i++) {
          // the hammer, step by step through the sample, then its mean force into the strings at the strike point
          if (hamOn) {
            let vs0 = 0;
            for (let s = 0; s < ns; s++) vs0 += share[s] * (buf[s][(w - tap[s]) & MASK] + buf[s][(w - delay[s] + tap[s]) & MASK]);
            let force = lastForce, sum = 0;
            for (let u = 0; u < HAMMER_SUB; u++) {
              const vs = vs0 + force * hamKappa / (hamZ * hamTotal);   // the string's velocity at the point: what the waves carry plus the push of the felt
              const x = yh - ys, rate = vh - vs;
              if (x > 0) { const xp = Math.pow(x, hamP); force = Math.max(0, hamK * (xp + FELT_HYSTERESIS * hamP * xp / x * rate)); } else force = 0;
              vh -= force / hamMass * dtS; yh += vh * dtS; ys += vs * dtS;
              sum += force;
            }
            lastForce = force;
            const mean = sum / HAMMER_SUB;
            for (let s = 0; s < ns; s++) {
              const inject = mean * share[s] / (2 * hamZ);
              buf[s][(w - tap[s]) & MASK] += inject; buf[s][(w - delay[s] + tap[s]) & MASK] += inject;
            }
            if (++hamAge > hamEnd || (hamAge > 8 && yh - ys < -2e-3)) hamOn = false;
          }
          // the waves reaching the bridge
          let S = 0;
          for (let s = 0; s < nt; s++) {
            let x = buf[s][(w - delay[s]) & MASK];
            let y = ia[s] * x + ix[s] - ia[s] * iy[s]; ix[s] = x; iy[s] = y; x = y;
            for (let q = 0; q < SECTIONS; q++) { const j = s * SECTIONS + q; y = dispA[s] * x + dx[j] - dispA[s] * dy[j]; dx[j] = x; dy[j] = y; x = y; }
            lp[s] = (1 - lc[s]) * x + lc[s] * lp[s];
            arrive[s] = lp[s] * loopNow[s];
            S += zw[s] * arrive[s];
          }
          // the phantom partials: the square of the motion, without its mean, put back on the bridge force
          if (phantom > 0) {
            const m = S * S; nonlinHp += 0.004 * (m - nonlinHp);
            const a = Math.abs(S); nonlinEnv = a > nonlinEnv ? a : nonlinEnv * 0.99995;
            S += phantom * 0.5 * (m - nonlinHp) / (nonlinEnv + 1e-9);
          }
          // the bridge junction, solved with the board's own direct term so that it is passive and exact
          let st = 0;
          for (let j = 0; j < modeCount; j++) st += mc[j] * (mb2[j] * mx2[j] - ma1[j] * my1[j] - ma2[j] * my2[j]);
          const v = zeta * (2 * b0t * S + st) / (1 + zTotal * zeta * b0t);
          const drive = 2 * S - zTotal * v;
          for (let j = 0; j < modeCount; j++) {
            const out = mb0[j] * drive + mb2[j] * mx2[j] - ma1[j] * my1[j] - ma2[j] * my2[j];
            mx2[j] = mx1[j]; mx1[j] = drive; my2[j] = my1[j]; my1[j] = out;
          }
          for (let s = 0; s < nt; s++) buf[s][w & MASK] = arrive[s] - v;
          w = (w + 1) & MASK;
          // the key's thud and the damper's tick
          thumpLp += 0.35 * (rand() - thumpLp);
          const t = thumpLp * thumpEnv * thumpAmp; thumpEnv *= thumpDecay;
          let tick = 0;
          if (knockEnv > 1e-4) { knockLp += 0.5 * (rand() - knockLp); tick = knockLp * knockEnv * knock; knockEnv *= 0.9965; }
          dcState += dcCoef * (S - dcState);   // a struck string keeps a mean displacement, and with it a steady force on the bridge, which the board does not pass
          const m = softClip(((v / zeta + DRY * 2 * (S - dcState)) * outAmp + t + tick) * level);
          outL[i] = m * panL; outR[i] = m * panR;
          const a = Math.abs(m); if (a > peak) peak = a;
        }
        k += n;
        quiet = peak < 1e-6 ? quiet + 1 : 0;
        if (quiet > 8 && !hamOn) active = false;
      },
    };
  },
};

// loudness correction by pitch: the table is the gain that brings a note struck at velocity 0.7 to the same level (about -20 dBFS at level 0.5)
// as the others found by rendering one note every half octave or so (the force on the bridge is in newtons, not in the range of a signal)
const LOUD = [[21, 0.322], [28, 0.277], [36, 0.0826], [44, 0.0796], [52, 0.0406], [60, 0.0526], [68, 0.0773], [76, 0.1306], [84, 0.2257], [92, 0.3396], [100, 0.6], [108, 1]];
function NORM(pf) { return lookup(LOUD, 21 + pf * 87); }
