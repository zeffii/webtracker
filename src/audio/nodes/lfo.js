// Low-frequency oscillator: a control source that free-runs. With reset = 1 a note
// restarts it. Output is the wave times amount. shape: 0 sine, 1 triangle, 2 saw, 3 square.
const RATE = 0, SHAPE = 1, AMOUNT = 2, RESET = 3;

export default {
  type: 'lfo',
  inputs: [],
  outputs: ['out'],
  params: [
    { name: 'rate', min: 0.01, max: 50, def: 2 },   // Hz
    { name: 'shape', min: 0, max: 3, def: 0, int: true },
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'reset', min: 0, max: 1, def: 0, int: true },
  ],
  create({ sampleRate }) {
    let phase = 0, pendingReset = false;
    return {
      note(msg) { if (msg.type === 'noteOn') pendingReset = true; },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        const inc = params[slots[RATE]] / sampleRate, shape = Math.round(params[slots[SHAPE]]), amount = params[slots[AMOUNT]];
        if (pendingReset && params[slots[RESET]] >= 0.5) phase = 0;
        pendingReset = false;
        for (let i = 0; i < n; i++) {
          let v;
          if (shape === 0) v = Math.sin(2 * Math.PI * phase);
          else if (shape === 1) v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
          else if (shape === 2) v = 2 * phase - 1;
          else v = phase < 0.5 ? 1 : -1;
          out[i] = v * amount;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
