// Piano by physical modelling. A note is a hammer striking one, two or three strings (one in the bass, three in the
// treble), and the sound of those strings coming through a wooden body.
//
//   hammer    a half-sine force pulse. A hard blow is shorter (brighter, louder); the felt makes it longer in the bass and
//             when `hard` is low. It enters the strings through a comb at the strike point, `pos` (a tenth of the string
//             or so on a real piano), which takes out the harmonics that have a node there.
//   strings   waveguides: a delay line the length of one period, a fractional-delay allpass to tune it exactly, a chain
//             of allpasses that makes the high partials run slightly sharp (the stiffness of real strings, `inharm`),
//             and a lowpass in the loop so the highs die first (`bright`). The strings of a note are detuned a little
//             (`detune`) so they beat; one of them decays quickly and the others slowly, which is the two-stage decay of a
//             piano, the prompt sound and the after sound (`prompt` is how much of the first there is).
//   body      three broad resonances below 600 Hz, and a soft thump of the hammer on the keybed.
//   damper    note off lets the damper fall on the strings, over `release` ms, unless the pedal is down. `pedal` is a
//             switch (0.5 and up is down) so a pattern column can play it; strings of released notes ring on while it is.
//
// Monophonic like the other synths: the voices node gives each key its own copy.
const SPEC = [
  { name: 'decay', min: 0.5, max: 40, def: 9 },          // seconds for the after sound to fall 60 dB at middle C (bass rings longer, treble shorter)
  { name: 'prompt', min: 0, max: 1, def: 0.45 },
  { name: 'hard', min: 0, max: 1, def: 0.5 },
  { name: 'pos', min: 0.04, max: 0.5, def: 0.12 },
  { name: 'bright', min: 0, max: 1, def: 0.55 },
  { name: 'inharm', min: 0, max: 1, def: 0.5 },
  { name: 'detune', min: 0, max: 15, def: 1.6 },         // cents between the strings of a note
  { name: 'body', min: 0, max: 1, def: 0.5 },
  { name: 'thump', min: 0, max: 1, def: 0.25 },
  { name: 'width', min: 0, max: 1, def: 0.5 },
  { name: 'pedal', min: 0, max: 1, def: 0 },
  { name: 'release', min: 20, max: 3000, def: 250 },     // ms the damper takes to still a released string
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.7 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SIZE = 1 << 14, MASK = SIZE - 1, SECTIONS = 3, MAXSTR = 3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// phase delay, in samples, of the first order allpass (a + z^-1) / (1 + a z^-1) at angular frequency w
const allpassDelay = (a, w) => {
  const num = Math.atan2(-Math.sin(w), a + Math.cos(w)), den = Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  return -(num - den) / w;
};

export default {
  type: 'piano',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'piano',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const fs = sampleRate, pitchOn = connected[0];
    const buf = Array.from({ length: MAXSTR }, () => new Float64Array(SIZE));
    // per string: allpass interpolation (a, x1, y1), dispersion (x1, y1 per section), loop lowpass state, gains
    const ia = new Float64Array(MAXSTR), ix = new Float64Array(MAXSTR), iy = new Float64Array(MAXSTR), lp = new Float64Array(MAXSTR);
    const dx = new Float64Array(MAXSTR * SECTIONS), dy = new Float64Array(MAXSTR * SECTIONS);
    const gs = new Float64Array(MAXSTR), delay = new Int32Array(MAXSTR), loop = new Float64Array(MAXSTR), damp = new Float64Array(MAXSTR), weight = new Float64Array(MAXSTR);
    const lc = new Float64Array(MAXSTR);
    let ns = 0, w = 0, dispA = 0;
    let note = 60, velocity = 1, active = false, keyUp = false, damped = false, pending = false;
    let k = 0, Lc = 100, dpos = 10, amp = 0, strikeEnd = 0;
    let thumpEnv = 0, thumpDecay = 0, thumpAmp = 0, thumpLp = 0;
    let seed = 0x2545f491;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    let quiet = 0, panL = 1, panR = 1;

    // the body: three resonant bandpass filters (RBJ, constant 0 dB peak gain), run on the sum of the strings
    const bq = [[95, 4], [230, 5], [540, 4]].map(([f, q]) => {
      const w0 = 2 * Math.PI * f / fs, al = Math.sin(w0) / (2 * q), a0 = 1 + al;
      return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    });
    const bodyGain = [0.9, 0.7, 0.45];

    // Set the strings up for a note with the current parameters.
    const strike = (g, pitchOct) => {
      const midi = note + g('tune') + pitchOct * 12;
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const pf = clamp((midi - 21) / 87, 0, 1);
      ns = midi < 31 ? 1 : midi < 48 ? 2 : 3;
      // Stiffness. A real string's partials run sharp, f(n) = n f0 sqrt(1 + B n^2), with B about 4e-4 at middle C and rising
      // with pitch. The allpass chain bends the loop's delay so that the sixth partial lands where that formula puts it
      // (the coefficient is found by bisection on the chain's exact delay); the others follow along.
      const B = g('inharm') * 2 * 4e-4 * Math.pow(2, (midi - 60) / 18);
      const T0 = fs / f0, w0 = 2 * Math.PI * f0 / fs, N6 = 6;
      const want = 0.5 * Math.log2(1 + B * N6 * N6);   // octaves sharp, at the sixth partial
      const got = a => -Math.log2(1 + SECTIONS * (allpassDelay(a, N6 * w0) - allpassDelay(a, w0)) / T0);
      let lo = 0, hi = T0 > 40 ? 0.95 : 0.4;
      for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (got(-mid) < want) lo = mid; else hi = mid; }
      dispA = -lo;
      const cUser = 0.62 + (0.03 - 0.62) * g('bright');
      const t60 = clamp(g('decay') * Math.pow(2, -(midi - 60) / 36), 0.3, 40);
      const spread = ns === 1 ? [0] : ns === 2 ? [-1, 1] : [-1, 0, 1];
      const prompt = g('prompt');
      for (let s = 0; s < MAXSTR; s++) { buf[s].fill(0); ix[s] = iy[s] = lp[s] = 0; }
      dx.fill(0); dy.fill(0);
      for (let s = 0; s < ns; s++) {
        const f = f0 * Math.pow(2, spread[s] * g('detune') / 1200), wf = 2 * Math.PI * f / fs;
        const T = fs / f;
        const strT60 = ns === 1 ? t60 * 0.6 : s === 0 ? t60 * 0.15 : t60;   // one quick string, the rest slow
        const target = Math.pow(10, -3 * (T / fs) / strT60);
        // The loop lowpass takes a little off the fundamental on every trip. Where that would be more than the string may
        // lose (the treble, with many trips a second) it is eased until the fundamental decays at the wanted rate.
        const mag = c => (1 - c) / Math.hypot(1 - c * Math.cos(wf), c * Math.sin(wf));
        let c = cUser;
        if (mag(c) < target / 0.99995) { let lo = 0, hi = c; for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (mag(mid) >= target / 0.99995) lo = mid; else hi = mid; } c = lo; }
        lc[s] = c;
        const lpMag = mag(c);
        const lpDelay = Math.atan2(c * Math.sin(wf), 1 - c * Math.cos(wf)) / wf;
        const D = T - lpDelay - SECTIONS * allpassDelay(dispA, wf);
        const Dint = Math.max(2, Math.floor(D - 0.5));
        let d = D - Dint;
        for (let it = 0; it < 4; it++) d += (D - Dint) - allpassDelay((1 - d) / (1 + d), wf);   // the interpolator's delay at this frequency, not its delay at DC
        d = clamp(d, 0.3, 1.9);
        ia[s] = (1 - d) / (1 + d);
        delay[s] = Dint;
        loop[s] = Math.min(0.99995, target / lpMag);
        damp[s] = Math.pow(10, -3 * (T / fs) / (g('release') * 0.001));
        weight[s] = ns === 1 ? 1 : s === 0 ? prompt * 1.4 : (1 - prompt) * 1.4 / (ns - 1);
      }
      const hard = g('hard'), v = velocity;
      const Tc = 0.0032 * Math.pow(f0 / 65.4, -0.45) * (0.6 + 0.9 * (1 - hard)) * (1.15 - 0.5 * v);   // seconds of contact: shorter for a hard felt, a hard blow and a high note
      Lc = Math.max(4, Math.min(Tc * fs, 0.5 * fs / f0));   // a blow no longer than half a period, or the string would hardly feel it
      dpos = Math.max(1, Math.round(g('pos') * fs / f0));
      const vm = 1 - g('vel') + g('vel') * v;
      amp = vm * vm * 0.5 * Math.min(1, fs / f0 / Lc) * Math.pow(2, -pf * 0.4) * NORM(pf);
      k = 0; strikeEnd = Lc + dpos + 1;
      thumpEnv = 1; thumpDecay = Math.exp(-1 / (0.012 * fs)); thumpAmp = g('thump') * vm * vm * 0.5;
      const pos = 0.5 + (pf - 0.5) * g('width');
      panL = Math.cos(pos * Math.PI / 2) * Math.SQRT2; panR = Math.sin(pos * Math.PI / 2) * Math.SQRT2;
      damped = false; quiet = 0;
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; active = true; keyUp = false; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') keyUp = true;
        else if (msg.type === 'noteCut') { active = false; keyUp = false; ns = 0; for (const b of buf) b.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        if (pending) { pending = false; strike(g, pitchOn ? inputs[0][0] : 0); }
        if (keyUp && !damped && g('pedal') < 0.5) damped = true;   // the damper falls, or the pedal comes up
        const level = g('level') * 2, body = g('body');
        for (let s = 0; s < ns; s++) gs[s] = loop[s] * (damped ? damp[s] : 1);
        let peak = 0;
        for (let i = 0; i < n; i++) {
          // the hammer: a half-sine pulse, entering through the strike-point comb
          const e = k < strikeEnd ? (k >= 0 && k < Lc ? Math.sin(Math.PI * k / Lc) : 0) - (k - dpos >= 0 && k - dpos < Lc ? Math.sin(Math.PI * (k - dpos) / Lc) : 0) : 0;
          k++;
          let sum = 0;
          for (let s = 0; s < ns; s++) {
            const b = buf[s];
            let x = b[(w - delay[s]) & MASK];
            let y = ia[s] * x + ix[s] - ia[s] * iy[s]; ix[s] = x; iy[s] = y; x = y;   // fractional delay
            for (let q = 0; q < SECTIONS; q++) {   // stiffness: the allpass chain
              const j = s * SECTIONS + q;
              y = dispA * x + dx[j] - dispA * dy[j]; dx[j] = x; dy[j] = y; x = y;
            }
            lp[s] = (1 - lc[s]) * x + lc[s] * lp[s];     // the highs die first
            sum += lp[s] * weight[s];
            b[w & MASK] = lp[s] * gs[s] + e * amp * weight[s];
          }
          w = (w + 1) & MASK;
          // the thump of the hammer on the keybed: lowpassed noise that dies in about 12 ms
          thumpLp += 0.35 * (rand() - thumpLp);
          const t = thumpLp * thumpEnv * thumpAmp; thumpEnv *= thumpDecay;
          const dry = sum + t;
          let resonance = 0;
          for (let r = 0; r < 3; r++) {
            const f = bq[r], out = f.b0 * dry + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
            f.x2 = f.x1; f.x1 = dry; f.y2 = f.y1; f.y1 = out;
            resonance += out * bodyGain[r];
          }
          const m = (dry + body * resonance * 2) * level;
          outL[i] = m * panL; outR[i] = m * panR;
          const a = Math.abs(m); if (a > peak) peak = a;
        }
        quiet = peak < 1e-6 ? quiet + 1 : 0;
        if (quiet > 8 && k > strikeEnd) active = false;
      },
    };
  },
};

// loudness correction by pitch (0 is A0, 1 is C8), so notes across the keyboard come out at about the same level
const LOUD = [[21, 0.7], [36, 0.7], [48, 0.85], [60, 1], [72, 1.6], [84, 3.3], [96, 5.7], [108, 8]];
function NORM(pf) {
  const midi = 21 + pf * 87;
  for (let i = 1; i < LOUD.length; i++) if (midi <= LOUD[i][0]) { const [m0, g0] = LOUD[i - 1], [m1, g1] = LOUD[i]; return g0 + (g1 - g0) * (midi - m0) / (m1 - m0); }
  return LOUD.at(-1)[1];
}
