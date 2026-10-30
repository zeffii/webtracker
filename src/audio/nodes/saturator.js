// Saturator, stereo: warmth and thickness from a curve, simply. `drive` pushes the sound into the curve (in dB; the level is
// kept about the same, so you can hear what the curve does rather than only that it is louder), `type` picks the curve (soft,
// tape, tube, clip: see saturation.js) and `bias` leans on it to add even harmonics. `bass` keeps everything below that
// frequency out of the curve, so a bass or a kick stays solid and clean while the rest warms up (20 Hz is off). `tone` is a
// lowpass after the curve, taking off the top the curve makes. `mix` blends with the dry sound and `out` is the level.
// `quality`: standard runs the curve at 2x oversampling, eco at 1x (cheaper, a little more aliasing), hq at 4x.
import { oversampleLatency } from '../latency.js';
import { Stage, settings, makeDelay, offsetK, TYPES, QUALITY, qualityOf, dbToGain } from './saturation.js';

const DRIVE = 0, TYPE = 1, BIAS = 2, BASS = 3, TONE = 4, MIX = 5, OUT = 6, QUALITY_AT = 7;

export default {
  type: 'saturator',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'saturator',
  latency: p => oversampleLatency([2, 1, 4][qualityOf(p.quality)]),   // the oversampling's filters
  params: [
    { name: 'drive', min: 0, max: 36, def: 12 },                 // dB
    { name: 'type', min: 0, max: 3, def: 0, int: true },          // soft, tape, tube, clip
    { name: 'bias', min: -1, max: 1, def: 0 },
    { name: 'bass', min: 20, max: 500, def: 20, scale: 'log' },   // Hz: below this stays clean (20 is off)
    { name: 'tone', min: 1000, max: 20000, def: 20000, scale: 'log' },   // Hz: lowpass after the curve (20000 is off)
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'out', min: -24, max: 12, def: 0 },                   // dB
    { name: 'quality', min: 0, max: 2, def: 0, int: true },       // standard, eco, hq
  ],
  create({ sampleRate }) {
    const stages = [new Stage(), new Stage()], dryDelay = [makeDelay(), makeDelay()], lowDelay = [makeDelay(), makeDelay()];
    const lowpass = [0, 0], tone = [0, 0];
    const hpK = offsetK(sampleRate);
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const quality = qualityOf(params[slots[QUALITY_AT]]);
        const s = settings(params[slots[TYPE]], params[slots[DRIVE]], params[slots[BIAS]]);
        const bass = params[slots[BASS]], split = bass > 20.5, bassK = 1 - Math.exp((-2 * Math.PI * Math.min(bass, sampleRate * 0.45)) / sampleRate);
        const toneHz = params[slots[TONE]], toneOn = toneHz < 19900, toneK = 1 - Math.exp((-2 * Math.PI * Math.min(toneHz, sampleRate * 0.45)) / sampleRate);
        const mix = params[slots[MIX]], out = dbToGain(params[slots[OUT]]);
        for (let c = 0; c < 2; c++) {
          const x = ins[c], y = outs[c], stage = stages[c], wait = stage.latency(quality);
          for (let i = 0; i < n; i++) {
            let low = 0, high = x[i];
            if (split) { lowpass[c] += (x[i] - lowpass[c]) * bassK; low = lowpass[c]; high = x[i] - low; }
            let wet = stage.run(high, s, quality, hpK) + (split ? lowDelay[c].push(low, wait) : 0);
            if (toneOn) { tone[c] += (wet - tone[c]) * toneK; wet = tone[c]; } else tone[c] = wet;
            const dry = dryDelay[c].push(x[i], wait);
            y[i] = (dry + (wet - dry) * mix) * out;
          }
        }
      },
    };
  },
};
export { TYPES, QUALITY };
