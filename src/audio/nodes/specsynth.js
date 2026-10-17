// Spectral synth. It listens to one of the instrument's samples (the sample list and the `sample` parameter work as
// on the sampler), reads the strength of its harmonics at the point `position` and plays that timbre on the note you
// give it: a bank of up to 64 sine partials whose levels follow the sample's own spectrum. The pitch comes from the
// note, the colour from the sample, so a voice, a bell or a bowed string can be played as a synth. `root` is the note
// the sample was recorded at (its harmonics sit at multiples of that pitch). Moving `position`, or letting `scan`
// crawl through the sample (a fraction per second), makes the timbre change as the sample's spectrum does; `blur`
// slows how fast the partials follow it. `contrast` sharpens the spectrum above 1 (only the strongest partials
// stay) and flattens it below. The rest shapes the partials as in the additive synth: tilt, even/odd, stretch,
// stereo width. Monophonic, last note wins, with glide; the voices node makes it polyphonic.
import { Adsr } from './adsr.js';

export const PARTIALS = 64;
const N = 4096, HOP = 1024;   // analysis window and the distance between frames

// radix-2 FFT, in place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const x = i + k, y = x + len / 2;
        const tr = re[y] * cr - im[y] * ci, ti = re[y] * ci + im[y] * cr;
        re[y] = re[x] - tr; im[y] = im[x] - ti; re[x] += tr; im[x] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const WINDOW = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

// Magnitude spectra of a sample, one per frame, worked out when first asked for and kept while the sample lives.
const cache = new WeakMap();
export function frameCount(data) { return Math.max(1, Math.ceil(data.length / HOP)); }
export function spectrumAt(data, right, frame) {
  let per = cache.get(data);
  if (!per) { per = new Map(); cache.set(data, per); }
  let mag = per.get(frame);
  if (mag) return mag;
  const re = new Float64Array(N), im = new Float64Array(N), centre = frame * HOP - N / 2;
  for (let i = 0; i < N; i++) {
    const at = centre + i;
    if (at >= 0 && at < data.length) re[i] = (right ? (data[at] + right[at]) * 0.5 : data[at]) * WINDOW[i];
  }
  fft(re, im);
  mag = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  per.set(frame, mag);
  return mag;
}

// The level of partial `m` (1 based) of a fundamental `f0` Hz in a spectrum: the strongest bin around it.
export function harmonicLevel(mag, rate, f0, m) {
  const bin = f0 * m * N / rate, lo = Math.max(1, Math.round(bin) - 1), hi = Math.min(N / 2 - 1, Math.round(bin) + 1);
  if (bin > N / 2 - 2) return 0;
  let v = 0;
  for (let k = lo; k <= hi; k++) if (mag[k] > v) v = mag[k];
  return v;
}

