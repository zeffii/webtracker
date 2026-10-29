// Drum synth: one drum hit built from three parts, each with its own envelope, plus a transient.
//   Body    a sine whose pitch falls from `startPitch` to `endPitch` along the pitch envelope (an ADSR: `patk` `pdec` `psus` `prel`), shaped by
//           the volume envelope (`attack` `decay` `sustain` `release`). `pitchMul` scales both pitches; with `keytrack` on the note moves them
//           too (`root` is the note that plays the pitches as written).
//   Noise   `noise` is how much, `noiseType` the colour (white, pink, brown, blue, violet), `noiseTone` a low-pass that takes the top off,
//           and its own volume envelope (`natk` `ndec` `nsus` `nrel`).
//   Click   a short burst at the very start of the hit, `click` of it. `clickMode` 0 makes it (a damped sine at `clickTone`), 1 plays the
//           first `clickLen` ms of a sample from the node's list (`clickSample` picks which), and `clickTail` ms of that end in a smooth fade so
//           a cut-off sample does not click (it does nothing for the synthesized click).
// The velocity is `vel` of the level. A hit restarts the sound; the node is monophonic and the voices node makes it polyphonic. A note off
// releases all three envelopes; with their sustain at 0 (the start) a hit ends by itself. A hit on a voice that is still sounding restarts the
// sine at phase 0; the old output carries on into the new hit and dies away in about a millisecond, so there is no step (no click).
import { Adsr } from './adsr.js';

const SPEC = [
  { name: 'startPitch', min: 20, max: 4000, def: 220 },    // Hz at the peak of the pitch envelope, at the root note
  { name: 'endPitch', min: 20, max: 2000, def: 52 },       // Hz the pitch falls to
  { name: 'pitchMul', min: 0.25, max: 4, def: 1 },         // multiplies both pitches
  { name: 'keytrack', min: 0, max: 1, def: 1, int: true },
  { name: 'root', min: 0, max: 127, def: 60, int: true },
  { name: 'patk', min: 0.1, max: 500, def: 0.1 },
  { name: 'pdec', min: 1, max: 2000, def: 55 },
  { name: 'psus', min: 0, max: 1, def: 0 },
  { name: 'prel', min: 1, max: 2000, def: 40 },
  { name: 'body', min: 0, max: 1, def: 0.9 },              // level of the pitched part
  { name: 'attack', min: 0.1, max: 500, def: 0.5 },
  { name: 'decay', min: 1, max: 3000, def: 280 },
  { name: 'sustain', min: 0, max: 1, def: 0 },
  { name: 'release', min: 1, max: 3000, def: 60 },
  { name: 'drive', min: 0, max: 1, def: 0.15 },
  { name: 'noise', min: 0, max: 1, def: 0.15 },
  { name: 'noiseType', min: 0, max: 4, def: 0, int: true },
  { name: 'noiseTone', min: 200, max: 16000, def: 9000 },  // Hz, low-pass on the noise
  { name: 'natk', min: 0.1, max: 500, def: 0.1 },
  { name: 'ndec', min: 1, max: 3000, def: 90 },
  { name: 'nsus', min: 0, max: 1, def: 0 },
  { name: 'nrel', min: 1, max: 3000, def: 30 },
  { name: 'click', min: 0, max: 1, def: 0.4 },
  { name: 'clickMode', min: 0, max: 1, def: 0, int: true },
  { name: 'clickLen', min: 0.3, max: 120, def: 6 },        // ms: the length of the click (of the sample, when it is one)
  { name: 'clickTone', min: 400, max: 12000, def: 3500 },  // Hz of the synthesized click
  { name: 'clickSample', min: 0, max: 255, def: 0, int: true },   // which sample of the node's list is the click
  { name: 'clickTail', min: 0, max: 60, def: 4 },          // ms of smooth fade at the end of a sample click
  { name: 'vel', min: 0, max: 1, def: 0.6 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });
export const NOISE_TYPES = ['white', 'pink', 'brown', 'blue', 'violet'];

