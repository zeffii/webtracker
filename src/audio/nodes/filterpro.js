// filterPro: one filter node with twelve voicings, per-sample cutoff modulation, input drive with bias, and a dry/wet mix.
// The SVF voicings are zero-delay (TPT) with a soft-clipped band state, so high resonance stays bounded and self-oscillates.
import { fftPlan } from '../fft.js';
import { spectrumPoints, FORMANTS, FORMANT_GAIN } from './filterproresponse.js';

const CUT = 0, RES = 1, MODE = 2, MORPH = 3, VOWEL = 4, DAMP = 5, DRIVE = 6, BIAS = 7, MIX = 8, LEVEL = 9;

// the formants (a e i o u, three bands in parallel) are in filterproresponse.js, where the panel draws them too
const FGAIN = FORMANT_GAIN;

const FRAME = 2048, POINTS = 240, REPORT_EVERY = 2400, WATCH_SECONDS = 3;   // the picture: a frame of sound, as many points, every 50 ms or so

const clip = x => x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x);   // smooth tanh-like, exact at +-3
let V1 = 0, V2 = 0;
// One TPT state-variable step on state array st at offset o; leaves band in V1 and low in V2.
function step(st, o, x, a1, a2, a3) {
  const v3 = x - st[o + 1];
  let v1 = a1 * st[o] + a2 * v3;
  v1 = 2 * clip(0.5 * v1);
  const v2 = st[o + 1] + a2 * st[o] + a3 * v3;
  st[o] = 2 * v1 - st[o];
  st[o + 1] = 2 * v2 - st[o + 1];
  V1 = v1; V2 = v2;
}

