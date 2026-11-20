// The spread table behind the pad synth (padsynth) and the spread oscillator (spreadosc).
//
// A sound that is a few harmonics, each smeared into a narrow band of frequencies with random phases, is a pad: no two cycles alike,
// no oscillator edge. It is made in the frequency domain, then one inverse FFT turns it into a table that loops without a seam, and
// playing the table at a speed sets the pitch. This is the PADsynth idea.
//
// A table is made for each octave band (the note's octave, read at 0.7 to 1.4 times its own speed, so the top harmonics stay under
// the Nyquist frequency), once for the left channel and once for the right with other random phases, which is where the width comes
// from. Tables are kept by their settings, so a note with settings already heard costs nothing.
import { fftPlan } from '../fft.js';

export const TABLE_SIZES = [32768, 8192, 65536];   // quality 0 standard, 1 eco, 2 high (finer bandwidth at low notes)
const BAND_MAX = 10;
const RATIO_TOP = 1.4143;   // the highest note of a band is this far above the pitch the table was made at
const TABLE_RMS = 0.5;
const SEEDS = [0x2545f491, 0x9e3779b9];   // left, right: the random phases
const DB_PER_OCTAVE = 0.015051499783199059;   // log10(2) / 20: a gain of 10^(tilt * log2(n) / 20) is n ^ (tilt * this)
const CACHE_MAX = 24;
const cache = new Map();

export const bandOf = note => Math.min(BAND_MAX, Math.max(0, Math.floor(note / 12)));
// The pitch a band's table is made at: the middle of its octave (six semitones above the C that starts it).
export const bandPitch = band => 440 * Math.pow(2, (band * 12 + 6 - 69) / 12);

// One channel's table. `p`: bandwidth (cents, of the first harmonic), spread (how the bandwidth grows with the harmonic number),
// tilt (dB per octave), evenodd (-1 .. 1), stretch (0 .. 1), harmonics.
function buildTable(sampleRate, size, band, p, channel) {
  const half = size / 2, pitch = bandPitch(band), nyquist = sampleRate * 0.45;
  const stretch = p.stretch * p.stretch * 0.004;
  const mag = new Float64Array(half);
  const sqrtHalfPi = Math.sqrt(Math.PI / 2);
  for (let h = 1; h <= p.harmonics; h++) {
    const freq = pitch * h * Math.sqrt(1 + stretch * h * h);
    if (freq * RATIO_TOP >= nyquist) break;
    const level = Math.pow(h, p.tilt * DB_PER_OCTAVE) * (h % 2 ? Math.min(1, 1 - p.evenodd) : Math.min(1, 1 + p.evenodd)) / h;
    const bandwidth = (Math.pow(2, p.bandwidth / 1200) - 1) * pitch * Math.pow(h, p.spread);   // Hz
    const width = Math.max(bandwidth * size / (2 * sampleRate), 1);   // bins
    const centre = freq * size / sampleRate;
    const amp = level / Math.sqrt(width * sqrtHalfPi);   // every harmonic keeps its energy however wide it is smeared
    const lo = Math.max(1, Math.floor(centre - 4 * width)), hi = Math.min(half - 1, Math.ceil(centre + 4 * width));
    for (let k = lo; k <= hi; k++) { const x = (k - centre) / width; mag[k] += amp * Math.exp(-x * x); }
  }
  const re = new Float64Array(size), im = new Float64Array(size);
  let rng = SEEDS[channel];
  for (let k = 1; k < half; k++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    const phase = (rng / 4294967296) * 2 * Math.PI;
    re[k] = mag[k] * Math.cos(phase); im[k] = mag[k] * Math.sin(phase);
    re[size - k] = re[k]; im[size - k] = -im[k];
  }
  fftPlan(size).run(re, im, true);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += re[i] * re[i];
  const scale = sum > 1e-30 ? TABLE_RMS / Math.sqrt(sum / size) : 0;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) table[i] = re[i] * scale;
  return table;
}

