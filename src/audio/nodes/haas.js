// Haas widener: one side is played a few milliseconds after the other. Inside about 35 ms the ear does not hear an echo but a sound that comes
// from the earlier side (the precedence effect), and a wider one. The delayed side can be duller and a little quieter, which makes it
// more natural. In mono the two sides add into a comb of notches (the panel shows where): a cost to know about, so keep the time short or `mix` low
// for material that will be played in mono. One delay line and a one-pole filter.
const TIME = 0, GAIN = 1, SIDE = 2, DAMP = 3, MIX = 4;
const MAX_MS = 45;

export default {
  type: 'haas',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'haas',
  editor: 'haas',
  params: [
    { name: 'time', min: 0, max: MAX_MS, def: 14 },     // ms
    { name: 'gain', min: 0, max: 1.2, def: 0.9 },
    { name: 'side', min: 0, max: 1, def: 1, int: true }, // which side is late: 0 left, 1 right
    { name: 'damp', min: 1000, max: 20000, def: 9000 },  // Hz: the late side loses its top
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_MS / 1000) + 4;
    const buf = new Float32Array(size);
    let w = 0, d = -1, lp = 0;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.05));
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const target = params[slots[TIME]] * sampleRate / 1000, gain = params[slots[GAIN]], right = params[slots[SIDE]] >= 0.5, mix = params[slots[MIX]];
        const c = 1 - Math.exp(-2 * Math.PI * params[slots[DAMP]] / sampleRate);
        if (d < 0) d = target;
        for (let i = 0; i < n; i++) {
          d += (target - d) * slew;
          const x = right ? inR[i] : inL[i];
          buf[w] = Math.abs(x) < 1e-20 ? 0 : x;
          let p = w - d; if (p < 0) p += size;
          const j = p | 0, f = p - j, s = buf[j] + (buf[j + 1 === size ? 0 : j + 1] - buf[j]) * f;
          lp += (s - lp) * c;
          const late = x + (lp * gain - x) * mix;
          if (right) { outL[i] = inL[i]; outR[i] = late; } else { outL[i] = late; outR[i] = inR[i]; }
          if (++w === size) w = 0;
        }
      },
    };
  },
};
