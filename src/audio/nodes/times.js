// Times: control rate multiply. Out = `in` x `by`. Wire a second control into `by` to multiply the two (a ring of controls);
// with nothing there `by` is the number typed in. A negative number flips the signal.
export default {
  type: 'times',
  inputs: ['in', 'mod'],
  outputs: ['out'],
  category: 'Control',
  shape: 'rounded',
  glyph: 'times',
  kinds: { in: 'control', mod: 'control', out: 'control' },
  params: [{ name: 'by', min: -1000, max: 1000, def: 1 }],
  create({ connected }) {
    const mod = connected?.[1] === true;
    return {
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], inp = inputs[0], m = inputs[1], by = params[slots[0]];
        if (mod) for (let i = 0; i < n; i++) out[i] = inp[i] * m[i] * by;
        else for (let i = 0; i < n; i++) out[i] = inp[i] * by;
      },
    };
  },
};