export default {
  type: 'filterpro',
  inputs: ['in', 'mod'],   // mod is in octaves, applied sample by sample
  outputs: ['out'],
  dual: true,
  category: 'Effects',
  shape: 'box',
  glyph: 'lowpass',
  editor: 'filterpro',   // the panel: the sound going in and coming out, and the curve between them
  kinds: { mod: 'control' },
  params: [
    { name: 'cutoff', min: 20, max: 18000, def: 1500 },
    { name: 'resonance', min: 0, max: 1, def: 0.25 },
    { name: 'mode', min: 0, max: 11, def: 0, int: true },
    { name: 'morph', min: 0, max: 1, def: 0 },
    { name: 'vowel', min: 0, max: 4, def: 0 },
    { name: 'damp', min: 0, max: 1, def: 0.3 },
    { name: 'drive', min: 0, max: 1, def: 0 },
    { name: 'bias', min: -1, max: 1, def: 0 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ sampleRate, emit, shared }) {
    const sr = sampleRate, cs = 1 - Math.exp(-4 / (sr * 0.004));
    const st = new Float64Array(16);   // 0 main, 2 second stage, 4..9 three formants
    const z = [0, 0, 0, 0];
    const buf = new Float32Array(Math.ceil(sr / 15) + 8);
    let wp = 0, fc = -1, rng = 22222, damped = 0;
    // While the panel is open (it asks every second) the node reports the spectrum it hears and the one it makes. Of the two
    // copies of a stereo pair only the last made reports, so the panel is fed once.
    const me = {}; if (shared) shared.reporter = me;
    const heardIn = new Float32Array(FRAME), heardOut = new Float32Array(FRAME);
    let heard = 0, watchLeft = 0, sinceReport = 0;
    const picture = ring => {
      const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
      for (let i = 0; i < FRAME; i++) re[i] = ring[(heard + i) % FRAME] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
      fftPlan(FRAME).run(re, im);
      return spectrumPoints(re, im, FRAME, sr, new Float32Array(POINTS));
    };
    return {
      message(msg) { if (msg.type === 'watch') watchLeft = WATCH_SECONDS * sr; },
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0], mod = inputs[1];
        const base = params[slots[CUT]], res = Math.min(Math.max(params[slots[RES]], 0), 1), mode = Math.round(params[slots[MODE]]);
        const morph = params[slots[MORPH]], vowel = params[slots[VOWEL]], damp = params[slots[DAMP]];
        const drive = params[slots[DRIVE]], bias = params[slots[BIAS]], mix = params[slots[MIX]], level = params[slots[LEVEL]];
        const pre = 1 + drive * 9, post = 1 / (1 + drive * 2), b = bias * 0.8, bOff = clip(b), driven = drive > 0.001 || bias !== 0;
        const k = 2 - 2.04 * res, kb = Math.max(k, 0.02), kick = res > 0.97 ? 1e-5 : 0;
        const vi = Math.min(Math.floor(vowel), 3), vf = vowel - vi;
        const fa = [0, 0, 0], fb = [0, 0, 0], fc3 = [0, 0, 0], fk = 1 / (2 + res * 18);
        for (let i = 0; i < n; i += 4) {
          const m = Math.min(4, n - i);
          let target = base;
          if (mod) target *= Math.pow(2, Math.max(-8, Math.min(8, mod[i])));
          if (fc < 0) fc = target;
          fc += (target - fc) * cs;
          const f = Math.min(Math.max(fc, 5), sr * 0.45);
          const g = Math.tan(Math.PI * f / sr);
          let a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          let b1 = 0, b2 = 0, b3 = 0, G = 0, kl = 0, delay = 0, fbk = 0;
          if (mode === 7) { const s = 1.4142; b1 = 1 / (1 + g * (g + s)); b2 = g * b1; b3 = g * b2; }
          else if (mode === 8) { const g2 = Math.tan(Math.PI * f / (2 * sr)); G = g2 / (1 + g2); kl = res * 4.3; }
          else if (mode === 9) {
            const scale = f / 1000;
            for (let q = 0; q < 3; q++) {
              const fq = Math.min((FORMANTS[vi][q] * (1 - vf) + FORMANTS[vi + 1][q] * vf) * scale, sr * 0.45);
              const gq = Math.tan(Math.PI * fq / sr), aq = 1 / (1 + gq * (gq + fk));
              fa[q] = aq; fb[q] = gq * aq; fc3[q] = gq * fb[q];
            }
          } else if (mode >= 10) { delay = Math.min(Math.max(sr / f, 2), buf.length - 4); fbk = (mode === 10 ? 1 : -1) * res * 0.97; }
          for (let j = i; j < i + m; j++) {
            const dry = input[j];
            let x = driven ? (clip(pre * dry + b) - bOff) * post : dry;
            if (kick && mode <= 8) { rng = (rng * 1664525 + 1013904223) >>> 0; x += (rng / 4294967296 - 0.5) * kick; }   // lets a resonance at 1 start singing
            let y;
            if (mode <= 6) {
              step(st, 0, x, a1, a2, a3);
              const bp = kb * V1, lp = V2, hp = x - k * V1 - lp;
              switch (mode) {
                case 0: y = lp; break;
                case 1: y = bp; break;
                case 2: y = hp; break;
                case 3: y = lp + hp; break;
                case 4: y = lp - hp; break;
                case 5: y = x - 2 * bp; break;
                default: {
                  const wl = Math.max(0, 1 - 2 * morph), wn = 1 - Math.abs(2 * morph - 1), wh = Math.max(0, 2 * morph - 1);
                  y = wl * lp + wn * (lp + hp) + wh * hp;
                }
              }
            } else if (mode === 7) {
              step(st, 0, x, b1, b2, b3);
              step(st, 2, V2, a1, a2, a3);
              y = V2;
            } else if (mode === 8) {
              let s = 0;
              for (let h = 0; h < 2; h++) {
                let u = clip(x - kl * z[3]);
                for (let p = 0; p < 4; p++) { const v = (u - z[p]) * G; const o = v + z[p]; z[p] = o + v; u = o; }
                s = u;
              }
              y = s * (1 + res * 0.7);
            } else if (mode === 9) {
              y = 0;
              for (let q = 0; q < 3; q++) {
                step(st, 4 + 2 * q, x, fa[q], fb[q], fc3[q]);   // only the band is used, but the low-pass state needs its third term or it only integrates and drifts
                y += 4 * FGAIN[q] * fk * V1;
              }
            } else {
              let rp = wp - delay; if (rp < 0) rp += buf.length;
              const i0 = Math.floor(rp), fr = rp - i0, i1 = i0 + 1 >= buf.length ? 0 : i0 + 1;
              const d = buf[i0] * (1 - fr) + buf[i1] * fr;
              damped += (d - damped) * (1 - damp * 0.9);
              y = x + fbk * damped;
              buf[wp] = y; wp = wp + 1 >= buf.length ? 0 : wp + 1;
              y *= 1 - Math.abs(fbk) * 0.5;
            }
            out[j] = (dry + (y - dry) * mix) * level;
          }
        }
        for (let q = 0; q < 16; q++) if (Math.abs(st[q]) < 1e-20) st[q] = 0;
        for (let q = 0; q < 4; q++) if (Math.abs(z[q]) < 1e-20) z[q] = 0;
        if (Math.abs(damped) < 1e-20) damped = 0;
        if (watchLeft > 0 && emit && (!shared || shared.reporter === me)) {
          watchLeft -= n;
          for (let i = 0; i < n; i++) { heardIn[heard] = input[i]; heardOut[heard] = out[i]; heard = heard + 1 >= FRAME ? 0 : heard + 1; }
          sinceReport += n;
          if (sinceReport >= REPORT_EVERY) {
            sinceReport = 0;
            const a = picture(heardIn), b = picture(heardOut);
            emit({ type: 'fpro', input: a, output: b }, [a.buffer, b.buffer]);
          }
        }
      },
    };
  },
};
