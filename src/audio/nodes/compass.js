// Compass: a vector synth with wave sequencing (see vectorcore.js for the diamond, the path and the lanes).
//
//   Sources    four lanes, A B C D, at the points of a diamond. Each lane is a wave sequence: a row of steps, each a wave
//              from the bank held for a number of song ticks and crossfaded into the next. A lane with one step is a plain
//              oscillator. `rate` is how fast the sequences run against the song, `smode` what they do at their end.
//   Vector     where the mix sits on the diamond. A drawn path moves it after each note starts (one trip takes `pathms`,
//              `pmode` says what happens at the end, `path` how far it is followed); `x` and `y` shift the whole thing,
//              and so do the x and y inputs.
//   Filter     a resonant low-pass, opened and closed by its own drawn envelope (`fenv` octaves over `ftime`).
//   Amplitude  a drawn envelope, `atime` long. With a sustain knot it waits there while the note is held.
//
// Monophonic, the last note wins; put it in front of `voices` for chords. Stereo out: `width` spreads A to the left and
// C to the right, so a move across the diamond is also a move across the speakers.
//
// Kept on the node (data): lanes (four lists of steps), path (the points), env.amp and env.filter (the drawings).
import { BezierEnvelope } from './bezierenv.js';
import { LowPassSvf } from './svf.js';
import { LanePlayer, LANES, cleanLanes, cleanPath, pathAt, diamondWeights } from './vectorcore.js';

// held at full, with a short fall when the note ends
export const DEFAULT_AMP = () => [{ x: 0, y: 0, l: null, r: [0, 0] }, { x: 0.02, y: 1, l: [0, 0], r: [0.1, 0], s: true }, { x: 1, y: 0, l: [-0.5, 0], r: null }];
// open at the start, closing over the note
export const DEFAULT_FILTER = () => [{ x: 0, y: 1, l: null, r: [0.05, -0.5] }, { x: 1, y: 0, l: [-0.55, 0], r: null }];