const SPEC = [
  { name: 'sample', min: 0, max: 255, def: 0, int: true },
  { name: 'position', min: 0, max: 1, def: 0.2 },
  { name: 'scan', min: -1, max: 1, def: 0 },            // fraction of the sample per second
  { name: 'blur', min: 0, max: 1, def: 0.1 },
  { name: 'contrast', min: 0.25, max: 3, def: 1 },
  { name: 'partials', min: 1, max: PARTIALS, def: 48, int: true },
  { name: 'root', min: 0, max: 127, def: 60 },
  { name: 'tilt', min: -12, max: 12, def: 0 },
  { name: 'evenodd', min: -1, max: 1, def: 0 },
  { name: 'stretch', min: 0, max: 1, def: 0 },
  { name: 'width', min: 0, max: 1, def: 0.4 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'glide', min: 0, max: 2000, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'attack', min: 0.1, max: 5000, def: 10 },
  { name: 'decay', min: 1, max: 5000, def: 400 },
  { name: 'sustain', min: 0, max: 1, def: 0.8 },
  { name: 'release', min: 1, max: 5000, def: 300 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'specsynth',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  samples: true,
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }],
  shape: 'rounded',
  glyph: 'specsynth',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, maxBlock = 128 }) {
    const pitchOn = connected[0];
    const bank = [];
    const amp = new Adsr(sampleRate);
    const re = new Float64Array(PARTIALS), im = new Float64Array(PARTIALS);
    const aPrev = new Float64Array(PARTIALS), smooth = new Float64Array(PARTIALS), target = new Float64Array(PARTIALS);
    const c = new Float64Array(PARTIALS), sn = new Float64Array(PARTIALS), levels = new Float64Array(PARTIALS);
    let env = new Float64Array(maxBlock), sumO = new Float64Array(maxBlock), sumE = new Float64Array(maxBlock);
    let note = 60, pos = 60, velocity = 1, scanned = 0, fresh = true;
    const reset = () => { re.fill(1); im.fill(0); aPrev.fill(0); smooth.fill(0); scanned = 0; fresh = true; };
    reset();
    return {
      message(msg) {
        if (msg.type !== 'sample') return;
        bank[msg.slot | 0] = { data: msg.data, right: msg.right ?? null, rate: msg.rate, gain: (msg.volume ?? 1) * (msg.globalVolume ?? 1) };
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { reset(); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          amp.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') amp.off();
        else if (msg.type === 'noteCut') amp.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const S = bank[Math.max(0, Math.min(255, Math.floor(params[slots[P.sample]]) || 0))];
        if (amp.idle || !S) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('attack'), g('decay'), g('sustain'), g('release'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const dt = n / sampleRate, nyq = sampleRate * 0.45;
        const count = Math.round(g('partials')), tilt = g('tilt'), eo = g('evenodd'), B = g('stretch') ** 2 * 0.004, width = g('width');
        const f0 = 440 * Math.pow(2, (pos + g('tune') - 69) / 12) * (pitchOn ? Math.pow(2, inputs[0][0]) : 1);
        // the sample's spectrum at the position, between two analysis frames
        scanned += g('scan') * dt;
        let at = g('position') + scanned; at -= Math.floor(at);
        const frames = frameCount(S.data), fx = at * (frames - 1), f1 = Math.floor(fx), fr = fx - f1;
        const A = spectrumAt(S.data, S.right, f1), Bm = spectrumAt(S.data, S.right, Math.min(frames - 1, f1 + 1));
        const rootHz = 440 * Math.pow(2, (g('root') - 69) / 12);
        let top = 1e-12;
        for (let h = 0; h < count; h++) {
          const v = harmonicLevel(A, S.rate, rootHz, h + 1) * (1 - fr) + harmonicLevel(Bm, S.rate, rootHz, h + 1) * fr;
          levels[h] = v; if (v > top) top = v;
        }
        const contrast = g('contrast'), blur = g('blur');
        const follow = fresh || blur <= 0 ? 1 : 1 - Math.exp(-dt / (blur * blur * 2 + 1e-4));   // blur is a time constant of up to two seconds
        fresh = false;
        let energy = 0;
        target.fill(0);
        for (let h = 0; h < count; h++) {
          const m = h + 1, freq = f0 * m * Math.sqrt(1 + B * m * m);
          smooth[h] += (Math.pow(levels[h] / top, contrast) - smooth[h]) * follow;
          if (freq >= nyq) continue;
          let a = smooth[h] * Math.pow(10, (tilt * Math.log2(m)) / 20);
          a *= m % 2 ? Math.min(1, 1 - eo) : Math.min(1, 1 + eo);
          energy += a * a;
          target[h] = a;
          const w = (2 * Math.PI * freq) / sampleRate;
          c[h] = Math.cos(w); sn[h] = Math.sin(w);
        }
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 0.4 * S.gain;
        const norm = energy > 1e-12 ? level / Math.sqrt(energy) : 0;
        let peakA = 0;
        for (let h = 0; h < count; h++) peakA = Math.max(peakA, target[h] * norm);
        if (env.length < n) env = new Float64Array(n);
        for (let i = 0; i < n; i++) env[i] = amp.next();
        // Odd and even partials sit on opposite sides of the stereo field, so each group is added up on its own and
        // panned once at the end; the envelope too is applied once to the sums, not to every partial.
        if (sumO.length < n) { sumO = new Float64Array(n); sumE = new Float64Array(n); }
        sumO.fill(0, 0, n); sumE.fill(0, 0, n);
        const quiet = peakA * 1e-4;   // a partial this far (-80 dB) below the loudest adds nothing to hear
        for (let h = 0; h < count; h++) {
          const a1 = target[h] * norm, a0 = aPrev[h];
          if (a0 < quiet && a1 < quiet) { aPrev[h] = a1; continue; }
          aPrev[h] = a1;
          const sum = h & 1 ? sumE : sumO;   // partial h + 1: even partials are the odd indexes
          let x = re[h], y = im[h];
          const cc = c[h], ss = sn[h], step = (a1 - a0) / n;
          let a = a0;
          for (let i = 0; i < n; i++) {
            const nx = x * cc - y * ss;
            y = x * ss + y * cc; x = nx;
            a += step;
            sum[i] += y * a;
          }
          const mag = 1 / Math.sqrt(x * x + y * y);
          re[h] = x * mag; im[h] = y * mag;
        }
        {
          const angO = ((-width + 1) * Math.PI) / 4, angE = ((width + 1) * Math.PI) / 4;
          const olo = Math.cos(angO) * Math.SQRT2, oro = Math.sin(angO) * Math.SQRT2, ole = Math.cos(angE) * Math.SQRT2, ore = Math.sin(angE) * Math.SQRT2;
          for (let i = 0; i < n; i++) {
            const e = env[i], o = sumO[i] * e, v = sumE[i] * e;
            outL[i] = o * olo + v * ole; outR[i] = o * oro + v * ore;
          }
        }
      },
    };
  },
};
