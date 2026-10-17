// Envelope effect: shapes the level of whatever passes through it with an ADSR you trigger by hand. Stereo in, stereo out.
// The trig parameter is the trigger (expose it as a 1hex column): a value above 0 starts the envelope (an attack,
// then a decay down to sustain, held there), 0 starts the release; writing a different non-zero value while it is
// on starts the attack again from where it is. Before the first trigger, and once released, the signal sits at
// range (in dB, -80 is as good as silent; 0 dB lets everything through whatever the envelope does). Set sustain to
// 0 for a percussive hit that dies by itself after the decay.
import { Adsr } from './adsr.js';

const TRIG = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, RANGE = 5;
const LIN = Math.LN10 / 20;

export default {
  type: 'envfx',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'adsr',
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }],   // the envelope the patcher draws beside the node
  params: [
    { name: 'trig', min: 0, max: 15, def: 0, int: true },   // 0 releases, anything else triggers
    { name: 'attack', min: 0.1, max: 5000, def: 5 },        // ms
    { name: 'decay', min: 1, max: 5000, def: 300 },
    { name: 'sustain', min: 0, max: 1, def: 0.7 },
    { name: 'release', min: 1, max: 5000, def: 300 },
    { name: 'range', min: -80, max: 0, def: -80 },          // dB: the level with the envelope at 0
  ],
  create({ sampleRate }) {
    const env = new Adsr(sampleRate);
    let prev = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const trig = Math.round(params[slots[TRIG]]);
        if (trig !== prev) {
          if (trig > 0) env.on(); else env.off();
          prev = trig;
        }
        env.set(params[slots[ATTACK]], params[slots[DECAY]], params[slots[SUSTAIN]], params[slots[RELEASE]]);
        const floor = Math.exp(params[slots[RANGE]] * LIN);
        for (let i = 0; i < n; i++) {
          const g = floor + (1 - floor) * env.next();
          outL[i] = inL[i] * g; outR[i] = inR[i] * g;
        }
      },
    };
  },
};
