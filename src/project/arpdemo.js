import { synth, instruments as base } from './synthwave.js';

// A techno sketch built around the arp node: 32 bars at 128 bpm in A minor (Am Am F G, eight times). Three instruments
// carry an arp: a trance line (up/down+ over two octaves), an offbeat chord stab (chord mode, the offbeat mask) and an
// acid line (up over two octaves, a gallop mask). Each plays a held chord written into its note columns, and the arp
// does the rest. Open it with ?demo=arp on the page's address.

const TPB = 4, BAR = 16, BARS = 32;
const hex = n => Math.round(n).toString(16).toUpperCase().padStart(2, '0');
const text = cells => Array.from({ length: BAR }, (_, i) => cells[i] ?? '... ..').join('\n');

// An instrument with an arp in its graph: the arp has no wires, it only needs to be there.
const withArp = (def, arp, mask) => {
  def.graph = { ...def.graph, nodes: [...def.graph.nodes.slice(0, -1), { id: 'arp', type: 'arp', x: 330, y: 170, params: arp, data: { gate: mask } }, def.graph.nodes.at(-1)] };
  return def;
};

const trance = withArp({
  ...synth(
    { wave1: 0, wave2: 1, pw: 0.45, osc2: 0.5, detune: 7, unison: 2, spread: 14, cutoff: 2600, res: 0.25, drive: 0.15, fenv: 2.5, keytrack: 0.5, fatk: 0.5, fdec: 140, fsus: 0.25, frel: 80, atk: 1, dec: 170, sus: 0.15, rel: 90, vel: 0.5, level: 0.3 },
    [{ id: 'delay', type: 'delay', params: { time: 351, feedback: 0.42, mix: 0.28 } }, { id: 'hall', type: 'hall', params: { decay: 2.6, mix: 0.2 } }],
    { voices: 6, gain: 1.0 },
  ),
  noteColumns: 3,
}, { mode: 4, rate: 4, gate: 0.55, octaves: 2, retrigger: 1, humanize: 0.15 },
[1, 0.55, 0.8, 0.55, 1, 0.55, 0.8, 0.55, 1, 0.55, 0.8, 0.55, 1, 0.55, 0.8, 0.55]);

const stab = withArp({
  ...synth(
    { wave1: 0, wave2: 0, osc2: 0.6, detune: 12, unison: 3, spread: 22, width: 0.8, cutoff: 1800, res: 0.2, drive: 0.2, fenv: 2, keytrack: 0.5, fatk: 0.5, fdec: 120, fsus: 0.2, frel: 80, atk: 1, dec: 150, sus: 0.1, rel: 100, vel: 0.4, level: 0.26 },
    [{ id: 'delay', type: 'delay', params: { time: 351, feedback: 0.5, mix: 0.35 } }, { id: 'hall', type: 'hall', params: { decay: 3, mix: 0.3 } }],
    { voices: 6, gain: 0.9 },
  ),
  noteColumns: 3,
}, { mode: 13, rate: 4, gate: 0.3, retrigger: 1 },
[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]);

const acid = withArp({
  ...synth(
    { wave1: 0, wave2: 0, osc2: 0, sub: 0.3, cutoff: 650, res: 0.6, drive: 0.5, fenv: 4, keytrack: 0.2, fatk: 0.5, fdec: 190, fsus: 0.05, frel: 60, atk: 1, dec: 160, sus: 0.3, rel: 40, vel: 0.5, level: 0.4 },
    [], { voices: 2, gain: 0.7 },
  ),
  noteColumns: 2,
}, { mode: 0, rate: 4, gate: 0.4, octaves: 2, retrigger: 4, offset: 0 },
[1, 0, 0.6, 1, 0.8, 0, 0.6, 1, 0.8, 0, 0.6, 1, 0.8, 0, 0.6, 0.5]);

