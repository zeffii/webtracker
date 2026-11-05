// Drum synth 2: a drum hit from three parts whose envelopes you draw, as Bezier splines in the panel under the parameters.
//   Body    a sine whose pitch follows the pitch drawing: the top of the drawing is `startPitch` and the bottom `endPitch`, and
//           it moves between them evenly in octaves, so a straight line is a smooth glide. `pitchMul` scales both; with `keytrack` on the
//           note moves them too (`root` is the note that plays the pitches as written). The volume drawing shapes the body.
//   Noise   `noise` is how much, `noiseType` the colour (white, pink, brown, blue, violet, velvet, crackle or stepped), `noiseTone`
//           takes the top off, `noiseHigh` the bottom, and the noise drawing is its volume.
//   Click   the same short burst at the start of the hit as the drum synth's: `clickMode` 0 makes it (a damped sine at `clickTone`), 1 plays
//           the first `clickLen` ms of a sample from the node's list, `clickTail` ms of that end smoothed. Nothing in it has changed.
//   Boost   an end stage after everything else: a low shelf (`boost` dB, from `boostFreq` Hz down) that puts weight under the hit, and a
//           soft limiter after it so the boost cannot clip.
// Each drawing is one shot, played from the note on. Its `rate` is how fast it plays: 1 takes the reference time (pitch 250 ms, volume
// 700 ms, noise 400 ms), 2 half as long, 0.5 twice as long. After its end a drawing holds its last level. A note off fades the hit out
// in 40 ms (which only matters when the volume drawing does not end at 0). Monophonic; the voices node makes it polyphonic.
// A hit on a voice that is still sounding restarts the sine at phase 0; the old output carries on and dies away in about a millisecond,
// so there is no step (no click).
import { SHAPES, envelopeTable, readEnvelope, cleanSpline } from './bezier.js';

const SPEC = [
  { name: 'startPitch', min: 20, max: 4000, def: 220 },    // Hz at the top of the pitch drawing, at the root note
  { name: 'endPitch', min: 20, max: 2000, def: 50 },       // Hz at the bottom of it
  { name: 'pitchMul', min: 0.25, max: 4, def: 1 },
  { name: 'keytrack', min: 0, max: 1, def: 1, int: true },
  { name: 'root', min: 0, max: 127, def: 60, int: true },
  { name: 'prate', min: 0.1, max: 10, def: 1 },            // how fast the pitch drawing plays
  { name: 'body', min: 0, max: 1, def: 0.9 },
  { name: 'arate', min: 0.1, max: 10, def: 1 },            // the volume drawing
  { name: 'drive', min: 0, max: 1, def: 0.15 },
  { name: 'noise', min: 0, max: 1, def: 0.15 },
  { name: 'noiseType', min: 0, max: 7, def: 0, int: true },
  { name: 'noiseTone', min: 200, max: 16000, def: 9000 },  // Hz, low-pass on the noise (for stepped, how often it steps)
  { name: 'noiseHigh', min: 20, max: 8000, def: 20 },      // Hz, high-pass on the noise
  { name: 'nrate', min: 0.1, max: 10, def: 1 },            // the noise drawing
  { name: 'click', min: 0, max: 1, def: 0.4 },
  { name: 'clickMode', min: 0, max: 1, def: 0, int: true },
  { name: 'clickLen', min: 0.3, max: 120, def: 6 },
  { name: 'clickTone', min: 400, max: 12000, def: 3500 },
  { name: 'clickSample', min: 0, max: 255, def: 0, int: true },
  { name: 'clickTail', min: 0, max: 60, def: 4 },
  { name: 'boost', min: 0, max: 18, def: 0 },              // dB of low shelf at the end
  { name: 'boostFreq', min: 25, max: 200, def: 60 },       // Hz
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });
export const NOISE_TYPES = ['white', 'pink', 'brown', 'blue', 'violet', 'velvet', 'crackle', 'stepped'];
export const REFERENCE_MS = { pitch: 250, amp: 700, noise: 400 };
export const DEFAULT_SHAPES = { pitch: SHAPES.fall, amp: SHAPES.punch, noise: () => [{ x: 0, y: 1, l: null, r: [0.02, -0.55] }, { x: 1, y: 0, l: [-0.4, 0], r: null }] };
const KEYS = ['pitch', 'amp', 'noise'];
const softLimit = y => { const a = Math.abs(y); return a <= 0.8 ? y : Math.sign(y) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)); };

