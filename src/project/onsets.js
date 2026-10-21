// Onset detection for auto-slice: where do the hits in a sample start? Spectral flux (how much the spectrum grows from one short
// window to the next, in log magnitude), a threshold that follows the local average, peaks picked from it, and each peak pulled back
// to where the sound actually starts. Pure functions on the sample data, no state.
import { fft } from './spectrogram.js';

const SIZE = 1024, HOP = 256;

// The onsets between frames `from` and `to` of a sample (stereo is averaged), as frame numbers in increasing order.
// sensitivity 0..1: how small a rise still counts (higher finds more); minGapMs: no two closer than this.
export function detectOnsets(data, right, rate, { from = 0, to = data.length, sensitivity = 0.5, minGapMs = 30 } = {}) {
  from = Math.max(0, Math.floor(from)); to = Math.min(data.length, Math.ceil(to));
  const len = to - from;
  if (len < SIZE) return [];
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = right ? (data[from + i] + right[from + i]) / 2 : data[from + i];
  const frames = Math.floor((len - SIZE) / HOP) + 1;
  const win = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE));
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE), prev = new Float64Array(SIZE / 2), flux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < SIZE; i++) { re[i] = mono[f * HOP + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < SIZE / 2; k++) {
      const m = Math.log1p(50 * Math.hypot(re[k], im[k]) / SIZE * 4);
      if (f > 0 && m > prev[k]) sum += m - prev[k];
      prev[k] = m;
    }
    flux[f] = sum;
  }
  // a typical loud value, to scale the threshold by (the 95th percentile, so one huge hit does not hide the rest)
  const sorted = Float64Array.from(flux).sort();
  const loud = sorted[Math.floor(frames * 0.95)] || sorted[frames - 1] || 1;
  if (loud < 1) return [];   // nothing but a steady tone or silence: flux this small is rounding noise
  const half = Math.max(2, Math.round(0.1 * rate / HOP));   // the average is taken over about 100 ms either side
  const delta = (1.05 - Math.min(1, Math.max(0, sensitivity))) * 0.4 * loud;
  const gap = Math.max(1, Math.round(minGapMs / 1000 * rate / HOP));
  const found = [];
  for (let f = 1; f < frames; f++) {
    let mean = 0, n = 0, top = true;
    for (let k = Math.max(0, f - half); k <= Math.min(frames - 1, f + half); k++) { mean += flux[k]; n++; }
    mean /= n;
    if (flux[f] <= mean + delta) continue;
    for (let k = Math.max(0, f - 3); k <= Math.min(frames - 1, f + 3); k++) if (flux[k] > flux[f]) { top = false; break; }
    if (!top) continue;
    if (found.length && f - found[found.length - 1].f < gap) { if (flux[f] > found[found.length - 1].v) found[found.length - 1] = { f, v: flux[f] }; continue; }
    found.push({ f, v: flux[f] });
  }
  // The peak frame covers a window that the hit begins somewhere inside: from the first sample there that reaches a fifth of
  // the loudest one nearby, less a millisecond for the attack.
  const back = Math.round(rate * 0.001);
  const starts = found.map(({ f }) => {
    const a = Math.max(0, f * HOP - HOP), b = Math.min(len, f * HOP + SIZE + HOP);
    let max = 0;
    for (let i = a; i < b; i++) max = Math.max(max, Math.abs(mono[i]));
    let at = a;
    for (let i = a; i < b; i++) if (Math.abs(mono[i]) >= max * 0.2) { at = i; break; }
    return Math.max(0, at - back);
  });
  return [...new Set(starts)].sort((x, y) => x - y).map(i => from + i);
}
