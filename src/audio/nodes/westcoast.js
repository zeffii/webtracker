// West-coast voice in one node: a complex oscillator into a pluck gate.
//
// The complex oscillator is two oscillators. A modulation oscillator (sine or triangle, a ratio of the pitch) bends the
// phase of the principal oscillator (`fm`), and can restart it every cycle (`sync`): the principal's pitch stays put and
// its tone swings from soft to metallic. The principal is a sine, triangle, saw, square or the wave drawn in the panel.
// A timbre stage then folds the wave back on itself (`fold`): the louder the wave is pushed into the folder the more
// folds, so a plain sine grows harmonics the way a filter never could; `symmetry` moves the wave off centre first, so the
// folds come out uneven and add the even harmonics.
//
// The pluck gate is one control for both loudness and brightness. A strike envelope (attack, decay, sustain, release)
// drives a vactrol: a light and a photocell, which is quick to open and slow to let go, so a sound dies with its top end
// first, like a struck object. That control opens the gain and the cutoff of a low-pass filter together (`mode` picks
// both, the gain alone, or the filter alone).
// A second envelope, the timbre envelope, moves `fold` and `fm` over the length of the note.
//
// Monophonic, the last note wins (put a voices node after it for chords). Stereo out, the same on both sides.
import { Adsr } from './adsr.js';
import { WAVE_POINTS, normalizeWave } from './waves.js';
import { foldWave, DcBlock, PluckGate } from '../westcore.js';

const SPEC = [
  { name: 'wave', min: 0, max: 4, def: 0, int: true },          // 0 sine, 1 triangle, 2 saw, 3 square, 4 drawn
  { name: 'tune', min: -48, max: 48, def: 0 },                   // semitones
  { name: 'ratio', min: 0.25, max: 8, def: 2 },                  // modulation oscillator's pitch against the principal's
  { name: 'modtune', min: -100, max: 100, def: 0 },              // cents, fine tuning of the modulation oscillator
  { name: 'modwave', min: 0, max: 1, def: 0, int: true },        // 0 sine, 1 triangle
  { name: 'fm', min: 0, max: 1, def: 0.2 },                      // how far the modulation oscillator bends the principal
  { name: 'sync', min: 0, max: 1, def: 0, int: true },           // 1: the principal restarts every cycle of the modulation oscillator
  { name: 'fold', min: 0, max: 1, def: 0.3 },                    // how hard the wave is pushed into the wave folder
  { name: 'symmetry', min: -1, max: 1, def: 0 },                 // moves the wave off centre before it is folded
  { name: 'foldenv', min: -1, max: 1, def: 0.5 },                // how much the timbre envelope adds to `fold`
  { name: 'fmenv', min: -1, max: 1, def: 0.3 },                  // how much the timbre envelope adds to `fm`
  { name: 'tatk', min: 0.1, max: 5000, def: 1 },                 // timbre envelope, ms
  { name: 'tdec', min: 1, max: 5000, def: 400 },
  { name: 'tsus', min: 0, max: 1, def: 0 },
  { name: 'trel', min: 1, max: 5000, def: 300 },
  { name: 'mode', min: 0, max: 2, def: 0, int: true },           // 0 gain and filter, 1 gain only, 2 filter only
  { name: 'bright', min: 0, max: 1, def: 0.6 },                  // the gate's highest cutoff
  { name: 'res', min: 0, max: 0.9, def: 0.05 },                   // the gate filter's resonance
  { name: 'track', min: 0, max: 1, def: 0.5 },                   // how far the cutoff follows the note's pitch
  { name: 'lpgatk', min: 0.2, max: 200, def: 2 },                // how fast the vactrol opens, ms
  { name: 'lpgdec', min: 10, max: 5000, def: 300 },              // how slowly it lets go, ms
  { name: 'atk', min: 0.1, max: 5000, def: 1 },                  // strike envelope, ms
  { name: 'dec', min: 1, max: 5000, def: 350 },
  { name: 'sus', min: 0, max: 1, def: 0 },
  { name: 'rel', min: 1, max: 5000, def: 200 },
  { name: 'glide', min: 0, max: 2000, def: 0 },                  // ms
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.6 },
  { name: 'quality', min: 0, max: 2, def: 1, int: true },        // 0 standard, 1 high (the oscillator and folder run at twice the rate), 2 ultra (four times)
  { name: 'drift', min: 0, max: 1, def: 0.5 },                    // how much the fold, fm and pitch wander, and how much each note differs from the last
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const TWO_PI = 2 * Math.PI, FM_RADIANS = 12;
let instances = 0;
// the step of a saw or square is smoothed over two samples so it does not alias (polyBLEP)
const blep = (t, dt) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
const triangle = p => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4);

