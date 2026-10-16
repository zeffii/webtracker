// Subtractive synth in one node: two band-limited oscillators (polyBLEP saw and square,
// naive triangle and sine) with unison, a sub oscillator and noise, into a 24 dB/oct
// resonant ladder lowpass, shaped by a filter envelope and an amplitude envelope. Stereo
// out: the unison voices are spread across the field. Monophonic, the last note wins,
// with optional glide (a smoothing time in ms) and slide (a straight-line glide measured in ticks that starts from the
// previous note of the same pattern column). The `pitch` input is in octaves (like osc.fm) and moves both
// oscillators; `cut` is in octaves and moves the filter cutoff, so an lfo can drive either.
//
// The ladder is a zero-delay-feedback four-pole with tanh saturation at its input, so
// resonance and drive bite rather than just ring, and resonance 1 sings by itself.
import { Adsr } from './adsr.js';

const P = {};
const SPEC = [
  { name: 'wave1', min: 0, max: 3, def: 0, int: true },       // 0 saw, 1 square, 2 triangle, 3 sine
  { name: 'wave2', min: 0, max: 3, def: 0, int: true },
  { name: 'pw', min: 0.05, max: 0.95, def: 0.5 },             // pulse width of the square waves
  { name: 'osc2', min: 0, max: 1, def: 0.6 },                 // level of oscillator 2 (oscillator 1 is 1)
  { name: 'detune', min: -100, max: 100, def: 7 },            // cents, oscillator 2 against 1
  { name: 'tune2', min: -24, max: 24, def: 0 },               // semitones, oscillator 2 against 1
  { name: 'sub', min: 0, max: 1, def: 0 },                    // sine one octave below
  { name: 'noise', min: 0, max: 1, def: 0 },
  { name: 'unison', min: 1, max: 7, def: 1, int: true },
  { name: 'spread', min: 0, max: 50, def: 12 },               // cents, outermost unison voices
  { name: 'width', min: 0, max: 1, def: 0.7 },                // stereo spread of the unison voices
  { name: 'cutoff', min: 20, max: 20000, def: 1200 },         // Hz
  { name: 'res', min: 0, max: 1, def: 0.2 },
  { name: 'drive', min: 0, max: 1, def: 0.2 },
  { name: 'fenv', min: -8, max: 8, def: 3 },                  // octaves of cutoff the filter envelope adds
  { name: 'keytrack', min: 0, max: 1, def: 0.5 },
  { name: 'fatk', min: 0.1, max: 5000, def: 1 },             // filter envelope, ms
  { name: 'fdec', min: 1, max: 5000, def: 250 },
  { name: 'fsus', min: 0, max: 1, def: 0.2 },
  { name: 'frel', min: 1, max: 5000, def: 150 },
  { name: 'atk', min: 0.1, max: 5000, def: 2 },              // amplitude envelope, ms
  { name: 'dec', min: 1, max: 5000, def: 300 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 150 },
  { name: 'glide', min: 0, max: 2000, def: 0 },               // ms
  { name: 'slide', min: 0, max: 15.9375, def: 0 },            // ticks: a note that follows another in its column slides to its pitch in this long (linear; 0 is instant). In pattern units, hex 10 is one tick
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.4 },
];
SPEC.forEach((s, i) => { P[s.name] = i; });

const MAXV = 7, SUB_BLOCK = 8, TWO_PI = 2 * Math.PI, LN2 = Math.LN2;
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
  if (wave === 2) return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  return Math.sin(TWO_PI * p);
};

