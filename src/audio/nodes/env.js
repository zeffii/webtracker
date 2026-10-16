// ADSR envelope, one per instrument (monophonic). A note on restarts the attack from
// the current level; note off, all-off and the end of the pattern release it; a cut
// zeroes it. Decay and release are exponential and the times are to fall by 60 dB.
// The output is level * amount, so amount sets the size of the swing (for example
// the number of octaves when it drives an oscillator's fm input). vel is how much
// the note's velocity scales the output.
const ATTACK = 0, DECAY = 1, SUSTAIN = 2, RELEASE = 3, AMOUNT = 4, VEL = 5;
const IDLE = 0, ATTACKING = 1, DECAYING = 2, RELEASING = 3;
const LN_60DB = Math.log(0.001);

export default {
  type: 'env',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'adsr',
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }],   // drawn beside the node when it is selected
  kinds: { out: 'control' },   // ports are audio unless listed
  params: [
    { name: 'attack', min: 0.1, max: 5000, def: 1 },      // ms
    { name: 'decay', min: 1, max: 5000, def: 200 },       // ms
    { name: 'sustain', min: 0, max: 1, def: 0 },
    { name: 'release', min: 1, max: 5000, def: 100 },     // ms
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'vel', min: 0, max: 1, def: 0 },
  ],
  create({ sampleRate }) {
    let stage = IDLE, level = 0, velocity = 1;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { stage = ATTACKING; velocity = msg.vel ?? 1; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') { if (stage === ATTACKING || stage === DECAYING) stage = RELEASING; }
        else if (msg.type === 'noteCut') { stage = IDLE; level = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        const attackStep = 1 / (Math.max(0.1, params[slots[ATTACK]]) * 0.001 * sampleRate);
        const decayCoef = Math.exp(LN_60DB / (Math.max(1, params[slots[DECAY]]) * 0.001 * sampleRate));
        const releaseCoef = Math.exp(LN_60DB / (Math.max(1, params[slots[RELEASE]]) * 0.001 * sampleRate));
        const sustain = params[slots[SUSTAIN]];
        const scale = params[slots[AMOUNT]] * (1 - params[slots[VEL]] + params[slots[VEL]] * velocity);
        for (let i = 0; i < n; i++) {
          if (stage === ATTACKING) {
            level += attackStep;
            if (level >= 1) { level = 1; stage = DECAYING; }
          } else if (stage === DECAYING) {
            level = sustain + (level - sustain) * decayCoef;
            if (level - sustain < 1e-6) level = sustain;   // settles exactly, no denormals
          } else if (stage === RELEASING) {
            level *= releaseCoef;
            if (level < 1e-6) { level = 0; stage = IDLE; }
          }
          out[i] = level * scale;
        }
      },
    };
  },
};
