// DC offset remover, stereo: a one-pole high pass that takes the constant part out of a signal and leaves everything
// above `freq` alone. y[n] = x[n] - x[n-1] + R * y[n-1], with R set from the cutoff, so it settles in a few
// hundred milliseconds at the default and costs next to nothing. Put it after anything that drifts off the centre line.
const FREQ = 0;

export default {
  type: 'dcblock',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'dcblock',
  params: [
    { name: 'freq', min: 1, max: 100, def: 10 },   // Hz, the cutoff of the high pass
  ],
  create({ sampleRate }) {
    let xl = 0, yl = 0, xr = 0, yr = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const R = Math.exp(-2 * Math.PI * params[slots[FREQ]] / sampleRate);
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          yl = l - xl + R * yl; xl = l;
          yr = r - xr + R * yr; xr = r;
          outL[i] = yl; outR[i] = yr;
        }
      },
    };
  },
};