const NODE = {
  type: 'drumsynth',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  samples: true,     // the click sample comes from the node's sample list
  editor: 'drumsynth',
  adsr: [{ atk: 'attack', dec: 'decay', sus: 'sustain', rel: 'release' }, { atk: 'patk', dec: 'pdec', sus: 'psus', rel: 'prel' }, { atk: 'natk', dec: 'ndec', sus: 'nsus', rel: 'nrel' }],
  shape: 'rounded',
  glyph: 'drumsynth',
  kinds: { out: 'stereo' },
  params: SPEC,
  create({ sampleRate }) {
    const amp = new Adsr(sampleRate), pit = new Adsr(sampleRate), noi = new Adsr(sampleRate);
    const bank = [];
    let note = 60, velocity = 1, hit = false, phase = 0, seed = 0x9e3779b9;
    let kOn = false, k = 0, kLen = 0, kNorm = 1, kTail = 0, kSample = null;
    let b0 = 0, b1 = 0, b2 = 0, brown = 0, w1 = 0, w2 = 0, lp = 0;
    let last = 0, carry = 0;   // the last sample out, and what is left of it when a new hit cuts in
    const white = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
    return {
      // { type: 'sample', slot?, data, right?, rate }: the click's sample, mixed down to one channel
      message(msg) {
        if (msg.type !== 'sample') return;
        const d = msg.data, r = msg.right, mono = new Float32Array(d.length);
        for (let i = 0; i < d.length; i++) mono[i] = r ? (d[i] + r[i]) * 0.5 : d[i];
        bank[msg.slot | 0] = { data: mono, ratio: msg.rate / sampleRate };
      },
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; hit = true; amp.on(); pit.on(); noi.on(); }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); pit.off(); noi.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); pit.cut(); noi.cut(); kOn = false; hit = false; last = carry = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle && noi.idle && !kOn && !hit) { outL.fill(0, 0, n); outR.fill(0, 0, n); last = carry = 0; return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('attack'), g('decay'), g('sustain'), g('release'));
        pit.set(g('patk'), g('pdec'), g('psus'), g('prel'));
        noi.set(g('natk'), g('ndec'), g('nsus'), g('nrel'));
        const ms = sampleRate * 0.001, keyed = g('keytrack') >= 1 ? Math.pow(2, (note - g('root')) / 12) : 1, mul = g('pitchMul') * keyed;
        const f0 = g('endPitch'), f1 = g('startPitch');
        const bodyLevel = g('body'), noiseAmt = g('noise'), type = Math.round(g('noiseType')), clickAmt = g('click');
        const nf = 1 - Math.exp(-2 * Math.PI * Math.min(g('noiseTone'), sampleRate * 0.45) / sampleRate);
        const v = 1 - g('vel') + g('vel') * velocity, level = g('level') * v, d = 1 + g('drive') * 4, dn = 1 / Math.tanh(d);
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
        const cd = Math.exp(-1 / (0.0015 * sampleRate)), tone = 2 * Math.PI * g('clickTone') / sampleRate, kEnd = kSample ? kLen : kLen * 1.5;
        for (let i = 0; i < n; i++) {
          const pe = pit.next(), f = (f0 + (f1 - f0) * pe) * mul;
          phase += f / sampleRate; if (phase >= 1) phase -= Math.floor(phase);
          const body = Math.sin(6.283185307179586 * phase) * bodyLevel * amp.next();
          const w = white();
          let nz;
          if (type === 1) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; nz = (b0 + b1 + b2 + w * 0.1848) * 0.3; }
          else if (type === 2) { brown = (brown + 0.02 * w) / 1.02; nz = brown * 3.5; }
          else if (type === 3) { nz = (w - w1) * 0.7; }
          else if (type === 4) { nz = (w - 2 * w1 + w2) * 0.4; }
          else nz = w;
          w2 = w1; w1 = w;
          lp += nf * (nz - lp);
          const noise = lp * noiseAmt * noi.next();
          let click = 0;
          if (kOn) {
            if (kSample) {
              const pos = k * kSample.ratio, a = Math.floor(pos), fr = pos - a, s = kSample.data;
              let c = (s[a] + ((s[a + 1] ?? s[a]) - s[a]) * fr) * kNorm;
              if (kTail > 0 && k > kLen - kTail) c *= 0.5 + 0.5 * Math.cos(Math.PI * (k - (kLen - kTail)) / kTail);   // a raised-cosine fade, so the end is smooth
              click = c;
            } else click = (Math.sin(tone * k) * 0.8 + w * 0.3) * Math.exp(-6.9078 * k / kLen);
            click *= clickAmt * 0.9;
            if (++k >= kEnd) kOn = false;
          }
          const fresh = Math.tanh((body + noise * 0.7 + click) * d) * dn * level;
          const y = fresh + carry;
          carry *= cd; last = fresh;
          outL[i] = y; outR[i] = y;
        }
        if (Math.abs(carry) < 1e-6) carry = 0;
        if (!Number.isFinite(lp + brown + b0 + b1 + b2)) { lp = brown = b0 = b1 = b2 = 0; }
      },
    };
  },
};
export default NODE;

// One hit rendered offline, for the picture of it: `values` are the parameters that differ from the defaults, `sample` is { data, rate } for a
// sample click. `offAt` (ms) lets go of the note, for a sound that would otherwise be held by its sustain.
export function renderPreview(values = {}, { sample = null, ms = 300, sr = 44100, note = 60, offAt = null } = {}) {
  const node = NODE.create({ sampleRate: sr });
  if (sample) node.message({ type: 'sample', slot: 0, data: sample.data, rate: sample.rate });
  const vals = new Float32Array(SPEC.map(s => values[s.name] ?? s.def)), slots = SPEC.map((_, i) => i);
  const total = Math.ceil(sr * ms / 1000), out = new Float32Array(total), L = new Float32Array(128), R = new Float32Array(128);
  node.note({ type: 'noteOn', note, vel: 1 });
  for (let at = 0; at < total; at += 128) {
    if (offAt !== null && at <= sr * offAt / 1000 && at + 128 > sr * offAt / 1000) node.note({ type: 'noteOff', note });
    node.process([], [[L, R]], 128, vals, slots);
    out.set(L.subarray(0, Math.min(128, total - at)), at);
  }
  return out;
}
// The curve of one ADSR, a value for each millisecond: the note is held for `hold` ms, then let go.
export function envCurve(a, d, s, r, hold, total) {
  const e = new Adsr(1000), out = new Float32Array(total);
  e.set(a, d, s, r); e.on();
  for (let i = 0; i < total; i++) { if (i === hold) e.off(); out[i] = e.next(); }
  return out;
}
