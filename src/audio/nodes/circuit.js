// Circuit: an effect made of the parts of an analogue signal path, each a small stage that can be switched on or off, wired
// in one of six orders (the algorithms), as an FM synth wires its operators. Stereo in and out, each channel with its own state.
//
//   slew       the slew-rate limit: the output cannot move faster than `slew` (full scale per millisecond), so a fast
//              sine turns into a triangle, the bright edge rounded the way an op-amp rounds it
//   device     a transistor-style curve: tanh of drive * x + bias. A bias off centre bends the curve, which adds even harmonics
//   miller     the louder the signal, the lower the frequency it rolls off from (a Miller capacitance grows with the level)
//   bandwidth  a one-pole lowpass: the rise time of the circuit (0.35 / bandwidth)
//   loop       the closed-loop response: a two-pole lowpass whose damping comes from the phase margin, so a low margin rings
//   converter  `bits` of resolution, and `jitter`: a timing error that matters more the faster the signal moves
//   noise      a flat hiss floor, in dB
//   wire       one reflection: a copy of the signal `length` ms later, times `reflect` (+1 an open end, -1 a short)
//
// `drift` moves the bandwidth, the miller corner and the bias slowly and at random, like parts warming up. The device runs
// at 1x, 2x or 4x (`oversample`) to cut the aliasing; the dry signal is delayed to match.
// out = (dry * (1 - mix) + wet * mix) * level.
import { Delay, Oversampler } from './oversample.js';
import { oversampleLatency } from '../latency.js';

const ALGORITHM = 0, MIX = 1, LEVEL = 2, OVERSAMPLE = 3, DRIFT = 4, FEEDBACK = 5,
  SLEW_ON = 6, SLEW = 7, DEVICE_ON = 8, DRIVE = 9, BIAS = 10, MILLER_ON = 11, MILLER = 12, MILLER_FREQ = 13,
  BANDWIDTH_ON = 14, BANDWIDTH = 15, LOOP_ON = 16, LOOP_FREQ = 17, MARGIN = 18,
  CONVERTER_ON = 19, BITS = 20, JITTER = 21, NOISE_ON = 22, HISS = 23, WIRE_ON = 24, REFLECT = 25, LENGTH = 26;

// The order of the stages in each algorithm. Algorithm 2 also feeds the output back into the device (`feedback`).
const SLEW_STAGE = 0, DEVICE_STAGE = 1, MILLER_STAGE = 2, BANDWIDTH_STAGE = 3, LOOP_STAGE = 4, CONVERTER_STAGE = 5, NOISE_STAGE = 6, WIRE_STAGE = 7;
const ORDERS = [
  [SLEW_STAGE, DEVICE_STAGE, MILLER_STAGE, BANDWIDTH_STAGE, LOOP_STAGE, CONVERTER_STAGE, NOISE_STAGE, WIRE_STAGE],   // 0 the signal path as it comes
  [WIRE_STAGE, BANDWIDTH_STAGE, DEVICE_STAGE, MILLER_STAGE, SLEW_STAGE, LOOP_STAGE, NOISE_STAGE, CONVERTER_STAGE],   // 1 the wire and band limit in front
  [DEVICE_STAGE, MILLER_STAGE, BANDWIDTH_STAGE, SLEW_STAGE, LOOP_STAGE, CONVERTER_STAGE, NOISE_STAGE, WIRE_STAGE],   // 2 the device first, with feedback
  [CONVERTER_STAGE, SLEW_STAGE, DEVICE_STAGE, MILLER_STAGE, BANDWIDTH_STAGE, LOOP_STAGE, NOISE_STAGE, WIRE_STAGE],   // 3 the converter first
  [NOISE_STAGE, DEVICE_STAGE, MILLER_STAGE, SLEW_STAGE, BANDWIDTH_STAGE, LOOP_STAGE, CONVERTER_STAGE, WIRE_STAGE],   // 4 the noise in front, so the device shapes it
  [LOOP_STAGE, DEVICE_STAGE, MILLER_STAGE, BANDWIDTH_STAGE, SLEW_STAGE, CONVERTER_STAGE, NOISE_STAGE, WIRE_STAGE],   // 5 the loop rings into the device
];
const FACTORS = [1, 2, 4];
const MAX_WIRE_MS = 5;

