// Pulse train: the pulsar oscillator on its own, for building a patch by hand (see pulsarcore.js for what the settings mean).
// Silent until the first note, like `osc`. `fm` moves the fundamental and `form` the formant, both in octaves. Stereo out, so
// `scatter` can place each pulsaret. Follows the note when `track` is on, otherwise plays `freq`.
import { PulsarTrain } from './pulsarcore.js';

const SPEC = [
  { name: 'freq', min: 1, max: 5000, def: 110 },           // Hz, used when track is 0
  { name: 'track', min: 0, max: 1, def: 1, int: true },
  { name: 'tune', min: -48, max: 48, def: 0 },             // semitones
  { name: 'formant', min: 40, max: 12000, def: 900 },      // Hz
  { name: 'wave', min: 0, max: 5, def: 0, int: true },
  { name: 'mask', min: 0, max: 1, def: 0 },
  { name: 'jitter', min: 0, max: 1, def: 0 },
  { name: 'scatter', min: 0, max: 1, def: 0 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'pulsetrain',
  inputs: ['fm', 'form'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'pulsar',
  editor: 'pulsetrain',
  kinds: { fm: 'control', form: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data }) {
    const fmOn = connected[0], formOn = connected[1];
    const train = new PulsarTrain();
    train.setWindow(data?.env?.window);
    let note = 60, started = false;
    return {
      message(msg) { if (msg.type === 'env' && msg.slot === 'window') train.setWindow(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') { if (!started) train.reset(); note = msg.note; started = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!started) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const base = g('track') >= 0.5 ? 440 * Math.pow(2, (note + g('tune') - 69) / 12) : g('freq') * Math.pow(2, g('tune') / 12);
        const wave = Math.round(g('wave')), mask = g('mask'), jitter = g('jitter'), scatter = g('scatter'), level = g('level');
        const formant = g('formant'), nyq = sampleRate * 0.45;
        for (let i = 0; i < n; i++) {
          const inc = Math.min(0.45, (base * (fmOn ? Math.pow(2, inputs[0][i]) : 1)) / sampleRate);
          const fHz = Math.min(nyq, formant * (formOn ? Math.pow(2, inputs[1][i]) : 1));
          const v = train.step(inc, fHz / sampleRate, wave, mask, jitter, scatter);
          outL[i] = v[0] * level; outR[i] = v[1] * level;
        }
      },
    };
  },
};
