// Cardinal: a monophonic virtual-analogue lead voice. Put it behind the `voices` node for chords.
//
// The signal path, left to right:
//   OSC 1 and OSC 2   triangle, saw, pulse, sine or noise each. Osc 2 has semitone and fine tune, key tracking
//                     (off: it plays the same pitch for every note), hard sync to osc 1, and osc 1 can frequency-modulate it (fm).
//   mix, ring, noise  osc balance (0 is osc 1 alone, 1 is osc 2 alone), ring modulation of the two, and white noise
//   unison            up to five copies detuned against each other and spread across the stereo field
//   filter            lowpass 24 dB (a ladder with saturation), lowpass 12, bandpass, highpass or notch, with cutoff, resonance,
//                     key tracking and distortion
//   amp envelope      ADSR for the level
// Two more sources of movement:
//   mod envelope      ADSR whose output can sweep the filter cutoff (e2cut, in octaves), the pitch of osc 2 (e2pitch), the fm amount
//                     (e2fm) and the pulse width (e2pw)
//   two LFOs          each with a wave (sine, triangle, saw, square, random), a rate, an amount and one destination:
//                     both pitches, pitch of osc 2, fm amount, pulse width, filter cutoff or level (tremolo)
// glide smooths a note into the next; slide is a straight-line glide measured in ticks (like the other synth nodes).
//
// The file is laid out in the order of that path: the parameter list, small helpers (oscillators, LFO, filters), the voice itself,
// and last the helpers the node's picture uses (renderPreview, filterResponse, lfoShape).
import { Adsr } from './adsr.js';

// ---- parameters ----
const SPEC = [
  // oscillators
  { name: 'o1wave', min: 0, max: 4, def: 1, int: true },          // 0 triangle, 1 saw, 2 pulse, 3 sine, 4 noise
  { name: 'o1pw', min: 0.05, max: 0.95, def: 0.5 },               // pulse width
  { name: 'o2wave', min: 0, max: 4, def: 1, int: true },
  { name: 'o2pw', min: 0.05, max: 0.95, def: 0.5 },
  { name: 'o2semi', min: -24, max: 24, def: 0 },                  // semitones, osc 2 against the note
  { name: 'o2fine', min: -100, max: 100, def: 6 },                // cents
  { name: 'o2track', min: 0, max: 1, def: 1, int: true },         // 1: osc 2 follows the note, 0: it always plays the same pitch
  { name: 'o2sync', min: 0, max: 1, def: 0, int: true },          // 1: every cycle of osc 1 restarts osc 2
  { name: 'fm', min: 0, max: 1, def: 0 },                         // osc 1 frequency-modulates osc 2
  { name: 'ring', min: 0, max: 1, def: 0 },                       // ring modulation of osc 1 by osc 2, blended in
  { name: 'mix', min: 0, max: 1, def: 0.5 },                      // 0: osc 1 only, 1: osc 2 only
  { name: 'noise', min: 0, max: 1, def: 0 },
  { name: 'unison', min: 1, max: 5, def: 1, int: true },
  { name: 'detune', min: 0, max: 50, def: 12 },                   // cents between the outermost unison voices
  { name: 'width', min: 0, max: 1, def: 0.7 },                    // stereo spread of the unison voices
  // filter
  { name: 'ftype', min: 0, max: 4, def: 0, int: true },           // 0 lowpass 24, 1 lowpass 12, 2 bandpass, 3 highpass, 4 notch
  { name: 'cutoff', min: 20, max: 20000, def: 1500 },             // Hz
  { name: 'res', min: 0, max: 1, def: 0.25 },
  { name: 'dist', min: 0, max: 1, def: 0.15 },
  { name: 'fkey', min: 0, max: 1, def: 0.5 },                     // how much the note moves the cutoff
  // mod envelope and what it moves
  { name: 'matk', min: 0.1, max: 5000, def: 1 },                  // ms
  { name: 'mdec', min: 1, max: 5000, def: 400 },
  { name: 'msus', min: 0, max: 1, def: 0 },
  { name: 'mrel', min: 1, max: 5000, def: 200 },
  { name: 'e2cut', min: -8, max: 8, def: 3 },                     // octaves of cutoff
  { name: 'e2pitch', min: -24, max: 24, def: 0 },                 // semitones on osc 2
  { name: 'e2fm', min: 0, max: 1, def: 0 },
  { name: 'e2pw', min: -0.45, max: 0.45, def: 0 },
  // amp envelope
  { name: 'atk', min: 0.1, max: 5000, def: 2 },
  { name: 'dec', min: 1, max: 5000, def: 300 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 150 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },                      // how much note velocity changes the level
  // LFO 1 and 2
  { name: 'l1wave', min: 0, max: 4, def: 0, int: true },          // 0 sine, 1 triangle, 2 saw, 3 square, 4 random
  { name: 'l1rate', min: 0.02, max: 50, def: 5 },                 // Hz
  { name: 'l1amt', min: 0, max: 1, def: 0 },
  { name: 'l1dest', min: 0, max: 5, def: 0, int: true },          // 0 pitch 1+2, 1 pitch 2, 2 fm, 3 pulse width, 4 filter, 5 level
  { name: 'l2wave', min: 0, max: 4, def: 0, int: true },
  { name: 'l2rate', min: 0.02, max: 50, def: 0.5 },
  { name: 'l2amt', min: 0, max: 1, def: 0 },
  { name: 'l2dest', min: 0, max: 5, def: 4, int: true },
  // play
  { name: 'glide', min: 0, max: 2000, def: 0 },                   // ms
  { name: 'slide', min: 0, max: 15.9375, def: 0 },                // ticks
  { name: 'level', min: 0, max: 1, def: 0.4 },
];
const P = Object.fromEntries(SPEC.map((s, i) => [s.name, i]));
export const SPEC_NAMES = SPEC.map(s => s.name);
export const WAVES = ['triangle', 'saw', 'pulse', 'sine', 'noise'];
export const FILTERS = ['lowpass 24', 'lowpass 12', 'bandpass', 'highpass', 'notch'];
export const LFO_WAVES = ['sine', 'triangle', 'saw', 'square', 'random'];
export const LFO_DESTS = ['pitch 1+2', 'pitch 2', 'fm', 'pulse width', 'filter', 'level'];