const hat = synth(
  { wave1: 2, osc2: 0, noise: 1, cutoff: 11000, res: 0.05, drive: 0, fenv: 0, keytrack: 0, atk: 0.5, dec: 40, sus: 0, rel: 25, vel: 0.5, level: 0.4 },
  [], { voices: 2, gain: 0.4 },
);

const instruments = { kick: base.kick, snare: base.snare, hat: { ...hat, noteColumns: 1 }, bass: base.bass, trance, stab, acid };

// chords per bar of a four-bar loop
const PROG = [
  { bass: 'A-1', trance: ['A-3', 'C-4', 'E-4'], stab: ['A-4', 'C-5', 'E-5'], acid: ['A-2', 'E-3'] },
  { bass: 'A-1', trance: ['A-3', 'C-4', 'E-4'], stab: ['A-4', 'C-5', 'E-5'], acid: ['A-2', 'E-3'] },
  { bass: 'F-1', trance: ['F-3', 'A-3', 'C-4'], stab: ['F-4', 'A-4', 'C-5'], acid: ['F-2', 'C-3'] },
  { bass: 'G-1', trance: ['G-3', 'B-3', 'D-4'], stab: ['G-4', 'B-4', 'D-5'], acid: ['G-2', 'D-3'] },
];
const names = ['a', 'a2', 'f', 'g'];
const chordText = (notes, vel) => text({ 0: notes.map(n => `${n} ${vel}`).join(' ') });
const perChord = key => Object.fromEntries(PROG.map((c, i) => [names[i], { text: chordText(c[key], 'C0') }]));
const bassText = c => text(Object.fromEntries([2, 6, 10, 14].map(r => [r, `${c.bass} ${hex(r === 14 ? 0xB0 : 0xA0)}`])));

const place = (puid, bar, bars = 1) => Array.from({ length: bars }, (_, i) => ({ puid, start: (bar + i) * BAR, length: BAR }));
// a pattern per chord for bars [from, to)
const chords = (from, to) => Array.from({ length: to - from }, (_, i) => place(names[(from + i) % 4], from + i)[0]);

const kickRows = text({ 0: 'C-2', 4: 'C-2', 8: 'C-2', 12: 'C-2' });
const clapRows = text({ 4: 'G-3 B0', 12: 'G-3 B0' });
const hatRows = text({ 2: 'C-4 90', 6: 'C-4 90', 10: 'C-4 90', 14: 'C-4 90', 3: 'C-4 40', 7: 'C-4 40', 11: 'C-4 40', 15: 'C-4 50' });

const section = (puid, ranges) => ranges.flatMap(([a, b]) => place(puid, a, b - a));

export const song = {
  name: 'arp demo',
  bpm: 128,
  ticksPerBeat: TPB,
  length: BARS * BAR,
  lanes: [
    { id: 'kick', instrument: 'kick', patterns: { four: { text: kickRows } }, placements: section('four', [[0, 16], [20, 32]]) },
    { id: 'hat', instrument: 'hat', patterns: { off: { text: hatRows } }, placements: section('off', [[0, 16], [20, 32]]) },
    { id: 'clap', instrument: 'snare', patterns: { back: { text: clapRows } }, placements: section('back', [[8, 16], [20, 32]]) },
    {
      id: 'bass', instrument: 'bass',
      patterns: Object.fromEntries(PROG.map((c, i) => [names[i], { text: bassText(c) }])),
      placements: [...chords(0, 16), ...chords(20, 32)],
    },
    { id: 'trance', instrument: 'trance', patterns: perChord('trance'), placements: [...chords(4, 20), ...chords(24, 32)] },
    { id: 'stab', instrument: 'stab', patterns: perChord('stab'), placements: [...chords(12, 20), ...chords(24, 32)] },
    { id: 'acid', instrument: 'acid', patterns: perChord('acid'), placements: [...chords(16, 20), ...chords(20, 32)] },
  ],
};

export const createArpDemoProject = () => ({
  song: structuredClone(song),
  instruments: structuredClone(instruments),
  samples: {},
});
