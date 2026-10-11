import { SLOT } from './params.js';

const FREQ = SLOT['tone.freq'];
const LEVEL = SLOT['tone.level'];

class TrackerEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.params = new Float32Array(options.processorOptions.sab);
    // One-pole slew (about 20 ms) so fast knob moves do not zipper.
    this.slew = 1 - Math.exp(-1 / (sampleRate * 0.02));
    this.freq = this.params[FREQ];
    this.level = this.params[LEVEL];
    this.phase = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const freqTarget = this.params[FREQ];   // read once per block
    const levelTarget = this.params[LEVEL];
    const slew = this.slew;
    let freq = this.freq, level = this.level, phase = this.phase;

    for (let i = 0; i < left.length; i++) {
      freq += (freqTarget - freq) * slew;
      level += (levelTarget - level) * slew;
      left[i] = Math.sin(phase * 2 * Math.PI) * level;
      phase += freq / sampleRate;
      if (phase >= 1) phase -= 1;
    }
    for (let ch = 1; ch < out.length; ch++) out[ch].set(left);

    this.freq = freq;
    this.level = level;
    this.phase = phase;
    return true;
  }
}

registerProcessor('tracker-engine', TrackerEngine);
