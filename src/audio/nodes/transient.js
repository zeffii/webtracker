// Transient designer: a fast and a slow envelope follower on the stereo sum; where the fast
// one is above the slow one a note is attacking, where it is below, the sound is sustaining.
// attack and sustain are gains from -1 (cut up to 12 dB) to +1 (boost up to 12 dB) applied
// to those two parts. speed scales all the follower times. The detection is shared by both
// channels, so the stereo image does not move.
const ATTACK = 0, SUSTAIN = 1, SPEED = 2;
const MAX_DB = 12, RANGE_DB = 6, DEADZONE_DB = 1.5;   // small differences (the ripple of a low steady tone) do nothing

export default {
  type: 'transient',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'transient',
  params: [
    { name: 'attack', min: -1, max: 1, def: 0 },
    { name: 'sustain', min: -1, max: 1, def: 0 },
    { name: 'speed', min: 0.25, max: 4, def: 1 },
  ],
  create({ sampleRate }) {
    let fast = 0, slow = 0, gain = 1;
    const coef = ms => Math.exp(-1 / (ms * 0.001 * sampleRate));
    const smooth = coef(2);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const attack = params[slots[ATTACK]], sustain = params[slots[SUSTAIN]], speed = params[slots[SPEED]];
        const fa = coef(1 / speed), fr = coef(20 / speed), sa = coef(25 / speed), sr = coef(120 / speed);
        for (let i = 0; i < n; i++) {
          const level = Math.abs(inL[i] + inR[i]) * 0.5;
          fast = level > fast ? level + (fast - level) * fa : level + (fast - level) * fr;
          slow = level > slow ? level + (slow - level) * sa : level + (slow - level) * sr;
          const d = 20 * Math.log10((fast + 1e-6) / (slow + 1e-6));   // dB, + while attacking, - while decaying
          const up = Math.max(d - DEADZONE_DB, 0), down = Math.max(-d - DEADZONE_DB, 0);
          const db = attack * MAX_DB * Math.min(up / RANGE_DB, 1) + sustain * MAX_DB * Math.min(down / RANGE_DB, 1);
          const target = Math.pow(10, db / 20);
          gain = target + (gain - target) * smooth;
          outL[i] = inL[i] * gain;
          outR[i] = inR[i] * gain;
        }
        if (Math.abs(fast) < 1e-20) fast = 0;
        if (Math.abs(slow) < 1e-20) slow = 0;
      },
    };
  },
};
