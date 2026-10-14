// Inserted by the compiler where a stereo wire feeds a mono input: the average of left and right.
export default {
  type: 'fold',
  hidden: true,
  inputs: [],
  outputs: ['out'],
  params: [],
  create() {
    return {
      process(inputs, outputs, n) {
        const [l, r] = inputs[0], out = outputs[0];
        for (let i = 0; i < n; i++) out[i] = (l[i] + r[i]) * 0.5;
      },
    };
  },
};
