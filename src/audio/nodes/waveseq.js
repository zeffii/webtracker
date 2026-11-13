// Wave seq: one wave sequence on its own, for building a patch by hand (see vectorcore.js for what a lane and its steps are).
// It is one of the four sources inside the compass synth. Silent until the first note, like `osc`; each note starts the
// sequence again from its first step. Follows the note when `track` is on, otherwise plays `freq`. `fm` moves the pitch,
// in octaves. Kept on the node (data): lanes, a list holding the one list of steps.
import { LanePlayer, cleanLanes } from './vectorcore.js';

const SPEC = [
  { name: 'freq', min: 1, max: 5000, def: 110 },           // Hz, used when track is 0
  { name: 'track', min: 0, max: 1, def: 1, int: true },
  { name: 'tune', min: -48, max: 48, def: 0 },             // semitones
  { name: 'fine', min: -100, max: 100, def: 0 },           // cents
  { name: 'rate', min: 0.125, max: 8, def: 1 },            // speed of the sequence against the song
  { name: 'smode', min: 0, max: 2, def: 1, int: true },    // once, loop, back and forth
  { name: 'level', min: 0, max: 1, def: 0.6 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'waveseq',
  inputs: ['fm'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'waveseq',
  editor: 'waveseq',
  kinds: { fm: 'control' },
  params: SPEC,
  create({ sampleRate, connected, data, clock }) {
    const fmOn = connected[0];
    const player = new LanePlayer(0);
    const setLanes = raw => player.setSteps(cleanLanes(raw, 1)[0]);
    setLanes(data?.lanes);
    let note = 60, started = false;
    return {
      message(msg) { if (msg.type === 'lanes') setLanes(msg.points); },
      note(msg) {
        if (msg.type === 'noteOn') { player.start(started); note = msg.note; started = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        if (!started) { out.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const semis = g('tune') + g('fine') / 100 + (fmOn ? inputs[0][0] * 12 : 0);
        const hz = (g('track') >= 0.5 ? 440 * Math.pow(2, (note - 69) / 12) : g('freq')) * Math.pow(2, semis / 12);
        player.tune(hz / sampleRate);
        const mode = Math.round(g('smode')), ticksPerSample = g('rate') / (clock?.tickSamples ?? sampleRate * 0.125), level = g('level');
        for (let i = 0; i < n; i++) out[i] = player.next(mode, ticksPerSample) * level;
      },
    };
  },
};
