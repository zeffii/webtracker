// Sidechain input: the finished sound of another instrument (the `source`, chosen in the node's panel), as a stereo
// signal inside this instrument's graph. Feed it to an envelope follower and the follower's level to a parameter port to
// duck this instrument under the other (a pad under a kick); or just mix it in. It hears the other instrument as it sounds
// after its own graph, in the same block, so there is no delay. An instrument can only listen to ones that do not listen to
// it in turn, directly or through others; the instrument list refuses a loop, and a loop that gets in anyway is silent.
export default {
  type: 'sidechain',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shared: true,   // one copy for all voices
  instrumentSource: true,   // the patcher panel offers a list of instruments for it
  shape: 'rounded',
  glyph: 'sidechain',
  kinds: { out: 'stereo' },
  params: [{ name: 'level', min: 0, max: 2, def: 1 }],
  create({ source, tap }) {
    return {
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const from = source && tap ? tap(source) : null;
        if (!from) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const gain = params[slots[0]];
        for (let i = 0; i < n; i++) { outL[i] = from.left[i] * gain; outR[i] = from.right[i] * gain; }
      },
    };
  },
};
