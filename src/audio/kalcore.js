// The kaleidoscope's geometry, shared by the effect and its panel. Frequency is taken in octaves (log2 of Hz), where a copy of a
// band that is `width` octaves wide sits a whole number of widths away, so a repeated band is the same band moved by `width` octaves.
//   band      the source: from `low` to `high` Hz, `width` octaves wide.
//   tiles     the band is repeated up and down the whole range. Tile 0 holds the source (moved by `rotate` widths); tile 1 is the
//             next one up, tile -1 the next down, and so on.
//   mirror    every second tile is read backwards, so each seam joins two matching ends and the spectrum is continuous.
//   copies    0 fills the whole range; N keeps only the N tiles either side of tile 0.
//   edge      in repeat mode (where the ends do not match) and at the last copy, the tile fades in and out over this many semitones.
//   A tone moved to another place has to keep its phase in step, so the effect works on the tones themselves (see Kaleidoscoper below).

export const F_MIN = 27.5, F_MAX = 14080;   // the range the panel draws
export const LOW_MIN = 40, HIGH_MAX = 16000;

// The band as octaves, the width never below a third of an octave.
export function bandOf(low, high) {
  const lo = Math.max(LOW_MIN, Math.min(low, high / 1.26));
  const hi = Math.min(HIGH_MAX, Math.max(high, lo * 1.26));
  return { lo, hi, b0: Math.log2(lo), width: Math.log2(hi / lo) };
}

// Where does the sound at octave position `o` of the output come from? { tile, from: octave of the source, edge: octaves to the nearest
// seam of the tile, outer: true when the nearest seam is the end of the last copy }
export function sourceOf(o, { b0, width }, { rotate = 0, mode = 0, copies = 0 } = {}) {
  const x = o - b0 - rotate * width, tile = Math.floor(x / width), u = x - tile * width;
  const flipped = mode === 0 && (((tile % 2) + 2) % 2) === 1;
  const nearLow = u < width - u;
  return {
    tile, inside: copies === 0 || Math.abs(tile) <= copies,
    from: b0 + (flipped ? width - u : u),
    edge: Math.min(u, width - u),
    outer: copies > 0 && Math.abs(tile) === copies && (tile > 0 ? !nearLow : nearLow),
  };
}

// Where a tone at octave position `oSrc` of the band lands in tile `k`, and how loud it is there (the fade at the seams, 0 to 1).
//   repeat  the tile holds the band moved by whole widths: the tone keeps its place inside the band.
//   mirror  every second tile is the band read backwards: the tone sits as far from the tile's far end as it was from the band's start.
export function tileOf(oSrc, k, band, { rotate = 0, mode = 0, copies = 0, edge = 0 }, into = {}) {
  const { b0, width } = band, start = b0 + rotate * width + k * width, flipped = mode === 0 && (((k % 2) + 2) % 2) === 1;
  const inBand = oSrc - b0;
  const out = flipped ? start + width - inBand : start + inBand;
  // a fade where the ends do not match: at the band's both ends in repeat mode, and at the outer end of the last copy in mirror mode
  let gain = 1;
  const fade = edge / 12;
  if (fade > 0) {
    let near = Infinity;
    if (mode === 1) near = Math.min(inBand, width - inBand);
    else if (copies > 0 && Math.abs(k) === copies) {
      const toHighEnd = width - inBand, toLowEnd = inBand;   // the tile's outer end is the high end for k > 0 (as it runs) and the low end for k < 0
      near = (k > 0) !== flipped ? toHighEnd : toLowEnd;
    }
    const t = Math.min(1, near / fade);
    gain = t * t * (3 - 2 * t);
  }
  into.out = out; into.gain = gain;
  return into;
}

// A windowed (periodic Hann) sinusoid's spectrum near its frequency: the weight at distance d bins from it, times n. Real, 0.5 at d = 0.
export function lobe(d) {
  const x = Math.abs(d);
  if (x < 1e-6) return 0.5;
  const den = 1 - x * x;
  if (Math.abs(den) < 1e-6) return 0.25;
  return Math.sin(Math.PI * x) / (2 * Math.PI * x * den);
}

const TWO_PI = 2 * Math.PI, TILES = 30;   // tiles either side of the source that are looked at

// The kaleidoscope's frame step. It reads one frame's spectrum, finds the tones in the band (the peaks), measures each one's true
// frequency from how its phase moved since the last frame, and writes every tone into every tile as a clean sinusoid, its phase carried
// on from frame to frame at the new frequency. That is what keeps a moved tone from smearing: bins that are only copied to another place
// would add up out of step.
export class Kaleidoscoper {
  constructor(n, sampleRate) {
    this.n = n; this.sr = sampleRate; this.hop = n / 4; this.half = n >> 1;
    this.prev = new Float64Array(this.half + 1);                         // the phase of every bin in the last frame
    this.acc = Array.from({ length: TILES * 2 + 1 }, () => new Float64Array(this.half + 1));   // per tile and source bin: the phase of the sinusoid made there
    this.seen = Array.from({ length: TILES * 2 + 1 }, () => new Int32Array(this.half + 1).fill(-5));
    this.mag = new Float64Array(this.half + 2);
    this.ph = new Float64Array(this.half + 1);
    this.frame = 0;
    this.spot = { out: 0, gain: 0 };   // reused by tileOf, so a frame allocates nothing
  }

