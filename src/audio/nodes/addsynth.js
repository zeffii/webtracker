// Additive synth: up to 32 sine partials whose levels you draw (the spectrum editor in the
// panel), shaped by a few controls that move every partial at once.
//   tilt      dB per octave added across the series (negative darkens)
//   evenodd   -1 silences even partials (hollow, square-like), +1 silences odd ones
//   stretch   partial n sits at n * f * sqrt(1 + B n^2): 0 is harmonic, more is bell or piano-like
//   drift     each partial gets a fixed random detune, so the sound shimmers instead of buzzing
//   hdecay    higher partials die faster, by hdecay/s per octave above the fundamental
//   width     odd partials lean left and even ones right
// Monophonic, last note wins, with glide. Partials are rotating phasors, so cost is a few
// multiplies per partial per sample, and anything past 0.45 * the sample rate is skipped.
import { Adsr } from './adsr.js';
import { HARMONICS, normalizeSpectrum } from './spectra.js';

const SPEC = [
  { name: 'harmonics', min: 1, max: HARMONICS, def: HARMONICS, int: true },
  { name: 'tilt', min: -12, max: 12, def: 0 },
  { name: 'evenodd', min: -1, max: 1, def: 0 },
  { name: 'stretch', min: 0, max: 1, def: 0 },
  { name: 'drift', min: 0, max: 1, def: 0 },
  { name: 'hdecay', min: 0, max: 20, def: 0 },
  { name: 'width', min: 0, max: 1, def: 0.4 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'glide', min: 0, max: 2000, def: 0 },
  { name: 'atk', min: 0.1, max: 5000, def: 5 },
  { name: 'dec', min: 1, max: 5000, def: 400 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 300 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'addsynth',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }],   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'addsynth',
  editor: 'spectrum',   // the patcher panel offers the spectrum editor for this node
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data, maxBlock = 128 }) {
    const pitchOn = connected[0];
    const amp = new Adsr(sampleRate);
    let spectrum = normalizeSpectrum(data?.spectrum);
    const re = new Float64Array(HARMONICS), im = new Float64Array(HARMONICS);
    const aPrev = new Float64Array(HARMONICS), age = new Float64Array(HARMONICS);   // aPrev: gain at the end of the last block
    const drifts = Float64Array.from({ length: HARMONICS }, (_, i) => {   // fixed pseudo-random, -1..1
      const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    });
    const target = new Float64Array(HARMONICS), c = new Float64Array(HARMONICS), sn = new Float64Array(HARMONICS);
    let env = new Float64Array(maxBlock), sumO = new Float64Array(maxBlock), sumE = new Float64Array(maxBlock);
    let note = 60, pos = 60, velocity = 1, time = 0;
    const reset = () => { re.fill(1); im.fill(0); aPrev.fill(0); time = 0; };
    reset();
    return {
      message(msg) { if (msg.type === 'spectrum') spectrum = normalizeSpectrum(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { reset(); pos = msg.note; }
          else time = 0;   // a retrigger brightens again
          note = msg.note; velocity = msg.vel ?? 1;
          amp.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') amp.off();
        else if (msg.type === 'noteCut') amp.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const count = Math.round(g('harmonics')), tilt = g('tilt'), eo = g('evenodd');
        const B = g('stretch') ** 2 * 0.004, drift = g('drift'), hdecay = g('hdecay'), width = g('width');
        const f0 = 440 * Math.pow(2, (pos + g('tune') - 69) / 12);
        const dt = n / sampleRate;
        const nyq = sampleRate * 0.45;
        const pitchMul = pitchOn ? Math.pow(2, inputs[0][0]) : 1;
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 0.4;
        // targets for this block, with the level normalised so a spectrum's shape does not change loudness
        let energy = 0;
        target.fill(0);
        for (let h = 0; h < count; h++) {
          const m = h + 1;
          const freq = f0 * pitchMul * m * Math.sqrt(1 + B * m * m) * Math.pow(2, (drift * 8 * drifts[h]) / 1200);
          if (freq >= nyq) continue;
          let a = spectrum[h] * Math.pow(10, (tilt * Math.log2(m)) / 20);
          a *= m % 2 ? Math.min(1, 1 - eo) : Math.min(1, 1 + eo);
          energy += a * a;
          target[h] = a;
          const w = (2 * Math.PI * freq) / sampleRate;
          c[h] = Math.cos(w); sn[h] = Math.sin(w);
        }
        const norm = energy > 1e-12 ? level / Math.sqrt(energy) : 0;
        let peakA = 0;
        for (let h = 0; h < count; h++) peakA = Math.max(peakA, target[h] * norm);
        if (env.length < n) env = new Float64Array(n);
        for (let i = 0; i < n; i++) env[i] = amp.next();
        // Odd and even partials sit on opposite sides of the stereo field, so each group is added up on its own and
        // panned once at the end; the envelope too is applied once to the sums, not to every partial.
        if (sumO.length < n) { sumO = new Float64Array(n); sumE = new Float64Array(n); }
        sumO.fill(0, 0, n); sumE.fill(0, 0, n);
        const quiet = peakA * 1e-4;   // a partial this far (-80 dB) below the loudest adds nothing to hear
        for (let h = 0; h < count; h++) {
          const bright = hdecay > 0 ? Math.exp(-hdecay * Math.log2(h + 1) * (time + dt)) : 1;   // higher partials die faster
          const a1 = target[h] * norm * bright, a0 = aPrev[h];
          if (a0 < quiet && a1 < quiet) { aPrev[h] = a1; continue; }
          aPrev[h] = a1;
          const sum = h & 1 ? sumE : sumO;   // partial h + 1: even partials are the odd indexes
          let x = re[h], y = im[h];
          const cc = c[h], ss = sn[h], step = (a1 - a0) / n;
          let a = a0;
          for (let i = 0; i < n; i++) {
            const nx = x * cc - y * ss;
            y = x * ss + y * cc; x = nx;
            a += step;
            sum[i] += y * a;
          }
          const mag = 1 / Math.sqrt(x * x + y * y);
          re[h] = x * mag; im[h] = y * mag;
        }
        {
          const angO = ((-width + 1) * Math.PI) / 4, angE = ((width + 1) * Math.PI) / 4;
          const olo = Math.cos(angO) * Math.SQRT2, oro = Math.sin(angO) * Math.SQRT2, ole = Math.cos(angE) * Math.SQRT2, ore = Math.sin(angE) * Math.SQRT2;
          for (let i = 0; i < n; i++) {
            const e = env[i], o = sumO[i] * e, v = sumE[i] * e;
            outL[i] = o * olo + v * ole; outR[i] = o * oro + v * ore;
          }
        }
        time += dt;
      },
    };
  },
};
