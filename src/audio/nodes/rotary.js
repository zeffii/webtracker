// Rotary: a rotating speaker cabinet. The sound is split in two at `cross`: the top goes to a horn that spins, the bottom to a
// drum that spins the other way, a little slower. Two microphones stand in front of the cabinet, one to each side.
//
// What a spinning speaker does, and so what is modelled per rotor and per microphone:
//   Doppler    the speaker moves towards the microphone and away again, so the pitch wobbles (a delay that changes length)
//   tremolo    it is louder while it points at the microphone
//   tone       the horn is duller while it points away
// The two microphones hear the same thing at different moments of the turn, which is where the width comes from.
//
// `speed` is the switch: 0 stop, 1 slow, 2 fast. The rotors do not jump to a new speed, they get there: the light horn in
// about a second, the heavy drum in several. That glide between slow and fast is the effect people play, so `speed` is the
// thing to write from a pattern. `inertia` stretches or shortens the glide.
import { LowPassSvf } from './svf.js';

export const SPEEDS = ['stop', 'slow', 'fast'];
// The rotors: how fast against the horn's speed, which way round, how long a change of speed takes (seconds, up and down),
// how deep the Doppler shift (ms of delay swing) and the tremolo are, and the tone when pointing away and towards (Hz).
export const ROTORS = {
  horn: { ratio: 1, direction: 1, rise: 0.9, fall: 1.3, dopplerMs: 0.55, tremolo: 0.65, dull: 2200, bright: 14000 },
  drum: { ratio: 0.86, direction: -1, rise: 4.5, fall: 5.5, dopplerMs: 0.18, tremolo: 0.35, dull: 20000, bright: 20000 },
};
const BUTTERWORTH = 0.3;   // the resonance setting of the filter that gives a flat split
const MAX_DELAY_MS = 4;

// The turning speed a rotor has one moment later: it closes in on `target` (Hz), quicker when speeding up than slowing down.
export function nextRotorSpeed(rotor, speedNow, target, seconds, inertia) {
  const time = (target > speedNow ? rotor.rise : rotor.fall) * Math.max(0.05, inertia);
  return speedNow + (target - speedNow) * (1 - Math.exp(-seconds / (time / 3)));
}

// The horn speed the switch asks for, in Hz.
export const targetSpeed = (speed, slow, fast) => (speed <= 0 ? 0 : speed === 1 ? slow : fast);

// One rotor: a short delay line read by two microphones.
class Rotor {
  constructor(spec, sampleRate) {
    this.spec = spec; this.sampleRate = sampleRate;
    this.size = Math.ceil((sampleRate * MAX_DELAY_MS) / 1000) + 4;
    this.line = new Float32Array(this.size);
    this.write = 0;
    this.angle = 0;      // turns, 0 to 1
    this.speed = 0;      // Hz
    this.toneL = 0; this.toneR = 0;
    this.out = [0, 0];
  }

  // what one microphone hears: `facing` is 1 when the speaker points at it, 0 when it points away
  hear(facing, doppler, tremolo) {
    const delay = (0.3 + this.spec.dopplerMs * doppler * (1 - facing)) * 0.001 * this.sampleRate;
    let at = this.write - delay; if (at < 0) at += this.size;
    const k = at | 0, f = at - k, next = k + 1 === this.size ? 0 : k + 1;
    return (this.line[k] + (this.line[next] - this.line[k]) * f) * (1 - this.spec.tremolo * tremolo * (1 - facing));
  }

