// Spread oscillator: the sound source of the pad synth (padsynth) on its own, with no envelope, so it can go through any filter, amp
// and envelope you wire after it. A few harmonics, each smeared into a band of frequencies with random phases, made into a table
// and played at the note's speed. Silent until the first note; the last note sets the pitch.
// Settings are as the pad synth's (bandwidth, spread, tilt, evenodd, stretch, harmonics, width, motion); the table is chosen when a
// note starts, so changes to the first six are heard from the next note. `fm` bends the pitch, in octaves.
import { SpreadPlayer, bandOf, bandPitch, spreadTables } from './padcore.js';

const SPEC = [
  { name: 'bandwidth', min: 1, max: 400, def: 45 },
  { name: 'spread', min: 0, max: 2, def: 1 },
  { name: 'tilt', min: -12, max: 12, def: 0 },
  { name: 'evenodd', min: -1, max: 1, def: 0 },
  { name: 'stretch', min: 0, max: 1, def: 0 },
  { name: 'harmonics', min: 1, max: 64, def: 32, int: true },
  { name: 'width', min: 0, max: 1, def: 0.8 },
  { name: 'motion', min: 0, max: 1, def: 0.4 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'quality', min: 0, max: 2, def: 0, int: true },   // 0 standard, 1 eco (a shorter table), 2 high (a longer one)
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'spreadosc',
  inputs: ['fm'],   // octaves, per block
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'padsynth',
  kinds: { fm: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const fmOn = connected[0];
    const player = new SpreadPlayer(sampleRate);
    let note = 60, started = false, fresh = false, tables = null, band = 0;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { if (!started) fresh = true; note = msg.note; started = true; }
        else if (msg.type === 'noteCut') started = false;
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!started) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        if (fresh) {
          band = bandOf(note);
          tables = spreadTables(sampleRate, g('quality'), band, { bandwidth: g('bandwidth'), spread: g('spread'), tilt: g('tilt'), evenodd: g('evenodd'), stretch: g('stretch'), harmonics: g('harmonics') });
          player.restart();
          fresh = false;
        }
        const f0 = 440 * Math.pow(2, (note + g('tune') - 69) / 12);
        const speed = (f0 * (fmOn ? Math.pow(2, inputs[0][0]) : 1)) / bandPitch(band);
        player.render(tables, n, speed, g('motion'), g('width'), outL, outR);
        const level = g('level');
        for (let i = 0; i < n; i++) { outL[i] *= level; outR[i] *= level; }
      },
    };
  },
};
