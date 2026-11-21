// Click remover, stereo: three small guards against the clicks at the start of a note, each with its own control, in this order.
//   fade    a fade-in of this many ms at every note start (a smooth step from silence to full level); 0 is off. It follows the notes
//           only where the node sits in a voice's own chain, before the voices node; after it, the fade never runs
//   dc      a high pass that takes the constant offset out (the corner in Hz, as the dc blocker); 0 is off
//   settle  for this many ms after a note starts the dc corner is 16 times higher, so an offset that arrives with the note is gone at once
//           and not slowly bleeding away as a thump; 0 is off
//   slew    the most the output may move from one sample to the next, as a fraction of full scale; 1 is off. A jump from a sudden edge
//           is turned into a short ramp, which costs a little brightness where the signal is loud and fast
const FADE = 0, DC = 1, SETTLE = 2, SLEW = 3;
const SETTLE_BOOST = 16;

export default {
  type: 'declick',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'declick',
  params: [
    { name: 'fade', min: 0, max: 50, def: 3 },        // ms
    { name: 'dc', min: 0, max: 100, def: 10 },        // Hz, 0 off
    { name: 'settle', min: 0, max: 200, def: 20 },    // ms
    { name: 'slew', min: 0.001, max: 1, def: 1 },     // fraction of full scale per sample, 1 off
  ],
  create({ sampleRate }) {
    let since = 1e9;   // samples since the last note started (a long time ago until one does)
    let xl = 0, yl = 0, xr = 0, yr = 0;   // the dc blocker's memory
    let sl = 0, sr = 0;                   // the last output, for the slew limit
    const pole = hz => Math.exp(-2 * Math.PI * Math.min(hz, sampleRate / 8) / sampleRate);
    return {
      note(msg) { if (msg.type === 'noteOn') since = 0; },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const fadeSamples = params[slots[FADE]] * 0.001 * sampleRate;
        const dc = params[slots[DC]];
        const settleSamples = params[slots[SETTLE]] * 0.001 * sampleRate;
        const slew = params[slots[SLEW]];
        const steady = dc > 0 ? pole(dc) : 0, fast = dc > 0 ? pole(dc * SETTLE_BOOST) : 0;
        for (let i = 0; i < n; i++) {
          const t = since + i;
          let l = inL[i], r = inR[i];
          if (t < fadeSamples) {
            const u = t / fadeSamples, g = u * u * (3 - 2 * u);
            l *= g; r *= g;
          }
          if (dc > 0) {
            const R = t < settleSamples ? fast : steady;
            const ol = l - xl + R * yl, or = r - xr + R * yr;
            xl = l; xr = r; yl = ol; yr = or;
            l = ol; r = or;
          }
          if (slew < 1) {
            l = sl + Math.max(-slew, Math.min(slew, l - sl));
            r = sr + Math.max(-slew, Math.min(slew, r - sr));
            sl = l; sr = r;
          }
          outL[i] = l; outR[i] = r;
        }
        since = Math.min(since + n, 1e9);
      },
    };
  },
};
