import { ALGORITHMS, scaleOL } from '../audio/nodes/dx7.js';

// A rough picture of what a DX voice sounds like, for the panel: it runs a few cycles of the six operators in
// the voice's algorithm (frequency ratios, output levels, feedback) at one point of the note, and gives back
// each operator's waveform, the summed output and its spectrum. It is a sketch for the eye, not the engine.
const SAMPLES = 256, PERIOD = 32;

export const STAGES = ['attack', 'decay', 'sustain'];

// the operator's frequency ratio as the panel shows it (fixed-frequency operators count as 1)
export function ratioOf(op) {
  if (op.mode) return 1;
  return (op.fc === 0 ? 0.5 : op.fc) * (1 + op.ff / 100);
}

// A short name for what an operator does in this algorithm, from whether it is a carrier and its ratio.
export function operatorNames(voice) {
  const alg = ALGORITHMS[voice.alg], names = [], seen = {};
  voice.ops.forEach((op, k) => {
    const r = ratioOf(op), whole = Math.abs(r - Math.round(r)) < 0.02, carrier = alg.carriers.includes(k);
    let name;
    if (carrier) name = r < 0.9 ? 'Sub' : whole && Math.round(r) === 1 ? 'Body' : whole && Math.round(r) === 2 ? 'Octave' : whole ? 'Overtone' : 'Partial';
    else name = !whole ? 'Metal' : r >= 7 ? 'Click' : r >= 2 ? 'Edge' : 'Warmth';
    seen[name] = (seen[name] || 0) + 1;
    names.push(name);
  });
  const count = {};
  return names.map(n => (seen[n] > 1 ? `${n} ${(count[n] = (count[n] || 0) + 1)}` : n));
}

// how loud an operator is at a stage of its envelope (0 attack peak, 1 decay, 2 sustain)
const levelAt = (op, stage) => (scaleOL(op.ol) / 127) * (scaleOL(op.l[stage]) / 127);

export function previewVoice(voice, stage = 0) {
  const alg = ALGORITHMS[voice.alg];
  const amp = voice.ops.map(op => levelAt(op, stage));
  const feeders = [[], [], [], [], [], []];
  for (const [to, from] of alg.mods) feeders[to].push(from);
  // modulators first: an operator waits for everything that feeds it
  const rank = new Array(6).fill(-1);
  const rankOf = k => rank[k] >= 0 ? rank[k] : (rank[k] = feeders[k].length ? 1 + Math.max(...feeders[k].map(rankOf)) : 0);
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => rankOf(a) - rankOf(b));

  const out = Array.from({ length: 6 }, () => new Float32Array(SAMPLES));
  const [fbFrom, fbTo] = alg.fb, fbAmount = voice.fb ? 0.35 * voice.fb / 7 * 9 : 0;
  for (let n = 0; n < SAMPLES; n++) {
    for (const k of order) {
      let m = 0;
      for (const s of feeders[k]) m += (5 * out[s][n]) / Math.max(1, 0.6 * feeders[k].length);
      if (k === fbTo && n > 0) m += fbAmount * out[fbFrom][n - 1];
      out[k][n] = Math.sin((2 * Math.PI * ratioOf(voice.ops[k]) * n) / PERIOD + m) * Math.min(1, amp[k] * 1.6);
    }
  }
  const mix = new Float32Array(SAMPLES);
  for (let n = 0; n < SAMPLES; n++) for (const c of alg.carriers) mix[n] += out[c][n];
  return { ops: out, mix, spectrum: spectrumOf(mix, 64) };
}

// magnitudes of the first `bins` harmonics of a buffer holding a whole number of cycles, scaled 0..1
function spectrumOf(buf, bins) {
  const N = buf.length, mags = [];
  let top = 1e-6;
  for (let k = 1; k <= bins; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const ph = (2 * Math.PI * k * n) / N; re += buf[n] * Math.cos(ph); im -= buf[n] * Math.sin(ph); }
    const m = Math.hypot(re, im);
    mags.push(m); top = Math.max(top, m);
  }
  return mags.map(m => Math.sqrt(m / top));
}