const SPEC = [
  { name: 'x', min: -1, max: 1, def: 0 },
  { name: 'y', min: -1, max: 1, def: 0 },
  { name: 'path', min: 0, max: 1, def: 1 },                  // how far the drawn path is followed
  { name: 'pathms', min: 10, max: 60000, def: 4000 },        // one trip along the path
  { name: 'pmode', min: 0, max: 2, def: 1, int: true },      // once, loop, back and forth
  { name: 'rate', min: 0.125, max: 8, def: 1 },              // speed of the wave sequences against the song
  { name: 'smode', min: 0, max: 2, def: 1, int: true },      // once, loop, back and forth
  { name: 'tune', min: -24, max: 24, def: 0 },               // semitones
  { name: 'fine', min: -100, max: 100, def: 0 },             // cents
  { name: 'atune', min: -24, max: 24, def: 0, int: true },   // semitones, per lane
  { name: 'btune', min: -24, max: 24, def: 0, int: true },
  { name: 'ctune', min: -24, max: 24, def: 0, int: true },
  { name: 'dtune', min: -24, max: 24, def: 0, int: true },
  { name: 'detune', min: 0, max: 50, def: 0 },               // cents the lanes are pulled apart
  { name: 'width', min: 0, max: 1, def: 0.3 },
  { name: 'glide', min: 0, max: 2000, def: 0 },              // ms
  { name: 'cutoff', min: 20, max: 20000, def: 20000 },       // Hz
  { name: 'res', min: 0, max: 1, def: 0.1 },
  { name: 'fenv', min: -8, max: 8, def: 0 },                 // octaves the filter drawing moves the cutoff, at its top
  { name: 'ftime', min: 5, max: 20000, def: 600 },           // ms, the length of the filter drawing
  { name: 'ftrack', min: 0, max: 1, def: 0 },                // how much the cutoff follows the note
  { name: 'atime', min: 5, max: 20000, def: 800 },           // ms, the length of the amplitude drawing
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const LANE_TUNE = ['atune', 'btune', 'ctune', 'dtune'];
const LANE_DETUNE = [-1, 0.33, 1, -0.33];   // how far `detune` moves each lane
const LANE_PAN = [-1, 0, 1, 0];             // where `width` puts each lane: A left, C right, B and D in the middle
const FILTER_EVERY = 16;                    // the cutoff is worked out again every so many samples

export default {
  type: 'compass',
  inputs: ['pitch', 'x', 'y'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'compass',
  editor: 'compass',
  kinds: { pitch: 'control', x: 'control', y: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected, data, clock }) {
    const pitchOn = connected[0], xOn = connected[1], yOn = connected[2];
    const amp = new BezierEnvelope(sampleRate, DEFAULT_AMP), filterEnv = new BezierEnvelope(sampleRate, DEFAULT_FILTER);
    amp.setDrawing(data?.env?.amp); filterEnv.setDrawing(data?.env?.filter);
    const players = LANES.map((_, i) => new LanePlayer(i));
    const setLanes = raw => cleanLanes(raw).forEach((steps, i) => players[i].setSteps(steps));
    setLanes(data?.lanes);
    let path = cleanPath(data?.path);
    const filterL = new LowPassSvf(sampleRate), filterR = new LowPassSvf(sampleRate);
    const position = [0, 0], target = new Float32Array(4), weights = new Float32Array(4), step = new Float32Array(4);
    const gainL = new Float32Array(4), gainR = new Float32Array(4);
    let note = 60, pitchNow = 60, velocity = 1, age = 0, fresh = true;

    return {
      get busy() { return !amp.idle; },
      // { type: 'env', slot: 'amp' | 'filter', points }, { type: 'lanes', points }, { type: 'path', points }
      message(msg) {
        if (msg.type === 'env' && msg.slot === 'amp') amp.setDrawing(msg.points);
        else if (msg.type === 'env' && msg.slot === 'filter') filterEnv.setDrawing(msg.points);
        else if (msg.type === 'lanes') setLanes(msg.points);
        else if (msg.type === 'path') path = cleanPath(msg.points);
      },
      note(msg) {
        if (msg.type === 'noteOn') {
          const fromSilence = amp.idle;
          if (fromSilence) { pitchNow = msg.note; filterL.reset(); filterR.reset(); fresh = true; }
          for (const player of players) player.start(!fromSilence);
          note = msg.note; velocity = msg.vel ?? 1; age = 0;
          amp.on(); filterEnv.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') { amp.off(); filterEnv.off(); }
        else if (msg.type === 'noteCut') { amp.cut(); filterEnv.cut(); }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.setTime(g('atime')); filterEnv.setTime(g('ftime'));

        // pitch
        const glideMs = g('glide');
        if (glideMs > 0.5) pitchNow += (note - pitchNow) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pitchNow = note;
        const bend = pitchOn ? inputs[0][0] * 12 : 0;   // the pitch input is in octaves
        const basePitch = pitchNow + g('tune') + g('fine') / 100 + bend, detune = g('detune') / 100;
        players.forEach((player, i) => {
          const semis = basePitch + g(LANE_TUNE[i]) + detune * LANE_DETUNE[i];
          player.tune((440 * Math.pow(2, (semis - 69) / 12)) / sampleRate);
        });

        // where the mix is on the diamond at the end of this block; the shares slide there from where they were
        pathAt(path, Math.round(g('pmode')), (age + n) / (g('pathms') * 0.001 * sampleRate), position);
        const follow = g('path');
        const x = g('x') + follow * position[0] + (xOn ? inputs[1][0] : 0), y = g('y') + follow * position[1] + (yOn ? inputs[2][0] : 0);
        diamondWeights(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)), target);
        if (fresh) { weights.set(target); fresh = false; }
        for (let k = 0; k < 4; k++) step[k] = (target[k] - weights[k]) / n;

        // each lane's place between the speakers (equal power)
        const width = g('width');
        for (let k = 0; k < 4; k++) {
          const angle = ((LANE_PAN[k] * width + 1) * Math.PI) / 4;
          gainL[k] = Math.cos(angle) * Math.SQRT2; gainR[k] = Math.sin(angle) * Math.SQRT2;
        }

        const seqMode = Math.round(g('smode')), ticksPerSample = g('rate') / (clock?.tickSamples ?? sampleRate * 0.125);
        const cutoff = g('cutoff') * Math.pow(2, (g('ftrack') * (pitchNow - 60)) / 12), resonance = g('res'), envOctaves = g('fenv');
        const level = g('level') * (1 - g('vel') + g('vel') * velocity);

        for (let i = 0; i < n; i++) {
          let left = 0, right = 0;
          for (let k = 0; k < 4; k++) {
            weights[k] += step[k];
            const sample = players[k].next(seqMode, ticksPerSample) * weights[k];
            left += sample * gainL[k]; right += sample * gainR[k];
          }
          const sweep = filterEnv.next();
          if (i % FILTER_EVERY === 0) {
            const hz = Math.min(20000, cutoff * Math.pow(2, envOctaves * sweep));
            filterL.set(hz, resonance); filterR.set(hz, resonance);
          }
          const loudness = amp.next() * level;
          outL[i] = filterL.next(left) * loudness; outR[i] = filterR.next(right) * loudness;
        }
        age += n;
      },
    };
  },
};
