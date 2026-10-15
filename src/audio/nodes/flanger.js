// Stereo flanger: a very short delay swept by an lfo and added to the dry signal, which makes a comb
// filter that moves up and down. `delay` is the middle of the sweep and `depth` how far it swings, both in
// ms; `feedback` sends the delayed signal back in (negative values invert it) for a harder, more
// metallic sound. The right channel's lfo is offset by `width` (a quarter cycle at 1).
// out = dry + wet * mix, so mix 1 is the deepest comb.
const RATE = 0, DEPTH = 1, DELAY = 2, FEEDBACK = 3, WIDTH = 4, MIX = 5;
const MAX_MS = 25;

export default {
  type: 'flanger',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'flanger',
  params: [
    { name: 'rate', min: 0.02, max: 8, def: 0.25 },       // Hz
    { name: 'depth', min: 0, max: 8, def: 1.5 },          // ms either side of the delay
    { name: 'delay', min: 0.2, max: 10, def: 2.5 },       // ms
    { name: 'feedback', min: -0.95, max: 0.95, def: 0.5 },
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.5 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_MS / 1000) + 4;
    const buf = [new Float32Array(size), new Float32Array(size)];
    const fbState = [0, 0];
    let w = 0, phase = 0;
    const ms = sampleRate / 1000;
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const inc = params[slots[RATE]] / sampleRate, depth = params[slots[DEPTH]], delay = params[slots[DELAY]];
        const fb = params[slots[FEEDBACK]], offset = 0.25 * params[slots[WIDTH]], mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < 2; c++) {
            const lfo = Math.sin(2 * Math.PI * (phase + (c ? offset : 0)));
            const pos = Math.max(1, Math.min(size - 3, (delay + depth * lfo) * ms));
            let r = w - pos;
            if (r < 0) r += size;
            const k = r | 0, f = r - k, k1 = k + 1 === size ? 0 : k + 1, b = buf[c];
            const wet = b[k] + (b[k1] - b[k]) * f;
            const dry = ins[c][i];
            const v = dry + fb * wet;
            b[w] = Math.abs(v) < 1e-20 ? 0 : v;
            outs[c][i] = dry + wet * mix;
          }
          if (++w === size) w = 0;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
