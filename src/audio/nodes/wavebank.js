// The wave bank of the vector nodes (compass, waveseq): the 256 single-cycle waves the wavetable synth also starts with, each kept
// in several band-limited copies so a wave stays clean up the keyboard.
//
// A copy keeps only the first so-many harmonics (HARMONICS). The player picks the copy whose top harmonic still sits under
// half the sample rate at the pitch it plays (levelFor). Copies are made the first time a wave is asked for and then shared
// by every node and every voice.
import { fftPlan } from '../fft.js';
import { FRAME, braidsFrames } from './wtutil.js';

export const WAVE_COUNT = 256;
export const HARMONICS = [256, 128, 64, 32, 16, 8, 4];   // per copy, the brightest first
const TOP = 0.45;   // the highest harmonic allowed, as a share of the sample rate

const copies = new Map();   // wave number -> [Float32Array(FRAME + 1), ...], one per entry of HARMONICS

export const cleanWave = index => Math.max(0, Math.min(WAVE_COUNT - 1, Math.round(Number(index) || 0)));

// One cycle of a wave as drawn (FRAME points, not band-limited): for the pictures in the panels.
export function waveShape(index) {
  const start = cleanWave(index) * FRAME;
  return braidsFrames().subarray(start, start + FRAME);
}

// The band-limited copies of one wave. Each has FRAME + 1 points: the last repeats the first, so reading between two
// points never has to wrap.
export function waveCopies(index) {
  const wave = cleanWave(index);
  let made = copies.get(wave);
  if (made) return made;
  const plan = fftPlan(FRAME), shape = waveShape(wave);
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) re[i] = shape[i];
  plan.run(re, im);
  made = HARMONICS.map(keep => {
    const cutRe = Float64Array.from(re), cutIm = Float64Array.from(im);
    for (let bin = keep; bin <= FRAME - keep; bin++) { cutRe[bin] = 0; cutIm[bin] = 0; }   // bins above `keep`, and their mirror images
    cutRe[0] = 0; cutIm[0] = 0;
    plan.run(cutRe, cutIm, true);
    const copy = new Float32Array(FRAME + 1);
    for (let i = 0; i < FRAME; i++) copy[i] = cutRe[i];
    copy[FRAME] = copy[0];
    return copy;
  });
  copies.set(wave, made);
  return made;
}

// Which copy to play at `inc` (cycles per sample): the brightest one whose top harmonic stays under TOP.
export function levelFor(inc) {
  const allowed = TOP / Math.max(1e-9, inc);
  let level = 0;
  while (level < HARMONICS.length - 1 && HARMONICS[level] > allowed) level++;
  return level;
}

// A copy read at `phase` (0 to 1), between its two nearest points.
export function readWave(copy, phase) {
  const x = phase * FRAME, k = x | 0;
  return copy[k] + (copy[k + 1] - copy[k]) * (x - k);
}
