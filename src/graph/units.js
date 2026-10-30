// How a parameter's value is shown in real units: "200 ms", "1.2 kHz", "+7 st", "triangle". A unit is looked up by
// node type and parameter name, then by the name alone; a parameter with named choices shows the name instead.
import { ALGORITHMS } from '../audio/nodes/fmsynth.js';
import { VOICINGS as AMP_VOICINGS, CABS as AMP_CABS } from '../audio/nodes/amp.js';
import { MODES as ARP_MODES, RATE_NAMES as ARP_RATES, RETRIGGER as ARP_RETRIG } from '../audio/nodes/arp.js';

const UNIT = {
  attack: 'ms', decay: 'ms', release: 'ms', atk: 'ms', dec: 'ms', rel: 'ms', fatk: 'ms', fdec: 'ms', frel: 'ms', patk: 'ms', pdec: 'ms', prel: 'ms',
  glide: 'ms', predelay: 'ms', tune: 'st', tune2: 'st', fine: 'ct', detune: 'ct', freq: 'Hz', cutoff: 'Hz', rate: 'Hz', lfoRate: 'Hz', vrate: 'Hz', pwmrate: 'Hz',
  threshold: 'dB', makeup: 'dB', knee: 'dB', range: 'dB', hyst: 'dB', floor: 'dB', fenv: 'oct', mix: '%', width: '%',
};
const TYPE_UNIT = {
  chorus: { depth: 'ms', delay: 'ms' },
  flanger: { depth: 'ms', delay: 'ms' },
  comb: { freq: 'Hz', spread: 'ct' },
  clap: { tone: 'Hz', spacing: 'ms', burstDecay: 'ms', tailDecay: 'ms', spread: '%', drive: '%' },
  urugraVerb: { predelay: 'ms', decay: '' },
  convolver: { decay: 's', predelay: 'ms', lowcut: 'Hz', highcut: 'Hz', level: 'dB' },
  phaser: { depth: 'oct' },
  delay: { time: 'ms' },
  multitap: { time: 'ms' },
  prismacanyon: { time: 'ms', cutoff: 'Hz', bass: 'dB', treble: 'dB' },
  shiva: { length: 'ms', damp: '%' },
  hall: { decay: 's' }, plate: { decay: 's' }, shimmer: { decay: 's', pitch: 'st' }, string: { decay: 's', release: 'ms' },
  env: {}, lfo: {},
  amp: { gain: '', bass: '', mid: '', treble: '', master: '', presence: '', depth: '', level: '' },
  distortion: { tone: 'Hz' },
  exciter: { freq: 'Hz' },
  transient: { attack: '', sustain: '', speed: 'x' },
  split: { f1: 'Hz', f2: 'Hz', f3: 'Hz' },
  compressor: { ratio: ':1' },
  follower: { gain: 'dB' },
  crusher: { rate: 'Hz', bits: 'bit' },
  mbcomp: { f1: 'Hz', f2: 'Hz', f3: 'Hz', knee: 'dB', out: 'dB', ...Object.fromEntries(['low', 'lowmid', 'highmid', 'high'].flatMap(b => [[`${b}Thresh`, 'dB'], [`${b}Ratio`, ':1'], [`${b}Attack`, 'ms'], [`${b}Release`, 'ms'], [`${b}Gain`, 'dB']])) },
  tempo: { ceiling: 'dB', boost: 'dB', release: 'ms' },
  dcblock: { freq: 'Hz' },
  modchan: {},
  tap: { fade: 'ms', fadein: 'ms' },
  vocoder: { low: 'Hz', high: 'Hz', attack: 'ms', release: 'ms', shift: 'st', sibilance: '%', tune: 'Hz', noise: '%', level: '' },
  sweep: { resonance: '%' },
  ladder: { cutoff: 'Hz', drive: '%', rate: 'Hz', depth: 'oct', mix: '%' },
  filterpro: { cutoff: 'Hz', vowel: '', damp: '%', drive: '%', bias: '%', level: '' },
  duette: { vco2pitch: 'ct', cutoff: 'Hz', attack: 'ms', decay: 'ms', port: 'ms', slide: 'ms', tune: 'st' },
  squelch: { tune: 'st', cutoff: 'Hz', decay: 'ms', slide: 'ms', rel: 'ms' },
  combperc: { decay: 'ms', click: 'ms', tune: 'st', sweep: 'oct', sdec: 'ms' },
  hat808: { tune: 'st', tone: 'Hz', cdec: 'ms', odec: 'ms' },
  sampler: { release: 'ms', nnaFade: 'ms', retrig: 'ticks', root: '' },
  ctrl: { time: 'subticks' },
  times: { by: 'x' },
  cardinal: { o1pw: '%', o2pw: '%', o2semi: 'st', o2fine: 'ct', fm: '%', ring: '%', mix: '%', noise: '%', detune: 'ct', width: '%', cutoff: 'Hz', res: '%', dist: '%', fkey: '%', matk: 'ms', mdec: 'ms', mrel: 'ms', msus: '%', e2cut: 'oct', e2pitch: 'st', e2fm: '%', e2pw: '%', atk: 'ms', dec: 'ms', rel: 'ms', sus: '%', vel: '%', l1rate: 'Hz', l2rate: 'Hz', l1amt: '%', l2amt: '%', glide: 'ms', slide: 'ticks', level: '%' },
  drumsynth: { startPitch: 'Hz', endPitch: 'Hz', pitchMul: 'x', patk: 'ms', pdec: 'ms', prel: 'ms', attack: 'ms', decay: 'ms', release: 'ms', drive: '%', noise: '%', noiseTone: 'Hz', natk: 'ms', ndec: 'ms', nrel: 'ms', click: '%', clickLen: 'ms', clickTone: 'Hz', clickTail: 'ms', body: '%' },
  woodblock: { tone: 'Hz', damping: 'ms', loss: '%', bend: 'st', attack: 'ms', decay: 'ms', release: 'ms', patk: 'ms', pdec: 'ms', prel: 'ms' },
  granular: { size: 'ms', pitchRand: 'ct', spread: '%', attack: 'ms', decay: 'ms', release: 'ms' },
  subsynth: { slide: 'ticks', spread: 'ct', width: '%' },
  fourpole: { transpose: 'st', detune: 'ct', atk: 'ms', dec: 'ms', rel: 'ms', atk2: 'ms', dec2: 'ms', rel2: 'ms', inertia: 'ms', glide: 'ms', vibrate: 'Hz', tuning: 'Hz' },
  oberheim: { vib: 'ct', sweep: 'st' },
  piano: { decay: 's', detune: 'ct', release: 'ms', pos: '%', thump: '%', body: '%', width: '%' },
  addsynth: { tilt: 'dB/oct', hdecay: '' },
  specsynth: { tilt: 'dB/oct' },
  wavetable: {},
  fmsynth: {},
  dvii: { tune: 'st', speed: 'x' },
  blur: { time: 'ms' },
  hpss: { length: 'ms', width: 'Hz', sharp: '' },
  specdyn: { threshold: 'dB', ratio: ':1', tilt: 'dB/oct', attack: 'ms', release: 'ms', makeup: 'dB', smooth: '', mix: '%' },
  xsynth: { amount: '%', smooth: '', detail: '%', mix: '%' },
  gater: { smooth: 'ms', depth: '%' },
  arp: { rate: '', gate: '%', swing: '', transpose: 'st', cycle1: 'st', cycle2: 'st', humanize: '%', level: '' },
  chord: { strum: 'ms', level: '' },
  freqshift: { shift: 'Hz' },
  specpan: { lowMono: 'Hz', rotate: '', spread: '%', mix: '%', rate: 'Hz', sweep: '', wave: ['sine', 'triangle', 'saw', 'square'] },
};
for (const k of [1, 2, 3, 4]) {
  Object.assign(TYPE_UNIT.fmsynth, { [`ratio${k}`]: 'x', [`fine${k}`]: 'ct', [`atk${k}`]: 'ms', [`dec${k}`]: 'ms', [`rel${k}`]: 'ms' });
}
for (let k = 1; k <= 5; k++) TYPE_UNIT.eq = { ...TYPE_UNIT.eq, [`f${k}`]: 'Hz', [`g${k}`]: 'dB', lowcut: 'Hz', highcut: 'Hz' };

