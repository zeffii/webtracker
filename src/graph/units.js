// How a parameter's value is shown in real units: "200 ms", "1.2 kHz", "+7 st", "triangle". A unit is looked up by
// node type and parameter name, then by the name alone; a parameter with named choices shows the name instead.
import { ALGORITHMS } from '../audio/nodes/fmsynth.js';

const UNIT = {
  attack: 'ms', decay: 'ms', release: 'ms', atk: 'ms', dec: 'ms', rel: 'ms', fatk: 'ms', fdec: 'ms', frel: 'ms', patk: 'ms', pdec: 'ms', prel: 'ms',
  glide: 'ms', predelay: 'ms', tune: 'st', tune2: 'st', fine: 'ct', detune: 'ct', freq: 'Hz', cutoff: 'Hz', rate: 'Hz', lfoRate: 'Hz', vrate: 'Hz', pwmrate: 'Hz',
  threshold: 'dB', makeup: 'dB', knee: 'dB', range: 'dB', hyst: 'dB', floor: 'dB', fenv: 'oct', mix: '%', width: '%',
};
const TYPE_UNIT = {
  chorus: { depth: 'ms', delay: 'ms' },
  flanger: { depth: 'ms', delay: 'ms' },
  phaser: { depth: 'oct' },
  delay: { time: 'ms' },
  multitap: { time: 'ms' },
  shiva: { length: 'ms', damp: '%' },
  hall: { decay: 's' }, plate: { decay: 's' }, shimmer: { decay: 's', pitch: 'st' }, string: { decay: 's', release: 'ms' },
  env: {}, lfo: {},
  distortion: { tone: 'Hz' },
  exciter: { freq: 'Hz' },
  transient: { attack: '', sustain: '', speed: 'x' },
  split: { f1: 'Hz', f2: 'Hz', f3: 'Hz' },
  compressor: { ratio: ':1' },
  follower: { gain: 'dB' },
  crusher: { rate: 'Hz', bits: 'bit' },
  dcblock: { freq: 'Hz' },
  hat808: { tune: 'st', tone: 'Hz', cdec: 'ms', odec: 'ms' },
  sampler: { release: 'ms', nnaFade: 'ms', retrig: 'ticks', root: '' },
  ctrl: { time: 'subticks' },
  granular: { size: 'ms', pitchRand: 'ct', spread: '%', attack: 'ms', decay: 'ms', release: 'ms' },
  subsynth: { slide: 'ticks', spread: 'ct', width: '%' },
  oberheim: { vib: 'ct', sweep: 'st' },
  piano: { decay: 's', detune: 'ct', release: 'ms', pos: '%', thump: '%', body: '%', width: '%' },
  addsynth: { tilt: 'dB/oct', hdecay: '' },
  specsynth: { tilt: 'dB/oct' },
  wavetable: {},
  fmsynth: {},
  dvii: { tune: 'st', speed: 'x' },
  blur: { time: 'ms' },
  gater: { smooth: 'ms', depth: '%' },
  freqshift: { shift: 'Hz' },
};
for (const k of [1, 2, 3, 4]) {
  Object.assign(TYPE_UNIT.fmsynth, { [`ratio${k}`]: 'x', [`fine${k}`]: 'ct', [`atk${k}`]: 'ms', [`dec${k}`]: 'ms', [`rel${k}`]: 'ms' });
}
for (let k = 1; k <= 5; k++) TYPE_UNIT.eq = { ...TYPE_UNIT.eq, [`f${k}`]: 'Hz', [`g${k}`]: 'dB', lowcut: 'Hz', highcut: 'Hz' };

const ONOFF = ['off', 'on'];
const WAVES = { osc: ['sine', 'saw', 'square', 'triangle'] };
const NAMES = {
  osc: { wave: WAVES.osc, track: ONOFF, reset: ONOFF },
  lfo: { shape: ['sine', 'triangle', 'saw', 'square'], reset: ONOFF },
  filter: { mode: ['lowpass', 'bandpass', 'highpass'] },
  distortion: { mode: ['soft', 'hard', 'tube', 'fuzz'], oversample: ['1x', '2x', '4x'] },
  waveshaper: { oversample: ['1x', '2x', '4x'] },
  follower: { mode: ['peak', 'rms'], invert: ONOFF },
  notetrig: { legato: ONOFF },
  sampler: { reverse: ONOFF },
  subsynth: { wave1: ['saw', 'square', 'triangle', 'sine'], wave2: ['saw', 'square', 'triangle', 'sine'] },
  oberheim: { wave1: ['saw', 'pulse', 'triangle'], wave2: ['saw', 'pulse', 'triangle'], sync: ONOFF },
  wavetable: { source: ['table', 'pair'], snap: ONOFF },
  granular: { keytrack: ONOFF },
  fmsynth: { algo: ALGORITHMS.map(a => a.name) },
  dvii: { gritty: ONOFF },
  blur: { freeze: ONOFF, size: ['1024', '2048', '4096'] },
};

const trim = (v, digits = 4) => String(Number(Number(v).toPrecision(digits)));
const sign = (v, text) => (v > 0 ? `+${text}` : text);

// The names of a parameter's choices, or null.
export const choices = (type, name) => NAMES[type]?.[name] ?? null;

export const unitOf = (type, name) => TYPE_UNIT[type]?.[name] ?? UNIT[name] ?? '';

// The value as text, in real units, for a parameter spec and its type name.
export function display(type, spec, value) {
  const names = NAMES[type]?.[spec.name];
  if (names) return names[Math.round(value) - Math.round(spec.min)] ?? String(Math.round(value));
  if (spec.int && spec.max - spec.min <= 1 && spec.min === 0) return ONOFF[Math.round(value)] ?? String(value);
  const u = unitOf(type, spec.name);
  switch (u) {
    case '%': return `${Math.round(value * 100)}%`;
    case 'ms': return Math.abs(value) >= 1000 ? `${trim(value / 1000, 3)} s` : `${trim(value, 3)} ms`;
    case 'Hz': return Math.abs(value) >= 1000 ? `${trim(value / 1000, 3)} kHz` : `${trim(value, 3)} Hz`;
    case 'st': case 'ct': return `${sign(value, trim(value, 3))} ${u}`;
    case 'dB': case 'oct': return `${sign(value, trim(value, 3))} ${u}`;
    case 'dB/oct': return `${sign(value, trim(value, 3))} ${u}`;
    case ':1': return `${trim(value, 3)}:1`;
    case 'x': return `${trim(value, 3)}x`;
    case '': return trim(value, 4);
    default: return `${trim(value, 4)} ${u}`;
  }
}
