// Low-frequency oscillator: a control source that free-runs. With reset = 1 a note
// restarts it. shape: 0 sine, 1 triangle, 2 saw, 3 square. Output: with range 0 the wave times amount (a swing
// either side of zero); with range 1 the wave runs between min and max, whatever they are.
const RATE = 0, SHAPE = 1, AMOUNT = 2, RESET = 3, RANGE = 4, MIN = 5, MAX = 6, STEPS = 7;
// `steps` is how many times per tick the wave is worked out; between updates the last value is held. 0 works it out for
// every sample. A wire into a parameter only reads the end of each block anyway, so a few updates per tick sound the
// same and cost far less than a sine for every sample.

export default {
  type: 'lfo',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'lfo',
  kinds: { out: 'control' },   // ports are audio unless listed
  params: [
    { name: 'rate', min: 0.01, max: 50, def: 2 },   // Hz
    { name: 'shape', min: 0, max: 3, def: 0, int: true },
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'reset', min: 0, max: 1, def: 0, int: true },
    { name: 'range', min: 0, max: 1, def: 0, int: true },   // 0: swing by amount, 1: between min and max
    { name: 'min', min: -1000, max: 1000, def: 0 },
    { name: 'max', min: -1000, max: 1000, def: 1 },
    { name: 'steps', min: 0, max: 256, def: 0, int: true },   // updates per tick, 0: every sample
  ],
  create({ sampleRate, clock }) {
    let phase = 0, pendingReset = false, until = 0, held = 0;
    return {
      note(msg) { if (msg.type === 'noteOn') pendingReset = true; },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        const inc = params[slots[RATE]] / sampleRate, shape = Math.round(params[slots[SHAPE]]), amount = params[slots[AMOUNT]];
        const between = params[slots[RANGE]] >= 0.5, lo = params[slots[MIN]], half = (params[slots[MAX]] - lo) * 0.5;
        if (pendingReset && params[slots[RESET]] >= 0.5) phase = 0;
        pendingReset = false;
        const steps = Math.round(params[slots[STEPS]]);
        const every = steps > 0 ? Math.max(1, (clock?.tickSamples ?? sampleRate * 0.125) / steps) : 1;
        for (let i = 0; i < n; i++) {
          if (until <= 0) {
            let v;
            if (shape === 0) v = Math.sin(2 * Math.PI * phase);
            else if (shape === 1) v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
            else if (shape === 2) v = 2 * phase - 1;
            else v = phase < 0.5 ? 1 : -1;
            held = between ? lo + (v + 1) * half : v * amount;
            until += every;
          }
          until--;
          out[i] = held;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
