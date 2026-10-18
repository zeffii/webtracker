// Post-transient resynthesis: keep the first few milliseconds of a hit as real sample data and rebuild the rest as a small
// tree of synth branches that run side by side into one output.
//
// The tail (everything after the cut) is analysed as a magnitude spectrogram and explained greedily. Each round proposes
// two candidates for what is left over, a tonal branch (the loudest ringing partial, followed through time: its pitch
// sweep and its decay) and a noise branch (a filter shape and a decay), subtracts the one that explains more, and goes
// round again. It stops at `max` branches, or earlier once a new branch no longer explains `tolerance` of the original.
// Everything is compared as magnitudes, so no phase has to match; the branches are then built from the ordinary osc, noise,
// filter, env and gain nodes, which makes the result an instrument that can be opened and edited like any other.
import { fft } from './spectrogram.js';

const MEAN_MAG = 0.8862;   // mean of a Rayleigh magnitude over its rms: what a noise bin averages against its rms
const C4 = 261.6256;
const LN_60DB = Math.log(1000);

// ---- the spectrogram ----

function stft(x, start, N, hop, frames) {
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  let wsum = 0, w2sum = 0;
  for (const w of win) { wsum += w; w2sum += w * w; }
  const re = new Float64Array(N), im = new Float64Array(N), half = N / 2;
  const mags = [];
  for (let f = 0; f < frames; f++) {
    const at = start + f * hop;
    for (let i = 0; i < N; i++) { re[i] = (x[at + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(half);
    for (let k = 0; k < half; k++) m[k] = Math.hypot(re[k], im[k]);
    mags.push(m);
  }
  return { mags, N, hop, win, wsum, w2sum };
}

const lossOf = mags => { let s = 0; for (const m of mags) for (let k = 2; k < m.length; k++) s += Math.sqrt(m[k]); return s; };

// R - B clamped at zero, B scaled by the best fit first (least squares where B is clearly present, kept near 1)
function subtract(R, B) {
  let rb = 0, bb = 0, peak = 0;
  for (const m of B) for (let k = 2; k < m.length; k++) if (m[k] > peak) peak = m[k];
  for (let f = 0; f < R.length; f++) for (let k = 2; k < R[f].length; k++) if (B[f][k] > 0.05 * peak) { rb += R[f][k] * B[f][k]; bb += B[f][k] * B[f][k]; }
  const scale = bb > 0 ? Math.min(1.5, Math.max(0.5, rb / bb)) : 1;
  let penalty = 0;   // sound the branch adds that the target does not have: taking it away must cost, or a branch could never be too much
  const out = R.map((m, f) => {
    const o = new Float32Array(m.length);
    for (let k = 0; k < m.length; k++) {
      const d = m[k] - B[f][k] * scale;
      if (d > 0) o[k] = d; else if (k >= 2) penalty += Math.sqrt(-d);
    }
    return o;
  });
  return { R: out, scale, penalty };
}

// weighted straight-line fit y = a + b t
function line(ts, ys, ws) {
  let sw = 0, st = 0, sy = 0, stt = 0, sty = 0;
  for (let i = 0; i < ts.length; i++) { const w = ws[i]; sw += w; st += w * ts[i]; sy += w * ys[i]; stt += w * ts[i] * ts[i]; sty += w * ts[i] * ys[i]; }
  const den = sw * stt - st * st;
  if (!(sw > 0) || Math.abs(den) < 1e-12) return { a: sw > 0 ? sy / sw : 0, b: 0 };
  const b = (sw * sty - st * sy) / den;
  return { a: (sy - b * st) / sw, b };
}

// ---- finding the cut ----

// The transient ends where the hit has fallen well below its peak (and a little after, to take the whole shape of it).
export function detectCut(x, rate, minMs = 4, maxMs = 30) {
  const win = Math.max(8, Math.round(rate * 0.001)), hops = Math.floor(x.length / win);
  const env = new Float64Array(hops);
  let peak = 0, at = 0;
  for (let h = 0; h < hops; h++) {
    let s = 0;
    for (let i = 0; i < win; i++) s += x[h * win + i] ** 2;
    env[h] = Math.sqrt(s / win);
    if (env[h] > peak) { peak = env[h]; at = h; }
  }
  let end = at;
  while (end < hops && env[end] > 0.35 * peak) end++;
  const ms = Math.min(maxMs, Math.max(minMs, (end + 2) * 1000 * win / rate));
  return ms;
}

// ---- tonal branches ----

function tonalCandidate(R, S, rate, cutSec, total, worth) {
  const { N, hop, wsum } = S, K = R[0].length, F = R.length;
  const kmin = Math.max(2, Math.ceil(25 * N / rate)), kmax = Math.min(K - 2, Math.floor(0.45 * rate * N / rate));
  let best = 0, bf = 0, bk = 0;
  for (let f = 0; f < F; f++) for (let k = kmin; k <= kmax; k++) if (R[f][k] > best) { best = R[f][k]; bf = f; bk = k; }
  if (best < 1e-5) return null;
  const nearPeak = (f, kc) => {
    const r = Math.max(3, Math.round(kc * 0.25)), lo = Math.max(kmin, Math.round(kc) - r), hi = Math.min(kmax, Math.round(kc) + r);
    let m = 0, km = lo;
    for (let k = lo; k <= hi; k++) if (R[f][k] > m) { m = R[f][k]; km = k; }
    let kf = km;
    if (km > 1 && km < K - 1 && m > 0) {   // parabola through the log magnitudes
      const a = Math.log(R[f][km - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(R[f][km + 1] + 1e-12);
      const d = a - 2 * b + c;
      if (d < 0) kf = km + Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d));
    }
    return { kf, m };
  };
  const track = new Map([[bf, { kf: bk, m: best }]]);
  for (let dir of [1, -1]) {
    let prev = bk;
    for (let f = bf + dir; f >= 0 && f < F; f += dir) {
      const p = nearPeak(f, prev);
      if (p.m < 0.03 * best) break;
      track.set(f, p); prev = p.kf;
    }
  }
  const frames = [...track.keys()].sort((a, b) => a - b);
  if (frames.length < 3) return null;
  const tau = f => (f * hop + N / 2) / rate;
  const ts = frames.map(tau), amps = frames.map(f => 2 * track.get(f).m / wsum), freqs = frames.map(f => track.get(f).kf * rate / N);
  // decay
  const ad = line(ts, amps.map(Math.log), amps);
  const tauA = ad.b < -0.2 ? -1 / ad.b : 5;
  const A0 = Math.exp(ad.a);
  // pitch
  const third = Math.max(1, Math.floor(frames.length / 3));
  const tail = freqs.slice(-third).sort((a, b) => a - b);
  let fe = tail[tail.length >> 1], sweep = null;
  const ys = freqs.map(v => Math.log2(v / fe));
  const head = ys.slice(0, third).reduce((a, b) => a + b, 0) / third;
  if (head > 0.06) {
    const keep = ys.map((y, i) => i).filter(i => ys[i] > 0.03);
    if (keep.length >= 2) {
      const pd = line(keep.map(i => ts[i]), keep.map(i => Math.log(ys[i])), keep.map(i => ys[i]));
      if (pd.b < -0.1) {
        const tauS = -1 / pd.b;
        sweep = { oct: Math.min(8, Math.exp(pd.a) * Math.exp(cutSec / tauS)), tau: tauS };
      }
    }
  }
  if (!sweep) fe = freqs.reduce((a, b) => a + b, 0) / freqs.length;
  fe = Math.min(0.45 * rate, Math.max(20, fe));
  // The tracked values are rough (the window smears a fast sweep), so polish them against the spectrogram itself.
  let model = { fe, sweep, A0, tauA };
  const evaluate = m => {
    const sub = subtract(R, stft(synthTonal(m, rate, cutSec, Math.min(total, Math.ceil(F * hop + N))), 0, N, hop, F).mags);
    return { sub, score: improvement(R, sub) };
  };
  let cur = evaluate(model);
  if (cur.score < worth) return { type: 'tonal', improve: cur.score };   // not worth polishing
  for (let step = 1; step >= 0.25; step /= 2) {
    for (let pass = 0; pass < 8; pass++) {   // keep going at this step size while it still finds something
      const moves = [
        m => ({ ...m, fe: m.fe * Math.exp(0.12 * step) }), m => ({ ...m, fe: m.fe * Math.exp(-0.12 * step) }),
        m => ({ ...m, tauA: m.tauA * Math.exp(0.25 * step) }), m => ({ ...m, tauA: m.tauA * Math.exp(-0.25 * step) }),
        m => ({ ...m, A0: m.A0 * Math.exp(0.2 * step) }), m => ({ ...m, A0: m.A0 * Math.exp(-0.2 * step) }),
      ];
      if (model.sweep) moves.push(
        m => ({ ...m, sweep: { ...m.sweep, oct: Math.min(8, m.sweep.oct + 0.3 * step) } }), m => ({ ...m, sweep: { ...m.sweep, oct: Math.max(0.05, m.sweep.oct - 0.3 * step) } }),
        m => ({ ...m, sweep: { ...m.sweep, tau: m.sweep.tau * Math.exp(0.3 * step) } }), m => ({ ...m, sweep: { ...m.sweep, tau: m.sweep.tau * Math.exp(-0.3 * step) } }));
      let moved = false;
      for (const move of moves) {
        const next = move(model);
        if (next.fe < 20 || next.fe > 0.45 * rate) continue;
        const trial = evaluate(next);
        if (trial.score > cur.score * 1.002) { model = next; cur = trial; moved = true; }
      }
      if (!moved) break;
    }
  }
  return { type: 'tonal', fe: model.fe, sweep: model.sweep, A0: model.A0 * cur.sub.scale, tauA: model.tauA, R: cur.sub.R, improve: cur.score };
}

// one tonal branch as audio: a sine with an exponentially falling pitch and level, t counted from the start of the tail
function synthTonal({ fe, sweep, A0, tauA }, rate, cutSec, length) {
  const y = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate, f = fe * Math.pow(2, sweep ? sweep.oct * Math.exp(-(t + cutSec) / sweep.tau) : 0);
    y[i] = A0 * Math.exp(-t / tauA) * Math.sin(phase);
    phase += 2 * Math.PI * f / rate;
  }
  return y;
}

const improvement = (R, sub) => lossOf(R) - lossOf(sub.R) - sub.penalty;

// ---- noise branches ----

const FILTER_FC = Array.from({ length: 28 }, (_, i) => 50 * Math.pow(2, i * 0.5));
const FILTER_RES = [0, 0.3, 0.55];

// |H| of the filter node's state-variable filter at the frequencies of the bins
export function filterResponse(mode, fc, res, rate, N, K) {
  const k = 2 - 1.95 * res, wc = Math.tan(Math.PI * Math.min(fc, 0.45 * rate) / rate);
  const h = new Float64Array(K);
  for (let b = 0; b < K; b++) {
    const w = Math.tan(Math.PI * Math.min(0.499, b / N) ) / wc, w2 = w * w;
    const den = Math.sqrt((1 - w2) ** 2 + k * k * w2);
    h[b] = (mode === 0 ? 1 : mode === 1 ? w : w2) / den;
  }
  return h;
}

function noiseCandidate(R, S, rate) {
  const { N, hop, w2sum } = S, K = R[0].length, F = R.length;
  const tau = f => (f * hop + N / 2) / rate;
  const e = R.map(m => { let s = 0; for (let k = 2; k < K; k++) s += m[k] * m[k]; return Math.sqrt(s); });
  const emax = Math.max(...e);
  if (emax < 1e-5) return null;
  const used = [];
  for (let f = 0; f < F && e[f] > 0.03 * emax; f++) used.push(f);
  if (used.length < 2) return null;
  const dd = line(used.map(tau), used.map(f => Math.log(e[f])), used.map(f => e[f]));
  const tauA = dd.b < -0.2 ? -1 / dd.b : 5;
  const a = used.map(f => Math.exp(-tau(f) / tauA));
  const aa = a.reduce((s, v) => s + v * v, 0);
  const P0 = new Float64Array(K);
  used.forEach((f, i) => { for (let k = 2; k < K; k++) P0[k] += R[f][k] * a[i]; });
  let pmax = 0;
  for (let k = 2; k < K; k++) { P0[k] /= aa; if (P0[k] > pmax) pmax = P0[k]; }
  // a few bins holding most of the energy is a ringing partial, not noise
  let total2 = 0;
  for (let k = 2; k < K; k++) total2 += P0[k] * P0[k];
  for (let k = 2, win = 0; k < K; k++) {
    win += P0[k] * P0[k] - (k >= 7 ? P0[k - 5] * P0[k - 5] : 0);
    if (win > 0.5 * total2) return null;
  }
  // the filter whose shape sits closest to the average spectrum
  let best = null;
  for (let mode = 0; mode < 3; mode++) for (const fc of FILTER_FC) for (const res of FILTER_RES) {
    if (fc > 0.45 * rate) continue;
    const H = filterResponse(mode, fc, res, rate, N, K);
    let sw = 0, sd = 0, sdd = 0;
    for (let k = 2; k < K; k++) {
      const w = P0[k] / pmax, d = Math.log(P0[k] + 1e-3 * pmax) - Math.log(H[k] + 1e-4);
      sw += w; sd += w * d; sdd += w * d * d;
    }
    const mean = sd / sw, cost = sdd - sd * sd / sw;
    if (!best || cost < best.cost) best = { mode, fc, res, cost, sw, g: Math.exp(mean), H };
  }
  best.dev = Math.sqrt(best.cost / best.sw);
  const gainRms = best.g / MEAN_MAG / Math.sqrt(w2sum / 3);
  const B = R.map((m, f) => {
    const o = new Float32Array(K), env = Math.exp(-tau(f) / tauA);
    for (let k = 2; k < K; k++) o[k] = MEAN_MAG * Math.sqrt(w2sum / 3) * gainRms * best.H[k] * env;
    return o;
  });
  const sub = subtract(R, B);
  return { type: 'noise', dev: best.dev, mode: best.mode, fc: best.fc, res: best.res, gain: gainRms * sub.scale, tauA, R: sub.R, improve: improvement(R, sub) };
}

// ---- the fit ----

// x: mono samples. Returns the transient (as samples), the branches, and a report.
export function fitTail(x, rate, { max = 8, tolerance = 0.05, transientMs = 0 } = {}) {
  if (x.length < rate * 0.05) throw new Error('That sample is too short to split (under 50 ms).');
  const cutMs = transientMs > 0 ? transientMs : detectCut(x, rate);
  const cut = Math.min(Math.round(cutMs * rate / 1000), x.length >> 1);
  const transient = Float32Array.from(x.subarray(0, cut));
  const fade = Math.max(2, Math.min(cut >> 1, Math.round(rate * 0.006)));
  for (let i = 0; i < fade; i++) transient[cut - fade + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / (fade + 1));
  const tailLen = Math.min(x.length - cut, Math.round(rate * 4));
  const N = tailLen > rate * 0.25 ? 2048 : tailLen > rate * 0.1 ? 1024 : 512, hop = N / 4;
  const frames = Math.max(1, Math.ceil((tailLen - N) / hop) + 1);
  const S = stft(x, cut, N, hop, frames);
  let R = S.mags;
  const L0 = lossOf(R);
  const branches = [];
  let noises = 0;
  while (branches.length < max && L0 > 0) {
    const t = tonalCandidate(R, S, rate, cut / rate, tailLen, 0.5 * tolerance * L0);
    const n = noises < 3 ? noiseCandidate(R, S, rate) : null;
    const pick = [t, n].filter(Boolean).sort((a, b) => b.improve - a.improve)[0];
    if (!pick || !(pick.improve > tolerance * L0)) break;
    if (pick.type === 'noise') noises++;
    branches.push(pick);
    R = pick.R;
  }
  for (const b of branches) delete b.R;
  const match = L0 > 0 ? 1 - lossOf(R) / L0 : 1;
  return { transient, cutMs: cut * 1000 / rate, branches, match, max };
}

// ---- the instrument ----

const msOf = tau => Math.min(5000, Math.max(1, tau * 1000 * LN_60DB));
const r4 = v => Math.round(v * 10000) / 10000;

// The graph for a fit: the transient sampler and every branch, all wired into the output.
export function buildInstrument(fit, sampleId) {
  const nodes = [{ id: 'attack', type: 'sampler', x: 40, y: 30, params: { level: 1 } }];
  const connections = [['attack.out', 'out.in']];
  const exposed = [{ node: 'attack', param: 'level', label: 'Atk' }];
  let row = 0, tonals = 0, noises = 0;
  for (const [i, b] of fit.branches.entries()) {
    const y = 30 + (++row) * 120, n = i + 1, dec = msOf(b.tauA);
    const amp = { id: `e${n}`, type: 'env', x: 300, y, params: { attack: Math.max(0.1, r4(fit.cutMs)), decay: r4(dec), sustain: 0, release: r4(dec), amount: 1 } };
    const vca = { id: `g${n}`, type: 'gain', x: 540, y, params: { gain: r4(Math.min(4, b.type === 'tonal' ? b.A0 : b.gain)) } };
    if (b.type === 'tonal') {
      tonals++;
      const semis = 12 * Math.log2(b.fe / C4), follows = Math.abs(semis) <= 48;
      nodes.push({ id: `o${n}`, type: 'osc', x: 40, y, params: follows ? { tune: r4(semis) } : { track: 0, freq: r4(Math.min(20000, b.fe)) } });
      connections.push([`o${n}.out`, `g${n}.in`]);
      if (b.sweep) {
        const sw = { id: `s${n}`, type: 'env', x: 300, y: y + 56, params: { attack: 0.1, decay: r4(msOf(b.sweep.tau)), sustain: 0, release: r4(msOf(b.sweep.tau)), amount: r4(b.sweep.oct) } };
        nodes.push(sw);
        connections.push([`s${n}.out`, `o${n}.fm`]);
      }
    } else {
      noises++;
      nodes.push({ id: `n${n}`, type: 'noise', x: 40, y, params: { seed: n } });
      nodes.push({ id: `f${n}`, type: 'filter', x: 170, y, params: { cutoff: r4(b.fc), resonance: b.res, mode: b.mode } });
      connections.push([`n${n}.out`, `f${n}.in`], [`f${n}.out`, `g${n}.in`]);
    }
    nodes.push(amp, vca);
    connections.push([`e${n}.out`, `g${n}.cv`], [`g${n}.out`, 'out.in']);
    if (exposed.length < 4) exposed.push({ node: `e${n}`, param: 'decay', label: b.type === 'tonal' ? `Dc${n}` : `Nz${n}`, scale: 'log' });
  }
  nodes.push({ id: 'out', type: 'out', x: 780, y: 30, params: { gain: 0.45 } });
  return { graph: { nodes, connections }, exposed, samples: { attack: sampleId } };
}
