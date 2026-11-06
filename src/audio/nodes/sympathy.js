// Sympathetic strings: a set of tuned resonators that ring when the input has a partial of their pitch, the way the undamped strings of
// a piano or a sitar answer a note. Each is a short feedback delay (a string) with a low-pass in its loop (the string loses its top as it rings).
// The chord picks which pitches are strung, `ringtime` how long they ring, `detune` how far they are from perfectly in tune (a little makes
// them shimmer). Up to 12 strings, spread across the stereo field. The dry sound stays; `mix` is the level of the strings.
import { stringsOf, midiHz, MAX_STRINGS } from '../spacecore.js';

const ROOT = 0, CHORD = 1, STRINGS = 2, RING = 3, DAMP = 4, DETUNE = 5, WIDTH = 6, MIX = 7;
const LOWEST = 30;   // Hz: the longest string

export default {
  type: 'sympathy',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'sympathy',
  editor: 'sympathy',
  params: [
    { name: 'root', min: 24, max: 84, def: 48, int: true },   // MIDI note
    { name: 'chord', min: 0, max: 7, def: 1, int: true },
    { name: 'strings', min: 1, max: MAX_STRINGS, def: 8, int: true },
    { name: 'ringtime', min: 100, max: 8000, def: 2500 },   // ms to fall 60 dB
    { name: 'damp', min: 1000, max: 16000, def: 6000 },     // Hz
    { name: 'detune', min: 0, max: 30, def: 4 },            // cents
    { name: 'width', min: 0, max: 1, def: 0.7 },
    { name: 'mix', min: 0, max: 1.5, def: 0.5 },
  ],
  create({ sampleRate, emit }) {
    const size = Math.ceil(sampleRate / LOWEST) + 4;
    const bufs = Array.from({ length: MAX_STRINGS }, () => new Float32Array(size));
    const pos = new Int32Array(MAX_STRINGS), lp = new Float64Array(MAX_STRINGS), len = new Float64Array(MAX_STRINGS), fb = new Float64Array(MAX_STRINGS), energy = new Float64Array(MAX_STRINGS);
    let key = '', count = 0, watchLeft = 0, sent = 0, pans = [];
    return {
      message(m) { if (m?.type === 'watch') watchLeft = sampleRate * 3; },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const p = i => params[slots[i]];
        const k = [p(ROOT), p(CHORD), p(STRINGS), p(RING), p(DETUNE), p(WIDTH)].join();
        if (k !== key) {
          key = k;
          const notes = stringsOf(p(ROOT), p(CHORD), p(STRINGS));
          count = notes.length;
          notes.forEach((m, i) => {
            const hz = Math.max(LOWEST, midiHz(m) * Math.pow(2, ((i % 2 ? 1 : -1) * p(DETUNE) * ((i >> 1) + 1) / 3) / 1200));
            len[i] = Math.min(size - 3, sampleRate / hz);
            fb[i] = Math.pow(0.001, len[i] / (p(RING) / 1000 * sampleRate));   // the loop gain that falls 60 dB in the ring time
            const a = (count > 1 ? i / (count - 1) * 2 - 1 : 0) * p(WIDTH) * (i % 2 ? 1 : -1) * 0.5 * (1 + 0), q = (a + 1) * Math.PI / 4;
            pans[i] = [Math.cos(q), Math.sin(q)];
          });
        }
        const mix = p(MIX) / Math.sqrt(Math.max(1, count)) * 2, c = 1 - Math.exp(-2 * Math.PI * p(DAMP) / sampleRate), feed = 0.15;
        for (let i = 0; i < n; i++) {
          const x = (inL[i] + inR[i]) * 0.5 * feed;
          let l = 0, r = 0;
          for (let s = 0; s < count; s++) {
            const b = bufs[s];
            let rp = pos[s] - len[s]; if (rp < 0) rp += size;
            const j = rp | 0, f = rp - j, y = b[j] + (b[j + 1 === size ? 0 : j + 1] - b[j]) * f;
            lp[s] += (y - lp[s]) * c;
            const v = lp[s] * fb[s] + x;
            b[pos[s]] = Math.abs(v) < 1e-20 ? 0 : v;
            if (++pos[s] === size) pos[s] = 0;
            l += y * pans[s][0]; r += y * pans[s][1];
            if (watchLeft > 0) energy[s] = Math.max(energy[s] * 0.9995, Math.abs(y));
          }
          outL[i] = inL[i] + l * mix; outR[i] = inR[i] + r * mix;
        }
        if (watchLeft > 0 && emit) {
          watchLeft -= n; sent += n;
          if (sent >= sampleRate * 0.08) { sent = 0; emit({ type: 'sym', energy: Array.from(energy.subarray(0, count)) }); }
        }
      },
    };
  },
};
