// A drawn envelope (a Bezier spline, see bezier.js) played by a note: the part a synth needs to use a drawing where it would
// otherwise have an ADSR. It behaves as the env2 node does:
//
//   with a sustain knot   it plays up to the knot and waits there while the note is held. When the note ends it plays on
//                         from the knot to the last anchor. A note that ends before the knot is reached fades in a straight
//                         line from the level it has got to, to the last anchor's level, in the length of the release (no
//                         less than 10 ms and no more than 60 ms).
//   without one           it is one shot: it plays through and a note off changes nothing.
//
// A new note starts from where the envelope was, if it was sounding, and slides to the drawing in 2 ms, so a retrigger
// never clicks. `idle` is true before the first note and once the drawing has played to its end; from then on the envelope
// stays at the last anchor's level (0 before the first note and after a cut).
import { envelopeTable, readEnvelope, cleanSpline, sustainKnot } from './bezier.js';

const IDLE = 0, RUN = 1, HOLD = 2, RELEASE = 3, FADE = 4, ENDED = 5;
const FADE_MIN_S = 0.01, FADE_MAX_S = 0.06, SLIDE_S = 0.002;

export class BezierEnvelope {
  // fallback: a function returning the drawing used until one is set (and when a stored one is broken)
  constructor(sampleRate, fallback) {
    this.sampleRate = sampleRate;
    this.fallback = fallback;
    this.slide = Math.exp(-1 / (SLIDE_S * sampleRate));
    this.length = sampleRate;   // samples from the first anchor to the last
    this.phase = IDLE;
    this.position = 0;          // samples into the drawing
    this.value = 0;             // the last value given out
    this.shape = 0;             // the drawing's own level now (without the slide in)
    this.offset = 0;            // what is left of the slide from the level before the note
    this.fadeFrom = 0; this.fadeLeft = 0; this.fadeLength = 1;
    this.setDrawing(null);
  }

  setDrawing(points) {
    const clean = cleanSpline(points, this.fallback);
    this.table = envelopeTable(clean);
    this.knot = sustainKnot(clean);
    this.endLevel = this.table[this.table.length - 1];
  }

  // how long the whole drawing takes, in ms
  setTime(ms) { this.length = Math.max(1, ms * 0.001 * this.sampleRate); }

  get idle() { return this.phase === IDLE || this.phase === ENDED; }

  on() {
    this.offset = this.phase === IDLE ? 0 : this.value - readEnvelope(this.table, 0);
    this.phase = RUN;
    this.position = 0;
  }

  off() {
    if (!this.knot || (this.phase !== RUN && this.phase !== HOLD)) return;   // a one shot plays through
    if (this.phase === HOLD) { this.position = this.knot.x * this.length; this.phase = RELEASE; return; }
    // let go before the knot was reached: a short straight fade from here
    const release = ((1 - this.knot.x) * this.length) / this.sampleRate;
    this.fadeLength = this.fadeLeft = Math.round(Math.min(FADE_MAX_S, Math.max(FADE_MIN_S, release)) * this.sampleRate);
    this.fadeFrom = this.shape;
    this.phase = FADE;
  }

  cut() { this.phase = IDLE; this.value = 0; this.offset = 0; }

  // the next value, one sample on
  next() {
    if (this.phase === IDLE) return 0;
    let x = this.position / this.length;
    if (this.phase === RUN && this.knot && x >= this.knot.x) { this.phase = HOLD; x = this.knot.x; }
    if (this.phase === ENDED) this.shape = this.endLevel;
    else if (this.phase === FADE) {
      this.shape = this.endLevel + (this.fadeFrom - this.endLevel) * (this.fadeLeft / this.fadeLength);
      if (--this.fadeLeft < 0) this.phase = ENDED;
    } else {
      this.shape = readEnvelope(this.table, x);
      if (x >= 1) this.phase = ENDED;
      else if (this.phase !== HOLD) this.position += 1;   // at the knot it waits
    }
    this.offset *= this.slide;
    this.value = this.shape + this.offset;
    return this.value;
  }
}
