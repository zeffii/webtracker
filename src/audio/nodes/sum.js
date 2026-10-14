// Inserted by the compiler where several wires feed one input: adds them together.
// Not placed by hand, so the patcher does not list it.
export default {
  type: 'sum',
  hidden: true,
  inputs: [],
  outputs: ['out'],
  params: [],
  create() {
    return {
      process(inputs, outputs, n) {
        const out = outputs[0];
        out.set(inputs[0].subarray(0, n));
        for (let k = 1; k < inputs.length; k++) {
          const x = inputs[k];
          for (let i = 0; i < n; i++) out[i] += x[i];
        }
      },
    };
  },
};
