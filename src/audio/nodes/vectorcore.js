// Vector synthesis and wave sequencing: what the compass synth and its building blocks (waveseq, vecmix, vecpath) share.
//
// THE DIAMOND
//   Four sources sit at the points of a diamond: A left, B top, C right, D bottom. A position (x, y), each from -1 to 1,
//   says how much of each is heard: at a point only that source, in the middle a quarter of each. The four shares always
//   add up to 1 (diamondWeights).
//
// THE PATH
//   A list of up to MAX_POINTS positions the mix travels through after a note starts: [{ x, y, d }]. `d` is how long the
//   stretch that ARRIVES at the point takes, as a share of the whole trip (the shares are weighed against each other, so
//   they need not add up to anything). The first point's `d` is only used when the path loops: it is the stretch from the
//   last point back to the first. pathAt gives the position at any time.
//
// THE WAVE SEQUENCE
//   A lane is a list of up to MAX_STEPS steps: [{ w, len, fade, semi, lvl }]. Each step plays wave `w` of the wave bank
//   for `len` ticks, `semi` semitones away from the note, at level `lvl`. `fade` (0 to 1) is how much of the step is
//   spent crossfading in from the step before: 0 switches at once, 1 fades for the whole step. A lane of one step is a
//   plain oscillator. LanePlayer plays one lane.
import { waveCopies, levelFor, readWave, cleanWave } from './wavebank.js';

export const MAX_POINTS = 8, MAX_STEPS = 16, MAX_LEN = 64;
export const LANES = ['A', 'B', 'C', 'D'];
export const PATH_MODES = ['once', 'loop', 'back and forth'];
export const SEQ_MODES = ['once', 'loop', 'back and forth'];
const ONCE = 0, LOOP = 1, BOUNCE = 2;
const MIN_FADE_SAMPLES = 48;   // even a step that "switches at once" takes this long, so it never clicks

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const number = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// ---------------------------------------------------------------------------------------------------------------- diamond

// A position pulled back onto the diamond when it lies outside it. Returns [x, y].
export function insideDiamond(x, y) {
  const reach = Math.abs(x) + Math.abs(y);
  return reach > 1 ? [x / reach, y / reach] : [x, y];
}

// The shares of A, B, C and D at (x, y), written into `out` (4 numbers).
export function diamondWeights(x, y, out) {
  const [px, py] = insideDiamond(x, y);
  // the diamond is a square turned 45 degrees: p runs from the A-D side to the B-C side, q from the D-C side to the A-B side
  const p = (px + py + 1) / 2, q = (py - px + 1) / 2;
  out[0] = (1 - p) * q;         // A, left
  out[1] = p * q;               // B, top
  out[2] = p * (1 - q);         // C, right
  out[3] = (1 - p) * (1 - q);   // D, bottom
  return out;
}

// ------------------------------------------------------------------------------------------------------------------- path

// A slow tour of the four points: what a new node starts with.
export const DEFAULT_PATH = () => [{ x: -1, y: 0, d: 1 }, { x: 0, y: 1, d: 1 }, { x: 1, y: 0, d: 1 }, { x: 0, y: -1, d: 1 }];

// Whatever was stored becomes a clean path: 1 to MAX_POINTS points, each on the diamond, each with a duration above 0.
export function cleanPath(raw) {
  if (!Array.isArray(raw)) return DEFAULT_PATH();
  const points = raw.filter(p => p && typeof p === 'object').slice(0, MAX_POINTS).map(p => {
    const [x, y] = insideDiamond(clamp(number(p.x, 0), -1, 1), clamp(number(p.y, 0), -1, 1));
    return { x, y, d: clamp(number(p.d, 1), 0.01, 100) };
  });
  return points.length ? points : DEFAULT_PATH();
}

