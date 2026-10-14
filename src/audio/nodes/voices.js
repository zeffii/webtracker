// Marks where the voices of a polyphonic instrument are added together. Everything that feeds
// this node runs once per voice (an oscillator and its envelope, say); everything after it runs
// once, on the sum (a delay, a reverb, the out node). With one voice it simply passes the
// signal through. The runtime does the summing for several voices; see GraphRuntime.load.
export default {
  type: 'voices',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Mix & level',
  shape: 'circle',
  glyph: 'voices',
  kinds: { in: 'stereo', out: 'stereo' },
  params: [],
  create() {
    return {
      process(inputs, outputs, n) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        for (let i = 0; i < n; i++) { outL[i] = inL[i]; outR[i] = inR[i]; }
      },
    };
  },
};