const NODE = {
  type: 'drumsynth2',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  samples: true,     // the click sample comes from the node's sample list
  editor: 'drumsynth2',
  shape: 'rounded',
  glyph: 'drumsynth2',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate, data }) {
    const tables = {};
    const setTable = (key, points) => { tables[key] = envelopeTable(cleanSpline(points, DEFAULT_SHAPES[key])); };
    for (const key of KEYS) setTable(key, data?.env?.[key]);
    const bank = [];
    let note = 60, velocity = 1, hit = false, phase = 0, seed = 0x9e3779b9, held = 0, fade = 1, off = false;   // `held`: samples since the note on
    let kOn = false, k = 0, kLen = 0, kNorm = 1, kTail = 0, kSample = null;
    let b0 = 0, b1 = 0, b2 = 0, brown = 0, w1 = 0, w2 = 0, lp = 0, hpLow = 0, stepHold = 0, stepLeft = 0;
    let last = 0, carry = 0, z1 = 0, z2 = 0;   // the last sample out, what is left of it when a new hit cuts in, the boost's state
    let playing = false;
    const white = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
    return {
      // { type: 'sample', slot?, data, right?, rate }: the click's sample, mixed down to one channel
      // { type: 'env', slot: 'pitch' | 'amp' | 'noise', points }: one of the drawings
      message(msg) {
        if (msg.type === 'env' && KEYS.includes(msg.slot)) { setTable(msg.slot, msg.points); return; }
        if (msg.type !== 'sample') return;
        const d = msg.data, r = msg.right, mono = new Float32Array(d.length);
        for (let i = 0; i < d.length; i++) mono[i] = r ? (d[i] + r[i]) * 0.5 : d[i];
        bank[msg.slot | 0] = { data: mono, ratio: msg.rate / sampleRate };
      },
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; hit = true; held = 0; fade = 1; off = false; playing = true; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') off = true;
        else if (msg.type === 'noteCut') { kOn = false; hit = false; playing = false; last = carry = 0; z1 = z2 = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!playing && !kOn && !hit) { outL.fill(0, 0, n); outR.fill(0, 0, n); last = carry = 0; return; }
        const g = name => params[slots[P[name]]];
        const ms = sampleRate * 0.001, keyed = g('keytrack') >= 1 ? Math.pow(2, (note - g('root')) / 12) : 1, mul = g('pitchMul') * keyed;
        const lo = g('endPitch'), ratio = Math.max(1, g('startPitch')) / Math.max(1, lo);
        const bodyLevel = g('body'), noiseAmt = g('noise'), type = Math.round(g('noiseType')), clickAmt = g('click');
        const nf = 1 - Math.exp(-2 * Math.PI * Math.min(g('noiseTone'), sampleRate * 0.45) / sampleRate);
        const hf = 1 - Math.exp(-2 * Math.PI * Math.min(g('noiseHigh'), sampleRate * 0.45) / sampleRate);
        const stepEvery = Math.max(1, Math.round(sampleRate / (2 * Math.max(50, g('noiseTone')))));
        const v = 1 - g('vel') + g('vel') * velocity, level = g('level') * v, d = 1 + g('drive') * 4, dn = 1 / Math.tanh(d);
        const rate = { pitch: g('prate'), amp: g('arate'), noise: g('nrate') };
        const perSample = key => rate[key] / (REFERENCE_MS[key] * ms);   // how far along its drawing it moves each sample
        const pStep = perSample('pitch'), aStep = perSample('amp'), nStep = perSample('noise');
        const boost = g('boost');
        let bb0 = 1, bb1 = 0, bb2 = 0, ba1 = 0, ba2 = 0;
        if (boost > 0.05) {   // a low shelf (RBJ, shelf slope 1)
          const A = Math.pow(10, boost / 40), w0 = 2 * Math.PI * Math.min(g('boostFreq'), sampleRate * 0.2) / sampleRate, cs = Math.cos(w0), sn = Math.sin(w0);
          const al = sn / 2 * Math.SQRT2, tw = 2 * Math.sqrt(A) * al, a0 = (A + 1) + (A - 1) * cs + tw;
          bb0 = A * ((A + 1) - (A - 1) * cs + tw) / a0; bb1 = 2 * A * ((A - 1) - (A + 1) * cs) / a0; bb2 = A * ((A + 1) - (A - 1) * cs - tw) / a0;
          ba1 = -2 * ((A - 1) + (A + 1) * cs) / a0; ba2 = ((A + 1) + (A - 1) * cs - tw) / a0;
        }
        if (hit) {   // a new hit: the click starts, from its sample when that is what it is
          hit = false; phase = 0; k = 0; carry = last; kLen = Math.max(1, Math.round(g('clickLen') * ms)); kSample = null; kNorm = 1; kOn = clickAmt > 0;
          if (g('clickMode') >= 1) {
            kSample = bank[Math.round(g('clickSample'))] ?? null;
            if (!kSample) kOn = false;
            else {
              kLen = Math.min(kLen, Math.floor(kSample.data.length / kSample.ratio));
              let pk = 0; for (let i = 0; i < kLen; i++) pk = Math.max(pk, Math.abs(kSample.data[Math.min(kSample.data.length - 1, Math.floor(i * kSample.ratio))]));
              kNorm = pk > 1e-6 ? 1 / pk : 1;   // the click is as loud as its amount says, whatever the sample's own level
              if (kLen < 1) kOn = false;
            }
          }
          kTail = Math.min(kLen, g('clickTail') * ms);
        }
        const kRamp = Math.max(2, Math.round(0.00015 * sampleRate)), cd = Math.exp(-1 / (0.0015 * sampleRate)), tone = 2 * Math.PI * g('clickTone') / sampleRate, kEnd = kSample ? kLen : kLen * 1.5;
        const fadeStep = 1 / (0.04 * sampleRate);
        const tp = tables.pitch, ta = tables.amp, tn = tables.noise;
        for (let i = 0; i < n; i++) {
          const pe = readEnvelope(tp, held * pStep), f = lo * Math.pow(ratio, pe) * mul;
          phase += f / sampleRate; if (phase >= 1) phase -= Math.floor(phase);
          const body = Math.sin(6.283185307179586 * phase) * bodyLevel * readEnvelope(ta, held * aStep);
          const w = white();
          let nz;
          if (type === 1) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; nz = (b0 + b1 + b2 + w * 0.1848) * 0.3; }
          else if (type === 2) { brown = (brown + 0.02 * w) / 1.02; nz = brown * 3.5; }
          else if (type === 3) nz = (w - w1) * 0.7;
          else if (type === 4) nz = (w - 2 * w1 + w2) * 0.4;
          else if (type === 5) { const r = white(); nz = r > 0.96 ? (r > 0.98 ? 1.6 : -1.6) : 0; }   // velvet: a few loud, sparse spikes, + or -
          else if (type === 6) { const r = white(), burst = Math.abs(r) > 0.985; nz = burst ? white() * 2.2 : 0; }   // crackle: pops of random size
          else if (type === 7) { if (--stepLeft <= 0) { stepHold = w; stepLeft = stepEvery; } nz = stepHold; }   // stepped: held, then a new value
          else nz = w;
          w2 = w1; w1 = w;
          lp += nf * (nz - lp);
          hpLow += hf * (lp - hpLow);
          const noise = (lp - hpLow) * noiseAmt * readEnvelope(tn, held * nStep);
          let click = 0;
          if (kOn) {
            if (kSample) {
              const pos = k * kSample.ratio, a = Math.floor(pos), fr = pos - a, s = kSample.data;
              let c = (s[a] + ((s[a + 1] ?? s[a]) - s[a]) * fr) * kNorm;
              if (kTail > 0 && k > kLen - kTail) c *= 0.5 + 0.5 * Math.cos(Math.PI * (k - (kLen - kTail)) / kTail);   // a raised-cosine fade, so the end is smooth
              click = c;
            } else click = (Math.sin(tone * k) * 0.8 + w * 0.3) * Math.exp(-6.9078 * k / kLen);
            click *= clickAmt * 0.9 * Math.min(1, (k + 1) / kRamp);   // in over a few samples: the first noise sample would otherwise be a step, a tick that is different at every hit
            if (++k >= kEnd) kOn = false;
          }
          held++;
          if (off) fade = Math.max(0, fade - fadeStep);
          const fresh = Math.tanh((body + noise * 0.7 + click) * d) * dn * level * fade;
          const y = fresh + carry;
          carry *= cd; last = fresh;
          let out = y;
          if (boost > 0.05) { const o = bb0 * y + z1; z1 = bb1 * y - ba1 * o + z2; z2 = bb2 * y - ba2 * o; out = softLimit(o); }
          outL[i] = out; outR[i] = out;
        }
        if (Math.abs(carry) < 1e-6) carry = 0;
        if (!Number.isFinite(lp + hpLow + brown + b0 + b1 + b2 + z1 + z2)) { lp = hpLow = brown = b0 = b1 = b2 = z1 = z2 = 0; }
        // finished: the drawings are over, the volume holds nothing, and the click and its carry are gone
        const doneAt = Math.max(1 / aStep, noiseAmt > 0 ? 1 / nStep : 0, kEnd + 4 * ms);
        if (held > doneAt && ta[ta.length - 1] < 1e-3 && (noiseAmt === 0 || tn[tn.length - 1] < 1e-3) && !kOn && carry === 0 && !hit) playing = false;
        if (off && fade <= 0) playing = false;
      },
    };
  },
};
export default NODE;

// One hit rendered offline, for the picture of it: `values` are the parameters that differ from the defaults, `env` the drawings.
export function renderPreview(values = {}, { env = {}, sample = null, ms = 400, sr = 44100, note = 60 } = {}) {
  const node = NODE.create({ sampleRate: sr, data: { env } });
  if (sample) node.message({ type: 'sample', slot: 0, data: sample.data, rate: sample.rate });
  const vals = new Float32Array(SPEC.map(s => values[s.name] ?? s.def)), slots = SPEC.map((_, i) => i);
  const total = Math.ceil(sr * ms / 1000), out = new Float32Array(total), L = new Float32Array(128), R = new Float32Array(128);
  node.note({ type: 'noteOn', note, vel: 1 });
  for (let at = 0; at < total; at += 128) {
    node.process([], [[L, R]], 128, vals, slots);
    out.set(L.subarray(0, Math.min(128, total - at)), at);
  }
  return out;
}
