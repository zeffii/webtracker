// Oberheim-style synth voice: two oscillators (saw, pulse with pulse-width modulation, triangle), the second
// optionally hard-synced to the first with a filter-envelope sweep on its pitch, into a state-variable multimode filter
// after the SEM: 12 dB per octave, and one `mode` knob sweeps it from lowpass through notch to highpass (with a
// bandpass blend on top). Filter and amplitude each have an ADSR. A slow analog drift keeps the two oscillators and the
// cutoff wandering a little, each note lands at a random spot in the stereo field (`scatter`), and a vibrato LFO is built
// in. Monophonic, last note wins, with glide; the voices node makes it a polyphonic synth, and its voices each get their
// own drift, which is much of the sound. The `pitch` input is in octaves, `cut` in octaves of cutoff.
import { Adsr } from './adsr.js';

const P = {};
const SPEC = [
  { name: 'wave1', min: 0, max: 2, def: 0, int: true },       // 0 saw, 1 pulse, 2 triangle
  { name: 'wave2', min: 0, max: 2, def: 1, int: true },
  { name: 'pw', min: 0.05, max: 0.95, def: 0.5 },             // pulse width
  { name: 'pwm', min: 0, max: 0.45, def: 0.15 },              // how far the width swings
  { name: 'pwmrate', min: 0.1, max: 10, def: 0.8 },           // Hz
  { name: 'osc2', min: 0, max: 1, def: 0.8 },                 // level of oscillator 2
  { name: 'detune', min: -100, max: 100, def: 6 },            // cents, oscillator 2 against 1
  { name: 'tune2', min: -24, max: 24, def: 0 },               // semitones
  { name: 'sync', min: 0, max: 1, def: 0, int: true },        // oscillator 2 restarts with oscillator 1
  { name: 'sweep', min: 0, max: 48, def: 0 },                 // semitones the filter envelope adds to oscillator 2
  { name: 'noise', min: 0, max: 1, def: 0 },
  { name: 'cutoff', min: 20, max: 20000, def: 1800 },         // Hz
  { name: 'res', min: 0, max: 1, def: 0.25 },
  { name: 'mode', min: 0, max: 1, def: 0 },                   // 0 lowpass, 0.5 notch, 1 highpass
  { name: 'bp', min: 0, max: 1, def: 0 },                     // blend towards bandpass
  { name: 'drive', min: 0, max: 1, def: 0.15 },
  { name: 'fenv', min: -8, max: 8, def: 2.5 },                // octaves of cutoff the filter envelope adds
  { name: 'keytrack', min: 0, max: 1, def: 0.5 },
  { name: 'fatk', min: 0.1, max: 5000, def: 2 },
  { name: 'fdec', min: 1, max: 5000, def: 400 },
  { name: 'fsus', min: 0, max: 1, def: 0.3 },
  { name: 'frel', min: 1, max: 5000, def: 300 },
  { name: 'atk', min: 0.1, max: 5000, def: 4 },
  { name: 'dec', min: 1, max: 5000, def: 300 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 300 },
  { name: 'glide', min: 0, max: 2000, def: 0 },               // ms
  { name: 'vib', min: 0, max: 100, def: 0 },                  // vibrato depth, cents
  { name: 'vrate', min: 0.5, max: 12, def: 5.5 },             // Hz
  { name: 'drift', min: 0, max: 1, def: 0.4 },
  { name: 'scatter', min: 0, max: 1, def: 0.4 },              // how far from the centre each note may land
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.4 },
];
SPEC.forEach((s, i) => { P[s.name] = i; });

const SUB_BLOCK = 8, TWO_PI = 2 * Math.PI;
let instances = 0;   // every voice gets its own random stream, the same on every load
const B = t => t * 2 - t * t - 1;   // the polyBLEP correction for the sample just after a step, t in 0..1 samples since it
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const osc = (wave, p, dt, pw) => {
  if (wave === 0) return 2 * p - 1 - blep(p, dt);
  if (wave === 1) {
    let q = p + 1 - pw; if (q >= 1) q -= 1;
    return (p < pw ? 1 : -1) + blep(p, dt) - blep(q, dt);
  }
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
};
const sat = z => (z > 3 ? 1 : z < -3 ? -1 : z * (27 + z * z) / (27 + 9 * z * z));

