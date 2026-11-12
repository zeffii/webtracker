// What FilterPro does to each frequency, worked out from its settings, and the helpers for drawing it. The panel draws the
// curve from here, and the tests check it against the real filter. Only the filter itself is modelled: drive, bias and the
// cutoff input are not, so with those in use the picture is the filter at rest.
//
// The two-pole voicings are zero-delay state-variable filters, whose response is the analog 2nd-order one with the frequency
// axis warped by tan(pi f / sr) (that warping is why the curve bends near the top of the spectrum).

export const F_LOW = 20, F_HIGH = 20000;
export const FORMANTS = [[800, 1150, 2900], [350, 2000, 2800], [270, 2140, 2950], [450, 800, 2830], [325, 700, 2700]];   // a e i o u
export const FORMANT_GAIN = [1, 0.5, 0.3];

// small complex numbers, as [re, im]
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

// the formant centres in Hz for a vowel setting (0 to 4) and a cutoff (the vowels are written for 1 kHz)
export function formantsAt(vowel, cutoff, sampleRate = 48000) {
  const vi = Math.min(Math.floor(vowel), 3), vf = vowel - vi;
  return [0, 1, 2].map(q => Math.min((FORMANTS[vi][q] * (1 - vf) + FORMANTS[vi + 1][q] * vf) * (cutoff / 1000), sampleRate * 0.45));
}

// A 2nd-order section at frequency f for a cutoff fc and damping k: w is the warped frequency (1 at the cutoff), and the section
// is 1 / (1 - w^2 + j k w), the low pass. The high pass has -w^2 on top of it, the band pass k w.
function section(f, fc, k, sampleRate) {
  const w = Math.tan(Math.PI * Math.min(f, sampleRate * 0.499) / sampleRate) / Math.tan(Math.PI * Math.min(fc, sampleRate * 0.45) / sampleRate);
  return { w, d: [1 - w * w, k * w] };
}

// The gain of the voicing at frequency f, as a plain number (1 is no change). `p` holds the node's parameters by name.
export function responseGain(f, p, sampleRate = 48000) {
  const mode = Math.round(p.mode), res = Math.min(Math.max(p.resonance, 0), 1), fc = Math.max(p.cutoff, 5);
  const k = 2 - 2.04 * res, kb = Math.max(k, 0.02);
  let h;   // the filter's complex response
  if (mode <= 6) {
    const { w, d } = section(f, fc, k, sampleRate);
    const lp = div([1, 0], d), hpass = div([-w * w, 0], d), bp = div([0, kb * w], d);
    switch (mode) {
      case 0: h = lp; break;
      case 1: h = bp; break;
      case 2: h = hpass; break;
      case 3: h = add(lp, hpass); break;
      case 4: h = add(lp, scale(hpass, -1)); break;
      case 5: h = add([1, 0], scale(bp, -2)); break;
      default: {
        const m = p.morph, wl = Math.max(0, 1 - 2 * m), wn = 1 - Math.abs(2 * m - 1), wh = Math.max(0, 2 * m - 1);
        h = add(add(scale(lp, wl), scale(add(lp, hpass), wn)), scale(hpass, wh));
      }
    }
  } else if (mode === 7) {   // two sections, the first at a fixed damping of root two
    const a = section(f, fc, 1.4142, sampleRate), b = section(f, fc, k, sampleRate);
    h = mul(div([1, 0], a.d), div([1, 0], b.d));
  } else if (mode === 8) {   // the ladder: four one-pole stages with the feedback of the resonance around them
    const w = Math.tan(Math.PI * Math.min(f, sampleRate * 0.499) / sampleRate) / Math.tan(Math.PI * Math.min(fc, sampleRate * 0.45) / sampleRate);
    const stage = div([1, 0], [1, w]);
    const four = mul(mul(stage, stage), mul(stage, stage));
    h = scale(div(four, add([1, 0], scale(four, res * 4.3))), 1 + res * 0.7);
  } else if (mode === 9) {   // three formant bands in parallel
    const fk = 1 / (2 + res * 18);
    h = [0, 0];
    formantsAt(p.vowel, fc, sampleRate).forEach((fq, q) => {
      const { w, d } = section(f, fq, fk, sampleRate);
      h = add(h, scale(div([0, w], d), 4 * FORMANT_GAIN[q] * fk));
    });
  } else {   // a comb: the output fed back through a delay of one period of the cutoff, with a damping filter in the loop
    const fbk = (mode === 10 ? 1 : -1) * res * 0.97, w = 2 * Math.PI * f / sampleRate, T = sampleRate / Math.min(Math.max(fc, 20), 5000 * 4);
    const damp = 1 - p.damp * 0.9, z = [Math.cos(-w), Math.sin(-w)];
    const hd = div([damp, 0], add([1, 0], scale(z, -(1 - damp))));
    const delayed = [Math.cos(-w * T), Math.sin(-w * T)];
    h = scale(div([1, 0], add([1, 0], scale(mul(hd, delayed), -fbk))), 1 - Math.abs(fbk) * 0.5);
  }
  const mix = p.mix ?? 1, level = p.level ?? 1;
  const wet = add(scale(h, mix), [1 - mix, 0]);
  return Math.hypot(wet[0], wet[1]) * level;
}

export const responseDb = (f, p, sampleRate) => 20 * Math.log10(Math.max(responseGain(f, p, sampleRate), 1e-5));

// A spectrum as `out.length` values from 0 to 1 along a log axis from 20 Hz to 20 kHz: the loudest bin under each point, in dB
// with a sine of amplitude 1 at the top and -90 dB at the bottom. re and im are the bins 0 to n/2 of a Hann-windowed frame.
export function spectrumPoints(re, im, n, sampleRate, out) {
  const half = n >> 1, perBin = sampleRate / n, lo = Math.log2(F_LOW), hi = Math.log2(F_HIGH), points = out.length, peak = n / 4;
  for (let p = 0; p < points; p++) {
    const a = Math.pow(2, lo + (hi - lo) * p / points) / perBin, b = Math.pow(2, lo + (hi - lo) * (p + 1) / points) / perBin;
    let m = 0;
    if (b - a < 1) {   // finer than a bin: blend the two bins the point sits between
      const c = (a + b) / 2, i = Math.max(1, Math.min(half - 1, Math.floor(c))), f = c - i;
      const m0 = re[i] * re[i] + im[i] * im[i], m1 = re[i + 1] * re[i + 1] + im[i + 1] * im[i + 1];
      m = m0 + (m1 - m0) * f;
    } else {
      for (let i = Math.floor(a); i <= Math.min(half, Math.floor(b)); i++) m = Math.max(m, re[i] * re[i] + im[i] * im[i]);
    }
    out[p] = m > 0 ? Math.max(0, Math.min(1, (10 * Math.log10(m / (peak * peak)) + 90) / 90)) : 0;
  }
  return out;
}
