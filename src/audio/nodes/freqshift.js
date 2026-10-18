// Frequency shifter: every frequency in the sound moves up (or down) by the same number of Hz, which is not the same
// as changing pitch: harmonics stop being multiples of the fundamental, so small shifts give a slow, shimmering detune
// and large ones make bells, metal and robot voices. It works by making a 90 degree shifted copy of the sound
// (a pair of allpass chains, the usual cheap Hilbert transform) and mixing the two with a sine and a cosine at the
// shift frequency. `feedback` sends the shifted sound back in, so each pass climbs another step: rising or falling
// spirals (the "barber pole"). Stereo, both sides shifted by the same oscillator.
const SHIFT = 0, FEEDBACK = 1, MIX = 2;
// coefficients of the two chains (squared inside), after Olli Niemitalo's design: 90 degrees apart over most of the audio range
const A1 = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map(v => v * v);
const A2 = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map(v => v * v);

class Hilbert {
  constructor() {
    this.x1 = new Float64Array(4); this.x2 = new Float64Array(4); this.y1 = new Float64Array(4); this.y2 = new Float64Array(4);   // per section: input and output, 1 and 2 samples ago, for chain 1 ...
    this.u1 = new Float64Array(4); this.u2 = new Float64Array(4); this.v1 = new Float64Array(4); this.v2 = new Float64Array(4);   // ... and chain 2
    this.delay = 0;
  }
  // returns [in phase, quadrature] in this.i, this.q
  run(x) {
    let a = x, b = x;
    for (let k = 0; k < 4; k++) {
      const ya = A1[k] * (a + this.y2[k]) - this.x2[k];
      this.x2[k] = this.x1[k]; this.x1[k] = a; this.y2[k] = this.y1[k]; this.y1[k] = ya; a = ya;
      const yb = A2[k] * (b + this.v2[k]) - this.u2[k];
      this.u2[k] = this.u1[k]; this.u1[k] = b; this.v2[k] = this.v1[k]; this.v1[k] = yb; b = yb;
    }
    this.q = b;
    this.i = this.delay; this.delay = a;   // the first chain is one sample late
  }
}

export default {
  type: 'freqshift',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'freqshift',
  params: [
    { name: 'shift', min: -1000, max: 1000, def: 7 },   // Hz, up or down
    { name: 'feedback', min: 0, max: 0.9, def: 0 },
    { name: 'mix', min: 0, max: 1, def: 0.5 },
  ],
  create({ sampleRate }) {
    const h = [new Hilbert(), new Hilbert()];
    let phase = 0, fb = [0, 0];
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0];
        const inc = params[slots[SHIFT]] / sampleRate, feedback = params[slots[FEEDBACK]], mix = params[slots[MIX]];
        for (let i = 0; i < n; i++) {
          const c = Math.cos(2 * Math.PI * phase), s = Math.sin(2 * Math.PI * phase);
          for (let ch = 0; ch < 2; ch++) {
            const dry = ins[ch][i];
            h[ch].run(dry + fb[ch] * feedback);
            const wet = h[ch].i * c + h[ch].q * s;
            fb[ch] = Math.abs(wet) < 1e-20 ? 0 : Math.tanh(wet);
            outs[ch][i] = dry + (wet - dry) * mix;
          }
          phase += inc;
          phase -= Math.floor(phase);
        }
      },
    };
  },
};
