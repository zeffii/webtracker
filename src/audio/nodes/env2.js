// Env 2: a control envelope you draw as a Bezier spline in the panel under the parameters (the same drawing as drum synth 2's).
// A note on plays it from the first anchor, over `time` ms in all. What happens at the end of the note depends on the drawing:
//   with a sustain knot   it plays up to the knot and waits there while the note is held. When the note ends (a note off, or `length`) it
//                         plays on from the knot to the last anchor. A note that ends before the knot is reached fades out in a straight line
//                         from the level it has got to, to the last anchor's level, in the length of the release (but no less than 10 ms and
//                         no more than 60 ms), so a short note ends quickly and never jumps.
//   without one           it is one shot: it plays through, then holds its last level, and a note off changes nothing. With `loop` on it
//                         starts again at its end, so it can be a wave of your own.
// `length` is optional: 0 leaves it out, and the note off ends the note. A number of ticks written in its pattern lane ends each note
// that long after it begins, as if the note off had come then (0 puts it back to the note off).
// The output is the drawing (0 to 1) times `amount`; `vel` is how much the note's velocity scales it. A new note starts from where the
// output was, if it was sounding, and slides to the drawing's first level in 2 ms, so a retrigger never clicks. From silence it starts at once.
import { envelopeTable, readEnvelope, cleanSpline, sustainKnot } from './bezier.js';

const TIME = 0, AMOUNT = 1, LOOP = 2, VEL = 3, LENGTH = 4;
const DEFAULT = () => [{ x: 0, y: 1, l: null, r: [0.03, -0.5] }, { x: 1, y: 0, l: [-0.55, 0], r: null }];
const IDLE = 0, RUN = 1, HOLD = 2, RELEASE = 3, FADE = 4;
const FADE_MIN = 0.01, FADE_MAX = 0.06;   // seconds

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
    { name: 'length', min: 0, max: 256, def: 0, int: true },   // ticks, 0: the note off ends the note
  ],
  create({ sampleRate, data, clock }) {
    let points = cleanSpline(data?.env?.main, DEFAULT), table = envelopeTable(points), knot = sustainKnot(points);
    let phase = IDLE, pos = 0, velocity = 1, left = Infinity, fresh = false, pendingOff = false;
    let shape = 0, last = 0, offset = 0, fadeFrom = 0, fadeLeft = 0, fadeLen = 1;   // shape: the drawing's value now; last: the output; offset: the slide in from the last output
    const setDrawing = raw => { points = cleanSpline(raw, DEFAULT); table = envelopeTable(points); knot = sustainKnot(points); };
    const letGo = len => {   // the note has ended
      if (!knot || (phase !== RUN && phase !== HOLD)) return;   // a one shot plays through
      if (phase === RUN) {   // ended before the knot: a straight fade from here to the last anchor's level
        fadeLen = fadeLeft = Math.round(Math.min(FADE_MAX, Math.max(FADE_MIN, (1 - knot.x) * len / sampleRate)) * sampleRate);
        fadeFrom = shape; phase = FADE; return;
      }
      pos = knot.x * len; phase = RELEASE;
    };
    return {
      // { type: 'env', slot: 'main', points }: the drawing
      message(msg) { if (msg.type === 'env' && msg.slot === 'main') setDrawing(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') { fresh = true; pendingOff = false; velocity = msg.vel ?? 1; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') pendingOff = true;
        else if (msg.type === 'noteCut') { phase = IDLE; last = 0; offset = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const o = outputs[0], len = Math.max(1, params[slots[TIME]] * 0.001 * sampleRate), loop = params[slots[LOOP]] >= 0.5;
        const gain = params[slots[AMOUNT]] * (1 - params[slots[VEL]] + params[slots[VEL]] * velocity), ticks = Math.round(params[slots[LENGTH]]);
        const slide = Math.exp(-1 / (0.002 * sampleRate));
        if (fresh) {   // a new note: from where the output was
          fresh = false;
          offset = Math.abs(last) > 1e-3 ? last - readEnvelope(table, 0) * gain : 0;   // from where it was, if it was sounding
          phase = RUN; pos = 0;
          left = ticks > 0 ? Math.max(1, Math.round(ticks * (clock?.tickSamples ?? sampleRate * 0.125))) : Infinity;
        }
        for (let i = 0; i < n; i++) {
          if (phase === IDLE) { o[i] = 0; continue; }
          if (pendingOff) { pendingOff = false; letGo(len); }
          if (left !== Infinity && --left === 0) letGo(len);   // `length` ran out: the same as a note off
          let x = pos / len;
          if (phase === RUN) {
            if (knot && x >= knot.x) { phase = HOLD; pos = knot.x * len; x = knot.x; }
            else if (!knot && loop && x >= 1) { pos -= len * Math.floor(x); x -= Math.floor(x); }
          }
          if (phase === FADE) { shape = table[table.length - 1] + (fadeFrom - table[table.length - 1]) * (fadeLeft / fadeLen); if (fadeLeft > 0) fadeLeft--; }
          else shape = readEnvelope(table, x);
          last = shape * gain;
          offset *= slide;
          o[i] = last + offset;
          if (phase === RUN || phase === RELEASE) pos += 1;
        }
        if (Math.abs(offset) < 1e-9) offset = 0;
      },
    };
  },
};
export { DEFAULT as DEFAULT_ENV2 };
