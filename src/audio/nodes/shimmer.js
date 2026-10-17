// Shimmer reverb: the hall reverb with a pitch shifter in its feedback. What the reverb produces is shifted (by
// default an octave up) and fed back in, so every pass of the tail climbs, and the sound blooms upward into a bright,
// choir-like cloud. `shimmer` is how much comes back round (the more, the longer the climb lasts), `pitch` the
// interval in semitones, `tone` rolls the highs off the fed-back sound so the climb stays soft. The reverb itself is
// the hall's (size, decay, damp, predelay). The loop runs a block behind, a few milliseconds, which is inaudible in a
// tail. out = dry * (1 - mix) + wet * mix.
import hall from './hall.js';

const SIZE = 0, DECAY = 1, DAMP = 2, PREDELAY = 3, PITCH = 4, SHIMMER = 5, TONE = 6, WIDTH = 7, MIX = 8;
const WINDOW_MS = 80;

export default {
  type: 'shimmer',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'shimmer',
  params: [
    { name: 'size', min: 0.5, max: 2, def: 1.2 },
    { name: 'decay', min: 0.2, max: 20, def: 5 },
    { name: 'damp', min: 0, max: 1, def: 0.35 },
    { name: 'predelay', min: 0, max: 200, def: 20 },
    { name: 'pitch', min: -12, max: 24, def: 12 },          // semitones
    { name: 'shimmer', min: 0, max: 0.95, def: 0.4 },       // how much of the shifted tail comes back
    { name: 'tone', min: 0, max: 1, def: 0.6 },             // brightness of the fed-back sound
    { name: 'width', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 0.4 },
  ],
  create({ sampleRate, maxBlock = 512 }) {
    const core = hall.create({ sampleRate });
    const inner = new Float32Array(8), innerSlots = Int32Array.from({ length: 8 }, (_, i) => i);
    const W = Math.round(WINDOW_MS * 0.001 * sampleRate), buf = new Float32Array(W + 2);
    let w = 0, ph = 0, lp = 0;
    let fb = new Float32Array(maxBlock), mixL = new Float32Array(maxBlock), mixR = new Float32Array(maxBlock);
    let wetL = new Float32Array(maxBlock), wetR = new Float32Array(maxBlock);
    const read = d => {   // d samples back, linear
      let r = w - d;
      if (r < 0) r += buf.length;
      const k = r | 0, f = r - k, k1 = k + 1 === buf.length ? 0 : k + 1;
      return buf[k] + (buf[k1] - buf[k]) * f;
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        if (fb.length < n) { fb = new Float32Array(n); mixL = new Float32Array(n); mixR = new Float32Array(n); wetL = new Float32Array(n); wetR = new Float32Array(n); }
        const g = i => params[slots[i]];
        // the reverb alone, fully wet, with the shifted feedback from the last block added to its input
        inner[0] = g(SIZE); inner[1] = g(DECAY); inner[2] = g(DAMP); inner[3] = g(PREDELAY);
        inner[4] = 0.8; inner[5] = 0.4; inner[6] = g(WIDTH); inner[7] = 1;
        for (let i = 0; i < n; i++) { mixL[i] = inL[i] + fb[i]; mixR[i] = inR[i] + fb[i]; }
        core.process([[mixL, mixR]], [[wetL, wetR]], n, inner, innerSlots);
        // pitch shift the wet mono sound for the next block: four read points sliding through the buffer, crossfaded
        const ratio = Math.pow(2, g(PITCH) / 12), amount = g(SHIMMER);
        const dph = (1 - ratio) / W;
        const c = 1 - Math.exp(-2 * Math.PI * (500 + 14000 * g(TONE) ** 2) / sampleRate);
        for (let i = 0; i < n; i++) {
          buf[w] = (wetL[i] + wetR[i]) * 0.5;
          if (++w === buf.length) w = 0;
          ph += dph; if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
          let s = 0;   // four read points a quarter of a window apart, so no one fade ever leaves a hole
          for (let k = 0; k < 4; k++) { const q = ph + 0.25 * k - (ph + 0.25 * k >= 1 ? 1 : 0); s += read(1 + q * W) * (0.5 - 0.5 * Math.cos(2 * Math.PI * q)); }
          s *= 0.5;
          lp += c * (s - lp);
          const z = lp * 1.5, z2 = z * z;
          fb[i] = (z > 3 ? 1 : z < -3 ? -1 : z * (27 + z2) / (27 + 9 * z2)) * amount * 0.9;   // soft clip: the loop can never run away
        }
        const mix = g(MIX);
        for (let i = 0; i < n; i++) {
          outL[i] = inL[i] + (wetL[i] - inL[i]) * mix;
          outR[i] = inR[i] + (wetR[i] - inR[i]) * mix;
        }
      },
    };
  },
};
