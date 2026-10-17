// Four-operator FM synth. Each operator is a phase-modulation oscillator reading a single-cycle waveform you draw
// (the wave editor in the panel; a sine until you change it) with its own ratio, level and ADSR envelope. The
// algorithm says who modulates whom; the operators that feed the output are the carriers. Operator 4 can modulate
// itself (feedback). Modulation is in cycles of the receiving operator: index scales every modulator, and a
// modulator's own level and envelope shape how much of it gets through, so envelopes bring brightness in and out.
// Monophonic, last note wins, with glide; the voices node makes it polyphonic.
import { Adsr } from './adsr.js';
import { WAVE_POINTS, OPERATORS, normalizeWaves } from './waves.js';

// Each algorithm: mods are [receiver, sender] pairs (the sender has the higher number, so operators are
// worked out 4, 3, 2, 1), carriers are the operators you hear. Numbers are 0 based here, 1 based on screen.
export const ALGORITHMS = [
  { name: '4>3>2>1', mods: [[2, 3], [1, 2], [0, 1]], carriers: [0] },
  { name: '(4>3)+2>1', mods: [[2, 3], [0, 2], [0, 1]], carriers: [0] },
  { name: '4+3+2>1', mods: [[0, 1], [0, 2], [0, 3]], carriers: [0] },
  { name: '2>1  4>3', mods: [[0, 1], [2, 3]], carriers: [0, 2] },
  { name: '4>1,2,3', mods: [[0, 3], [1, 3], [2, 3]], carriers: [0, 1, 2] },
  { name: '3>2>1  4', mods: [[1, 2], [0, 1]], carriers: [0, 3] },
  { name: '2>1  3  4', mods: [[0, 1]], carriers: [0, 2, 3] },
  { name: 'all carriers', mods: [], carriers: [0, 1, 2, 3] },
];

const SPEC = [
  { name: 'algo', min: 0, max: ALGORITHMS.length - 1, def: 0, int: true },
  { name: 'index', min: 0, max: 8, def: 2 },        // modulation depth, in cycles
  { name: 'fb', min: 0, max: 1, def: 0 },           // operator 4 modulating itself
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'glide', min: 0, max: 2000, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },        // how much velocity scales the level (and so the brightness)
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const RATIOS = [1, 1, 2, 1], LEVELS = [1, 0.7, 0.5, 0.4];
for (let k = 1; k <= OPERATORS; k++) {
  SPEC.push(
    { name: `ratio${k}`, min: 0.25, max: 16, def: RATIOS[k - 1] },
    { name: `fine${k}`, min: -100, max: 100, def: 0 },     // cents
    { name: `level${k}`, min: 0, max: 1, def: LEVELS[k - 1] },
    { name: `atk${k}`, min: 0.1, max: 5000, def: 2 },     // ms
    { name: `dec${k}`, min: 1, max: 5000, def: 300 },
    { name: `sus${k}`, min: 0, max: 1, def: k === 1 ? 0.8 : 0.4 },
    { name: `rel${k}`, min: 1, max: 5000, def: 200 },
  );
}
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'fmsynth',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [1, 2, 3, 4].map(k => ({ atk: `atk${k}`, dec: `dec${k}`, sus: `sus${k}`, rel: `rel${k}` })),   // one envelope per operator   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'fmsynth',
  editor: 'wave',   // the patcher panel offers the operator wave editor for this node
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data }) {
    const pitchOn = connected[0];
    let tables = normalizeWaves(data?.waves);
    const env = Array.from({ length: OPERATORS }, () => new Adsr(sampleRate));
    const phase = new Float64Array(OPERATORS), inc = new Float64Array(OPERATORS), lvl = new Float64Array(OPERATORS);
    const out = new Float64Array(OPERATORS), carrier = new Float64Array(OPERATORS), modm = new Float64Array(OPERATORS * OPERATORS);
    let note = 60, pos = 60, velocity = 1, fbPrev = 0, fbPrev2 = 0;
    const idle = () => env.every(e => e.idle);
    return {
      message(msg) { if (msg.type === 'waves') tables = normalizeWaves(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (idle()) { phase.fill(0); fbPrev = fbPrev2 = 0; pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          for (const e of env) e.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') for (const e of env) e.off();
        else if (msg.type === 'noteCut') for (const e of env) e.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (idle()) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const alg = ALGORITHMS[Math.min(ALGORITHMS.length - 1, Math.max(0, Math.round(g('algo'))))];
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const f0 = 440 * Math.pow(2, (pos + g('tune') - 69) / 12) * (pitchOn ? Math.pow(2, inputs[0][0]) : 1);
        const index = g('index'), fb = g('fb') * 0.5;
        const vm = 1 - g('vel') + g('vel') * velocity;
        carrier.fill(0); modm.fill(0);
        for (const c of alg.carriers) carrier[c] = 1;
        for (const [to, from] of alg.mods) modm[to * OPERATORS + from] = 1;
        for (let k = 0; k < OPERATORS; k++) {
          env[k].set(g(`atk${k + 1}`), g(`dec${k + 1}`), g(`sus${k + 1}`), g(`rel${k + 1}`));
          inc[k] = (f0 * g(`ratio${k + 1}`) * Math.pow(2, g(`fine${k + 1}`) / 1200)) / sampleRate;
          lvl[k] = g(`level${k + 1}`) * vm;
          if (inc[k] >= 0.5) inc[k] = 0;   // above Nyquist: silent instead of aliasing noise
        }
        const mix = (g('level') * 0.5) / Math.sqrt(alg.carriers.length);
        const last = OPERATORS - 1;
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let k = last; k >= 0; k--) {
            let m = 0;
            for (let s = k + 1; s < OPERATORS; s++) m += modm[k * OPERATORS + s] * out[s];
            let p = phase[k] + m * index + (k === last ? fb * (fbPrev + fbPrev2) : 0);
            p -= Math.floor(p);
            const x = p * WAVE_POINTS, j = x | 0, f = x - j, t = tables[k];
            const w = t[j] + (t[(j + 1) & (WAVE_POINTS - 1)] - t[j]) * f;
            const o = w * env[k].next() * lvl[k];
            out[k] = o;
            if (k === last) { fbPrev2 = fbPrev; fbPrev = o; }
            sum += o * carrier[k];
            let ph = phase[k] + inc[k];
            if (ph >= 1) ph -= 1;
            phase[k] = ph;
          }
          outL[i] = outR[i] = sum * mix;
        }
      },
    };
  },
};
