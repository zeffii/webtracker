// Stereo multi-tap delay. The input is summed to mono into one line; tap k is read at
// k * time, scaled by decay^(k-1), and panned (equal power) along a sweep from left to
// right across the taps, narrowed by `spread`. The last tap feeds back. Dry stays stereo.
const TIME = 0, TAPS = 1, DECAY = 2, SPREAD = 3, FEEDBACK = 4, MIX = 5;
const MAX_TAPS = 8, MAX_TIME_MS = 1000;

export default {
  type: 'multitap',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'multitap',
  params: [
    { name: 'time', min: 1, max: MAX_TIME_MS, def: 180 },     // ms between taps
    { name: 'taps', min: 1, max: MAX_TAPS, def: 4, int: true },
    { name: 'decay', min: 0, max: 1, def: 0.7 },              // level of each tap relative to the one before
    { name: 'spread', min: 0, max: 1, def: 0.8 },
    { name: 'feedback', min: 0, max: 0.9, def: 0.3 },
    { name: 'mix', min: 0, max: 1, def: 0.4 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_TAPS * MAX_TIME_MS / 1000) + 4;
    const buf = new Float32Array(size);
    let w = 0, d = -1;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.05));
    const gain = new Float64Array(MAX_TAPS), gl = new Float64Array(MAX_TAPS), gr = new Float64Array(MAX_TAPS);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const target = Math.min(Math.max(params[slots[TIME]] * 0.001 * sampleRate, 1), size / MAX_TAPS - 2);
        const taps = Math.min(MAX_TAPS, Math.max(1, Math.round(params[slots[TAPS]])));
        const decay = params[slots[DECAY]], spread = params[slots[SPREAD]], fb = params[slots[FEEDBACK]], mix = params[slots[MIX]];
        if (d < 0) d = target;
        for (let k = 0; k < taps; k++) {   // per tap level and pan, once per block
          const p = taps === 1 ? 0 : spread * ((2 * k) / (taps - 1) - 1);
          const a = (p + 1) * Math.PI / 4;
          gain[k] = Math.pow(decay, k);
          gl[k] = gain[k] * Math.SQRT2 * Math.cos(a);
          gr[k] = gain[k] * Math.SQRT2 * Math.sin(a);
        }
        for (let i = 0; i < n; i++) {
          d += (target - d) * slew;
          let wl = 0, wr = 0, last = 0;
          for (let k = 0; k < taps; k++) {
            let r = w - d * (k + 1);
            if (r < 0) r += size;
            const j = r | 0, f = r - j, j1 = j + 1 === size ? 0 : j + 1;
            const v = buf[j] + (buf[j1] - buf[j]) * f;
            wl += v * gl[k];
            wr += v * gr[k];
            last = v;
          }
          const l = inL[i], r = inR[i];
          outL[i] = l + wl * mix;
          outR[i] = r + wr * mix;
          const v = (l + r) * 0.5 + last * fb;
          buf[w] = Math.abs(v) < 1e-20 ? 0 : v;   // no slow denormals in a long tail
          if (++w === size) w = 0;
        }
      },
    };
  },
};
