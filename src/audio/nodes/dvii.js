// DVIIloader: a six-operator FM synth in the manner of the Yamaha DX7, which loads DX7 banks (.syx) from the panel.
// 32 algorithms, rate / level envelopes that move in steps of 0.75 dB (so they are straight lines in dB, with the
// DX7's fast-then-slow attack), the output level, keyboard level and rate scaling, velocity sensitivity, detune,
// fixed frequencies, operator feedback, the pitch envelope and the LFO. The voice is picked with `voice`, so a pattern
// can change sound with a command. Modulation depth follows the real chip's convention (a full-level modulator
// bends its operator by one cycle). Monophonic, last note wins; the voices node makes it polyphonic. This is a
// close model written from the documented behaviour, not a bit-exact copy of the chip.
import { ALGORITHMS, VOICES, unpackBank, scaleOL, levelScaling } from './dx7.js';

const OPS = 6, CHUNK = 16;
const VOICE = 0, TUNE = 1, VEL = 2, LEVEL = 3, LFO = 4, SPEED = 5, GRITTY = 6, MUTE = 7, SOLO = 8;

const VELOCITY = [0, 70, 86, 97, 106, 114, 121, 126, 132, 138, 142, 148, 152, 156, 160, 163, 166, 170, 173, 174, 178, 181, 184, 186, 189, 190, 194, 196, 198, 200, 202, 205, 206, 209, 211, 214, 216, 218, 220, 222, 224, 225, 227, 229, 230, 232, 233, 235, 237, 238, 240, 241, 242, 243, 244, 246, 246, 248, 249, 250, 251, 252, 253, 254];
const PITCH_LOW = [-128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35, -33, -32, -31];
const pitchOct = pl => {   // pitch EG level 0..99 -> octaves, 50 is no change
  const v = pl < 20 ? PITCH_LOW[pl] : pl <= 50 ? pl - 50 : -(100 - pl < 20 ? PITCH_LOW[100 - pl] : 100 - pl - 50);
  return v / 32;
};
const PMS_TAB = [0, 10, 20, 33, 55, 92, 153, 255];
const AMS_TAB = [0, 0.259, 0.427, 1];

const velocityScaling = (vel, sens) => {   // in 1/32 steps
  const value = VELOCITY[Math.min(127, Math.max(0, vel)) >> 1] - 239;
  return ((sens * value + 7) >> 3) << 4;
};

