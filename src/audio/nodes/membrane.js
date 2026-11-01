// Membrane: a drum skin. A circular membrane that is struck rings in a fixed family of patterns (modes). Each mode (m, n) has m
// straight nodal lines across the head and n circles, and its pitch is set by a zero of a Bessel function: the mode's frequency is
// j(m,n), the n-th zero of J_m, divided by j(0,1). That is why a tom's overtones sit at 1, 1.59, 2.14, 2.30, 2.65, 2.92 times the
// lowest and not at 1, 2, 3, 4 like a string. This node finds those zeros itself (bessel() and zerosOfBessel() below), so the
// resonances are the real ones for a skin, not a table typed in.
//
// How loud each mode is comes from the Bessel function too: hit the head at radius r (0 the middle, 1 the rim) and mode (m, n)
// moves by J_m(j(m,n) * r), so a hit in the exact middle only shakes the modes with no nodal lines (m = 0) and a hit near the rim
// shakes nearly all of them.
//
//   position   where the head is hit, from the middle (0) to the rim (1)
//   strike     the beater: 0 a soft mallet or a hand (the low modes), 1 a hard stick (all of them, and a click)
//   damping    how fast the ringing dies: 0 rings on for seconds, 1 is a dead thud
//   highdamp   how much faster the high modes die than the low ones (a taped or wet head)
//   stiffness  how much a stiff head pushes the high modes sharp, away from the pure Bessel ratios (a thick head, a plate, a gong)
//   glide      the pitch jump of a hard hit: the head tightens when struck and the pitch falls back (the zap of a tom)
//   shell      the drum under the head: a deep, short note an octave below the lowest mode (a kick's boom)
//   width      the two stereo pick-ups listen at different angles around the head, so modes with nodal lines differ left and right
//   quality    standard uses 40 modes, eco the lowest 16 (about half the CPU; the high ones are quiet and short)
//
// The note you play is the pitch of the main tone, the (1,1) mode, which is the one the ear takes as the pitch of a tom; the
// lowest mode (0,1) sits well below it (a ratio of 0.63). Monophonic, a new note hits it again (what rings carries on); the voices
// node makes it polyphonic. Note off damps the ringing over `release` (a hand on the head).
const SPEC = [
  { name: 'position', min: 0, max: 1, def: 0.55 },
  { name: 'strike', min: 0, max: 1, def: 0.55 },
  { name: 'damping', min: 0, max: 1, def: 0.5 },
  { name: 'highdamp', min: 0, max: 1, def: 0.5 },
  { name: 'stiffness', min: 0, max: 1, def: 0.15 },
  { name: 'glide', min: 0, max: 1, def: 0.35 },
  { name: 'shell', min: 0, max: 1, def: 0.25 },
  { name: 'width', min: 0, max: 1, def: 0.4 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'release', min: 5, max: 3000, def: 300 },   // ms
  { name: 'quality', min: 0, max: 1, def: 0, int: true },   // 0 standard, 1 eco
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// J_m(x), the Bessel function of the first kind: (1 / 2 pi) times the integral of cos(m t - x sin t) over a full turn. The sum over
// 256 points is as accurate as it needs to be for x up to about 100 (the integrand is smooth and repeats every turn).
const STEPS = 256;
const SIN = new Float64Array(STEPS), COS = new Float64Array(STEPS);
for (let k = 0; k < STEPS; k++) { SIN[k] = Math.sin(2 * Math.PI * k / STEPS); COS[k] = Math.cos(2 * Math.PI * k / STEPS); }
export function bessel(m, x) {
  let sum = 0;
  for (let k = 0; k < STEPS; k++) {
    const t = 2 * Math.PI * k / STEPS;
    sum += Math.cos(m * t - x * SIN[k]);
  }
  return sum / STEPS;
}

// The zeros of J_m up to `limit`: walk along x until the sign changes, then halve the gap until it is tiny.
export function zerosOfBessel(m, limit) {
  const zeros = [];
  let x0 = m === 0 ? 0.5 : m + 0.5, f0 = bessel(m, x0);   // J_m is zero and flat at 0 (for m > 0); the first real zero is beyond m
  for (let x1 = x0 + 0.05; x1 <= limit; x1 += 0.05) {
    const f1 = bessel(m, x1);
    if (f0 === 0 || (f0 < 0) !== (f1 < 0)) {
      let lo = x0, hi = x1, flo = f0;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2, fm = bessel(m, mid);
        if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      zeros.push((lo + hi) / 2);
    }
    x0 = x1; f0 = f1;
  }
  return zeros;
}

// Every mode (m, n) up to a ratio of 12 above the lowest, sorted by pitch. ratio = j(m,n) / j(0,1).
const MAX_MODES = 40, ECO_MODES = 16;
const MODES = (() => {
  const j01 = zerosOfBessel(0, 3)[0], all = [];
  for (let m = 0; m <= 14; m++) {
    zerosOfBessel(m, j01 * 12).forEach((j, i) => {
      const slope = Math.abs(bessel(m + 1, j));          // how big the mode's shape is: it sets how hard the mode is to move
      all.push({ m, n: i + 1, j, ratio: j / j01, norm: 1 / Math.max(slope, 1e-3) * (m === 0 ? 1 : Math.SQRT2) });
    });
  }
  return all.sort((a, b) => a.ratio - b.ratio).slice(0, MAX_MODES);
})();
const MAIN = MODES.find(k => k.m === 1 && k.n === 1);   // the mode the ear hears as the pitch of the drum
export const MEMBRANE_MODES = MODES;

export default {
  type: 'membrane',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'membrane',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0];
    const count = MODES.length;
    let note = 60, velocity = 1, held = false, active = false, pending = false, age = 0, amp = 1, gain = 1;
    let lp = 0, lp2 = 0, shellPhase = 0, prevRand = 0;
    const y1 = new Float64Array(count), y2 = new Float64Array(count);
    const a1 = new Float64Array(count), a2 = new Float64Array(count);
    const gL = new Float64Array(count), gR = new Float64Array(count);
    let used = 0;
    let seed = 0x2468ace1;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };

    // Where the head is struck on its angle, and how far the pick-ups sit from that, in radians.
    const STRIKE_ANGLE = 0.4;

    // The resonators for the settings and the note: pitch (so also the glide), decay and loudness of every mode.
    // `lift` is the glide: how far above rest the whole head is pitched right now (1 is at rest).
    const aim = (g, main, lift, loudness) => {
      const position = g('position'), stiff = g('stiffness'), high = g('highdamp'), width = g('width');
      const limit = g('quality') >= 0.5 ? ECO_MODES : count;
      const t60 = 3 * Math.pow(0.05 / 3, g('damping'));                  // seconds for the lowest mode to fall 60 dB
      const slope = 0.3 + 1.2 * high;                                    // how fast the decay time shortens up the modes
      const spread = width * 1.2;                                        // angle of the two pick-ups either side of the strike
      const base = main * lift / MAIN.ratio;                             // the pitch of the lowest mode
      used = 0;
      for (let k = 0; k < limit; k++) {
        const md = MODES[k];
        const f = base * md.ratio * Math.sqrt(1 + stiff * 0.02 * md.ratio * md.ratio);
        if (f > sampleRate * 0.45) { gL[k] = gR[k] = 0; continue; }
        used = k + 1;
        const t = Math.max(0.004, t60 * Math.pow(md.ratio, -slope) * (md.m === 0 && md.n === 1 ? 1 : 0.85));
        const r = Math.pow(10, -3 / (t * sampleRate)), th = 2 * Math.PI * f / sampleRate;
        a1[k] = 2 * r * Math.cos(th); a2[k] = r * r;
        const shape = bessel(md.m, md.j * position * 0.9) * md.norm;    // (the very rim is held still, so the furthest hit is 90% of the way out)             // how far this mode moves where the head is hit
        const beater = Math.pow(md.ratio, -0.35);
        const w = shape * beater * Math.sin(th) * 0.12 * loudness;
        gL[k] = w * Math.cos(md.m * (STRIKE_ANGLE - spread));
        gR[k] = w * Math.cos(md.m * (STRIKE_ANGLE + spread));
      }
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; held = true; active = true; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') held = false;
        else if (msg.type === 'noteCut') { active = false; held = false; y1.fill(0); y2.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const main = 440 * Math.pow(2, (note + g('tune') - 69) / 12 + (pitchOn ? inputs[0][0] : 0));
        if (pending) { pending = false; age = 0; amp = 1; shellPhase = 0; gain = 1 - g('vel') + g('vel') * velocity; }
        const strike = g('strike'), glide = g('glide'), shell = g('shell');
        // glide: a hit tightens the head, the harder the more, and the pitch falls back over about 45 ms
        const lift = 1 + glide * 0.5 * (0.4 + 0.6 * gain) * Math.exp(-age / (0.045 * sampleRate));
        aim(g, main, lift, 1 + 1.4 * g('position'));   // a hit near the rim moves the head less, so it is lifted a little to keep the level even
        const fc = 300 * Math.pow(60, strike), beat = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);   // the beater's brightness: two one-poles, 12 dB per octave
        const click = 0.0004 * sampleRate;                                                              // the stick's click: a few hundred microseconds of noise
        const rel = Math.pow(10, -3 / (g('release') * 0.001 * sampleRate));
        const shellTau = 0.09 * sampleRate, shellF0 = main / MAIN.ratio * 0.5;
        const out = g('level') * gain * 1.1;
        for (let i = 0; i < n; i++) {
          if (!held) amp *= rel;
          let hit = age === 0 ? 1 : 0;
          if (age < click) { const r = rand(); hit += strike * 0.5 * (r - prevRand) * (1 - age / click); prevRand = r; }   // the difference of two randoms has no net push, only a click
          lp += (hit - lp) * beat; lp2 += (lp - lp2) * beat;
          let L = 0, R = 0;
          for (let k = 0; k < used; k++) {
            const y = lp2 + a1[k] * y1[k] - a2[k] * y2[k];
            y2[k] = y1[k]; y1[k] = y;
            L += y * gL[k]; R += y * gR[k];
          }
          let body = 0;
          if (shell > 0) {
            shellPhase += shellF0 * (1 + 0.8 * Math.exp(-age / (0.02 * sampleRate))) / sampleRate; shellPhase -= Math.floor(shellPhase);
            body = Math.sin(2 * Math.PI * shellPhase) * Math.exp(-age / shellTau) * shell * 1.1 * Math.min(1, age / 8);
          }
          age++;
          outL[i] = Math.tanh((L + body) * amp) * out;
          outR[i] = Math.tanh((R + body) * amp) * out;
        }
        // finished when what rings has fallen far below hearing (and the shell is over), so a quiet voice stops costing anything
        if (age > shellTau * 5 && age > sampleRate * 0.05) {
          let e = 0; for (let k = 0; k < used; k++) e += y1[k] * y1[k] + y2[k] * y2[k];
          if (e * amp * amp < 1e-14 || amp < 1e-5) { active = false; y1.fill(0); y2.fill(0); }
        }
      },
    };
  },
};