// The position on the path at `time`, where 1 is one whole trip. Written into `out` as [x, y].
//   once            from the first point to the last, then it stays there
//   loop            round and round, going from the last point back to the first
//   back and forth  to the last point and back the way it came
export function pathAt(path, mode, time, out) {
  const count = path.length;
  if (count === 1 || time <= 0) { out[0] = path[0].x; out[1] = path[0].y; return out; }
  const closed = mode === LOOP;
  let total = 0;
  for (let i = closed ? 0 : 1; i < count; i++) total += path[i].d;
  let along;   // how far along the trip, 0 to 1
  if (mode === ONCE) along = Math.min(1, time);
  else if (mode === LOOP) along = time - Math.floor(time);
  else { const turn = time - 2 * Math.floor(time / 2); along = turn <= 1 ? turn : 2 - turn; }
  let left = along * total;
  // the stretches in the order they are travelled: 0 -> 1, 1 -> 2 ... and, when closed, last -> 0
  const stretches = closed ? count : count - 1;
  for (let s = 0; s < stretches; s++) {
    const from = path[s], to = path[(s + 1) % count], length = to.d;
    if (left <= length || s === stretches - 1) {
      const t = clamp(left / length, 0, 1);
      out[0] = from.x + (to.x - from.x) * t; out[1] = from.y + (to.y - from.y) * t;
      return out;
    }
    left -= length;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ lanes

// The plainest waves of the bank, one step each: what a new compass starts with (a sine, a saw, a square and a triangle).
const DEFAULT_WAVES = [176, 172, 173, 179];
export const DEFAULT_STEP = wave => ({ w: wave, len: 4, fade: 0.5, semi: 0, lvl: 1 });
export const DEFAULT_LANE = (lane = 0) => [DEFAULT_STEP(DEFAULT_WAVES[lane] ?? 0)];
export const DEFAULT_LANES = () => LANES.map((_, i) => DEFAULT_LANE(i));

export function cleanStep(raw) {
  const step = raw && typeof raw === 'object' ? raw : {};
  return {
    w: cleanWave(step.w),
    len: clamp(Math.round(number(step.len, 4)), 1, MAX_LEN),
    fade: clamp(number(step.fade, 0.5), 0, 1),
    semi: clamp(Math.round(number(step.semi, 0)), -24, 24),
    lvl: clamp(number(step.lvl, 1), 0, 1),
  };
}

// One lane: 1 to MAX_STEPS clean steps.
export function cleanLane(raw, lane = 0) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_LANE(lane);
  return raw.slice(0, MAX_STEPS).map(cleanStep);
}

// `count` lanes from whatever was stored.
export function cleanLanes(raw, count = LANES.length) {
  return Array.from({ length: count }, (_, i) => cleanLane(Array.isArray(raw) ? raw[i] : null, i));
}

export const laneTicks = lane => lane.reduce((sum, step) => sum + step.len, 0);

// One wave being played: its copies in the bank, where it is in its cycle, and how it is tuned and levelled.
class WaveVoice {
  constructor() { this.copies = waveCopies(0); this.copy = this.copies[0]; this.phase = 0; this.ratio = 1; this.level = 1; this.inc = 0; }
  load(step) { this.copies = waveCopies(step.w); this.ratio = Math.pow(2, step.semi / 12); this.level = step.lvl; }
  // inc: the lane's own pitch in cycles per sample, before the step's transposition
  tune(inc) { this.inc = Math.min(0.45, inc * this.ratio); this.copy = this.copies[levelFor(this.inc)]; }
  next() {
    const value = readWave(this.copy, this.phase) * this.level;
    this.phase += this.inc;
    if (this.phase >= 1) this.phase -= 1;
    return value;
  }
}

// Plays one lane. Per block: tune(inc), then next(ticksPerSample) for every sample.
export class LanePlayer {
  constructor(lane = 0) {
    this.now = new WaveVoice();      // the step that is playing
    this.before = new WaveVoice();   // the step it is fading in from
    this.setSteps(DEFAULT_LANE(lane));
    this.start();
  }

  setSteps(steps) {
    this.steps = steps;
    if (this.index >= steps.length) this.index = steps.length - 1;
    if (this.index !== undefined) this.now.load(steps[this.index]);   // an edit to the step that is playing is heard at once
  }

  // Back to the first step, with nothing to fade in from. keepPhase: the waves carry on from where they were (a retrigger).
  start(keepPhase = false) {
    this.index = 0; this.direction = 1; this.ticks = 0; this.fadeLeft = 0; this.fadeLength = 1; this.inc = 0;
    if (!keepPhase) this.now.phase = 0;
    this.now.load(this.steps[0]);
  }

  // The step after the one playing, or -1 when the lane stays where it is.
  following(mode) {
    const last = this.steps.length - 1;
    if (last === 0) return -1;
    if (mode === LOOP) return this.index === last ? 0 : this.index + 1;
    if (mode === BOUNCE) {
      if (this.index + this.direction > last || this.index + this.direction < 0) this.direction = -this.direction;
      return this.index + this.direction;
    }
    return this.index === last ? -1 : this.index + 1;
  }

  advance(mode, ticksPerSample) {
    const next = this.following(mode);
    if (next < 0) { this.ticks = this.steps[this.index].len; return; }   // once: it stays on the last step
    this.ticks -= this.steps[this.index].len;
    // the playing step becomes the one faded out; the new one picks up its place in the cycle so that two steps
    // of the same pitch join without a jump
    const swap = this.before; this.before = this.now; this.now = swap;
    this.index = next;
    const step = this.steps[next];
    this.now.load(step); this.now.phase = this.before.phase;
    this.now.tune(this.inc); this.before.tune(this.inc);
    const stepSamples = step.len / Math.max(1e-9, ticksPerSample);
    this.fadeLength = this.fadeLeft = Math.max(MIN_FADE_SAMPLES, Math.round(step.fade * stepSamples));
  }

  tune(inc) { this.inc = inc; this.now.tune(inc); if (this.fadeLeft > 0) this.before.tune(inc); }

  // the next sample; ticksPerSample is how fast the sequence runs
  next(mode, ticksPerSample) {
    this.ticks += ticksPerSample;
    if (this.ticks >= this.steps[this.index].len) this.advance(mode, ticksPerSample);
    let value = this.now.next();
    if (this.fadeLeft > 0) {
      const old = this.fadeLeft / this.fadeLength;
      value = value * (1 - old) + this.before.next() * old;
      this.fadeLeft--;
    }
    return value;
  }
}
