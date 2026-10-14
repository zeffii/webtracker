// A small ADSR state machine shared by the synth nodes (env.js keeps its own copy). Attack is
// linear; decay and release are exponential, with times to fall by 60 dB. A note on restarts
// the attack from the current level, note off releases, a cut zeroes it.
const IDLE = 0, ATTACKING = 1, DECAYING = 2, RELEASING = 3;
const LN_60DB = Math.log(0.001);

export class Adsr {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.stage = IDLE;
    this.level = 0;
    this.attackStep = 1; this.decayCoef = 0.99; this.releaseCoef = 0.99; this.sustain = 1;
  }
  // times in ms; call once per block
  set(attack, decay, sustain, release) {
    const ms = this.sr * 0.001;
    this.attackStep = 1 / (Math.max(0.1, attack) * ms);
    this.decayCoef = Math.exp(LN_60DB / (Math.max(1, decay) * ms));
    this.releaseCoef = Math.exp(LN_60DB / (Math.max(1, release) * ms));
    this.sustain = sustain;
  }
  get idle() { return this.stage === IDLE; }
  on() { this.stage = ATTACKING; }
  off() { if (this.stage === ATTACKING || this.stage === DECAYING) this.stage = RELEASING; }
  cut() { this.stage = IDLE; this.level = 0; }
  next() {
    const s = this.stage;
    if (s === ATTACKING) {
      this.level += this.attackStep;
      if (this.level >= 1) { this.level = 1; this.stage = DECAYING; }
    } else if (s === DECAYING) {
      this.level = this.sustain + (this.level - this.sustain) * this.decayCoef;
      if (this.level - this.sustain < 1e-6) this.level = this.sustain;
    } else if (s === RELEASING) {
      this.level *= this.releaseCoef;
      if (this.level < 1e-6) { this.level = 0; this.stage = IDLE; }
    }
    return this.level;
  }
}
