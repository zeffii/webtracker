// Mono feedback delay with a one-second maximum. Shared state, not per voice.
const TIME = 0, FEEDBACK = 1, MIX = 2;

export default {
  type: 'delay',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { name: 'time', min: 1, max: 1000, def: 300 },
    { name: 'feedback', min: 0, max: 0.95, def: 0.35 },
    { name: 'mix', min: 0, max: 1, def: 0.25 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate) + 2;
    const buf = new Float32Array(size);
    let w = 0, d = -1;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.05));   // per sample, so the glide does not depend on the block size
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0];
        const target = Math.min(Math.max(params[slots[TIME]] * 0.001 * sampleRate, 1), size - 3);
        if (d < 0) d = target;
        const fb = params[slots[FEEDBACK]], mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          d += (target - d) * slew;
          let r = w - d;
          if (r < 0) r += size;
          const k = r | 0, f = r - k, k1 = k + 1 === size ? 0 : k + 1;
          const y = buf[k] + (buf[k1] - buf[k]) * f;
          const x = input[i];
          const v = x + y * fb;
          buf[w] = Math.abs(v) < 1e-20 ? 0 : v;   // no slow denormals in a long tail
          out[i] = x + y * mix;
          if (++w === size) w = 0;
        }
      },
    };
  },
};
