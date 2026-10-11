// Mono state-variable filter (TPT form). mode: 0 lowpass, 1 bandpass, 2 highpass.
const CUTOFF = 0, RES = 1, MODE = 2;

export default {
  type: 'filter',
  inputs: ['in'],
  outputs: ['out'],
  params: [
    { name: 'cutoff', min: 20, max: 18000, def: 2000 },
    { name: 'resonance', min: 0, max: 0.95, def: 0.2 },
    { name: 'mode', min: 0, max: 2, def: 0 },
  ],
  create({ sampleRate }) {
    let ic1 = 0, ic2 = 0, fc = -1;
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0];
        const target = params[slots[CUTOFF]];
        if (fc < 0) fc = target;
        fc += (target - fc) * (1 - Math.exp(-n / (sampleRate * 0.02)));   // slew
        const g = Math.tan(Math.PI * Math.min(fc, sampleRate * 0.45) / sampleRate);
        const k = 2 - 1.95 * params[slots[RES]];
        const mode = Math.round(params[slots[MODE]]);
        const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        for (let i = 0; i < n; i++) {
          const x = input[i];
          const v3 = x - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          ic1 = 2 * v1 - ic1;
          ic2 = 2 * v2 - ic2;
          out[i] = mode === 0 ? v2 : mode === 1 ? v1 : x - k * v1 - v2;
        }
      },
    };
  },
};