const MAXV = 5, CONTROL_BLOCK = 8, TWO_PI = 2 * Math.PI;
const LFO_PITCH = 12, LFO_FILTER = 4, LFO_PW = 0.45;   // what an LFO amount of 1 does: semitones, octaves of cutoff, pulse width

// ---- oscillators and LFOs ----
const blep = (t, dt) => {   // the correction that takes the aliasing out of a saw or pulse edge
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const wrap01 = p => p - Math.floor(p);
// one sample of an oscillator at phase p (0 to 1) advancing dt per sample; `noise` supplies the random value for wave 4
function oscillator(wave, p, dt, pw, noise) {
  switch (wave) {
    case 0: return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case 1: return 2 * p - 1 - blep(p, dt);
    case 2: { const q = wrap01(p + 1 - pw); return (p < pw ? 1 : -1) + blep(p, dt) - blep(q, dt); }
    case 3: return Math.sin(TWO_PI * p);
    default: return noise;
  }
}
// the LFO's wave at phase p, -1 to 1; `held` is the random value that stays until the phase wraps
export function lfoShape(wave, p, held = 0) {
  switch (wave) {
    case 0: return Math.sin(TWO_PI * p);
    case 1: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 2: return 2 * p - 1;
    case 3: return p < 0.5 ? 1 : -1;
    default: return held;
  }
}

// ---- the filter's picture: its gain at a frequency, from the analogue prototype each type is built on ----
export function filterResponse(values, hz) {
  const type = Math.round(values.ftype ?? 0), x = hz / values.cutoff, res = values.res ?? 0;
  if (type === 0) {   // four poles with the resonance fed back around them
    let re = 1, im = 0;   // (1 + jx) to the fourth power
    for (let i = 0; i < 4; i++) [re, im] = [re - im * x, re * x + im];
    return 1 / Math.hypot(re + res * 4, im);
  }
  const k = 2 - 1.95 * res, re = 1 - x * x, im = k * x, den = Math.hypot(re, im);
  if (type === 1) return 1 / den;
  if (type === 2) return x / den;
  if (type === 3) return (x * x) / den;
  return Math.abs(re) / den;
}

// ---- the node ----
const NODE = {
  type: 'cardinal',
  inputs: ['pitch', 'cut'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  editor: 'cardinal',
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'matk', dec: 'mdec', sus: 'msus', rel: 'mrel' }],
  shape: 'rounded',
  glyph: 'cardinal',
  kinds: { pitch: 'control', cut: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, clock }) {
    const pitchOn = connected?.[0] === true, cutOn = connected?.[1] === true;
    const amp = new Adsr(sampleRate), mod = new Adsr(sampleRate);
    const phase1 = new Float64Array(MAXV), phase2 = new Float64Array(MAXV);
    const inc1 = new Float64Array(MAXV), inc2 = new Float64Array(MAXV);
    const panL = new Float64Array(MAXV), panR = new Float64Array(MAXV);
    const startPhase = Float64Array.from({ length: MAXV }, (_, i) => (i * 0.61803398875) % 1);
    const ladder = new Float64Array(8);   // lowpass 24: four stages for each channel
    const svf = new Float64Array(4);      // the 12 dB types: two integrators for each channel
    const lfoPhase = [0, 0], lfoHeld = [0, 0];
    let note = 60, pos = 60, velocity = 1, seed = 12345;
    let latch = false, ampFresh = false, from = -1, slideRate = 0;   // slide: read once, on the first block of a note
    const flush = v => (Math.abs(v) < 1e-18 ? 0 : v);
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const restartPhases = () => { for (let i = 0; i < MAXV; i++) { phase1[i] = startPhase[i]; phase2[i] = startPhase[i]; } };
    restartPhases();

    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          ampFresh = amp.idle;
          if (amp.idle) { restartPhases(); ladder.fill(0); svf.fill(0); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          latch = true; from = msg.from ?? -1;
          amp.on(); mod.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); mod.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); mod.cut(); }
      },

      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const pitchIn = inputs[0], cutIn = inputs[1];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        mod.set(g('matk'), g('mdec'), g('msus'), g('mrel'));

        // -- where the note is: glide and slide move `pos` toward it
        if (latch) {
          latch = false;
          const ticks = g('slide'), tickSamples = clock?.tickSamples ?? sampleRate * 0.125;
          if (ticks > 0) {
            if (from >= 0 && pos !== from && ampFresh) pos = from;
            slideRate = Math.abs(note - pos) / (ticks * tickSamples);
          } else slideRate = 0;
          ampFresh = false;
        }
        if (slideRate > 0) {
          const step = slideRate * n;
          pos = Math.abs(note - pos) <= step ? note : pos + Math.sign(note - pos) * step;
          if (pos === note) slideRate = 0;
        } else if (g('glide') > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * g('glide') * 0.001 / 3)));
        else pos = note;

        // -- block constants
        const w1 = Math.round(g('o1wave')), w2 = Math.round(g('o2wave'));
        const pw1 = g('o1pw'), pw2 = g('o2pw');
        const sync = g('o2sync') >= 0.5, tracks = g('o2track') >= 0.5;
        const fmAmount = g('fm'), ring = g('ring'), mix = g('mix'), noiseLevel = g('noise');
        const voices = Math.max(1, Math.min(MAXV, Math.round(g('unison')))), detune = g('detune'), width = g('width');
        const baseHz = 440 * Math.pow(2, (pos - 69) / 12), osc2Hz = tracks ? baseHz : 440 * Math.pow(2, (60 - 69) / 12);
        const osc2Semi = g('o2semi') + g('o2fine') / 100;
        const voiceGain = 1 / Math.sqrt(voices);
        for (let u = 0; u < voices; u++) {
          const x = voices === 1 ? 0 : (2 * u) / (voices - 1) - 1;
          inc1[u] = (baseHz * Math.pow(2, (x * detune) / 1200)) / sampleRate;
          inc2[u] = (osc2Hz * Math.pow(2, (osc2Semi * 100 + x * detune) / 1200)) / sampleRate;
          const a = ((x * width + 1) * Math.PI) / 4;   // equal-power pan, the middle voice in the centre
          panL[u] = Math.cos(a) * Math.SQRT2 * voiceGain;
          panR[u] = Math.sin(a) * Math.SQRT2 * voiceGain;
        }
        const type = Math.round(g('ftype')), cutoff = g('cutoff'), res = g('res');
        const distGain = 1 + g('dist') * 4, ladderK = res * 4, svfK = 2 - 1.95 * res;
        const e2cut = g('e2cut'), e2pitch = g('e2pitch'), e2fm = g('e2fm'), e2pw = g('e2pw');
        const keyOct = (g('fkey') * (pos - 60)) / 12;
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 1.5;
        const lfoWave = [Math.round(g('l1wave')), Math.round(g('l2wave'))], lfoInc = [g('l1rate') / sampleRate, g('l2rate') / sampleRate];
        const lfoAmt = [g('l1amt'), g('l2amt')], lfoDest = [Math.round(g('l1dest')), Math.round(g('l2dest'))];
        const nyquist = sampleRate * 0.45;
        let G = 0, G2 = 0, G3 = 0, G4 = 0, ladderNorm = 1;   // the filter's coefficients, refreshed every few samples
        let svfG = 0, svfA1 = 0, svfA2 = 0, svfA3 = 0;

        for (let i = 0; i < n; i++) {
          const ampLevel = amp.next(), modLevel = mod.next();

          // -- the LFOs add up what they push at each destination
          let pitchBoth = 0, pitch2 = 0, fmAdd = 0, pwAdd = 0, cutOct = 0, tremolo = 1;
          for (let k = 0; k < 2; k++) {
            lfoPhase[k] += lfoInc[k];
            if (lfoPhase[k] >= 1) { lfoPhase[k] -= 1; lfoHeld[k] = random(); }
            if (lfoAmt[k] === 0) continue;
            const v = lfoShape(lfoWave[k], lfoPhase[k], lfoHeld[k]) * lfoAmt[k];
            switch (lfoDest[k]) {
              case 0: pitchBoth += v * LFO_PITCH; break;
              case 1: pitch2 += v * LFO_PITCH; break;
              case 2: fmAdd += v; break;
              case 3: pwAdd += v * LFO_PW; break;
              case 4: cutOct += v * LFO_FILTER; break;
              default: tremolo *= 1 - lfoAmt[k] * (0.5 - 0.5 * lfoShape(lfoWave[k], lfoPhase[k], lfoHeld[k]));
            }
          }

          // -- the filter's coefficients, every few samples
          if ((i & (CONTROL_BLOCK - 1)) === 0) {
            const oct = e2cut * modLevel + keyOct + cutOct + (cutOn ? cutIn[i] : 0);
            const hz = Math.min(nyquist, Math.max(10, cutoff * Math.pow(2, oct)));
            const gg = Math.tan((Math.PI * hz) / sampleRate);
            if (type === 0) { G = gg / (1 + gg); G2 = G * G; G3 = G2 * G; G4 = G2 * G2; ladderNorm = 1 / (1 + ladderK * G4); }
            else { svfG = gg; svfA1 = 1 / (1 + gg * (gg + svfK)); svfA2 = gg * svfA1; svfA3 = gg * svfA2; }
          }

          // -- the oscillators, summed over the unison voices
          const pitchMul = Math.pow(2, (pitchBoth / 12) + (pitchOn ? pitchIn[i] : 0));
          const osc2Mul = pitchMul * Math.pow(2, (pitch2 + e2pitch * modLevel) / 12);
          const fmDepth = Math.min(1, Math.max(0, fmAmount + e2fm * modLevel + fmAdd)) * 0.5;
          const width1 = Math.min(0.95, Math.max(0.05, pw1 + pwAdd + e2pw * modLevel)), width2 = Math.min(0.95, Math.max(0.05, pw2 + pwAdd + e2pw * modLevel));
          let l = 0, r = 0;
          for (let u = 0; u < voices; u++) {
            const d1 = inc1[u] * pitchMul, d2 = inc2[u] * osc2Mul;
            const o1 = oscillator(w1, phase1[u], d1, width1, w1 === 4 ? random() : 0);
            const o2 = oscillator(w2, wrap01(phase2[u] + fmDepth * o1), d2, width2, w2 === 4 ? random() : 0);
            let v = o1 * (1 - mix) + o2 * mix;
            if (ring > 0) v = v * (1 - ring) + ring * o1 * o2 * 1.5;
            l += v * panL[u]; r += v * panR[u];
            let p1 = phase1[u] + d1, p2 = phase2[u] + d2;
            if (p1 >= 1) { p1 -= 1; if (sync) p2 = p1 * (d2 / d1); }   // a sync restart lands part-way into the sample, as the real edge would
            if (p2 >= 1) p2 -= 1;
            phase1[u] = p1; phase2[u] = p2;
          }
          if (noiseLevel > 0) { const w = noiseLevel * random(); l += w; r += w; }

          // -- the filter, left then right
          for (let ch = 0; ch < 2; ch++) {
            const x = (ch ? r : l) * distGain;
            let y;
            if (type === 0) {   // zero-delay-feedback four-pole with saturation in front
              const o = ch * 4, h = 1 - G;
              const S1 = h * ladder[o], S2 = h * ladder[o + 1], S3 = h * ladder[o + 2], S4 = h * ladder[o + 3];
              const sigma = G3 * S1 + G2 * S2 + G * S3 + S4;
              const z = (x * (1 + res * 0.5) - ladderK * sigma) * ladderNorm, z2 = z * z;
              const s0 = z > 3 ? 1 : z < -3 ? -1 : z * (27 + z2) / (27 + 9 * z2);   // a cheap tanh
              const y1 = G * s0 + S1, y2 = G * y1 + S2, y3 = G * y2 + S3, y4 = G * y3 + S4;
              ladder[o] = flush(2 * y1 - ladder[o]); ladder[o + 1] = flush(2 * y2 - ladder[o + 1]);
              ladder[o + 2] = flush(2 * y3 - ladder[o + 2]); ladder[o + 3] = flush(2 * y4 - ladder[o + 3]);
              y = y4;
            } else {   // the 12 dB types: a state-variable filter
              const o = ch * 2, v3 = x - svf[o + 1];
              const v1 = svfA1 * svf[o] + svfA2 * v3, v2 = svf[o + 1] + svfA2 * svf[o] + svfA3 * v3;
              svf[o] = flush(2 * v1 - svf[o]); svf[o + 1] = flush(2 * v2 - svf[o + 1]);
              const high = x - svfK * v1 - v2;
              y = type === 1 ? v2 : type === 2 ? v1 * svfK : type === 3 ? high : v2 + high;
            }
            if (ch) r = y; else l = y;
          }
          const gain = (ampLevel * level * tremolo) / distGain;
          outL[i] = l * gain; outR[i] = r * gain;
        }
      },
    };
  },
};

