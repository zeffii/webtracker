// Exciter: high-passes the signal, saturates that band, high-passes the result again (to
// drop the low products and any DC), and adds it back: out = in + amount * wet. `even`
// biases the saturator, which adds even harmonics. Stereo in and out.
const FREQ = 0, DRIVE = 1, AMOUNT = 2, EVEN = 3;

export default {
  type: 'exciter',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'exciter',
  params: [
    { name: 'freq', min: 500, max: 12000, def: 3000 },   // Hz, where the excited band starts
    { name: 'drive', min: 1, max: 20, def: 4 },
    { name: 'amount', min: 0, max: 1, def: 0.3 },
    { name: 'even', min: 0, max: 1, def: 0.3 },
  ],
  create({ sampleRate }) {
    // state of two high-pass filters per channel: [ic1, ic2] for the pre and the post filter
    const state = [new Float64Array(4), new Float64Array(4)];
    let fc = -1;
    const K = 1.4142;   // damping: Butterworth
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const target = params[slots[FREQ]];
        if (fc < 0) fc = target;
        fc += (target - fc) * (1 - Math.exp(-n / (sampleRate * 0.02)));
        const g = Math.tan(Math.PI * Math.min(Math.max(fc, 20), sampleRate * 0.45) / sampleRate);
        const a1 = 1 / (1 + g * (g + K)), a2 = g * a1, a3 = g * a2;
        const drive = params[slots[DRIVE]], amount = params[slots[AMOUNT]];
        const bias = params[slots[EVEN]] * 0.8, bias0 = Math.tanh(bias);
        for (let c = 0; c < 2; c++) {
          const x = ins[c], out = outs[c], s = state[c];
          for (let i = 0; i < n; i++) {
            const xi = x[i];
            let v3 = xi - s[1];
            let v1 = a1 * s[0] + a2 * v3;
            const v2 = s[1] + a2 * s[0] + a3 * v3;
            s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
            const band = xi - K * v1 - v2;                       // high-passed input
            const sat = Math.tanh(band * drive + bias) - bias0;  // saturated
            v3 = sat - s[3];
            v1 = a1 * s[2] + a2 * v3;
            const w2 = s[3] + a2 * s[2] + a3 * v3;
            s[2] = 2 * v1 - s[2]; s[3] = 2 * w2 - s[3];
            out[i] = xi + amount * (sat - K * v1 - w2);
          }
          for (let k = 0; k < 4; k++) if (Math.abs(s[k]) < 1e-20) s[k] = 0;
        }
      },
    };
  },
};
