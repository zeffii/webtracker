// Env 2: a control envelope you draw as a Bezier spline in the panel under the parameters (the same drawing as drum synth 2's).
// A note on plays it once from the start: `time` ms from the first anchor to the last, then it holds its last level. With `loop` on it
// starts again at the end, so it can be a wave of your own. The output is the drawing (0 to 1) times `amount`; `vel` is how much the note's
// velocity scales it. A note off does nothing (it is a one-shot); a note cut sets it to the first level again.
// Wire it where the ADSR env goes: an oscillator's fm, a gain's cv, a filter's cutoff.
import { envelopeTable, readEnvelope, cleanSpline, SHAPES } from './bezier.js';

const TIME = 0, AMOUNT = 1, LOOP = 2, VEL = 3;
const DEFAULT = () => [{ x: 0, y: 1, l: null, r: [0.03, -0.5] }, { x: 1, y: 0, l: [-0.55, 0], r: null }];

export default {
  type: 'env2',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'env2',
  editor: 'env2',
  kinds: { out: 'control' },
  params: [
    { name: 'time', min: 1, max: 20000, def: 300 },     // ms from the first anchor to the last
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'loop', min: 0, max: 1, def: 0, int: true },
    { name: 'vel', min: 0, max: 1, def: 0 },
  ],
  create({ sampleRate, data }) {
    let table = envelopeTable(cleanSpline(data?.env?.main, DEFAULT));
    let pos = 1e9, velocity = 1, started = false;   // samples since the note on
    return {
      // { type: 'env', slot: 'main', points }: the drawing
      message(msg) { if (msg.type === 'env' && msg.slot === 'main') table = envelopeTable(cleanSpline(msg.points, DEFAULT)); },
      note(msg) {
        if (msg.type === 'noteOn') { pos = 0; velocity = msg.vel ?? 1; started = true; }
        else if (msg.type === 'noteCut') { pos = 0; started = false; }
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], len = Math.max(1, params[slots[TIME]] * 0.001 * sampleRate), loop = params[slots[LOOP]] >= 0.5;
        const scale = params[slots[AMOUNT]] * (1 - params[slots[VEL]] + params[slots[VEL]] * velocity);
        for (let i = 0; i < n; i++) {
          let x = pos / len;
          if (loop && x >= 1) { pos -= len * Math.floor(x); x -= Math.floor(x); }
          out[i] = readEnvelope(table, started ? x : 0) * scale * (started ? 1 : 0);
          pos += 1;
        }
        if (pos > 1e12) pos = 1e9;
      },
    };
  },
};
export { DEFAULT as DEFAULT_ENV2 };