  // input: this rotor's share of the sound; micAngle: how far each microphone stands off centre, in turns
  next(input, micAngle, doppler, tremolo) {
    this.line[this.write] = input;
    this.angle += (this.spec.direction * this.speed) / this.sampleRate;
    this.angle -= Math.floor(this.angle);
    const turn = 2 * Math.PI;
    const facingL = 0.5 + 0.5 * Math.cos(turn * (this.angle + micAngle)), facingR = 0.5 + 0.5 * Math.cos(turn * (this.angle - micAngle));
    let left = this.hear(facingL, doppler, tremolo), right = this.hear(facingR, doppler, tremolo);
    if (this.spec.dull < this.spec.bright) {   // duller while pointing away
      const span = this.spec.bright - this.spec.dull, rate = (2 * Math.PI) / this.sampleRate;
      this.toneL += (left - this.toneL) * Math.min(1, (this.spec.dull + span * facingL) * rate); left = this.toneL;
      this.toneR += (right - this.toneR) * Math.min(1, (this.spec.dull + span * facingR) * rate); right = this.toneR;
    }
    if (++this.write === this.size) this.write = 0;
    this.out[0] = left; this.out[1] = right;
    return this.out;
  }
}

const SPEC = [
  { name: 'speed', min: 0, max: 2, def: 1, int: true },   // stop, slow, fast
  { name: 'slow', min: 0.1, max: 3, def: 0.8 },           // Hz, the horn's slow speed
  { name: 'fast', min: 3, max: 12, def: 6.7 },            // Hz, the horn's fast speed
  { name: 'inertia', min: 0.1, max: 4, def: 1 },          // how long the rotors take to change speed (1: as the real thing)
  { name: 'drive', min: 0, max: 1, def: 0.2 },            // the amplifier pushed into the speakers
  { name: 'doppler', min: 0, max: 2, def: 1 },            // depth of the pitch wobble
  { name: 'tremolo', min: 0, max: 1, def: 0.7 },          // depth of the loudness wobble
  { name: 'spread', min: 0, max: 1, def: 0.7 },           // how far apart the microphones stand
  { name: 'balance', min: 0, max: 1, def: 0.5 },          // drum (0) against horn (1)
  { name: 'cross', min: 200, max: 3000, def: 800 },       // Hz, where the sound is split between drum and horn
  { name: 'mix', min: 0, max: 1, def: 1 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'rotary',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'rotary',
  editor: 'rotary',
  params: SPEC,
  create({ sampleRate }) {
    const horn = new Rotor(ROTORS.horn, sampleRate), drum = new Rotor(ROTORS.drum, sampleRate);
    const splitA = new LowPassSvf(sampleRate), splitB = new LowPassSvf(sampleRate);   // two in a row: a steep split
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        // the rotors close in on the speed the switch asks for
        const target = targetSpeed(Math.round(g('speed')), g('slow'), g('fast')), inertia = g('inertia'), seconds = n / sampleRate;
        horn.speed = nextRotorSpeed(ROTORS.horn, horn.speed, target * ROTORS.horn.ratio, seconds, inertia);
        drum.speed = nextRotorSpeed(ROTORS.drum, drum.speed, target * ROTORS.drum.ratio, seconds, inertia);

        const cross = g('cross'); splitA.set(cross, BUTTERWORTH); splitB.set(cross, BUTTERWORTH);
        const push = 1 + g('drive') * 9, makeUp = 1 / Math.pow(push, 0.6);
        const micAngle = g('spread') * 0.25, doppler = g('doppler'), tremolo = g('tremolo'), mix = g('mix');
        const balance = g('balance'), hornLevel = Math.sin((balance * Math.PI) / 2) * Math.SQRT2, drumLevel = Math.cos((balance * Math.PI) / 2) * Math.SQRT2;

        for (let i = 0; i < n; i++) {
          const dry = 0.5 * (inL[i] + inR[i]);
          const driven = Math.tanh(dry * push) * makeUp;
          const low = splitB.next(splitA.next(driven)), high = driven - low;
          const top = horn.next(high, micAngle, doppler, tremolo), bottom = drum.next(low, micAngle, doppler, tremolo);
          const wetL = top[0] * hornLevel + bottom[0] * drumLevel, wetR = top[1] * hornLevel + bottom[1] * drumLevel;
          outL[i] = inL[i] + (wetL - inL[i]) * mix; outR[i] = inR[i] + (wetR - inR[i]) * mix;
        }
      },
    };
  },
};
