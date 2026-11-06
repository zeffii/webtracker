// Early reflections: the first echoes a room gives a sound, from the box of a room you set. The image-source method (spacecore.js) turns the
// walls, floor and ceiling into mirrors; each mirror image of the source is a tap of one delay line, with the delay and the level of the way
// it travelled and the side it comes from. Up to 32 taps, a handful of multiplies each. The dry sound stays as it is; `mix` is the level of the
// reflections. No tail: put a reverb after it for that.
import { reflections, MAX_TAPS } from '../spacecore.js';

const WIDTH = 0, DEPTH = 1, HEIGHT = 2, SX = 3, SY = 4, LX = 5, LY = 6, ABSORB = 7, TAPS = 8, DAMP = 9, MIX = 10;
const MAX_S = 0.6;

export default {
  type: 'reflect',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'reflect',
  editor: 'reflect',
  params: [
    { name: 'width', min: 2, max: 60, def: 8 },      // m
    { name: 'depth', min: 2, max: 60, def: 11 },     // m
    { name: 'height', min: 2, max: 20, def: 4 },     // m
    { name: 'srcx', min: 0, max: 1, def: 0.3 },      // the sound's place on the floor, as a fraction of the width
    { name: 'srcy', min: 0, max: 1, def: 0.75 },
    { name: 'lisx', min: 0, max: 1, def: 0.55 },     // the listener's place; they face the far wall (up on the panel)
    { name: 'lisy', min: 0, max: 1, def: 0.2 },
    { name: 'absorb', min: 0, max: 0.95, def: 0.3 },
    { name: 'taps', min: 1, max: MAX_TAPS, def: 16, int: true },
    { name: 'damp', min: 1000, max: 20000, def: 9000 },   // Hz: the reflections lose their top, as they do on a wall
    { name: 'mix', min: 0, max: 1.5, def: 0.6 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_S) + 8;
    const buf = new Float32Array(size);
    let w = 0, key = '';
    const delay = new Float32Array(MAX_TAPS), gl = new Float32Array(MAX_TAPS), gr = new Float32Array(MAX_TAPS);
    const tDelay = new Float32Array(MAX_TAPS), tl = new Float32Array(MAX_TAPS), tr = new Float32Array(MAX_TAPS);
    let live = 0, fresh = true, lpL = 0, lpR = 0;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.03));
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const p = i => params[slots[i]];
        const k = [p(WIDTH), p(DEPTH), p(HEIGHT), p(SX), p(SY), p(LX), p(LY), p(ABSORB), p(TAPS)].join();
        if (k !== key) {
          key = k;
          const room = reflections({ w: p(WIDTH), d: p(DEPTH), h: p(HEIGHT), s: { x: p(SX), y: p(SY) }, l: { x: p(LX), y: p(LY) }, absorb: p(ABSORB) }, p(TAPS));
          live = 0;
          for (const t of room.list) {
            const rel = (t.delay - room.direct) * sampleRate;   // the dry sound is the direct one; the taps come after it
            if (rel < 1 || rel > size - 4) continue;
            const a = (t.pan + 1) * Math.PI / 4;
            tDelay[live] = rel; tl[live] = Math.cos(a) * t.gain; tr[live] = Math.sin(a) * t.gain;
            live++;
          }
          if (fresh) { delay.set(tDelay); gl.set(tl); gr.set(tr); fresh = false; }
          for (let i = live; i < MAX_TAPS; i++) { tl[i] = 0; tr[i] = 0; }
        }
        const mix = p(MIX), lp = 1 - Math.exp(-2 * Math.PI * p(DAMP) / sampleRate);
        for (let i = 0; i < n; i++) {
          const x = (inL[i] + inR[i]) * 0.5;
          buf[w] = Math.abs(x) < 1e-20 ? 0 : x;
          let l = 0, r = 0;
          for (let t = 0; t < MAX_TAPS; t++) {
            delay[t] += (tDelay[t] - delay[t]) * slew; gl[t] += (tl[t] - gl[t]) * slew; gr[t] += (tr[t] - gr[t]) * slew;
            if (gl[t] < 1e-5 && gr[t] < 1e-5 && tl[t] === 0 && tr[t] === 0) continue;
            let rp = w - delay[t];
            if (rp < 0) rp += size;
            const j = rp | 0, f = rp - j, s = buf[j] + (buf[j + 1 === size ? 0 : j + 1] - buf[j]) * f;
            l += s * gl[t]; r += s * gr[t];
          }
          lpL += (l - lpL) * lp; lpR += (r - lpR) * lp;
          outL[i] = inL[i] + lpL * mix; outR[i] = inR[i] + lpR * mix;
          if (++w === size) w = 0;
        }
      },
    };
  },
};
