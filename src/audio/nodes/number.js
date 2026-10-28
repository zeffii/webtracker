// Int and Float: a fixed number as a control signal, set with a slider, by typing, or (Int) with the + and - buttons.
const make = (type, int) => ({
  type,
  inputs: [],
  outputs: ['out'],
  category: 'Control',
  shared: true,
  shape: 'rounded',
  glyph: type,
  editor: int ? 'int' : undefined,
  kinds: { out: 'control' },
  params: [{ name: 'value', min: int ? -128 : -1000, max: int ? 128 : 1000, def: 0, ...(int ? { int: true } : {}) }],
  create() {
    return {
      process(inputs, outputs, n, params, slots) {
        const v = params[slots[0]];
        outputs[0].fill(int ? Math.round(v) : v, 0, n);
      },
    };
  },
});
export const int = make('int', true);
export const float = make('float', false);
