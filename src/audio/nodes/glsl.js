// The shader machine's parameters. It has no ports and makes no sound: the live picture reads the sixteen values k1 to k16 every
// frame and hands those the shader asks for (kn("name", ...) in its code) to it. A number exposed from the Shader view becomes one
// of these, as a pattern column of the shader lane, so a pattern can animate it. Each is 0 to 1 here; the shader's own low and high
// stretch it to the range the number needs.
export const KNOBS = 16;
export default {
  type: 'glsl',
  hidden: true,   // made by the Shader view when a number is exposed, not something to add to a graph
  inputs: [],
  outputs: [],
  category: 'Control',
  shape: 'box',
  params: Array.from({ length: KNOBS }, (_, i) => ({ name: `k${i + 1}`, min: 0, max: 1, def: 0.5 })),
  create() { return { process() {} }; },
};
