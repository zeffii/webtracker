// Lone: a one-node lead synth in the manner of the classic monophonic analogue leads, with a Braids wavetable added.
//
//   oscillator   a saw, a pulse (its width set by hand, moved by the LFO and by the filter envelope), the Braids
//                wavetable (`position` set by hand, moved by its own envelope, by the LFO and by the `pos` input),
//                a sub oscillator one or two octaves down (square or sine) and noise. Each has its own level, so the
//                wavetable can sit beside the saw or replace it.
//   sync         hard sync: a master phase at the note's pitch restarts the saw, pulse and wavetable, which run at
//                `syncratio` times the pitch. Sweep the ratio for the tearing lead sound.
//   fold         a wave-folder after the mix, before the filter.
//   filter       the 24 dB/oct ladder low-pass of the Subtractive synth (zero-delay feedback, tanh), with key tracking, the
//                filter envelope and the LFO.
//   LFO          triangle, square, saw or random steps, with a delay that fades it in after each note; it can move the
//                pitch, the cutoff, the pulse width and the wavetable position.
//   glide        `glide` is an exponential glide in ms; `slide` a straight-line one in ticks from the previous note of the
//                same pattern column; `legato` keeps the envelopes running (no new attack) when a note starts while the
//                last one is still held.
//
// The node is monophonic, last note wins. The number of voices belongs to the machine (the Voices setting): one voice is the
// mono lead; more make it polyphonic through the `voices` node, each voice with its own copy of everything above.
import { Adsr } from './adsr.js';
import { FRAME, braidsFrames } from './wtutil.js';

