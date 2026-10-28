// Add: control rate sum. Out = everything wired into `in` (several wires are added) + `value`. A negative value lowers
// an LFO or any control signal; `value` can have a port of its own to be moved by another control.
export default {
  type: 'add',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Control',
  shape: 'rounded',
  glyph: 'add',
  kinds: { in: 'control', out: 'control' },
  params: [{ name: 'value', min: -1000, max: 1000, def: 0 }],
  create() {
    return {
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], inp = inputs[0], v = params[slots[0]];
        for (let i = 0; i < n; i++) out[i] = inp[i] + v;
      },
    };
  },
};