export default {
  type: 'westcoast',
  inputs: ['pitch', 'fold'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  editor: 'oscwave',        // the drawing of the `drawn` wave
  drawnWave: 4,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'tatk', dec: 'tdec', sus: 'tsus', rel: 'trel' }],
  shape: 'rounded',
  glyph: 'westcoast',
  kinds: { pitch: 'control', fold: 'control', out: 'stereo' },   // pitch in octaves; fold adds to the fold amount
  params: SPEC,
  create({ sampleRate, connected, data }) {
    const pitchOn = connected[0], foldOn = connected[1];
    const amp = new Adsr(sampleRate), tim = new Adsr(sampleRate);
    let table = normalizeWave(data?.wave);
    const gate = new PluckGate(sampleRate), dcb = new DcBlock();
    let p = 0, pm = 0, note = 60, pos = 60, velocity = 1, prev = 0;
    let seed = 0x2545f491 ^ (++instances * 0x9e3779b9) >>> 0 || 1;   // each voice wanders its own way, the same every time the song is rendered
    const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296 * 2 - 1; };
    let dFold = 0, dFm = 0, dPitch = 0, tFold = 0, tFm = 0, tPitch = 0, until = 0, perNote = 0;
    const reset = () => { p = 0; pm = 0; prev = 0; gate.reset(); dcb.reset(); };
    const principal = (wave, x, dt) => {
      if (wave === 0) return Math.sin(TWO_PI * x);
      if (wave === 1) return triangle(x);
      if (wave === 2) return 2 * x - 1 - blep(x, dt);
      if (wave === 3) return (x < 0.5 ? 1 : -1) + blep(x, dt) - blep(x < 0.5 ? x + 0.5 : x - 0.5, dt);
      const t = x * WAVE_POINTS, j = t | 0, f = t - j;
      return table[j] + (table[(j + 1) & (WAVE_POINTS - 1)] - table[j]) * f;
    };
    return {
      message(msg) { if (msg.type === 'wave') table = normalizeWave(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle && gate.idle) { reset(); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1; perNote = rand();
          amp.on(); tim.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); tim.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); tim.cut(); gate.reset(); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle && gate.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const pitchIn = inputs[0], foldIn = inputs[1];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        tim.set(g('tatk'), g('tdec'), g('tsus'), g('trel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const wave = Math.round(g('wave')), modwave = Math.round(g('modwave')), sync = g('sync') >= 0.5, quality = Math.round(g('quality'));
        const drift = g('drift');
        until -= n;   // a new place to wander to about every 0.4 s, reached smoothly
        if (until <= 0) { tFold = rand(); tFm = rand(); tPitch = rand(); until = sampleRate * 0.4; }
        const slide = 1 - Math.exp(-n / (sampleRate * 0.25));
        dFold += (tFold - dFold) * slide; dFm += (tFm - dFm) * slide; dPitch += (tPitch - dPitch) * slide;
        const inc = 440 * Math.pow(2, (pos - 69 + g('tune') + drift * dPitch * 0.06) / 12) / sampleRate, incMod = inc * g('ratio') * Math.pow(2, g('modtune') / 1200);
        const fm0 = g('fm'), fmenv = g('fmenv'), fold0 = g('fold'), foldenv = g('foldenv'), sym = g('symmetry') * 0.6;
        gate.set({ mode: Math.round(g('mode')), bright: g('bright'), res: g('res'), openMs: g('lpgatk'), closeMs: g('lpgdec'), semis: (pos - 60) * g('track') });
        const strike = 1 - g('vel') + g('vel') * velocity, level = g('level');
        const steps = quality === 2 ? 4 : quality === 1 ? 2 : 1, step = 1 / steps, high = steps > 1;
        const foldDrift = drift * (0.22 * dFold + 0.12 * perNote), fmDrift = drift * 0.2 * dFm;
        for (let i = 0; i < n; i++) {
          const a = amp.next(), t = tim.next();
          const pitchMul = pitchOn ? Math.pow(2, pitchIn[i]) : 1;
          const idx = Math.max(0, Math.min(1, fm0 + fmDrift + fmenv * t));
          const index = idx * idx * FM_RADIANS;
          const amount = Math.max(0, Math.min(1, fold0 + foldDrift + foldenv * t + (foldOn ? foldIn[i] : 0)));
          let first = 0, last = 0, sum = 0;
          for (let s = 0; s < steps; s++) {
            const m = modwave === 0 ? Math.sin(TWO_PI * pm) : triangle(pm);
            let x = p + (index * m) / TWO_PI; x -= Math.floor(x);
            const y = foldWave(principal(wave, x, inc * pitchMul * step), amount, sym);
            if (s === 0) first = y; else last = y;
            sum += y;
            pm += incMod * pitchMul * step; p += inc * pitchMul * step;
            if (pm >= 1) { pm -= Math.floor(pm); if (sync) p = 0; }
            if (p >= 1) p -= Math.floor(p);
          }
          const raw = steps === 4 ? (prev + sum + last) / 6 : high ? (prev + 2 * first + last) * 0.25 : first;   // a short low-pass over the half-steps before they are dropped to the output rate
          if (high) prev = last;
          const out = gate.run(dcb.run(raw), a * strike) * level;
          outL[i] = out; outR[i] = out;
        }
      },
    };
  },
};
