// The saturation stage shared by the two saturators (`saturator` and `mbsat`): drive a curve, keep what it makes, take the
// offset away, and keep the loudness about the same whatever the drive. One `Stage` is one channel of one band.
//
//   soft   tanh: the smooth, general-purpose curve, odd harmonics
//   tape   a gentler arctangent, rounder at the knee, fewer high harmonics
//   tube   lopsided (the negative half is squashed more), so it adds even harmonics too: warmer, thicker
//   clip   a cubic soft clip: clean up to the knee, then a firm wall
// `bias` pushes the signal off-centre into the curve, which adds even harmonics to any of them. The curve runs at 1x, 2x or 4x
// (`quality`: standard is 2x, eco 1x, hq 4x) to keep the aliasing down; the dry sound has to be delayed by `latency` to match.
import { Oversampler, Delay } from './oversample.js';

export const TYPES = ['soft', 'tape', 'tube', 'clip'];
export const QUALITY = ['standard', 'eco', 'hq'];
const FACTORS = [2, 1, 4];   // the oversampling each quality uses

const SHAPES = [
  x => Math.tanh(x),
  x => (2 / Math.PI) * Math.atan((x * Math.PI) / 2),
  x => (x >= 0 ? Math.tanh(x) : 1.8 * Math.tanh(x * 0.35)),   // the negative half is softer and reaches further (even harmonics)
  x => (x > 1.5 ? 1 : x < -1.5 ? -1 : x * (1 - (x * x * 4) / 27)),
];

export const dbToGain = db => Math.pow(10, db / 20);
export const typeOf = value => Math.min(3, Math.max(0, Math.round(value)));
export const qualityOf = value => Math.min(2, Math.max(0, Math.round(value)));

// What the curve needs for a block: its drive (a gain), its bias, and the factor that keeps the loudness level.
export function settings(type, driveDb, bias) {
  const shape = SHAPES[typeOf(type)], gain = dbToGain(driveDb);
  const offset = shape(bias);
  // `curve` is made once for a block, not for every sample; `norm` makes a half-scale sound come out half scale
  return { curve: v => shape(v * gain + bias) - offset, norm: 0.5 / shape(0.5 * gain) };
}

export class Stage {
  constructor() {
    this.chains = FACTORS.map(f => new Oversampler(f));   // by quality
    this.hp = 0;
  }
  latency(quality) { return this.chains[qualityOf(quality)].latency; }
  // One sample through the curve; `s` is what `settings` made, `hpK` the one-pole that follows the offset.
  run(x, s, quality, hpK) {
    let wet = this.chains[qualityOf(quality)].run(x, s.curve) * s.norm;
    this.hp += (wet - this.hp) * hpK;
    wet -= this.hp;
    return wet;
  }
}

export const makeDelay = () => new Delay(48);
export const offsetK = sampleRate => 1 - Math.exp((-2 * Math.PI * 12) / sampleRate);
