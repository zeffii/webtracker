// Crossfade between a and b: out = a * (1 - mix) + b * mix. An unconnected input is silence.
const MIX = 0;

export default {
  type: 'mix',
  inputs: ['a', 'b'],
  outputs: ['out'],
  params: [{ name: 'mix', min: 0, max: 1, def: 0.5 }],
  dual: true,   // runs as a left/right pair when a stereo signal arrives
  category: 'Mix & level',
  shape: 'circle',
  glyph: 'mix',
  create() {
    let m0 = -1;
    return {
      process(inputs, outputs, n, params, slots) {
        const a = inputs[0], b = inputs[1], out = outputs[0];
        const m = params[slots[MIX]];
        if (m0 < 0) m0 = m;
        const dm = (m - m0) / n;   // ramp across the block
        for (let i = 0; i < n; i++) {
          m0 += dm;
          out[i] = a[i] + (b[i] - a[i]) * m0;
        }
        m0 = m;
      },
    };
  },
};
