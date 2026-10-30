// Inserted by the compiler where two audio paths meet and one is quicker than the other (delay compensation, see
// audio/latency.js): it delays the quicker one by whole samples, so both arrive together. Mono or stereo.
export default {
  type: 'compdelay',
  hidden: true,
  inputs: [],
  outputs: ['out'],
  params: [],
  create({ data, stereo }) {
    const len = Math.max(1, Math.round(data?.samples ?? 1));
    const lines = [new Float32Array(len), new Float32Array(len)];
    let at = 0;
    return {
      process(inputs, outputs, n) {
        const wide = stereo === true, channels = wide ? 2 : 1;
        for (let c = 0; c < channels; c++) {
          const x = wide ? inputs[0][c] : inputs[0], y = wide ? outputs[0][c] : outputs[0], line = lines[c];
          let w = at;
          for (let i = 0; i < n; i++) { y[i] = line[w]; line[w] = x[i]; if (++w === len) w = 0; }
        }
        at = (at + n) % len;
      },
    };
  },
};