  // re, im: the frame's spectrum. Writes the arrayed sound's spectrum into reW and imW (bins 0 to n/2).
  run(re, im, reW, imW, { low, high, mode, rotate, copies, edge, level }) {
    const { n, half, hop, sr, mag, ph, prev } = this, band = bandOf(low, high), perBin = sr / n;
    const step = TWO_PI * hop / n;
    reW.fill(0, 0, half + 1); imW.fill(0, 0, half + 1);
    let top = 0;
    for (let k = 0; k <= half; k++) { mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); if (mag[k] > top) top = mag[k]; }
    mag[half + 1] = 0;
    const floor = Math.max(1e-7 * n, top * 1e-4);
    this.frame++;
    // only the tiles that can land between 20 Hz and the top of the range are looked at
    const oLow = Math.log2(20), oHigh = Math.log2(sr * 0.48), settings = { rotate, mode, copies, edge };
    const kLow = Math.max(-TILES, Math.floor((oLow - band.b0 - rotate * band.width) / band.width)), kHigh = Math.min(TILES, Math.floor((oHigh - band.b0 - rotate * band.width) / band.width) + 1);
    for (let p = 1; p < half; p++) {
      if (mag[p] < floor || mag[p] <= mag[p - 1] || mag[p] < mag[p + 1]) continue;
      // the tone's true frequency, in bins, from the phase advance (the part beyond what a tone at the bin's own frequency would do)
      let dev = ph[p] - prev[p] - step * p;
      dev -= TWO_PI * Math.round(dev / TWO_PI);
      const q = p + Math.max(-1, Math.min(1, dev / step)), d = p - q;
      const f = q * perBin;
      if (f < band.lo || f > band.hi) continue;
      const oSrc = Math.log2(f), half_a = mag[p] / (n * lobe(d)), phi = ph[p] + Math.PI * d;   // half the amplitude, and the phase at the start of the frame
      for (let k = Math.max(kLow, copies > 0 ? -copies : -TILES); k <= Math.min(kHigh, copies > 0 ? copies : TILES); k++) {
        const t = tileOf(oSrc, k, band, settings, this.spot);
        const fOut = Math.pow(2, t.out);
        if (fOut < 20 || fOut > sr * 0.48 || t.gain <= 0) continue;
        const qOut = fOut / perBin, i = k + TILES;
        // carry the phase on from the last frame if this tone was there; otherwise start it where the source is
        const acc = this.seen[i][p] === this.frame - 1 ? (this.acc[i][p] + step * qOut) % TWO_PI : phi;
        this.acc[i][p] = acc; this.seen[i][p] = this.frame;
        const amp = half_a * n * t.gain * level;
        for (let b = Math.max(1, Math.floor(qOut) - 1); b <= Math.min(half, Math.floor(qOut) + 2); b++) {
          const dd = b - qOut, w = amp * lobe(dd), a = acc - Math.PI * dd;
          reW[b] += w * Math.cos(a); imW[b] += w * Math.sin(a);
        }
      }
    }
    for (let k = 0; k <= half; k++) prev[k] = ph[k];
  }
}

// The spectrum of a frame as `points` values from 0 to 1 along the panel's log axis, for the picture: the loudest bin under each point,
// in dB with a sine of amplitude 1 at the top and -80 dB at the bottom.
export function pictureOf(re, im, n, sampleRate, peak, out) {
  const half = n >> 1, perBin = sampleRate / n, lo = Math.log2(F_MIN), hi = Math.log2(F_MAX), points = out.length;
  for (let p = 0; p < points; p++) {
    const a = Math.pow(2, lo + (hi - lo) * p / points) / perBin, b = Math.pow(2, lo + (hi - lo) * (p + 1) / points) / perBin;
    let m = 0;
    if (b - a < 1) {   // finer than a bin: blend the two bins the point sits between, so the picture is smooth where the bins are few
      const c = (a + b) / 2, i = Math.max(1, Math.min(half - 1, Math.floor(c))), f = c - i;
      const m0 = re[i] * re[i] + im[i] * im[i], m1 = re[i + 1] * re[i + 1] + im[i + 1] * im[i + 1];
      m = m0 + (m1 - m0) * f;
    } else {
      for (let i = Math.floor(a); i <= Math.min(half, Math.floor(b)); i++) m = Math.max(m, re[i] * re[i] + im[i] * im[i]);
    }
    out[p] = m > 0 ? Math.max(0, Math.min(1, (10 * Math.log10(m / (peak * peak)) + 80) / 80)) : 0;
  }
  return out;
}
