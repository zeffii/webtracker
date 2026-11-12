// Groove, stereo: what playing a record does to a sound. Every part has a level of its own, and a part at zero is not worked out at
// all (no noise is drawn, no filter runs), so only what you use costs anything. In the order the sound meets them:
//   warp      the pitch drifts once every turn of the record (an off-centre hole, a slightly dished disc), with a second, smaller
//             swing twice a turn. `speed` sets the turn: 33, 45 or 78 rpm.
//   wear      the highs go (a worn groove and stylus), and the lows join in the middle (a cut keeps its bass mono).
//   tracing   the stylus cannot follow a loud, busy groove: a soft, a little lopsided distortion.
//   dust      many tiny clicks at random, each of a random size.
//   scratch   now and then a bigger click with a ring to it. `stuck` is the chance that each one comes round again on the next turn.
//   pops      now and then a loud pop with a low thump in it.
//   surface   the steady hiss of the vinyl itself.
//   rumble    the very low noise of the motor and the floor.
// `mix` blends with the clean sound. `quality`: standard works at the normal sample rate; simulation works the stylus at four times it
// (less aliasing in the distortion, which matters with loud, bright sounds) and makes the clicks band-limited; it delays the sound by
// the oversampling's filters, and the clean sound is delayed to match.
import { Oversampler, Delay } from './oversample.js';
import { oversampleLatency } from '../latency.js';

const SPEED = 0, WARP = 1, WEAR = 2, TRACING = 3, DUST = 4, SCRATCH = 5, STUCK = 6, POPS = 7, SURFACE = 8, RUMBLE = 9, MIX = 10, QUALITY = 11;
const RPM = [100 / 3, 45, 78];
const MAX_VOICES = 14, BUF = 2048, MASK = BUF - 1;

const makeRand = seed => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

// The shape of each kind of click, one sample at a time from the click's start.
function kernels(sr, simulation) {
  const dust = simulation
    ? Float32Array.from({ length: 20 }, (_, j) => { const x = j - 6; return x * Math.exp(-(x * x) / 7) * 0.9; })   // a derivative of a bell: no sharp edge to alias
    : Float32Array.from([1, -0.7, 0.25, -0.08]);
  const ring = (hz, ms, seconds, edge) => Float32Array.from({ length: Math.round(sr * seconds) }, (_, j) => {
    const t = j / sr, attack = edge ? Math.min(1, j / 6) : 1;
    return Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / (ms / 1000)) * attack;
  });
  return { dust, scratch: ring(3300, 1.4, 0.012, simulation), pop: ring(210, 13, 0.07, true) };
}

// The clicks of one channel: each is a kernel played from its start, scaled; they add up while they overlap.
class Clicks {
  constructor() { this.k = new Array(MAX_VOICES).fill(null); this.pos = new Int32Array(MAX_VOICES); this.amp = new Float32Array(MAX_VOICES); this.live = 0; }
  add(kernel, amp) {
    for (let v = 0; v < MAX_VOICES; v++) if (!this.k[v]) { this.k[v] = kernel; this.pos[v] = 0; this.amp[v] = amp; this.live++; return; }
  }
  next() {
    let sum = 0;
    for (let v = 0; v < MAX_VOICES && this.live; v++) {
      const kernel = this.k[v];
      if (!kernel) continue;
      sum += kernel[this.pos[v]] * this.amp[v];
      if (++this.pos[v] >= kernel.length) { this.k[v] = null; this.live--; }
    }
    return sum;
  }
}