const SPEC = [
  { name: 'saw', min: 0, max: 1, def: 0.8 },                  // level of the saw
  { name: 'pulse', min: 0, max: 1, def: 0 },                  // level of the pulse
  { name: 'pw', min: 0.05, max: 0.95, def: 0.5 },             // pulse width
  { name: 'pwlfo', min: 0, max: 0.45, def: 0 },               // how far the LFO moves the width
  { name: 'pwenv', min: -0.45, max: 0.45, def: 0 },           // how far the filter envelope moves it
  { name: 'wt', min: 0, max: 1, def: 0 },                     // level of the wavetable
  { name: 'position', min: 0, max: 1, def: 0.2 },             // where in the table
  { name: 'pamt', min: -1, max: 1, def: 0 },                  // how far the position envelope moves it
  { name: 'plfo', min: 0, max: 1, def: 0 },                   // how far the LFO moves it
  { name: 'patk', min: 0.1, max: 5000, def: 5 },              // position envelope, ms
  { name: 'pdec', min: 1, max: 5000, def: 600 },
  { name: 'psus', min: 0, max: 1, def: 0 },
  { name: 'prel', min: 1, max: 5000, def: 300 },
  { name: 'sub', min: 0, max: 1, def: 0.4 },
  { name: 'suboct', min: 1, max: 2, def: 1, int: true },      // octaves below
  { name: 'subwave', min: 0, max: 1, def: 0, int: true },     // 0 square, 1 sine
  { name: 'noise', min: 0, max: 1, def: 0 },
  { name: 'sync', min: 0, max: 1, def: 0, int: true },
  { name: 'syncratio', min: 1, max: 8, def: 2 },              // slave pitch against master
  { name: 'fold', min: 0, max: 1, def: 0 },
  { name: 'cutoff', min: 20, max: 20000, def: 900 },          // Hz
  { name: 'res', min: 0, max: 1, def: 0.3 },
  { name: 'drive', min: 0, max: 1, def: 0.2 },
  { name: 'fenv', min: -8, max: 8, def: 3 },                  // octaves the filter envelope adds
  { name: 'keytrack', min: 0, max: 1, def: 0.5 },
  { name: 'fmod', min: 0, max: 4, def: 0 },                   // octaves the LFO moves the cutoff
  { name: 'fatk', min: 0.1, max: 5000, def: 1 },
  { name: 'fdec', min: 1, max: 5000, def: 250 },
  { name: 'fsus', min: 0, max: 1, def: 0.2 },
  { name: 'frel', min: 1, max: 5000, def: 150 },
  { name: 'atk', min: 0.1, max: 5000, def: 2 },
  { name: 'dec', min: 1, max: 5000, def: 300 },
  { name: 'sus', min: 0, max: 1, def: 0.8 },
  { name: 'rel', min: 1, max: 5000, def: 150 },
  { name: 'lfoRate', min: 0.05, max: 40, def: 5 },            // Hz
  { name: 'lfoShape', min: 0, max: 3, def: 0, int: true },    // 0 triangle, 1 square, 2 saw, 3 random steps
  { name: 'lfoDelay', min: 0, max: 5000, def: 0 },            // ms until the LFO is at full depth after a note
  { name: 'vib', min: 0, max: 200, def: 0 },                  // cents the LFO moves the pitch
  { name: 'glide', min: 0, max: 2000, def: 0 },               // ms
  { name: 'slide', min: 0, max: 15.9375, def: 0 },            // ticks
  { name: 'legato', min: 0, max: 1, def: 0, int: true },
  { name: 'tune', min: -24, max: 24, def: 0 },                // semitones
  { name: 'fine', min: -100, max: 100, def: 0 },              // cents
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SUB_BLOCK = 8, TWO_PI = 2 * Math.PI;
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const sawAt = (p, dt) => 2 * p - 1 - blep(p, dt);
const pulseAt = (p, dt, pw) => {
  let q = p + 1 - pw; if (q >= 1) q -= 1;
  return (p < pw ? 1 : -1) + blep(p, dt) - blep(q, dt);
};

// The LFO at phase p (0 to 1): triangle, square, saw (falling) or the held random value `held`.
export function lfoAt(shape, p, held) {
  if (shape === 1) return p < 0.5 ? 1 : -1;
  if (shape === 2) return 1 - 2 * p;
  if (shape === 3) return held;
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
}

// The wave folder: 0 leaves the sound alone, more drives it into a sine fold that reflects the peaks back.
export function fold(x, amount) {
  if (amount <= 0) return x;
  return Math.sin(x * (1 + amount * 5) * (Math.PI / 2)) / (1 + amount * 0.3);
}

export default {
  type: 'lone',
  inputs: ['pitch', 'cut', 'pos'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }, { atk: 'fatk', dec: 'fdec', sus: 'fsus', rel: 'frel' }],
  shape: 'rounded',
  glyph: 'lone',
  kinds: { pitch: 'control', cut: 'control', pos: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, clock }) {
    const pitchOn = connected[0], cutOn = connected[1], posOn = connected[2];
    const table = braidsFrames(), count = table.length / FRAME;
    const amp = new Adsr(sampleRate), fil = new Adsr(sampleRate), posEnv = new Adsr(sampleRate);
    let master = 0, slave = 0, subPhase = 0, lfoPhase = 0, held = 0, since = 0;
    let note = 60, pos = 60, velocity = 1, seed = 4242;
    let legatoOn = false, latch = false, ampFresh = false, from = -1, rate = 0;
    const s = new Float64Array(4);
    const flush = v => (Math.abs(v) < 1e-18 ? 0 : v);
    const heldNow = () => amp.stage === 1 || amp.stage === 2;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          const tied = legatoOn && heldNow();
          ampFresh = amp.idle;
          if (amp.idle) { master = slave = subPhase = 0; lfoPhase = 0; since = 0; s.fill(0); pos = msg.note; }
          note = msg.note; velocity = msg.vel ?? 1;
          latch = true; from = msg.from ?? -1;
          if (!tied) { amp.on(); fil.on(); posEnv.on(); since = 0; }
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); fil.off(); posEnv.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); fil.cut(); posEnv.cut(); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        legatoOn = g('legato') >= 0.5;
        const pitchIn = inputs[0], cutIn = inputs[1], posIn = inputs[2];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        fil.set(g('fatk'), g('fdec'), g('fsus'), g('frel'));
        posEnv.set(g('patk'), g('pdec'), g('psus'), g('prel'));
        const glideMs = g('glide');
        if (latch) {
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

        const sawL = g('saw'), pulseL = g('pulse'), wtL = g('wt'), subL = g('sub'), noiseL = g('noise');
        const pw0 = g('pw'), pwLfo = g('pwlfo'), pwEnv = g('pwenv');
        const position = g('position'), pAmt = g('pamt'), pLfo = g('plfo');
        const subDiv = g('suboct') >= 1.5 ? 4 : 2, subSine = g('subwave') >= 0.5;
        const syncOn = g('sync') >= 0.5, ratio = syncOn ? g('syncratio') : 1;
        const foldAmt = g('fold');
        const lfoRate = g('lfoRate') / sampleRate, shape = Math.round(g('lfoShape')), delay = g('lfoDelay') * sampleRate * 0.001;
        const vib = g('vib') / 1200, fmod = g('fmod');
        const cutoff = g('cutoff'), res = g('res'), k = res * 4, drive = 1 + g('drive') * 4, comp = 1 + res * 0.5;
        const fenv = g('fenv'), keyOct = (g('keytrack') * (pos - 60)) / 12;
        const baseHz = 440 * Math.pow(2, (pos + g('tune') + g('fine') / 100 - 69) / 12);
        const level = g('level') * (1 - g('vel') + g('vel') * velocity) * 2.2;
        const nyq = sampleRate * 0.45;
        let G = 0, G2 = 0, G3 = 0, G4 = 0, norm = 1;
        for (let i = 0; i < n; i++) {
          const a = amp.next(), f = fil.next(), pe = posEnv.next();
          // LFO, faded in over `delay` samples after the note
          lfoPhase += lfoRate; if (lfoPhase >= 1) { lfoPhase -= 1; seed = (seed * 1664525 + 1013904223) >>> 0; held = seed / 2147483648 - 1; }
          since++;
          const fade = delay > 0 ? Math.min(1, since / delay) : 1;
          const lfo = lfoAt(shape, lfoPhase, held) * fade;
          if ((i & (SUB_BLOCK - 1)) === 0) {
            const oct = fenv * f + keyOct + fmod * lfo + (cutOn ? cutIn[i] : 0);
            const hz = Math.min(nyq, Math.max(10, cutoff * Math.pow(2, oct)));
            const gg = Math.tan((Math.PI * hz) / sampleRate);
            G = gg / (1 + gg); G2 = G * G; G3 = G2 * G; G4 = G2 * G2;
            norm = 1 / (1 + k * G4);
          }
          const fm = Math.pow(2, (vib > 0 ? vib * lfo : 0) + (pitchOn ? pitchIn[i] : 0));
          const inc = Math.min(0.2, (baseHz * fm) / sampleRate);
          const sinc = Math.min(0.45, inc * ratio);
          let v = 0;
          if (sawL > 0 || pulseL > 0 || wtL > 0) {
            if (sawL > 0) v += sawL * sawAt(slave, sinc);
            if (pulseL > 0) {
              const pw = Math.max(0.05, Math.min(0.95, pw0 + pwLfo * lfo + pwEnv * f));
              v += pulseL * 0.8 * pulseAt(slave, sinc, pw);
            }
            if (wtL > 0) {
              let p = position + pAmt * pe + pLfo * 0.5 * lfo + (posOn ? posIn[i] : 0);
              p = p < 0 ? 0 : p > 1 ? 1 : p;
              const fp = p * (count - 1), kf = Math.min(count - 2, Math.floor(fp)), ff = fp - kf;
              const x = slave * FRAME, j = Math.floor(x), t = x - j, j1 = j + 1 >= FRAME ? 0 : j + 1;
              const b0 = kf * FRAME, b1 = b0 + FRAME;
              const wa = table[b0 + j] + (table[b0 + j1] - table[b0 + j]) * t;
              const wb = table[b1 + j] + (table[b1 + j1] - table[b1 + j]) * t;
              v += wtL * (wa + (wb - wa) * ff);
            }
          }
          if (subL > 0) {
            const sinc2 = inc / subDiv;
            v += subL * (subSine ? Math.sin(TWO_PI * subPhase) : pulseAt(subPhase, sinc2, 0.5) * 0.8);
          }
          subPhase += inc / subDiv; if (subPhase >= 1) subPhase -= 1;
          if (noiseL > 0) { seed = (seed * 1664525 + 1013904223) >>> 0; v += noiseL * (seed / 2147483648 - 1); }
          // advance the phases: the master wraps, and with sync restarts the slave from where the wrap landed
          master += inc;
          if (master >= 1) {
            master -= 1;
            slave = syncOn ? (master * ratio) % 1 : slave + sinc;
            if (!syncOn && slave >= 1) slave -= 1;
          } else {
            slave += sinc; if (slave >= 1) slave -= 1;
          }
          v = fold(v * 0.6, foldAmt);
          // ladder
          const hh = 1 - G;
          const S1 = hh * s[0], S2 = hh * s[1], S3 = hh * s[2], S4 = hh * s[3];
          const sigma = G3 * S1 + G2 * S2 + G * S3 + S4;
          const z = (v * comp * drive - k * sigma) * norm, z2 = z * z;
          const x1 = z > 3 ? 1 : z < -3 ? -1 : z * (27 + z2) / (27 + 9 * z2);
          const y1 = G * x1 + S1, y2 = G * y1 + S2, y3 = G * y2 + S3, y4 = G * y3 + S4;
          s[0] = flush(2 * y1 - s[0]); s[1] = flush(2 * y2 - s[1]); s[2] = flush(2 * y3 - s[2]); s[3] = flush(2 * y4 - s[3]);
          const out = (y4 * a * level) / drive;
          outL[i] = out; outR[i] = out;
        }
      },
    };
  },
};