// A noise source that gives the same numbers here and in the native port.
class Noise {
  constructor(seed) { this.state = seed >>> 0; }
  next() {   // -1 to 1
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 2147483648 - 1;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const asInt = (v, hi) => clamp(Math.round(v), 0, hi);

export default {
  type: 'circuit',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Distortion',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'circuit',
  latency: p => (p.device_on ? oversampleLatency(FACTORS[asInt(p.oversample, 2)]) : 0),   // the oversampling's filters
  params: [
    { name: 'algorithm', min: 0, max: 5, def: 0, int: true },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'level', min: 0, max: 2, def: 0.7 },
    { name: 'oversample', min: 0, max: 2, def: 1, int: true },          // 0: 1x, 1: 2x, 2: 4x
    { name: 'drift', min: 0, max: 1, def: 0 },
    { name: 'feedback', min: 0, max: 0.9, def: 0.3 },                   // algorithm 2: how much of the output goes back into the device
    { name: 'slew_on', min: 0, max: 1, def: 1, int: true },
    { name: 'slew', min: 0.5, max: 400, def: 60, scale: 'log' },        // full scale per millisecond
    { name: 'device_on', min: 0, max: 1, def: 1, int: true },
    { name: 'drive', min: 0.1, max: 20, def: 2, scale: 'log' },
    { name: 'bias', min: -1, max: 1, def: 0.15 },
    { name: 'miller_on', min: 0, max: 1, def: 1, int: true },
    { name: 'miller', min: 0, max: 1, def: 0.4 },
    { name: 'millerfreq', min: 500, max: 20000, def: 9000, scale: 'log' },   // Hz, the corner for a quiet signal
    { name: 'bandwidth_on', min: 0, max: 1, def: 1, int: true },
    { name: 'bandwidth', min: 200, max: 20000, def: 14000, scale: 'log' },    // Hz
    { name: 'loop_on', min: 0, max: 1, def: 0, int: true },
    { name: 'loopfreq', min: 1000, max: 20000, def: 12000, scale: 'log' },    // Hz
    { name: 'margin', min: 20, max: 90, def: 60 },                      // degrees of phase margin: 45 rings a little, 60 hardly
    { name: 'converter_on', min: 0, max: 1, def: 0, int: true },
    { name: 'bits', min: 2, max: 24, def: 16, int: true },
    { name: 'jitter', min: 0, max: 1, def: 0 },
    { name: 'noise_on', min: 0, max: 1, def: 0, int: true },
    { name: 'hiss', min: -100, max: -30, def: -80 },                     // dB
    { name: 'wire_on', min: 0, max: 1, def: 0, int: true },
    { name: 'reflect', min: -1, max: 1, def: 0.3 },
    { name: 'length', min: 0.02, max: MAX_WIRE_MS, def: 0.5, scale: 'log' },   // ms
  ],
  create({ sampleRate }) {
    const chains = FACTORS.map(f => [new Oversampler(f), new Oversampler(f)]);
    const dryDelays = [new Delay(48), new Delay(48)];
    const wireLength = Math.ceil(sampleRate * MAX_WIRE_MS / 1000) + 2;
    const channels = [0, 1].map(c => ({
      slew: 0, level: 0, miller: 0, bandwidth: 0, loopLow: 0, loopBand: 0, previous: 0, previousWet: 0, blocker: 0,
      wire: new Float64Array(wireLength), wirePos: 0, noise: new Noise(12345 + 977 * c), jitterNoise: new Noise(54321 + 313 * c),
    }));
    const blockK = 1 - Math.exp(-2 * Math.PI * 12 / sampleRate);   // the gentle highpass that takes the offset a biased device makes
    const followK = 1 - Math.exp(-1 / (sampleRate * 0.005));        // how fast the level follower tracks (5 ms)
    const drifter = new Noise(777);
    let drift = 0, driftTarget = 0, driftLeft = 0;                  // the slow wander, -1 to 1

    // What the block's settings come to; the stages below read it.
    const s = {
      factor: 0, slewStep: 0, drive: 1, bias: 0, biasTanh: 0, norm: 1, feedback: 0, millerAmount: 0, millerFreq: 1, bandwidthK: 0,
      a1: 0, a2: 0, a3: 0, quantum: 1, jitterAmount: 0, hiss: 0, reflect: 0, wireSamples: 1, chain: null,
    };
    // The device's curve: tanh of the driven, biased signal, the bias's own output taken off, scaled to unity for full scale.
    const curve = v => (Math.tanh(v * s.drive + s.bias) - s.biasTanh) * s.norm;

    // The stages, indexed by the *_STAGE numbers; each takes a sample of channel `ch` and returns one.
    const stages = [
      (v, ch) => { ch.slew += clamp(v - ch.slew, -s.slewStep, s.slewStep); return ch.slew; },
      (v, ch, c) => {
        const wet = chains[s.factor][c].run(v - s.feedback * ch.previousWet, curve);
        ch.blocker += (wet - ch.blocker) * blockK;   // follows the offset
        return wet - ch.blocker;
      },
      (v, ch) => {
        ch.level += (Math.abs(v) - ch.level) * followK;
        const k = 1 - Math.exp(-2 * Math.PI * s.millerFreq / (1 + s.millerAmount * ch.level) / sampleRate);
        ch.miller += (v - ch.miller) * k;
        return ch.miller;
      },
      (v, ch) => { ch.bandwidth += (v - ch.bandwidth) * s.bandwidthK; return ch.bandwidth; },
      (v, ch) => {   // a trapezoidal state-variable lowpass
        const v3 = v - ch.loopLow, v1 = s.a1 * ch.loopBand + s.a2 * v3, v2 = ch.loopLow + s.a2 * ch.loopBand + s.a3 * v3;
        ch.loopBand = 2 * v1 - ch.loopBand;
        ch.loopLow = 2 * v2 - ch.loopLow;
        return v2;
      },
      (v, ch) => {
        const moved = v + s.jitterAmount * ch.jitterNoise.next() * (v - ch.previous);   // the error grows with the slope
        ch.previous = v;
        return Math.floor(moved * s.quantum + 0.5) / s.quantum;
      },
      (v, ch) => v + s.hiss * ch.noise.next(),
      (v, ch) => {
        ch.wire[ch.wirePos] = v;
        const behind = ch.wire[(ch.wirePos - s.wireSamples + wireLength) % wireLength];
        ch.wirePos = (ch.wirePos + 1) % wireLength;
        return v + s.reflect * behind;
      },
    ];

    return {
      process(inputs, outputs, n, params, slots) {
        const p = i => params[slots[i]];
        const order = ORDERS[asInt(p(ALGORITHM), 5)];
        const mix = p(MIX), level = p(LEVEL);
        s.factor = asInt(p(OVERSAMPLE), 2);
        s.feedback = order === ORDERS[2] ? p(FEEDBACK) : 0;
        // the slow wander: a new target now and then, approached over a second or two
        if ((driftLeft -= n) <= 0) { driftTarget = drifter.next(); driftLeft = sampleRate * 1.2; }
        drift += (driftTarget - drift) * (1 - Math.exp(-n / (sampleRate * 1.5)));
        const wander = drift * p(DRIFT);
        const on = [p(SLEW_ON), p(DEVICE_ON), p(MILLER_ON), p(BANDWIDTH_ON), p(LOOP_ON), p(CONVERTER_ON), p(NOISE_ON), p(WIRE_ON)].map(v => v >= 0.5);

        s.slewStep = p(SLEW) / (sampleRate / 1000);
        s.drive = p(DRIVE);
        s.bias = clamp(p(BIAS) + wander * 0.1, -1, 1);
        s.biasTanh = Math.tanh(s.bias);
        s.norm = 1 / Math.tanh(s.drive);
        s.millerAmount = p(MILLER) * 6;
        s.millerFreq = p(MILLER_FREQ) * Math.pow(2, wander * 0.3);
        s.bandwidthK = 1 - Math.exp(-2 * Math.PI * Math.min(p(BANDWIDTH) * Math.pow(2, wander * 0.3), sampleRate * 0.45) / sampleRate);
        const g = Math.tan(Math.PI * Math.min(p(LOOP_FREQ), sampleRate * 0.45) / sampleRate);
        const damping = 2 * clamp(p(MARGIN) / 100, 0.2, 0.95);   // k = 2 zeta, zeta about the phase margin over 100
        s.a1 = 1 / (1 + g * (g + damping)); s.a2 = g * s.a1; s.a3 = g * s.a2;
        s.quantum = Math.pow(2, asInt(p(BITS), 24) - 1);
        s.jitterAmount = p(JITTER) * 0.02;
        s.hiss = Math.pow(10, p(HISS) / 20) * Math.sqrt(3);   // (a uniform noise of unit variance, times the level)
        s.reflect = p(REFLECT);
        s.wireSamples = clamp(Math.round(p(LENGTH) * sampleRate / 1000), 1, wireLength - 2);
        const wait = on[DEVICE_STAGE] ? chains[s.factor][0].latency : 0;

        for (let c = 0; c < 2; c++) {
          const x = inputs[0][c], out = outputs[0][c], ch = channels[c];
          for (let i = 0; i < n; i++) {
            let wet = x[i];
            for (const stage of order) if (on[stage]) wet = stages[stage](wet, ch, c);
            ch.previousWet = wet;
            const dry = dryDelays[c].push(x[i], wait);
            out[i] = (dry + (wet - dry) * mix) * level;
          }
          if (Math.abs(ch.loopLow) < 1e-20) ch.loopLow = 0;   // no slow denormals while silent
          if (Math.abs(ch.loopBand) < 1e-20) ch.loopBand = 0;
        }
      },
    };
  },
};
