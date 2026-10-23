// Woodblock. A struck piece of wood: a short burst of noise (the strike) rings four resonant modes at inharmonic
// ratios, and the energy leaks out of them as they ring. `damping` is how long the lowest mode takes to fall by 60 dB;
// `loss` makes each higher mode leak faster, so a hit goes from a bright click to a dull knock. `hardness` is the
// stick: a hard strike excites the high modes, a soft one only the low ones, and a harder note (velocity) is brighter.
// `inharm` spreads the modes away from their natural ratios. The pitch follows the note from `root` when `keytrack`
// is 1; `tone` is the lowest mode's frequency at the root. Two envelopes, both ADSRs you draw beside the node: the
// volume one shapes the whole sound, the pitch one moves every mode by `bend` semitones (it starts high and falls).
// Monophonic per node, last note wins; the voices node makes it polyphonic.
import { Adsr } from './adsr.js';

const SPEC = [
  { name: 'tone', min: 100, max: 4000, def: 900 },          // Hz of the lowest mode at the root note
  { name: 'keytrack', min: 0, max: 1, def: 1, int: true },
  { name: 'root', min: 0, max: 127, def: 60 },
  { name: 'inharm', min: 0, max: 1, def: 0.3 },
  { name: 'hardness', min: 0, max: 1, def: 0.6 },
  { name: 'damping', min: 5, max: 1500, def: 140 },        // ms, lowest mode to -60 dB
  { name: 'loss', min: 0, max: 1, def: 0.6 },
  { name: 'bend', min: 0, max: 24, def: 4 },               // semitones the pitch envelope adds
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
  { name: 'attack', min: 0.1, max: 500, def: 0.1 },
  { name: 'decay', min: 1, max: 2000, def: 160 },
  { name: 'sustain', min: 0, max: 1, def: 0 },
  { name: 'release', min: 1, max: 2000, def: 40 },
  { name: 'patk', min: 0.1, max: 500, def: 0.1 },
  { name: 'pdec', min: 1, max: 2000, def: 22 },
  { name: 'psus', min: 0, max: 1, def: 0 },
  { name: 'prel', min: 1, max: 2000, def: 20 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });
const RATIO = [1, 1.52, 2.31, 3.38];   // the modes of a small block of wood, roughly
const STRIDE = 16;                     // the resonators' tuning is updated every 16 samples while the pitch moves

export default {
  type: 'woodblock',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }, { atk: 'patk', dec: 'pdec', sus: 'psus', rel: 'prel' }],
  shape: 'rounded',
  glyph: 'woodblock',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const amp = new Adsr(sampleRate), pit = new Adsr(sampleRate);
    const s = new Float64Array(4), c = new Float64Array(4), e = new Float64Array(4), r = new Float64Array(4), gain = new Float64Array(4);
    let note = 60, velocity = 1, strike = 0, strikeDecay = 0.9, lp = 0, hit = false, noise = 0x9e3779b9;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; hit = true; amp.on(); pit.on(); }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); pit.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); pit.cut(); s.fill(0); c.fill(0); strike = 0; hit = false; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle && !hit && strike < 1e-5 && !s.some(v => Math.abs(v) > 1e-6)) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('attack'), g('decay'), g('sustain'), g('release'));
        pit.set(g('patk'), g('pdec'), g('psus'), g('prel'));
        const damping = g('damping'), loss = g('loss'), bend = g('bend'), inharm = g('inharm'), hard = g('hardness');
        const keyed = g('keytrack') >= 1 ? Math.pow(2, (note - g('root')) / 12) : 1;
        const base = g('tone') * keyed;
        const v = 1 - g('vel') + g('vel') * velocity;
        const level = g('level') * v * 0.5;
        const bright = 0.25 + 0.7 * hard * (0.5 + 0.5 * velocity);   // each mode is this much quieter than the one below it
        for (let k = 0; k < 4; k++) {
          gain[k] = Math.pow(bright, k);
          r[k] = Math.exp(-6.9078 / (Math.max(1, damping / (1 + loss * 3 * k)) * 0.001 * sampleRate));   // 60 dB in damping ms, shorter for the higher modes
        }
        if (hit) {   // the strike: a burst of noise, shorter and brighter for a hard stick
          hit = false; strike = v;
          strikeDecay = Math.exp(-1 / (sampleRate * (0.0012 - 0.0009 * hard)));
        }
        const cut = 0.15 + 0.8 * hard;   // one-pole low-pass on the burst: a soft stick is muffled
        for (let i = 0; i < n; i++) {
          if ((i & (STRIDE - 1)) === 0) {
            const pe = pit.level, f = base * Math.pow(2, bend * pe / 12);
            for (let k = 0; k < 4; k++) {
              const fk = Math.min(sampleRate * 0.45, f * RATIO[k] * (1 + inharm * 0.07 * k * (k % 2 ? 1 : -0.6)));
              e[k] = 2 * Math.sin(Math.PI * fk / sampleRate);
            }
          }
          pit.next();
          noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
          lp += cut * (((noise >>> 0) / 2147483648 - 1) - lp);
          const x = lp * strike * 0.6;
          strike *= strikeDecay;
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            c[k] -= e[k] * s[k];
            s[k] += e[k] * c[k] + x * gain[k];
            s[k] *= r[k]; c[k] *= r[k];
            sum += s[k];
          }
          const y = sum * level * amp.next() * 4;
          outL[i] = y; outR[i] = y;
        }
        if (!Number.isFinite(s[0] + s[1] + s[2] + s[3] + c[0] + c[1] + c[2] + c[3])) { s.fill(0); c.fill(0); }
        for (let k = 0; k < 4; k++) if (Math.abs(s[k]) < 1e-9 && Math.abs(c[k]) < 1e-9) { s[k] = 0; c[k] = 0; }
      },
    };
  },
};
