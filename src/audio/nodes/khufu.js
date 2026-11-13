// Khufu: the voice of a string machine. One sawtooth per register, all cut from the same running phase the way a
// divide-down organ makes its octaves, so the registers of a note never drift against each other:
//   low    an octave under the note        mid    the note        high   an octave above it
// The mix goes through a low cut and a gentle low-pass (`tone`), and a drawn amplitude envelope, `atime` long, shapes
// each note: the slow bow-like rise and the long release are the instrument. A slow vibrato is built in.
//
// Monophonic, the last note wins: put it in front of `voices` for chords, and put an `ensemble` after the voices. The
// voice on its own is plain on purpose; the ensemble is what turns it into strings.
// Kept on the node (data): env.amp, the amplitude drawing.
import { BezierEnvelope } from './bezierenv.js';
import { LowPassSvf } from './svf.js';

// a slow rise, held, and a long fall when the note ends
export const DEFAULT_AMP = () => [{ x: 0, y: 0, l: null, r: [0.08, 0.5] }, { x: 0.25, y: 1, l: [-0.1, 0], r: [0.1, 0], s: true }, { x: 1, y: 0, l: [-0.5, 0], r: null }];

export const REGISTERS = [
  { name: 'low', octave: 0 },    // the running phase itself is the low register
  { name: 'mid', octave: 1 },
  { name: 'high', octave: 2 },
];

const SPEC = [
  { name: 'low', min: 0, max: 1, def: 0.3 },
  { name: 'mid', min: 0, max: 1, def: 1 },
  { name: 'high', min: 0, max: 1, def: 0.6 },
  { name: 'tone', min: 300, max: 16000, def: 5000 },     // Hz, the low-pass
  { name: 'lowcut', min: 20, max: 1000, def: 120 },      // Hz
  { name: 'vib', min: 0, max: 50, def: 4 },              // cents of vibrato
  { name: 'vibrate', min: 0.5, max: 10, def: 5.2 },      // Hz
  { name: 'tune', min: -24, max: 24, def: 0 },           // semitones
  { name: 'fine', min: -100, max: 100, def: 0 },         // cents
  { name: 'atime', min: 5, max: 20000, def: 1200 },      // ms, the length of the amplitude drawing
  { name: 'vel', min: 0, max: 1, def: 0.3 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// A falling sawtooth at `phase` (0 to 1) whose jump is rounded over one sample either side (polyBLEP), so it does not alias.
// inc: how far the phase moves per sample.
export function cleanSaw(phase, inc) {
  let value = 1 - 2 * phase;
  if (phase < inc) { const t = phase / inc; value -= t + t - t * t - 1; }
  else if (phase > 1 - inc) { const t = (phase - 1) / inc; value -= t * t + t + t + 1; }
  return value;
}

// The registers added up as they are drawn in the panel: plain saws, no rounding and no filters. levels: [low, mid, high].
export function registerMix(phase, levels) {
  let sum = 0;
  REGISTERS.forEach((register, i) => { const p = (phase * (1 << register.octave)) % 1; sum += (1 - 2 * p) * levels[i]; });
  return sum;
}

export default {
  type: 'khufu',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'khufu',
  editor: 'khufu',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data }) {
    const pitchOn = connected[0];
    const amp = new BezierEnvelope(sampleRate, DEFAULT_AMP);
    amp.setDrawing(data?.env?.amp);
    const tone = new LowPassSvf(sampleRate);
    let phase = 0, vibPhase = 0, cutState = 0, note = 60, velocity = 1;
    return {
      get busy() { return !amp.idle; },
      message(msg) { if (msg.type === 'env' && msg.slot === 'amp') amp.setDrawing(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { tone.reset(); cutState = 0; }
          note = msg.note; velocity = msg.vel ?? 1;
          amp.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') amp.off();
        else if (msg.type === 'noteCut') amp.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.setTime(g('atime'));
        tone.set(g('tone'), 0.15);
        const cut = 1 - Math.exp((-2 * Math.PI * g('lowcut')) / sampleRate);
        const levels = [g('low'), g('mid'), g('high')];
        const semis = note + g('tune') + g('fine') / 100 + (pitchOn ? inputs[0][0] * 12 : 0);
        const lowHz = 440 * Math.pow(2, (semis - 12 - 69) / 12);   // the running phase is the low register, an octave under the note
        const vibDepth = g('vib') / 1200, vibInc = g('vibrate') / sampleRate;
        const loudness = g('level') * (1 - g('vel') + g('vel') * velocity) * 0.35;
        for (let i = 0; i < n; i++) {
          vibPhase += vibInc; if (vibPhase >= 1) vibPhase -= 1;
          const inc = Math.min(0.11, (lowHz * Math.pow(2, vibDepth * Math.sin(2 * Math.PI * vibPhase))) / sampleRate);
          phase += inc; if (phase >= 1) phase -= 1;
          let mix = 0;
          for (let r = 0; r < 3; r++) {
            if (levels[r] <= 0) continue;
            const times = 1 << REGISTERS[r].octave, p = phase * times;
            mix += cleanSaw(p - Math.floor(p), inc * times) * levels[r];
          }
          cutState += (mix - cutState) * cut;   // the low cut: what is left after the slow part is taken away
          const value = tone.next(mix - cutState) * amp.next() * loudness;
          outL[i] = value; outR[i] = value;
        }
      },
    };
  },
};
