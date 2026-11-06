// Ring modulator with a carrier that can follow the pitch of what it hears: tracked, the sidebands stay in a fixed relation to the note, so a
// melody stays a melody (at ratio 1 it doubles the note's overtones, at 0.5 or 2 it gives octaves and fifths; an offset of a few Hz makes it
// inharmonic and bell-like). Fixed, it is the classic ring modulator. The pitch is found by counting zero crossings of the lowpassed input,
// which is cheap and good enough for a single voice. Output = in x (1 - depth + depth x carrier), blended with the dry by mix.
import { carrierAt } from '../spacecore.js';

const FREQ = 0, TRACK = 1, RATIO = 2, OFFSET = 3, WAVE = 4, DEPTH = 5, MIX = 6;

export default {
  type: 'ringmod',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'ringmod',
  editor: 'ringmod',
  params: [
    { name: 'freq', min: 0.1, max: 5000, def: 220 },    // Hz: the carrier when it is fixed, and when no pitch is heard
    { name: 'track', min: 0, max: 1, def: 1, int: true },
    { name: 'ratio', min: 0.25, max: 8, def: 1 },       // carrier = pitch x ratio
    { name: 'offset', min: -500, max: 500, def: 0 },    // Hz added to the carrier
    { name: 'wave', min: 0, max: 3, def: 0, int: true },   // sine, triangle, square, saw
    { name: 'depth', min: 0, max: 1, def: 1 },
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate, emit }) {
    let phase = 0, f0 = 0, fc = 220, lp = 0, prev = 0, since = 0, silent = 0, watchLeft = 0, sent = 0;
    const lpc = 1 - Math.exp(-2 * Math.PI * 1200 / sampleRate);
    const lo = 40, hi = 2000;
    let env = 0;
    return {
      message(m) { if (m?.type === 'watch') watchLeft = sampleRate * 3; },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const track = params[slots[TRACK]] >= 0.5, fixed = params[slots[FREQ]], ratio = params[slots[RATIO]], off = params[slots[OFFSET]];
        const wave = Math.round(params[slots[WAVE]]), depth = params[slots[DEPTH]], mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          const x = (inL[i] + inR[i]) * 0.5;
          lp += (x - lp) * lpc;
          env += (Math.abs(x) - env) * 0.002;
          since++;
          if (prev < 0 && lp >= 0) {   // a rising zero crossing: the time since the last is one period
            const hz = sampleRate / since;
            if (hz > lo && hz < hi && env > 0.003) f0 = f0 > 0 && Math.abs(hz / f0 - 1) < 0.5 ? f0 + (hz - f0) * 0.35 : hz;
            since = 0;
          }
          prev = lp;
          if (since > sampleRate * 0.05 && env < 0.002) f0 = 0;
          const want = track && f0 > 0 ? f0 * ratio + off : fixed + (track ? off : 0);
          fc += (Math.max(0.1, want) - fc) * 0.002;
          phase += fc / sampleRate; if (phase >= 1) phase -= 1;
          const g = 1 - depth + depth * carrierAt(phase, wave);
          outL[i] = inL[i] + (inL[i] * g - inL[i]) * mix; outR[i] = inR[i] + (inR[i] * g - inR[i]) * mix;
        }
        if (watchLeft > 0 && emit) {
          watchLeft -= n; sent += n;
          if (sent >= sampleRate * 0.1) { sent = 0; emit({ type: 'ring', f0, fc }); }
        }
      },
    };
  },
};
