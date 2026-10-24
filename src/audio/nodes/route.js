// A route point: a signal goes in, and the same signal comes out of one output that any number of wires can leave.
// It is drawn as a small dot, a place to branch a wire (or to park one) rather than a processor. It changes nothing,
// and a stereo signal stays stereo.
export default {
  type: 'route',
  inputs: ['in'],
  outputs: ['out'],
  params: [],
  dual: true,
  category: 'Routing',
  shape: 'dot',
  size: { w: 10, h: 10 },
  create() {
    return {
      process(inputs, outputs, n) {
        outputs[0].set(inputs[0].subarray(0, n));
      },
    };
  },
};