export default {
  type: 'subsynth',
  inputs: ['pitch', 'cut'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'fatk', dec: 'fdec', sus: 'fsus', rel: 'frel' }],   // amplitude and filter envelopes, drawn beside the node when it is selected   // makes sound from notes, so the instrument screen can play it from the keyboard
  shape: 'rounded',
  glyph: 'subsynth',
  kinds: { pitch: 'control', cut: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, clock }) {
    const pitchOn = connected[0], cutOn = connected[1];
    const amp = new Adsr(sampleRate), fil = new Adsr(sampleRate);
    const ph1 = new Float64Array(MAXV), ph2 = new Float64Array(MAXV);
    const inc1 = new Float64Array(MAXV), inc2 = new Float64Array(MAXV);
    const gl = new Float64Array(MAXV), gr = new Float64Array(MAXV);
    const start = Float64Array.from({ length: MAXV }, (_, i) => (i * 0.61803398875) % 1);
    let subPhase = 0, note = 60, pos = 60, velocity = 1, seed = 12345;
    let latch = false, ampFresh = false, from = -1, rate = 0;   // a new note: read `slide` once, in the next block, and move pos in a straight line
    const s = new Float64Array(8);   // ladder states: 4 left, 4 right
    const flush = v => (Math.abs(v) < 1e-18 ? 0 : v);
    const resetPhases = () => { for (let i = 0; i < MAXV; i++) { ph1[i] = start[i]; ph2[i] = (start[i] + 0.37) % 1; } subPhase = 0; };
    resetPhases();
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          ampFresh = amp.idle;
          if (amp.idle) { resetPhases(); s.fill(0); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          latch = true; from = msg.from ?? -1;
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
        if (latch) {   // the slide time in force when the note started (the pattern writes it just before)
          latch = false;
          const ticks = g('slide'), tickSamples = clock?.tickSamples ?? sampleRate * 0.125;
          if (ticks > 0) {
            if (from >= 0 && pos !== from && ampFresh) pos = from;
            rate = Math.abs(note - pos) / (ticks * tickSamples);
          } else rate = 0;
          ampFresh = false;
        }
        if (rate > 0) {
          const step = rate * n;
          pos = Math.abs(note - pos) <= step ? note : pos + Math.sign(note - pos) * step;
          if (pos === note) rate = 0;
        } else if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        const w1 = Math.round(g('wave1')), w2 = Math.round(g('wave2')), pw = g('pw');
        const lvl2 = g('osc2'), sub = g('sub'), noise = g('noise');
        const U = Math.max(1, Math.min(MAXV, Math.round(g('unison'))));
        const spread = g('spread'), width = g('width'), detune = g('detune'), tune2 = g('tune2');
        const baseHz = 440 * Math.pow(2, (pos - 69) / 12);
        const vnorm = 1 / Math.sqrt(U);
        for (let u = 0; u < U; u++) {
          const x = U === 1 ? 0 : (2 * u) / (U - 1) - 1;
          const cents = x * spread;
          inc1[u] = (baseHz * Math.pow(2, cents / 1200)) / sampleRate;
          inc2[u] = (baseHz * Math.pow(2, (tune2 * 100 + detune + cents) / 1200)) / sampleRate;
          const a = ((x * width + 1) * Math.PI) / 4;   // equal-power pan, centre at x = 0
          gl[u] = Math.cos(a) * Math.SQRT2 * vnorm;
          gr[u] = Math.sin(a) * Math.SQRT2 * vnorm;
        }
        const subInc = baseHz / 2 / sampleRate;
        const cutoff = g('cutoff'), res = g('res'), k = res * 4, drive = 1 + g('drive') * 4;
        const fenv = g('fenv'), keyOct = (g('keytrack') * (pos - 60)) / 12;
        const comp = 1 + res * 0.5;
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 1.5;
        const nyq = sampleRate * 0.45;
        let G = 0, G2 = 0, G3 = 0, G4 = 0, norm = 1;
        for (let i = 0; i < n; i++) {
          const a = amp.next(), f = fil.next();
          if ((i & (SUB_BLOCK - 1)) === 0) {
            const oct = fenv * f + keyOct + (cutOn ? cutIn[i] : 0);
            const hz = Math.min(nyq, Math.max(10, cutoff * Math.pow(2, oct)));
            const gg = Math.tan((Math.PI * hz) / sampleRate);
            G = gg / (1 + gg); G2 = G * G; G3 = G2 * G; G4 = G2 * G2;
            norm = 1 / (1 + k * G4);
          }
          const fm = pitchOn ? Math.pow(2, pitchIn[i]) : 1;
          let l = 0, r = 0;
          for (let u = 0; u < U; u++) {
            const d1 = inc1[u] * fm, d2 = inc2[u] * fm;
            const v = osc(w1, ph1[u], d1, pw) + (lvl2 > 0 ? lvl2 * osc(w2, ph2[u], d2, pw) : 0);
            l += v * gl[u]; r += v * gr[u];
            ph1[u] += d1; if (ph1[u] >= 1) ph1[u] -= 1;
            ph2[u] += d2; if (ph2[u] >= 1) ph2[u] -= 1;
          }
          let c = 0;
          if (sub > 0) { c += sub * Math.sin(TWO_PI * subPhase); }
          subPhase += subInc * fm; if (subPhase >= 1) subPhase -= 1;
          if (noise > 0) { seed = (seed * 1664525 + 1013904223) >>> 0; c += noise * (seed / 2147483648 - 1); }
          l += c; r += c;
          // ladder, left then right: y = G x + (1 - G) s for each stage, solved with the feedback
          for (let ch = 0; ch < 2; ch++) {
            const o = ch * 4, h = 1 - G;
            const S1 = h * s[o], S2 = h * s[o + 1], S3 = h * s[o + 2], S4 = h * s[o + 3];
            const sigma = G3 * S1 + G2 * S2 + G * S3 + S4;
            const x1 = Math.tanh(((ch ? r : l) * comp * drive - k * sigma) * norm);
            const y1 = G * x1 + S1, y2 = G * y1 + S2, y3 = G * y2 + S3, y4 = G * y3 + S4;
            s[o] = flush(2 * y1 - s[o]);
            s[o + 1] = flush(2 * y2 - s[o + 1]);
            s[o + 2] = flush(2 * y3 - s[o + 2]);
            s[o + 3] = flush(2 * y4 - s[o + 3]);
            if (ch) r = y4; else l = y4;
          }
          outL[i] = (l * a * level) / drive;
          outR[i] = (r * a * level) / drive;
        }
      },
    };
  },
};
