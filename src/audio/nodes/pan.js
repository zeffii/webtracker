// Mono in, stereo out, equal-power. The cv input (control) is added to pan, so an lfo
// gives an auto-pan. Centre has unity gain per channel, like the out node's own pan.
const PAN = 0;

export default {
  type: 'pan',
  inputs: ['in', 'cv'],
  outputs: ['out'],
  category: 'Mix & level',
  kinds: { cv: 'control', out: 'stereo' },
  shape: 'circle',
  glyph: 'pan',
  params: [{ name: 'pan', min: -1, max: 1, def: 0 }],
  create({ connected }) {
    const cvOn = connected[1];
    let gl0 = -1, gr0 = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], cv = inputs[1], [left, right] = outputs[0];
        let p = params[slots[PAN]];
        if (cvOn) {
          let sum = 0;
          for (let i = 0; i < n; i++) sum += cv[i];
          p += sum / n;   // averaged over the block; the gains ramp across it
        }
        const a = (Math.min(Math.max(p, -1), 1) + 1) * Math.PI / 4;
        const gl = Math.SQRT2 * Math.cos(a), gr = Math.SQRT2 * Math.sin(a);
        if (gl0 < 0) gl0 = gl, gr0 = gr;
        const dl = (gl - gl0) / n, dr = (gr - gr0) / n;
        for (let i = 0; i < n; i++) {
          gl0 += dl; gr0 += dr;
          left[i] = input[i] * gl0;
          right[i] = input[i] * gr0;
        }
        gl0 = gl; gr0 = gr;
      },
    };
  },
};