export default {
  type: 'dvii',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'dvii',
  editor: 'dx',   // the panel offers the bank loader, the voice list and the algorithm view
  kinds: { pitch: 'control', out: 'stereo' },
  params: [
    { name: 'voice', min: 0, max: VOICES - 1, def: 0, int: true },
    { name: 'tune', min: -48, max: 48, def: 0 },       // semitones
    { name: 'vel', min: 0, max: 1, def: 1 },           // how much velocity counts (0 ignores it)
    { name: 'level', min: 0, max: 1, def: 0.5 },
    { name: 'lfo', min: 0, max: 2, def: 1 },           // scales the voice's LFO depth, pitch and amplitude
    { name: 'speed', min: 0.25, max: 4, def: 1 },      // scales all envelope rates
    { name: 'gritty', min: 0, max: 1, def: 0, int: true },   // coarse 11-bit operator output, a little of the old converters
    { name: 'mute', min: 0, max: 63, def: 0, int: true },    // bit k silences operator k+1
    { name: 'solo', min: 0, max: 63, def: 0, int: true },    // if any bit is set, only those operators sound
  ],
  create({ sampleRate, connected, data }) {
    const pitchOn = connected[0];
    const rateScale = 44100 / sampleRate;
    let voices = unpackBank(data?.bank);
    let cur = -1, v = voices[0];
    // operator state
    const phase = new Float64Array(OPS), inc = new Float64Array(OPS), out = new Float64Array(OPS);
    const gain = new Float64Array(OPS), gainNext = new Float64Array(OPS);
    const baseHz = new Float64Array(OPS), fixed = new Uint8Array(OPS);
    const egL = new Float64Array(OPS), egStage = new Uint8Array(OPS), egRate = new Float64Array(OPS * 4), egTarget = new Float64Array(OPS * 4);
    const olBase = new Float64Array(OPS);
    let pL = 0, pStage = 4;
    const pTarget = new Float64Array(4), pRate = new Float64Array(4);
    let note = 60, velocity = 100, held = false, idle = true, lfoPhase = 0, lfoHold = 0, lfoAge = 0, hist0 = 0, hist1 = 0, sh = 0;
    let velParam = 1;

    // everything that follows from the voice and the note, not the clock
    const prep = () => {
      v = voices[cur];
      const n = note + v.trnsp - 24;
      const hz = 440 * Math.pow(2, (n - 69) / 12);
      for (let k = 0; k < OPS; k++) {
        const p = v.ops[k];
        fixed[k] = p.mode;
        const det = Math.pow(2, ((p.det - 7) * 2) / 1200);
        baseHz[k] = p.mode ? Math.pow(10, (p.fc & 3) + p.ff / 100) * det : hz * (p.fc === 0 ? 0.5 : p.fc) * (1 + p.ff / 100) * det;
        let ol = Math.min(127, Math.max(0, scaleOL(p.ol) + levelScaling(n, p)));
        ol = Math.max(0, ol + (velocityScaling(velocity, p.kvs) / 32) * velParam);
        olBase[k] = ol;
        const x = Math.min(31, Math.max(0, ((n / 3) | 0) - 7)), delta = (p.rs * x) >> 3;
        for (let s = 0; s < 4; s++) {
          egTarget[k * 4 + s] = scaleOL(p.l[s]);
          const q = Math.min(63, ((p.r[s] * 41) >> 6) + delta);
          egRate[k * 4 + s] = ((4 + (q & 3)) * Math.pow(2, q >> 2) / 524288) * rateScale;   // steps per sample
        }
      }
      for (let s = 0; s < 4; s++) {
        pTarget[s] = pitchOct(v.pl[s]);
        pRate[s] = 0.04 * Math.pow(2, v.pr[s] / 9) / sampleRate;   // octaves per sample
      }
    };
    // advances one envelope by m samples: stages 0..2 move to L1..L3, 3 holds, 4 releases to L4
    const advance = (L, stage, target, rate, m, speed, attackCurve) => {
      let l = L;
      for (let guard = 0; guard < 4 && stage < 5 && m > 0; guard++) {
        const idx = stage === 4 ? 3 : Math.min(stage, 2);
        if (stage === 3) break;
        const t = target(idx), r = rate(idx) * speed;
        if (l < t) {
          if (attackCurve && l < 53.6) l = Math.min(53.6, t);
          l += r * (attackCurve ? Math.max(0.05, (136 - l) / 8) : 1) * m;
          if (l >= t) { l = t; if (stage === 4) { stage = 5; break; } stage++; continue; }
        } else if (l > t) {
          l -= r * m;
          if (l <= t) { l = t; if (stage === 4) { stage = 5; break; } stage++; continue; }
        } else { if (stage === 4) { stage = 5; break; } stage++; continue; }
        break;
      }
      return [l, stage];
    };
    return {
      message(msg) { if (msg.type === 'bank') { voices = unpackBank(msg.points); if (cur >= 0) prep(); } },
      note(msg) {
        if (msg.type === 'noteOn') {
          note = msg.note; velocity = Math.min(127, Math.max(1, Math.round((msg.vel ?? 1) * 127)));
          if (cur < 0) cur = 0;
          prep();
          if (idle) { egL.fill(0); pL = 0; }
          if (v.oks) phase.fill(0);
          egStage.fill(0); pStage = 0; hist0 = hist1 = 0;
          if (v.lks || idle) { lfoPhase = 0.25; lfoAge = 0; }
          sh = Math.random() * 2 - 1;
          held = true; idle = false;
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') {
          if (held) { held = false; egStage.fill(4); pStage = 4; }
        } else if (msg.type === 'noteCut') { held = false; idle = true; egL.fill(0); out.fill(0); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = i => params[slots[i]];
        const want = Math.min(VOICES - 1, Math.max(0, Math.round(g(VOICE))));
        velParam = g(VEL);
        if (want !== cur) { cur = want; prep(); }
        const alg = ALGORITHMS[v.alg];
        const tune = Math.pow(2, g(TUNE) / 12), speed = g(SPEED), lfoScale = g(LFO), gritty = g(GRITTY) >= 0.5;
        const pitchIn = pitchOn ? Math.pow(2, inputs[0][0]) : 1;
        const mix = (g(LEVEL) * 0.7) / Math.sqrt(alg.carriers.length);
        const muteBits = Math.round(g(MUTE)), soloBits = Math.round(g(SOLO));
        const isCarrier = new Uint8Array(OPS); for (const c of alg.carriers) isCarrier[c] = 1;
        const fbScale = v.fb ? Math.pow(2, v.fb - 8) : 0;
        const [fbFrom, fbTo] = alg.fb;
        const lfoHz = 0.062 * Math.pow(50 / 0.062, v.lfs / 99);
        const lfoDelay = Math.pow(v.lfd / 99, 2) * 5;
        const pitchDepth = (v.lpmd / 99) * (PMS_TAB[v.pms] / 255) * lfoScale;
        const ampDepth = (v.lamd / 99) * lfoScale * 64;
        let wi = 0;
        for (let c0 = 0; c0 < n; c0 += CHUNK) {
          const m = Math.min(CHUNK, n - c0);
          // envelopes
          let silent = !held;
          for (let k = 0; k < OPS; k++) {
            const [l, st] = advance(egL[k], egStage[k], i => egTarget[k * 4 + i], i => egRate[k * 4 + i], m, speed, egStage[k] < 3);
            egL[k] = l; egStage[k] = st;
          }
          { const [l, st] = advance(pL, pStage, i => pTarget[i], i => pRate[i], m, speed, false); pL = l; pStage = st; }
          // the LFO
          lfoAge += m / sampleRate;
          lfoPhase += (lfoHz * m) / sampleRate;
          if (lfoPhase >= 1) { lfoPhase -= 1; sh = Math.random() * 2 - 1; }
          const lp = lfoPhase;
          const wave = v.lfw === 0 ? (lp < 0.5 ? 4 * lp - 1 : 3 - 4 * lp) : v.lfw === 1 ? 1 - 2 * lp : v.lfw === 2 ? 2 * lp - 1 : v.lfw === 3 ? (lp < 0.5 ? 1 : -1) : v.lfw === 4 ? Math.sin(2 * Math.PI * lp) : sh;
          const fade = lfoDelay > 0 ? Math.min(1, Math.max(0, (lfoAge - lfoDelay * 0.4) / (lfoDelay * 0.6))) : 1;
          const pitchMul = Math.pow(2, pL + wave * fade * pitchDepth) * tune * pitchIn;
          for (let k = 0; k < OPS; k++) {
            inc[k] = (baseHz[k] * (fixed[k] ? 1 : pitchMul) * (fixed[k] ? Math.pow(2, wave * fade * pitchDepth) : 1)) / sampleRate;
            if (inc[k] >= 0.5) inc[k] = 0;
            const am = ampDepth * AMS_TAB[v.ops[k].ams] * ((wave * fade + 1) * 0.5);
            const steps = Math.min(127, Math.max(0, egL[k] + olBase[k] - 127 - am));
            const audible = !((muteBits >> k) & 1) && (soloBits === 0 || ((soloBits >> k) & 1));
            gainNext[k] = steps < 1 || !audible ? 0 : Math.pow(2, (steps - 127) / 8);
            if (isCarrier[k] && (held || steps >= 2)) silent = false;
          }
          for (let i = 0; i < m; i++) {
            const t = (i + 1) / m;
            let sum = 0;
            for (let k = OPS - 1; k >= 0; k--) {
              let mod = 0;
              for (const e of alg.mods) if (e[0] === k) mod += out[e[1]];
              if (k === fbTo) mod += fbScale * 0.5 * (hist0 + hist1);
              let p = phase[k] + mod;
              p -= Math.floor(p);
              let o = Math.sin(6.283185307179586 * p) * (gain[k] + (gainNext[k] - gain[k]) * t);
              if (gritty) o = Math.round(o * 1024) / 1024;
              out[k] = o;
              if (k === fbFrom) { hist1 = hist0; hist0 = o; }
              if (isCarrier[k]) sum += o;
              let ph = phase[k] + inc[k];
              if (ph >= 1) ph -= 1;
              phase[k] = ph;
            }
            outL[wi] = outR[wi] = sum * mix;
            wi++;
          }
          for (let k = 0; k < OPS; k++) gain[k] = gainNext[k];
          if (silent && !held) { idle = true; out.fill(0); hist0 = hist1 = 0; outL.fill(0, wi, n); outR.fill(0, wi, n); return; }
        }
      },
    };
  },
};
