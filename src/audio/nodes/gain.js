// Gain stage. With the cv input connected it is a VCA: out = in * gain * cv.
// Unconnected, cv counts as 1.
const GAIN = 0;

export default {
  type: 'gain',
  inputs: ['in', 'cv'],
  outputs: ['out'],
  params: [{ name: 'gain', min: 0, max: 4, def: 1 }],
  create({ connected }) {
    const cvOn = connected[1];
    let g0 = -1;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], cv = inputs[1], out = outputs[0];
        const g = params[slots[GAIN]];
        if (g0 < 0) g0 = g;
        const dg = (g - g0) / n;   // ramp across the block
        for (let i = 0; i < n; i++) {
          g0 += dg;
          out[i] = input[i] * g0 * (cvOn ? cv[i] : 1);
        }
        g0 = g;
      },
    };
  },
};