export default {
  type: 'oberheim',
  inputs: ['pitch', 'cut'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'fatk', dec: 'fdec', sus: 'fsus', rel: 'frel' }],
  shape: 'rounded',
  glyph: 'oberheim',
  kinds: { pitch: 'control', cut: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0], cutOn = connected[1];
    const amp = new Adsr(sampleRate), fil = new Adsr(sampleRate);
    let seed = (0x9e3779b9 * ++instances) >>> 0 || 1;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    let p1 = 0, p2 = 0, pwmPh = rand() * 0.5 + 0.5, vibPh = 0, note = 60, pos = 60, velocity = 1;
    let d1 = 0, d2 = 0, d3 = 0, off2 = 0, pan = 0, noiseSeed = 12345;
    let s1 = 0, s2 = 0, s1r = 0, s2r = 0;
    const driftC = 1 - Math.exp(-TWO_PI * 0.6 / (sampleRate / SUB_BLOCK)), driftGain = Math.sqrt((2 - driftC) / driftC) * 0.577;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { p1 = 0; p2 = 0.37; s1 = s2 = s1r = s2r = 0; pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          off2 = rand();   // each note comes out a little different
          pan = rand();
          amp.on(); fil.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); fil.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); fil.cut(); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const pitchIn = inputs[0], cutIn = inputs[1];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        fil.set(g('fatk'), g('fdec'), g('fsus'), g('frel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const w1 = Math.round(g('wave1')), w2 = Math.round(g('wave2')), pwBase = g('pw'), pwm = g('pwm');
        const lvl2 = g('osc2'), noise = g('noise'), sync = g('sync') >= 0.5, sweep = g('sweep'), drift = g('drift');
        const detune = g('detune'), tune2 = g('tune2') * 100, vib = g('vib');
        const pwmInc = g('pwmrate') / sampleRate, vibInc = g('vrate') / sampleRate;
        const baseHz = 440 * Math.pow(2, (pos - 69) / 12);
        const cutoff = g('cutoff'), res = g('res'), drive = 1 + g('drive') * 4, mode = g('mode'), bpm = g('bp');
        const R = 1 - res * 0.97;   // damping: 1 is no resonance
        const fenv = g('fenv'), keyOct = (g('keytrack') * (pos - 60)) / 12;
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 1.2 * (1 - res * 0.25);
        const nyq = sampleRate * 0.45;
        const scatter = g('scatter') * pan, a = (scatter + 1) * Math.PI / 4, gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2;
        let G = 0, den = 1, inc1 = 0, inc2 = 0, pw = pwBase, osc2Semi = 0;
        for (let i = 0; i < n; i++) {
          const av = amp.next(), f = fil.next();
          if ((i & (SUB_BLOCK - 1)) === 0) {
            d1 += (rand() - d1) * driftC; d2 += (rand() - d2) * driftC; d3 += (rand() - d3) * driftC;
            pwmPh += pwmInc * SUB_BLOCK; if (pwmPh >= 1) pwmPh -= 1;
            vibPh += vibInc * SUB_BLOCK; if (vibPh >= 1) vibPh -= 1;
            const v = vib * Math.sin(TWO_PI * vibPh);
            const octs = pitchOn ? pitchIn[i] : 0;
            inc1 = baseHz * Math.pow(2, octs + (v + drift * 6 * driftGain * d1 + off2 * drift * 3) / 1200) / sampleRate;
            inc2 = baseHz * Math.pow(2, octs + (v + detune + tune2 + sweep * 100 * f + drift * 6 * driftGain * d2 - off2 * drift * 3) / 1200) / sampleRate;
            pw = Math.max(0.05, Math.min(0.95, pwBase + pwm * Math.sin(TWO_PI * pwmPh)));
            const oct = fenv * f + keyOct + (cutOn ? cutIn[i] : 0) + drift * 0.08 * driftGain * d3;
            const hz = Math.min(nyq, Math.max(10, cutoff * Math.pow(2, oct)));
            G = Math.tan((Math.PI * hz) / sampleRate);
            den = 1 / (1 + 2 * R * G + G * G);
          }
          let v = osc(w1, p1, inc1, pw);
          p1 += inc1; let wrapped = false;
          if (p1 >= 1) { p1 -= 1; wrapped = true; }
          if (lvl2 > 0) {
            let o2 = osc(w2, p2, inc2, pw);
            p2 += inc2; if (p2 >= 1) p2 -= 1;
            if (sync && wrapped) {   // oscillator 1 restarts: oscillator 2 jumps back with it, softened by a polyBLEP
              const t = p1 / inc1;   // how far into this sample the restart happened
              const before = o2, np = t * inc2;
              p2 = np; o2 = osc(w2, p2, inc2, pw);
              if (w2 !== 2) o2 += ((before - o2) * -0.5) * B(Math.min(1, t));
            }
            v += lvl2 * o2;
          }
          if (noise > 0) { noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0; v += noise * (noiseSeed / 2147483648 - 1); }
          // state variable filter (zero delay feedback), left and right states are the same signal so one is enough
          const x = sat(v * 0.6 * drive);
          const hp = (x - (2 * R + G) * s1 - s2) * den;
          const bp = G * hp + s1, lp = G * bp + s2;
          s1 = 2 * sat((G * hp + bp) * 0.5); s2 = G * bp + lp;
          if (Math.abs(s1) < 1e-18) s1 = 0; if (Math.abs(s2) < 1e-18) s2 = 0;
          let y = (1 - mode) * lp + mode * hp;
          y = y * (1 - bpm) + bpm * bp * (0.5 + R);
          const o = y * av * level / drive * 2.2;
          outL[i] = o * gl; outR[i] = o * gr;
        }
      },
    };
  },
};
