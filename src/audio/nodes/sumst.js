// Inserted by the compiler where several wires feed one stereo input: adds them, channel by channel.
export default {
  type: 'sumst',
  hidden: true,
  inputs: [],
  outputs: ['out'],
  params: [],
  create() {
    return {
      process(inputs, outputs, n) {
        const [ol, or] = outputs[0];
        ol.set(inputs[0][0].subarray(0, n));
        or.set(inputs[0][1].subarray(0, n));
        for (let k = 1; k < inputs.length; k++) {
          const [l, r] = inputs[k];
          for (let i = 0; i < n; i++) { ol[i] += l[i]; or[i] += r[i]; }
        }
      },
    };
  },
};