// The left and right tables for a band and settings (made the first time, then kept).
export function spreadTables(sampleRate, quality, band, settings) {
  const size = TABLE_SIZES[Math.min(2, Math.max(0, quality))];
  const q = x => Math.round(x * 1000) / 1000;
  const p = { bandwidth: q(settings.bandwidth), spread: q(settings.spread), tilt: q(settings.tilt), evenodd: q(settings.evenodd), stretch: q(settings.stretch), harmonics: settings.harmonics };
  const key = `${sampleRate}|${size}|${band}|${p.bandwidth}|${p.spread}|${p.tilt}|${p.evenodd}|${p.stretch}|${p.harmonics}`;
  let found = cache.get(key);
  if (found) { cache.delete(key); cache.set(key, found); return found; }   // (most recently used last)
  found = { size, left: buildTable(sampleRate, size, band, p, 0), right: buildTable(sampleRate, size, band, p, 1) };
  cache.set(key, found);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return found;
}

// Reads a pair of tables at a speed: each channel has its own place in its table and its own slow wobble of the speed (`motion`, in
// cents), so the two drift against each other. `width` 0 is mono (the two channels' mean), 1 the two tables as they are.
export class SpreadPlayer {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.posL = 0; this.posR = 0;
    this.lfoL = 0; this.lfoR = 0;
    this.rng = 0x1234abcd;
    this.fresh = false;   // set by restart(): the first block then turns the starting places into table positions
  }
  // a new note starts the tables at a random place and the wobble at a random phase
  restart() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; this.posL = this.rng / 4294967296;
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; this.posR = this.rng / 4294967296;
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; this.lfoL = (this.rng / 4294967296) * 2 * Math.PI;
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; this.lfoR = (this.rng / 4294967296) * 2 * Math.PI;
    this.fresh = true;
  }
  // `speed`: table steps per sample (the note's frequency over the table's pitch). Fills outL / outR for n samples.
  render(tables, n, speed, motion, width, outL, outR) {
    const size = tables.size, mask = size - 1, tl = tables.left, tr = tables.right;
    if (this.fresh) { this.posL *= size; this.posR *= size; this.fresh = false; }
    const cents = motion * 12;
    const stepL = speed * Math.pow(2, (cents * Math.sin(this.lfoL)) / 1200), stepR = speed * Math.pow(2, (cents * Math.sin(this.lfoR)) / 1200);
    this.lfoL += (2 * Math.PI * 0.11 * n) / this.sr; this.lfoR += (2 * Math.PI * 0.17 * n) / this.sr;
    if (this.lfoL > 2 * Math.PI) this.lfoL -= 2 * Math.PI;
    if (this.lfoR > 2 * Math.PI) this.lfoR -= 2 * Math.PI;
    const mix = (1 - width) * Math.SQRT2 * 0.5;
    let pl = this.posL, pr = this.posR;
    for (let i = 0; i < n; i++) {
      const il = Math.floor(pl), fl = pl - il, ir = Math.floor(pr), fr = pr - ir;
      const l0 = tl[(il - 1) & mask], l1 = tl[il & mask], l2 = tl[(il + 1) & mask], l3 = tl[(il + 2) & mask];
      const r0 = tr[(ir - 1) & mask], r1 = tr[ir & mask], r2 = tr[(ir + 1) & mask], r3 = tr[(ir + 2) & mask];
      const l = ((((3 * (l1 - l2) - l0 + l3) * 0.5) * fl + (2 * l2 + l0 - (5 * l1 + l3) * 0.5)) * fl + (l2 - l0) * 0.5) * fl + l1;
      const r = ((((3 * (r1 - r2) - r0 + r3) * 0.5) * fr + (2 * r2 + r0 - (5 * r1 + r3) * 0.5)) * fr + (r2 - r0) * 0.5) * fr + r1;
      const m = mix * (l + r);
      outL[i] = m + width * l; outR[i] = m + width * r;
      pl += stepL; if (pl >= size) pl -= size;
      pr += stepR; if (pr >= size) pr -= size;
    }
    this.posL = pl; this.posR = pr;
  }
}