export default NODE;

// ---- helpers for the node's picture ----
// The node's own code, run offline: the left channel for `ms` milliseconds from one note (let go at offAt ms, if given).
export function renderPreview(values = {}, { ms = 100, sr = 44100, note = 45, offAt = null } = {}) {
  const node = NODE.create({ sampleRate: sr, connected: [false, false] });
  const vals = new Float32Array(SPEC.map(s => values[s.name] ?? s.def)), slots = SPEC.map((_, i) => i);
  const total = Math.ceil(sr * ms / 1000), out = new Float32Array(total), L = new Float32Array(128), R = new Float32Array(128);
  const none = new Float32Array(128);
  node.note({ type: 'noteOn', note, vel: 1 });
  for (let at = 0; at < total; at += 128) {
    if (offAt !== null && at <= sr * offAt / 1000 && at + 128 > sr * offAt / 1000) node.note({ type: 'noteOff', note });
    node.process([none, none], [[L, R]], 128, vals, slots);
    out.set(L.subarray(0, Math.min(128, total - at)), at);
  }
  return out;
}
// The oscillator section alone, as a picture of a few cycles: filter open, no envelopes or LFOs moving anything, unison off.
// `only` 1 or 2 mutes the other oscillator.
export function oscPreview(values, { cycles = 3, sr = 44100, only = 0 } = {}) {
  const hz = 440 * Math.pow(2, (45 - 69) / 12);
  const quiet = {
    ...values, ftype: 1, cutoff: 20000, res: 0, dist: 0, e2cut: 0, e2pitch: 0, e2fm: 0, e2pw: 0,
    l1amt: 0, l2amt: 0, unison: 1, atk: 0.1, sus: 1, vel: 0, level: 0.67, glide: 0, slide: 0, noise: 0, fkey: 0,
    ...(only === 1 ? { mix: 0, ring: 0 } : only === 2 ? { mix: 1, ring: 0 } : {}),
  };
  return renderPreview(quiet, { ms: (cycles / hz) * 1000, sr });
}
// The curve of one ADSR, a value for each millisecond: held for `hold` ms, then let go.
export function envCurve(a, d, s, r, hold, total) {
  const e = new Adsr(1000), out = new Float32Array(total);
  e.set(a, d, s, r); e.on();
  for (let i = 0; i < total; i++) { if (i === hold) e.off(); out[i] = e.next(); }
  return out;
}
