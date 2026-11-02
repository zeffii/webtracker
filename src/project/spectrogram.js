// A spectrogram of one sample for the display: time runs left to right on the same axis as the
// waveform, low frequencies at the bottom.

const SIZE = 1024;   // FFT length in frames

// In-place radix-2 FFT of re/im (length a power of two).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Brightness 0..255 for cols x rows cells, row 0 at the top. Frequency is spread so that the low
// end gets more rows (a square-root scale); brightness is dB below the loudest cell, over a 90 dB range.
// Stereo samples are averaged.
export function computeSpectrogram(data, right, cols, rows) {
  const out = new Uint8Array(cols * rows);
  if (!data.length) return out;
  const half = SIZE / 2, window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE));
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  const db = new Float32Array(cols * rows);
  const binOf = y => Math.min(half - 1, Math.floor(((rows - 1 - y) / rows) ** 2 * half));
  let top = -Infinity;
  for (let x = 0; x < cols; x++) {
    const centre = Math.floor((x + 0.5) * data.length / cols);
    for (let i = 0; i < SIZE; i++) {
      const k = centre - half + i;
      const v = k < 0 || k >= data.length ? 0 : right ? (data[k] + right[k]) * 0.5 : data[k];
      re[i] = v * window[i]; im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < rows; y++) {
      const b = binOf(y);
      const level = 20 * Math.log10(Math.hypot(re[b], im[b]) / half + 1e-9);
      db[x * rows + y] = level;
      if (level > top) top = level;
    }
  }
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) out[y * cols + x] = Math.round(255 * Math.min(1, Math.max(0, (db[x * rows + y] - (top - 90)) / 90)));
  }
  return out;
}

// RGBA of a brightness: black, through blue and magenta, to near white.
export function heat(v) {
  const t = v / 255;
  return [255 * Math.min(1, t * 1.6) ** 1.5, 255 * Math.max(0, t * 1.4 - 0.4) ** 1.2, 255 * Math.min(1, t * 2.2 + 0.1) * (t > 0.01 ? 1 : 0), 255];
}

// The same picture on a pitch axis, for the piano roll: rows are spaced by pitch (equal room for every semitone) from MIDI `hi`
// at the top to `lo` at the bottom, and `hzOf(midi)` gives the frequency of a pitch (the roll's tuning), so a recording that is
// sharp or flat sits on the rows once the tuning matches it. A longer FFT than the plain view, as low notes are close together
// in Hz; between bins the level is interpolated, and a row that spans several bins takes the loudest.
const PITCH_SIZE = 4096;
export function computePitchSpectrogram(data, right, rate, cols, rows, { lo, hi, hzOf }) {
  const out = new Uint8Array(cols * rows);
  if (!data.length) return out;
  const size = PITCH_SIZE, half = size / 2;
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const re = new Float64Array(size), im = new Float64Array(size), mag = new Float64Array(half);
  const db = new Float32Array(cols * rows);
  // the bin range each row covers (fractional), from the pitch at its lower and upper edge
  const span = hi - lo, binOf = midi => hzOf(midi) * size / rate;
  const edges = Array.from({ length: rows }, (_, y) => {
    const top = hi - (y / rows) * span, bottom = hi - ((y + 1) / rows) * span;
    return [binOf(bottom), binOf(top), binOf((top + bottom) / 2)];
  });
  let loudest = -Infinity;
  for (let x = 0; x < cols; x++) {
    const centre = Math.floor((x + 0.5) * data.length / cols);
    for (let i = 0; i < size; i++) {
      const k = centre - half + i;
      const v = k < 0 || k >= data.length ? 0 : right ? (data[k] + right[k]) * 0.5 : data[k];
      re[i] = v * window[i]; im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]) / half;
    for (let y = 0; y < rows; y++) {
      const [b0, b1, mid] = edges[y];
      let m = 0;
      if (mid >= half - 1) m = 0;
      else if (b1 - b0 < 1) { const k = Math.floor(mid), t = mid - k; m = mag[k] * (1 - t) + mag[k + 1] * t; }
      else for (let k = Math.max(0, Math.floor(b0)); k <= Math.min(half - 1, Math.ceil(b1)); k++) m = Math.max(m, mag[k]);
      const level = 20 * Math.log10(m + 1e-9);
      db[x * rows + y] = level;
      if (level > loudest) loudest = level;
    }
  }
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) out[y * cols + x] = Math.round(255 * Math.min(1, Math.max(0, (db[x * rows + y] - (loudest - 80)) / 80)));
  }
  return out;
}
