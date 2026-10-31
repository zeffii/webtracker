// Output stage: gain and equal-power balance on a stereo input (a mono wire feeds both
// channels, so a mono source is panned as before). The master node.
const GAIN = 0, PAN = 1;   // (a third parameter, `master`, is read by the runtime: 0 keeps the instrument out of the mix, so only a sidechain node hears it)

export default {
  type: 'out',
  master: true,
  inputs: ['in'],
  outputs: ['left', 'right'],
  category: 'Output',
  kinds: { in: 'stereo' },
  shape: 'speaker',
  params: [
    { name: 'gain', min: 0, max: 1.5, def: 0.8 },
    { name: 'pan', min: -1, max: 1, def: 0 },
    { name: 'master', min: 0, max: 1, def: 1, int: true },   // 1: the sound goes to the mix; 0: it does not, but a sidechain node in another instrument still hears it
  ],
  create() {
    let gl0 = -1, gr0 = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], left = outputs[0], right = outputs[1];
        const g = params[slots[GAIN]] * Math.SQRT2;
        const a = (params[slots[PAN]] + 1) * Math.PI / 4;
        const gl = g * Math.cos(a), gr = g * Math.sin(a);
        if (gl0 < 0) gl0 = gl, gr0 = gr;
        const dl = (gl - gl0) / n, dr = (gr - gr0) / n;   // ramp across the block
        for (let i = 0; i < n; i++) {
          gl0 += dl; gr0 += dr;
          left[i] = inL[i] * gl0;
          right[i] = inR[i] * gr0;
        }
        gl0 = gl; gr0 = gr;
      },
    };
  },
};
