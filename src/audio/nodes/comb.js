// Comb filter: the signal is mixed with a copy of itself delayed by one period of `freq`, so the spectrum gets
// evenly spaced peaks (and notches) at that frequency and its multiples. Two parts: `feedback` sends the output back
// through the delay, which makes the peaks ring (a tuned resonator, a plucked-string sound when fed noise or clicks;
// negative values put the peaks between the harmonics and drop the pitch an octave), and `ff` mixes in the delayed
// input once (feedforward: notches rather than ringing). `damp` darkens the feedback path, so the high peaks die
// first, as in a real string. `spread` detunes the right channel in cents for width. The loop gain is evened out
// as feedback rises, so turning it up does not also turn up the level. out = dry + (comb - dry) * mix.
const FREQ = 0, FEEDBACK = 1, FF = 2, DAMP = 3, SPREAD = 4, MIX = 5;
const MIN_HZ = 20;

export default {
  type: 'comb',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'comb',
  params: [
    { name: 'freq', min: MIN_HZ, max: 8000, def: 220 },    // Hz: the first peak
    { name: 'feedback', min: -0.995, max: 0.995, def: 0.85 },
    { name: 'ff', min: -1, max: 1, def: 0 },
    { name: 'damp', min: 0, max: 1, def: 0.3 },
    { name: 'spread', min: 0, max: 100, def: 0 },           // cents, right channel up and left down
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate / MIN_HZ) + 8;
    const xb = [new Float32Array(size), new Float32Array(size)], yb = [new Float32Array(size), new Float32Array(size)];
    const lp = [0, 0], len = [0, 0];   // the damping filter's state, and each channel's delay in samples (glided towards its target)
    let w = 0, primed = false;
    const glide = 1 - Math.exp(-1 / (sampleRate * 0.004));
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const freq = params[slots[FREQ]], fb = params[slots[FEEDBACK]], ff = params[slots[FF]], damp = params[slots[DAMP]], mix = params[slots[MIX]];
        const cents = params[slots[SPREAD]], norm = 1 / (1 + 0.8 * Math.abs(fb));
        const target = [sampleRate / (freq * Math.pow(2, cents / 1200)), sampleRate / (freq * Math.pow(2, -cents / 1200))].map(d => Math.max(2, Math.min(size - 3, d)));
        if (!primed) { len[0] = target[0]; len[1] = target[1]; primed = true; }
        const a = 1 - 0.95 * damp;   // one-pole low-pass in the loop: 1 passes everything
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < 2; c++) {
            len[c] += (target[c] - len[c]) * glide;
            let r = w - len[c];
            if (r < 0) r += size;
            const k = r | 0, f = r - k, k1 = k + 1 === size ? 0 : k + 1;
            const xd = xb[c][k] + (xb[c][k1] - xb[c][k]) * f, yd = yb[c][k] + (yb[c][k1] - yb[c][k]) * f;
            lp[c] += a * (yd - lp[c]);
            if (Math.abs(lp[c]) < 1e-20) lp[c] = 0;
            const x = ins[c][i];
            const y = (x + ff * xd + fb * lp[c]);
            xb[c][w] = x;
            yb[c][w] = Math.abs(y) < 1e-20 ? 0 : y;
            outs[c][i] = x + (y * norm - x) * mix;
          }
          if (++w === size) w = 0;
        }
        if (!Number.isFinite(lp[0] + lp[1])) { lp[0] = lp[1] = 0; xb[0].fill(0); xb[1].fill(0); yb[0].fill(0); yb[1].fill(0); }
      },
    };
  },
};
