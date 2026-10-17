// Wavetable synth. Two ways to get a wave, picked by `source`:
//   0 table: a stack of single-cycle frames; `position` (0 to 1) moves through it, blending the two frames it falls
//            between (`snap` 1 jumps from frame to frame instead). The table is the Braids oscillator's 256 waves
//            until you load another one cut from a sample (see the node's panel); it is kept on the node.
//   1 pair:  two waves of 512 points that you cut from any loaded sample (the panel picks the sample and where
//            in it); `mix` blends from A to B. Also kept on the node, so it does not depend on the sample afterwards.
// A second envelope (patk, pdec, psus, prel) times `pamt` moves the position (or the mix) over a note, and an LFO
// (`lfoRate`, `lfoDepth`) wobbles it. Amplitude has its own ADSR; the voices node makes it polyphonic.
// Monophonic, last note wins, with glide.
import { Adsr } from './adsr.js';
import { FRAME, braidsFrames, decodeFrames, defaultPair } from './wtutil.js';

const SPEC = [
  { name: 'source', min: 0, max: 1, def: 0, int: true },
  { name: 'position', min: 0, max: 1, def: 0.2 },
  { name: 'mix', min: 0, max: 1, def: 0 },
  { name: 'snap', min: 0, max: 1, def: 0, int: true },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'fine', min: -100, max: 100, def: 0 },       // cents
  { name: 'glide', min: 0, max: 2000, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
  { name: 'attack', min: 0.1, max: 5000, def: 3 },
  { name: 'decay', min: 1, max: 5000, def: 300 },
  { name: 'sustain', min: 0, max: 1, def: 0.8 },
  { name: 'release', min: 1, max: 5000, def: 250 },
  { name: 'pamt', min: -1, max: 1, def: 0 },           // how far the second envelope moves position / mix
  { name: 'patk', min: 0.1, max: 5000, def: 5 },
  { name: 'pdec', min: 1, max: 5000, def: 600 },
  { name: 'psus', min: 0, max: 1, def: 0 },
  { name: 'prel', min: 1, max: 5000, def: 300 },
  { name: 'lfoRate', min: 0.05, max: 20, def: 2 },     // Hz
  { name: 'lfoDepth', min: 0, max: 1, def: 0 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'wavetable',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }, { atk: 'patk', dec: 'pdec', sus: 'psus', rel: 'prel' }],
  shape: 'rounded',
  glyph: 'wavetable',
  editor: 'wavetable',   // the patcher panel offers the table and A/B pickers for this node
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, data }) {
    const load = text => (typeof text === 'string' && text.length ? decodeFrames(text) : null);
    const set = { table: load(data?.table) ?? braidsFrames(), pair: load(data?.pair) ?? defaultPair() };
    const ampEnv = new Adsr(sampleRate), posEnv = new Adsr(sampleRate);
    let phase = 0, note = 60, pos = 60, velocity = 1, lfo = 0;
    return {
      message(msg) {
        if (msg.type === 'table') set.table = load(msg.points) ?? braidsFrames();
        else if (msg.type === 'pair') set.pair = load(msg.points) ?? defaultPair();
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (ampEnv.idle) { phase = 0; lfo = 0; pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          ampEnv.on(); posEnv.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { ampEnv.off(); posEnv.off(); }
        else if (msg.type === 'noteCut') { ampEnv.cut(); posEnv.cut(); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (ampEnv.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        ampEnv.set(g('attack'), g('decay'), g('sustain'), g('release'));
        posEnv.set(g('patk'), g('pdec'), g('psus'), g('prel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const inc = (440 * Math.pow(2, (pos + g('tune') + g('fine') / 100 - 69) / 12)) / sampleRate;
        const level = g('level') * (1 - g('vel') + g('vel') * velocity);
        const pairMode = g('source') >= 0.5, snap = g('snap') >= 0.5;
        const frames = pairMode ? set.pair : set.table, count = frames.length / FRAME;
        const base = pairMode ? g('mix') : g('position'), amt = g('pamt'), depth = g('lfoDepth'), lfoInc = (2 * Math.PI * g('lfoRate')) / sampleRate;
        for (let i = 0; i < n; i++) {
          // the frame position for this sample: the base value moved by the second envelope and the LFO
          let p = base + amt * posEnv.next() + depth * 0.5 * Math.sin(lfo);
          lfo += lfoInc;
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          let fp = p * (count - 1);
          if (snap) fp = Math.round(fp);
          const k = Math.min(count - 2 < 0 ? 0 : count - 2, Math.floor(fp)), f = count > 1 ? fp - k : 0;
          const x = phase * FRAME, j = Math.floor(x), t = x - j, j1 = j + 1 >= FRAME ? 0 : j + 1;
          const a = frames[k * FRAME + j] + (frames[k * FRAME + j1] - frames[k * FRAME + j]) * t;
          let w = a;
          if (f > 0) {
            const b = frames[(k + 1) * FRAME + j] + (frames[(k + 1) * FRAME + j1] - frames[(k + 1) * FRAME + j]) * t;
            w = a + (b - a) * f;
          }
          outL[i] = outR[i] = w * ampEnv.next() * level;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
