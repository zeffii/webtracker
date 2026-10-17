// Noise gate, stereo-linked: the louder channel drives the detector and both channels get the same gain.
// The gate opens when the level rises above the threshold and closes once it has stayed below the threshold minus
// the hysteresis for the hold time; closing lowers the gain to range (in dB, -80 is as good as silence).
// Attack and release smooth the gain, so a short attack and a hold with a quick release gives the gated-reverb
// chop of the eighties. A detector that falls over about 3 ms keeps the gate from chattering on a waveform.
const THRESHOLD = 0, HYST = 1, ATTACK = 2, HOLD = 3, RELEASE = 4, RANGE = 5;
const DB = 20 / Math.LN10, LIN = Math.LN10 / 20;

export default {
  type: 'gate',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'gate',
  params: [
    { name: 'threshold', min: -80, max: 0, def: -40 },   // dB
    { name: 'hyst', min: 0, max: 24, def: 6 },           // dB below the threshold before it may close
    { name: 'attack', min: 0.05, max: 100, def: 1 },     // ms
    { name: 'hold', min: 0, max: 2000, def: 80 },        // ms
    { name: 'release', min: 1, max: 2000, def: 120 },    // ms
    { name: 'range', min: -80, max: 0, def: -80 },       // dB left when closed; 0 does nothing
  ],
  create({ sampleRate }) {
    let env = 0, gain = 1, open = false, held = 0;
    const coef = ms => Math.exp(-1 / (ms * 0.001 * sampleRate));
    const fall = coef(3);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const T = Math.pow(10, params[slots[THRESHOLD]] / 20), Tc = Math.pow(10, (params[slots[THRESHOLD]] - params[slots[HYST]]) / 20);
        const ca = coef(params[slots[ATTACK]]), cr = coef(params[slots[RELEASE]]), hold = params[slots[HOLD]] * 0.001 * sampleRate;
        const floor = Math.exp(params[slots[RANGE]] * LIN);
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR[i], level = Math.max(Math.abs(l), Math.abs(r));
          env = level > env ? level : env * fall;
          if (env >= T) { open = true; held = hold; }
          else if (open) {
            if (env >= Tc) held = hold;                // still above the closing level: keep waiting
            else if (held-- <= 0) open = false;
          }
          const target = open ? 1 : floor;
          gain = target > gain ? target + (gain - target) * ca : target + (gain - target) * cr;
          outL[i] = l * gain; outR[i] = r * gain;
        }
      },
    };
  },
};
