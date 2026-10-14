// Stereo chorus: up to four modulated taps per channel, spread around the lfo cycle so
// they drift against each other. The right channel's lfo is offset by `width` (a quarter
// cycle at 1), which is what makes it wide. out = dry + wet * mix.
const RATE = 0, DEPTH = 1, DELAY = 2, VOICES = 3, WIDTH = 4, MIX = 5;
const MAX_MS = 60;

export default {
  type: 'chorus',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'chorus',
  params: [
    { name: 'rate', min: 0.05, max: 8, def: 0.6 },                 // Hz
    { name: 'depth', min: 0, max: 15, def: 4 },                    // ms
    { name: 'delay', min: 5, max: 35, def: 15 },                   // ms
    { name: 'voices', min: 1, max: 4, def: 3, int: true },
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.5 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_MS / 1000) + 4;
    const bufL = new Float32Array(size), bufR = new Float32Array(size);
    let w = 0, phase = 0, depth = -1, delay = -1;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.05));   // per sample, so parameter moves do not click
    const ms = sampleRate / 1000;
    const read = (buf, pos) => {
      let r = w - pos;
      if (r < 0) r += size;
      const k = r | 0, f = r - k, k1 = k + 1 === size ? 0 : k + 1;
      return buf[k] + (buf[k1] - buf[k]) * f;
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const inc = params[slots[RATE]] / sampleRate, voices = Math.max(1, Math.round(params[slots[VOICES]]));
        const depthT = params[slots[DEPTH]], delayT = params[slots[DELAY]];
        const offset = 0.25 * params[slots[WIDTH]], mix = params[slots[MIX]];
        if (depth < 0) { depth = depthT; delay = delayT; }
        for (let i = 0; i < n; i++) {
          depth += (depthT - depth) * slew;
          delay += (delayT - delay) * slew;
          let wl = 0, wr = 0;
          for (let v = 0; v < voices; v++) {
            const p = phase + v / voices;
            wl += read(bufL, (delay + depth * Math.sin(2 * Math.PI * p)) * ms);
            wr += read(bufR, (delay + depth * Math.sin(2 * Math.PI * (p + offset))) * ms);
          }
          const l = inL[i], r = inR[i];
          outL[i] = l + (wl / voices) * mix;
          outR[i] = r + (wr / voices) * mix;
          bufL[w] = Math.abs(l) < 1e-20 ? 0 : l;
          bufR[w] = Math.abs(r) < 1e-20 ? 0 : r;
          if (++w === size) w = 0;
          phase += inc;
          if (phase >= 1) phase -= 1;
        }
      },
    };
  },
};
