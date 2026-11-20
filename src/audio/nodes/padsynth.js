// Pad synth: a few harmonics, each smeared into a band of frequencies with random phases (the PADsynth idea), made into a table and
// played at the note's speed. The result has no edge and no two cycles alike: a slow, wide, evolving pad. The oscillator on its own,
// without the envelope, is the spread oscillator (spreadosc).
//   bandwidth  how far the first harmonic is smeared, in cents: narrow is a clear tone, wide is a choir or a wash
//   spread     how much more the higher harmonics are smeared (0 the same, 1 in proportion to the harmonic number)
//   tilt       dB per octave across the harmonics (negative darkens)
//   evenodd    -1 silences the even harmonics (hollow), +1 the odd ones
//   stretch    harmonic n sits at n * f * sqrt(1 + B n^2): 0 is harmonic, more is bell-like
//   harmonics  how many are used (1 to 64)
//   width      0 is mono, 1 the left and right tables (different random phases) as they are
//   motion     a slow wobble of each side's pitch against the other, up to 12 cents
// The table is chosen when a note starts, so changes to bandwidth to stretch are heard from the next note. Monophonic, last note wins,
// with glide.
import { Adsr } from './adsr.js';
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
  { name: 'glide', min: 0, max: 2000, def: 0 },
  { name: 'atk', min: 0.1, max: 5000, def: 900 },
  { name: 'dec', min: 1, max: 5000, def: 800 },
  { name: 'sus', min: 0, max: 1, def: 0.9 },
  { name: 'rel', min: 1, max: 5000, def: 1500 },
  { name: 'vel', min: 0, max: 1, def: 0.4 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'quality', min: 0, max: 2, def: 0, int: true },   // 0 standard, 1 eco (a shorter table), 2 high (a longer one)
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'padsynth',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }],
  shape: 'rounded',
  glyph: 'padsynth',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0];
    const amp = new Adsr(sampleRate), player = new SpreadPlayer(sampleRate);
    let note = 60, pos = 60, velocity = 1, fresh = true, tables = null, band = 0;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          if (amp.idle) { pos = msg.note; fresh = true; }   // (a note on a sounding voice only moves the pitch: the table stays)
          note = msg.note; velocity = msg.vel ?? 1;
          amp.on();
        } else if (msg.type === 'noteOff' || msg.type === 'allOff') amp.off();
        else if (msg.type === 'noteCut') amp.cut();
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (amp.idle) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        amp.set(g('atk'), g('dec'), g('sus'), g('rel'));
        const glideMs = g('glide');
        if (glideMs > 0.5) pos += (note - pos) * (1 - Math.exp(-n / (sampleRate * glideMs * 0.001 / 3)));
        else pos = note;
        if (fresh) {
          band = bandOf(note);
          tables = spreadTables(sampleRate, g('quality'), band, { bandwidth: g('bandwidth'), spread: g('spread'), tilt: g('tilt'), evenodd: g('evenodd'), stretch: g('stretch'), harmonics: g('harmonics') });
          player.restart();
          fresh = false;
        }
        const f0 = 440 * Math.pow(2, (pos + g('tune') - 69) / 12);
        const speed = (f0 * (pitchOn ? Math.pow(2, inputs[0][0]) : 1)) / bandPitch(band);
        player.render(tables, n, speed, g('motion'), g('width'), outL, outR);
        const level = g('level') * (1 - g('vel') + g('vel') * velocity);
        for (let i = 0; i < n; i++) { const e = amp.next() * level; outL[i] *= e; outR[i] *= e; }
      },
    };
  },
};
