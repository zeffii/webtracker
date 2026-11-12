// Mix: the sound of the whole song so far, as a stereo signal. It exists in the Master graph: the sum of every machine arrives
// here, goes through whatever effects are wired after it, and into the Out node, then the master volume and the limiter. When
// nothing is wired into the Out node the sound passes unchanged. (In any other machine it is silent.)
export default {
  type: 'busin',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shared: true,   // one copy for all voices
  shape: 'rounded',
  glyph: 'busin',
  kinds: { out: 'stereo' },
  params: [{ name: 'level', min: 0, max: 2, def: 1 }],
  create({ bus }) {
    return {
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        const from = bus?.();
        if (!from) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = params[slots[0]];
        for (let i = 0; i < n; i++) { outL[i] = from[0][i] * g; outR[i] = from[1][i] * g; }
      },
    };
  },
};
