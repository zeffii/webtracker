// Pulsar synth: a pulsar train (see pulsarcore.js) played from notes. Monophonic, the last note wins, with optional glide.
//   Pitch      the note sets the fundamental, the rate of the pulsarets; `tune` moves it, the `pitch` input is in octaves.
//   Formant    `formant` Hz is how fast each pulsaret plays, the colour of the sound. `track` makes it follow the note
//              (1: a fixed ratio to the pitch, so the timbre keeps its shape up the keyboard; 0: a fixed place). The `form` input
//              is in octaves. The drawn sweep moves the formant by up to `sweep` octaves over `sweepms` after each note starts.
//   Window     the drawn shape over every pulsaret (panel).
//   Texture    mask, jitter and scatter (see pulsarcore.js).
// Stereo out. Amplitude: attack, decay, sustain, release.
import { Adsr } from './adsr.js';
import { PulsarTrain } from './pulsarcore.js';
import { envelopeTable, readEnvelope, cleanSpline, SHAPES } from './bezier.js';

export const DEFAULT_SWEEP = SHAPES.fall;
const SPEC = [
  { name: 'formant', min: 40, max: 12000, def: 900 },      // Hz
  { name: 'track', min: 0, max: 1, def: 0.4 },
  { name: 'wave', min: 0, max: 5, def: 0, int: true },
  { name: 'tune', min: -24, max: 24, def: 0 },             // semitones
  { name: 'sweep', min: -4, max: 4, def: 1.5 },            // octaves the drawn sweep adds to the formant at its top
  { name: 'sweepms', min: 5, max: 5000, def: 400 },
  { name: 'mask', min: 0, max: 1, def: 0 },
  { name: 'jitter', min: 0, max: 1, def: 0 },
  { name: 'scatter', min: 0, max: 1, def: 0.4 },
  { name: 'glide', min: 0, max: 2000, def: 0 },            // ms
  { name: 'atk', min: 0.1, max: 5000, def: 2 },
  { name: 'dec', min: 1, max: 5000, def: 300 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 200 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'pulsar',
  inputs: ['pitch', 'form'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }],
  shape: 'rounded',
  glyph: 'pulsar',
  editor: 'pulsar',
  kinds: { pitch: 'control', form: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data }) {
    const pitchOn = connected[0], formOn = connected[1];
    const amp = new Adsr(sampleRate), train = new PulsarTrain();
    let sweepTable = envelopeTable(cleanSpline(data?.env?.sweep, DEFAULT_SWEEP));
    train.setWindow(data?.env?.window);
    let note = 60, pos = 60, velocity = 1, age = 0;
    return {
      get busy() { return !amp.idle; },   // a low note is silent for long stretches between pulsarets, so silence alone does not mean the release is over
      message(msg) {
        if (msg.type !== 'env') return;
        if (msg.slot === 'window') train.setWindow(msg.points);
        else if (msg.slot === 'sweep') sweepTable = envelopeTable(cleanSpline(msg.points, DEFAULT_SWEEP));
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { train.reset(); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1; age = 0;
          amp.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') amp.off();
        else if (msg.type === 'noteCut') amp.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const wave = Math.round(g('wave')), mask = g('mask'), jitter = g('jitter'), scatter = g('scatter');
        const sweepLen = Math.max(1, g('sweepms') * 0.001 * sampleRate), sweepOct = g('sweep');
        const baseHz = 440 * Math.pow(2, (pos + g('tune') - 69) / 12);
        const formantHz = g('formant') * Math.pow(2, (g('track') * (pos - 60)) / 12);
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 2;
        const nyq = sampleRate * 0.45;
        for (let i = 0; i < n; i++) {
          const a = amp.next();
          const fm = pitchOn ? Math.pow(2, inputs[0][i]) : 1;
          const oct = sweepOct * readEnvelope(sweepTable, age / sweepLen) + (formOn ? inputs[1][i] : 0);
          const fHz = Math.min(nyq, formantHz * Math.pow(2, oct));
          const v = train.step(Math.min(0.45, (baseHz * fm) / sampleRate), fHz / sampleRate, wave, mask, jitter, scatter);
          outL[i] = v[0] * a * level; outR[i] = v[1] * a * level;
          if (age < sweepLen) age++;
        }
      },
    };
  },
};