const ONOFF = ['off', 'on'];
const WAVES = { osc: ['sine', 'saw', 'square', 'triangle'] };
const NAMES = {
  osc: { wave: WAVES.osc, track: ONOFF, reset: ONOFF },
  noise: { restart: ONOFF, free: ONOFF, tilt: 'dB/oct' },
  squelch: { wave: ['saw', 'square'], sld: ONOFF },
  tempo: { limit: ONOFF },
  tape: { type: ['studio reel', 'chrome cassette', 'ferric cassette', 'worn cassette', 'dictaphone', 'dubbed copy'] },
  duette: { vco1wave: ['saw', 'triangle', 'square'], vco2wave: ['saw', 'triangle', 'noise'], vco2oct: ["16'", "8'", "4'", "2'"], mod: ['off', 'sync', 'ring'], egtype: ['A/D', 'A/G/D', 'gate'], egtarget: ['pitch', 'pitch 2', 'cutoff'], lfowave: ['saw', 'triangle', 'square'], lfomode: ['fast', 'slow', '1-shot'], lfotarget: ['pitch', 'shape', 'cutoff'], portmode: ['auto', 'always'], sld: ONOFF },
  lfo: { shape: ['sine', 'triangle', 'saw', 'square'], reset: ONOFF, range: ['swing by amount', 'between min and max'] },
  filter: { mode: ['lowpass', 'bandpass', 'highpass'] },
  sweep: { slope: ['12 dB', '24 dB'] },
  ladder: { shape: ['sine', 'triangle', 'saw down', 'square'] },
  filterpro: { mode: ['lowpass', 'bandpass', 'highpass', 'notch', 'peak', 'allpass', 'morph', 'lowpass 24', 'ladder', 'vowel', 'comb +', 'comb -'] },
  amp: { voicing: AMP_VOICINGS, cab: AMP_CABS, oversample: ['1x', '2x', '4x'] },
  distortion: { mode: ['soft', 'hard', 'tube', 'fuzz'], oversample: ['1x', '2x', '4x'] },
  waveshaper: { oversample: ['1x', '2x', '4x'] },
  follower: { mode: ['peak', 'rms'], invert: ONOFF },
  notetrig: { legato: ONOFF },
  oscout: { mode: ['Renoise addresses', 'Wax addresses'], instrument: '', track: '', transpose: 'st' },
  arp: { mode: ARP_MODES, rate: ARP_RATES, retrigger: ARP_RETRIG, veltype: ['played', 'fixed'], hold: ONOFF, thru: ONOFF },
  chord: { follow: ONOFF, direction: ['from the lowest', 'from the highest'] },
  sampler: { reverse: ONOFF },
  fourpole: {
    wave1: ['sine', 'triangle', 'square', 'upsaw', 'downsaw', 'sawoid 1', 'sawoid 2', 'sawoid 3', 'noise 1', 'noise 2'],
    wave2: ['sine', 'triangle', 'square', 'upsaw', 'downsaw', 'sawoid 1', 'sawoid 2', 'sawoid 3', 'noise 1', 'noise 2', 'off'],
    mix: ['1+2', '1-2', '2-1', '1*2', '1/2', '2/1'],
    f1type: ['off', 'lowpass', 'highpass'], f2type: ['off', 'slave', 'lowpass', 'highpass'], f3type: ['off', 'slave', 'lowpass', 'highpass'], f4type: ['off', 'slave', 'lowpass', 'highpass'],
    route: ['1>2>3>4', '1+2>3>4', '1>2>3+4', '1>2+3>4', '1>2+3+4', '1+2>3+4', '1+2+3>4', '1+2+3+4'],
    limit: ['22050 Hz', '12000 Hz', '6000 Hz', '3000 Hz', '1500 Hz', '750 Hz', '325 Hz', 'note', 'note x2', 'note x3', 'note x4', 'note /2', 'note /3', 'note /4'],
  },
  subsynth: { wave1: ['saw', 'square', 'triangle', 'sine'], wave2: ['saw', 'square', 'triangle', 'sine'] },
  oberheim: { wave1: ['saw', 'pulse', 'triangle'], wave2: ['saw', 'pulse', 'triangle'], sync: ONOFF },
  wavetable: { source: ['table', 'pair'], snap: ONOFF },
  granular: { keytrack: ONOFF },
  woodblock: { keytrack: ONOFF },
  cardinal: { o1wave: ['triangle', 'saw', 'pulse', 'sine', 'noise'], o2wave: ['triangle', 'saw', 'pulse', 'sine', 'noise'], o2track: ONOFF, o2sync: ONOFF, ftype: ['lowpass 24', 'lowpass 12', 'bandpass', 'highpass', 'notch'], l1wave: ['sine', 'triangle', 'saw', 'square', 'random'], l2wave: ['sine', 'triangle', 'saw', 'square', 'random'], l1dest: ['pitch 1+2', 'pitch 2', 'fm', 'pulse width', 'filter', 'level'], l2dest: ['pitch 1+2', 'pitch 2', 'fm', 'pulse width', 'filter', 'level'] },
  drumsynth: { keytrack: ONOFF, noiseType: ['white', 'pink', 'brown', 'blue', 'violet'], clickMode: ['synthesized', 'sample'] },
  fmsynth: { algo: ALGORITHMS.map(a => a.name) },
  dvii: { gritty: ONOFF },
  blur: { freeze: ONOFF, size: ['1024', '2048', '4096'] },
  hpss: { size: ['1024', '2048', '4096'] },
  specdyn: { size: ['1024', '2048', '4096'] },
  xsynth: { size: ['1024', '2048', '4096'] },
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
