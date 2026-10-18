// Comb-resonator percussion. A short burst of noise (the strike) is fed into four feedback comb filters tuned to the
// note. A comb is a delay line fed back on itself, so it rings at the pitch whose period is the delay and at every
// multiple of it; the loop passes through a lowpass (`damp`) so the highs die first. The four combs sit at ratios
// that run from harmonic (1 2 3 4: a pitched, tom-like or bell-like tone) to inharmonic and metallic (`spread`,
// the sound of a ringing pipe, a clang or an industrial hit). `hollow` flips the feedback negative, which drops the
// pitch an octave and keeps only the odd multiples (a hollow, wooden sound). `sweep` starts the combs high and
// lets them fall to pitch over `sdec` ms, the zap of a techno tom; the delay lines are modulated while they ring,
// which gives the pitch dive its metallic smear. `drive` saturates the sum. Monophonic: a new note
// strikes the combs again and the old ring carries on into it. Note off is ignored; percussion rings out.
const SPEC = [
  { name: 'decay', min: 20, max: 4000, def: 250 },     // ms for the ring to fall 60 dB
  { name: 'damp', min: 0, max: 1, def: 0.35 },
  { name: 'spread', min: 0, max: 1, def: 0.6 },        // 0: harmonic, 1: metallic
  { name: 'hollow', min: 0, max: 1, def: 0, int: true },
  { name: 'click', min: 0.2, max: 20, def: 2 },        // ms, length of the strike
  { name: 'bright', min: 0, max: 1, def: 0.7 },        // brightness of the strike
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'sweep', min: 0, max: 4, def: 0.5 },         // octaves above pitch at the start of the hit
  { name: 'sdec', min: 2, max: 500, def: 40 },         // ms for the sweep to fall 60 dB
  { name: 'drive', min: 0, max: 1, def: 0.2 },
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SIZE = 1 << 15, MASK = SIZE - 1;
const HARM = [1, 2, 3, 4];
const METAL = [1, 1.504, 2.742, 4.156];
const WEIGHT = [1, 0.8, 0.6, 0.5];

export default {
  type: 'combperc',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shared: true,   // one resonator bank for the instrument, never copied for each voice
  shape: 'rounded',
  glyph: 'combperc',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const bufs = [0, 1, 2, 3].map(() => new Float64Array(SIZE));
    const lp = new Float64Array(4);
    let w = 0, note = 60, velocity = 1, pending = false, active = false;
    let strikeLeft = 0, strikeLen = 1, strikeGain = 0, strikeLp = 0, sweepEnv = 0, quiet = 0, dc = 0, dcx = 0;
    let seed = 0x2545f491;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = Math.max(0, Math.min(1, msg.vel ?? 1)); pending = true; active = true; }
        else if (msg.type === 'noteCut') { active = false; pending = false; strikeLeft = 0; sweepEnv = 0; quiet = 0; for (const b of bufs) b.fill(0); lp.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const spread = g('spread'), hollow = g('hollow') >= 0.5;
        const decay = g('decay') * 0.001, sweep = g('sweep'), drive = g('drive');
        const ratio = HARM.map((h, k) => h + (METAL[k] - h) * spread);
        const base = 440 * Math.pow(2, (note + g('tune') - 69) / 12);
        const cLp = 1 - g('damp') * 0.88;                       // loop lowpass coefficient
        const sDecay = Math.exp(-6.9 / (sampleRate * g('sdec') * 0.001));
        if (pending) {
          pending = false;
          strikeLen = Math.max(1, Math.round(g('click') * 0.001 * sampleRate));
          strikeLeft = strikeLen;
          strikeGain = 1 - g('vel') + g('vel') * velocity;
          sweepEnv = 1;
          strikeLp = 0;
        }
        const hard = 0.08 + g('bright') * 0.92;
        const level = g('level') * 0.9;
        const driveGain = 1 + drive * 5;
        for (let i = 0; i < n; i++) {
          // the strike: noise through a one-pole lowpass, fading out over its length
          let x = 0;
          if (strikeLeft > 0) {
            strikeLp += hard * (rand() - strikeLp);
            x = strikeLp * strikeGain * (strikeLeft / strikeLen);
            strikeLeft--;
          }
          const pitch = base * Math.pow(2, sweep * sweepEnv);
          sweepEnv *= sDecay;
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const D = Math.max(2.5, Math.min(SIZE - 4, sampleRate / (pitch * ratio[k])));
            const di = Math.floor(D), df = D - di;
            const b = bufs[k];
            const a0 = b[(w - di) & MASK], a1 = b[(w - di - 1) & MASK];
            const d = a0 + (a1 - a0) * df;
            lp[k] += cLp * (d - lp[k]);
            // loop gain from the decay time: one pass of this delay line
            let fb = Math.pow(10, -3 * (D / sampleRate) / decay);
            if (fb > 0.99995) fb = 0.99995;
            const y = x * 0.5 * WEIGHT[k] + lp[k] * (hollow ? -fb : fb);
            b[w & MASK] = y;
            sum += y * WEIGHT[k];
          }
          w = (w + 1) & MASK;
          let s = sum * 0.5;
          s = drive > 0 ? Math.tanh(s * driveGain) / Math.sqrt(driveGain) : s;
          // remove DC left by the feedback paths
          const o = s - dcx + 0.995 * dc; dcx = s; dc = o;
          outL[i] = outR[i] = o * level;
          const ao = Math.abs(o);
          quiet = ao > quiet ? ao : quiet * 0.9995;
        }
        if (!Number.isFinite(dc + dcx)) { dc = dcx = 0; for (const b of bufs) b.fill(0); lp.fill(0); }
        if (quiet < 1e-5 && strikeLeft === 0) {
          active = false; quiet = 0; dc = dcx = 0;
          for (const b of bufs) b.fill(0);
          lp.fill(0);
        }
      },
    };
  },
};