export default {
  type: 'groove',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'groove',
  latency: p => (Math.round(p.quality) === 1 ? oversampleLatency(4) : 0),   // the stylus's oversampling filters
  params: [
    { name: 'speed', min: 0, max: 2, def: 0, int: true },   // 33, 45, 78 rpm
    { name: 'warp', min: 0, max: 1, def: 0.3 },
    { name: 'wear', min: 0, max: 1, def: 0.3 },
    { name: 'tracing', min: 0, max: 1, def: 0.2 },
    { name: 'dust', min: 0, max: 1, def: 0.4 },
    { name: 'scratch', min: 0, max: 1, def: 0.2 },
    { name: 'stuck', min: 0, max: 1, def: 0 },
    { name: 'pops', min: 0, max: 1, def: 0.1 },
    { name: 'surface', min: 0, max: 1, def: 0.3 },
    { name: 'rumble', min: 0, max: 1, def: 0.2 },
    { name: 'mix', min: 0, max: 1, def: 1 },
    { name: 'quality', min: 0, max: 1, def: 0, int: true },   // standard, simulation
  ],
  create({ sampleRate: sr }) {
    const pole = fc => 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr);
    const K = [kernels(sr, false), kernels(sr, true)];
    const rand = [makeRand(0x2545f491), makeRand(0x9e3779b9)], randShared = makeRand(0x1b873593);
    const clicks = [new Clicks(), new Clicks()];
    const ring = [new Float32Array(BUF), new Float32Array(BUF)];
    const over = [new Oversampler(4), new Oversampler(4)], latDelay = [new Delay(256), new Delay(256)], dryDelay = [new Delay(256), new Delay(256)];
    const st = {   // the filters' memories, a pair for each channel
      lp1: [0, 0], lp2: [0, 0], sideLp: 0, hiss: [0, 0], hissHp: [0, 0], rum1: 0, rum2: 0,
    };
    const x = new Float64Array(2), y = new Float64Array(2), dryAt = new Float64Array(2);   // (made once: nothing is allocated per sample)
    let w = 0, turn = 0, prevTurn = 0, depth = 0;
    const kept = [];   // scratches that may come round again: { at: position in the turn, amp }
    const latency = Math.round(oversampleLatency(4));

    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = k => params[slots[k]];
        const sim = Math.round(g(QUALITY)) === 1, kernel = K[sim ? 1 : 0];
        const rpm = RPM[Math.max(0, Math.min(2, Math.round(g(SPEED))))], turnStep = rpm / 60 / sr;
        const warp = g(WARP), wear = g(WEAR), tracing = g(TRACING), dust = g(DUST), scratch = g(SCRATCH), stuck = g(STUCK), pops = g(POPS);
        const surface = g(SURFACE), rumble = g(RUMBLE), mix = g(MIX);
        const depthTo = warp * 2.2 * sr * 0.001;   // the swing of the delay in samples: at most 2.2 ms
        const lossA = pole(17000 * Math.pow(0.2, wear)), lossB = pole(17000 * Math.pow(0.2, wear) * 1.3), sideA = pole(140);
        const gain = 1 + 4 * tracing, bias = 0.12 * tracing, biasT = Math.tanh(bias), norm = 0.25 / Math.tanh(0.25 * gain);   // (a quarter-scale sound keeps about its level)
        const curve = v => (Math.tanh(gain * v + bias) - biasT) * norm;
        const dustP = dust > 0 ? (dust * dust * 140 + 4 * dust) / sr : 0, dustAmp = 0.006 + 0.05 * dust;
        const scratchP = scratch > 0 ? scratch * 2.5 / sr : 0, scratchAmp = 0.05 + 0.25 * scratch;
        const popP = pops > 0 ? pops * 0.8 / sr : 0, popAmp = 0.08 + 0.3 * pops;
        const hissA = pole(9000), hissHpA = pole(700), hissGain = surface * 0.011;
        const rumA = pole(18), rumGain = rumble * 1.0;
        const idle = warp <= 1e-4 && depth <= 1e-4;
        const dry = [inL, inR], out = [outL, outR];
        for (let i = 0; i < n; i++) {
          prevTurn = turn; turn += turnStep; if (turn >= 1) turn -= 1;
          depth += (depthTo - depth) * 0.002;   // eased, so moving the knob does not click
          let swing = 0;
          if (depth > 1e-4) swing = Math.sin(2 * Math.PI * turn) * 0.75 + Math.sin(4 * Math.PI * turn + 0.7) * 0.25;
          const mean = 2 + depth, d = mean + depth * swing;
          x[0] = dry[0][i]; x[1] = dry[1][i];
          for (let c = 0; c < 2; c++) {
            const buf = ring[c];
            buf[w] = x[c];
            if (idle) { y[c] = x[c]; dryAt[c] = x[c]; continue; }
            const pos = w - d, i0 = Math.floor(pos), f = pos - i0;
            const ym = buf[(i0 - 1) & MASK], y0 = buf[i0 & MASK], y1 = buf[(i0 + 1) & MASK], y2 = buf[(i0 + 2) & MASK];
            const c1 = 0.5 * (y1 - ym), c2 = ym - 2.5 * y0 + 2 * y1 - 0.5 * y2, c3 = 0.5 * (y2 - ym) + 1.5 * (y0 - y1);
            y[c] = ((c3 * f + c2) * f + c1) * f + y0;
            dryAt[c] = buf[(w - Math.round(mean)) & MASK];
          }
          w = (w + 1) & MASK;
          // wear: the highs (two poles), and the bass of the difference between the channels
          if (wear > 1e-4) {
            for (let c = 0; c < 2; c++) { st.lp1[c] += (y[c] - st.lp1[c]) * lossA; st.lp2[c] += (st.lp1[c] - st.lp2[c]) * lossB; y[c] = st.lp2[c]; }
            const m = (y[0] + y[1]) * 0.5, s = (y[0] - y[1]) * 0.5;
            st.sideLp += (s - st.sideLp) * sideA;
            const s2 = s - st.sideLp * wear;
            y[0] = m + s2; y[1] = m - s2;
          }
          for (let c = 0; c < 2; c++) {
            // tracing: the stylus, at four times the rate when simulating (else the sound waits as long, to stay in time)
            if (sim) y[c] = tracing > 0 ? over[c].run(y[c], curve) : latDelay[c].push(y[c], latency);
            else if (tracing > 0) y[c] = curve(y[c]);
            // the things the groove adds
            if (dustP > 0 && rand[c]() < dustP) { const e = -Math.log(Math.max(1e-6, rand[c]())); clicks[c].add(kernel.dust, (rand[c]() < 0.5 ? -1 : 1) * dustAmp * Math.min(6, 0.4 + e)); }
            if (scratchP > 0 && rand[c]() < scratchP) {
              const a = (rand[c]() < 0.5 ? -1 : 1) * scratchAmp * (0.4 + rand[c]());
              clicks[c].add(kernel.scratch, a);
              if (stuck > 0 && c === 0) { if (kept.length >= 3) kept.shift(); kept.push({ at: turn, amp: a }); }
            }
            if (popP > 0 && rand[c]() < popP) clicks[c].add(kernel.pop, (rand[c]() < 0.5 ? -1 : 1) * popAmp * (0.5 + rand[c]()));
            if (clicks[c].live) y[c] += clicks[c].next();
            if (hissGain > 0) {
              const white = rand[c]() * 2 - 1;
              st.hiss[c] += (white - st.hiss[c]) * hissA;
              st.hissHp[c] += (st.hiss[c] - st.hissHp[c]) * hissHpA;
              y[c] += (st.hiss[c] - st.hissHp[c]) * hissGain * 2;
            }
          }
          // a scratch that comes round again: when the turn passes where it began
          if (stuck > 0 && kept.length) {
            for (const k of kept) {
              const passed = prevTurn <= turn ? (k.at > prevTurn && k.at <= turn) : (k.at > prevTurn || k.at <= turn);
              if (passed && randShared() < stuck) { clicks[0].add(kernel.scratch, k.amp); clicks[1].add(kernel.scratch, k.amp * 0.9); }
            }
          }
          if (rumGain > 0) {
            st.rum1 += ((randShared() * 2 - 1) - st.rum1) * rumA;
            st.rum2 += (st.rum1 - st.rum2) * rumA;
            const r = st.rum2 * rumGain;
            y[0] += r; y[1] += r;
          }
          // mix with the clean sound, lined up with it
          for (let c = 0; c < 2; c++) {
            const clean = sim ? dryDelay[c].push(dryAt[c], latency) : dryAt[c];
            out[c][i] = clean + (y[c] - clean) * mix;
          }
        }
      },
    };
  },
};
