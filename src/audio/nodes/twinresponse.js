// What the twin filter does to each frequency, worked out from its settings, and the helpers the panel draws with. Only the two filters and
// the way they are joined are modelled: drive, tilt, feedback and the modulation are not, so with those in use the picture is the filter at
// rest (the cutoffs as set, the lock and detune applied, no pitch tracker).
//
// Each filter is a zero-delay state-variable filter (12 dB per octave) whose response is the analog second-order one with the frequency axis
// warped by tan(pi f / sr). Its output is the mix of the low pass, band pass and high pass, each with a level from -1 to 1.

export const F_LOW = 20, F_HIGH = 20000;

const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

// The cutoffs the panel shows: filter 1 as set, and filter 2 either as set or (locked) at the ratio above filter 1, both with the detune.
export function cutoffs(p) {
  const detune = Math.pow(2, (p.detune ?? 0) / 1200), f1 = Math.max(p.cutoff1, 5);
  const f2 = Math.round(p.lock) === 1 ? f1 * p.ratio * detune : Math.max(p.cutoff2, 5) * detune;
  return [f1, f2];
}

// One filter's complex response at f. `n` is 1 or 2: which filter's settings (cutoff, res, low, band, high) to read.
export function filterResponse(f, p, n, fc, sampleRate = 48000) {
  const res = Math.min(Math.max(p[`res${n}`], 0), 1), k = 2 - 2.04 * res, kb = Math.max(k, 0.02);
  const w = Math.tan(Math.PI * Math.min(f, sampleRate * 0.499) / sampleRate) / Math.tan(Math.PI * Math.min(Math.max(fc, 5), sampleRate * 0.45) / sampleRate);
  const d = [1 - w * w, k * w];
  const lp = div([1, 0], d), hp = div([-w * w, 0], d), bp = div([0, kb * w], d);
  return add(add(scale(lp, p[`low${n}`]), scale(bp, p[`band${n}`])), scale(hp, p[`high${n}`]));
}

// The two together: filter 2 hears a mix of filter 1's output and the input (the more parallel, the more input); the output is filter 1
// (as much as is parallel) plus filter 2, shared out so a plain parallel pair is their average.
export function responseGain(f, p, sampleRate = 48000) {
  const [f1, f2] = cutoffs(p), blend = Math.min(Math.max(p.blend, 0), 1);
  const h1 = filterResponse(f, p, 1, f1, sampleRate), h2 = filterResponse(f, p, 2, f2, sampleRate);
  const into2 = add([1, 0], scale(add(h1, [-1, 0]), 1 - blend));
  const h = scale(add(scale(h1, blend), mul(h2, into2)), 1 / (1 + blend));
  return Math.hypot(h[0], h[1]);
}

// One filter's own gain in dB (to draw it on its own), and the two together in dB.
export const filterDb = (f, p, n, sampleRate = 48000) => 20 * Math.log10(Math.max(Math.hypot(...filterResponse(f, p, n, cutoffs(p)[n - 1], sampleRate)), 1e-6));
export const responseDb = (f, p, sampleRate = 48000) => 20 * Math.log10(Math.max(responseGain(f, p, sampleRate), 1e-6));

// The overtones above a frequency: 2x, 3x, ... while they stay under the top of the display. Each is { n, f }.
export function overtones(f, most = 10) {
  const out = [];
  for (let n = 2; n <= most && n * f < F_HIGH; n++) out.push({ n, f: n * f });
  return out;
}

// Which overtones of the two filters land on the same frequency (within about a fifth of a semitone), as sets of the multiples:
// { shared: [{ f, a, b }] } with a the multiple of filter 1 and b the multiple of filter 2 (1 means the cutoff itself).
export function sharedOvertones(f1, f2, most = 10) {
  const out = [];
  for (let a = 1; a <= most; a++) for (let b = 1; b <= most; b++) {
    if (a === 1 && b === 1) continue;
    const x = a * f1, y = b * f2;
    if (x < F_HIGH && Math.abs(Math.log2(x / y)) < 0.017) out.push({ f: (x + y) / 2, a, b });
  }
  return out;
}
