// Bitcrusher, stereo: lowers the bit depth and the sample rate. `bits` is the resolution (it may be fractional,
// so 4.5 is between 4 and 5 bits), `rate` the rate in Hz the signal is held at (a sample is taken, then held until
// the next one is due; the two channels share the clock, as one sample-and-hold would). `jitter` randomises when the
// next sample is taken (0 is steady, 1 gives a rough, gritty rate), `dither` adds a little noise before rounding so
// quiet passages crackle instead of going stepped and silent, and `mix` blends with the clean signal.
const BITS = 0, RATE = 1, JITTER = 2, DITHER = 3, MIX = 4;

export default {
  type: 'crusher',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'crusher',
  params: [
    { name: 'bits', min: 1, max: 16, def: 8 },
    { name: 'rate', min: 100, max: 48000, def: 12000 },   // Hz; at or above the engine's rate there is no reduction
    { name: 'jitter', min: 0, max: 1, def: 0 },
    { name: 'dither', min: 0, max: 1, def: 0 },
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    let phase = 1, heldL = 0, heldR = 0, seed = 0x1234567;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const levels = Math.pow(2, params[slots[BITS]] - 1);   // steps on each side of zero
        const step = Math.min(1, params[slots[RATE]] / sampleRate), jitter = params[slots[JITTER]], dither = params[slots[DITHER]] / levels, mix = params[slots[MIX]];
        const quantise = x => Math.round(Math.max(-1, Math.min(1, x)) * levels) / levels;
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i];
          phase += step;
          if (phase >= 1) {
            phase -= 1 + (jitter ? (rand() - 0.5) * jitter * 1.9 : 0);   // the next sample comes sooner or later
            if (phase < 0) phase = 0;
            heldL = quantise(l + (dither ? (rand() + rand() - 1) * dither : 0));
            heldR = quantise(r + (dither ? (rand() + rand() - 1) * dither : 0));
          }
          outL[i] = l + (heldL - l) * mix;
          outR[i] = r + (heldR - r) * mix;
        }
      },
    };
  },
};
