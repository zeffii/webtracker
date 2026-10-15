import { kickGraph, synthKinds } from '../instruments.js';

// The default project: an original synthwave sketch in A minor, eight bars at 110 bpm
// (Am F C G, twice), every sound made from synth nodes: a kick, a gated-reverb snare, a
// pulsing saw bass, a slow pad, a 16th-note arp and a sparse lead that joins for the second pass.

const TPB = 4, BAR = 16, BARS = 8;

// A subtractive synth instrument: the synth, its voices node, then the effect nodes in order.
const synth = (params, fx = [], { voices = 4, gain = 0.5 } = {}) => {
  const base = synthKinds.subtractive.make();
  const chain = [{ id: 'synth', type: 'subsynth', params }, { id: 'poly', type: 'voices' }, ...fx, { id: 'out', type: 'out', params: { gain } }];
  base.graph = { nodes: chain, connections: chain.slice(0, -1).map((n, i) => [`${n.id}.out`, `${chain[i + 1].id}.in`]), voices };
  return base;
};

const instruments = {
  kick: {
    graph: { ...kickGraph, nodes: kickGraph.nodes.map(n => (n.id === 'out' ? { ...n, params: { gain: 0.42 } } : n)) },
    exposed: [
      { node: 'pitchEnv', param: 'amount', label: 'Pit' },
      { node: 'ampEnv', param: 'decay', label: 'Dec', scale: 'log' },
    ],
  },
  // noise through a low-pass plus a short triangle body, into a small hall for the gated tail
  snare: {
    ...synth(
      { wave1: 2, osc2: 0, noise: 0.85, cutoff: 7500, res: 0.1, drive: 0.3, fenv: 0, keytrack: 0, atk: 0.5, dec: 150, sus: 0, rel: 70, fatk: 0.5, fdec: 60, fsus: 1, frel: 50, vel: 0.3, level: 0.9 },
      [{ id: 'hall', type: 'hall', params: { size: 0.7, decay: 1.1, damp: 0.5, predelay: 0, mix: 0.28 } }],
      { voices: 3, gain: 1.0 },
    ),
    noteColumns: 1,
  },
  bass: {
    ...synth(
      { wave1: 0, wave2: 0, osc2: 0.5, detune: 6, sub: 0.6, cutoff: 380, res: 0.25, drive: 0.35, fenv: 2.6, keytrack: 0.3, fatk: 0.5, fdec: 130, fsus: 0.2, frel: 60, atk: 1, dec: 130, sus: 0.4, rel: 50, vel: 0.5, level: 0.5 },
      [], { voices: 2, gain: 0.72 },
    ),
    noteColumns: 1,
  },
  pad: {
    ...synth(
      { wave1: 0, wave2: 0, osc2: 0.8, detune: 9, unison: 4, spread: 22, width: 0.9, cutoff: 1500, res: 0.15, drive: 0.1, fenv: 1.5, keytrack: 0.4, fatk: 400, fdec: 900, fsus: 0.5, frel: 600, atk: 350, dec: 800, sus: 0.8, rel: 700, vel: 0.2, level: 0.2 },
      [{ id: 'chorus', type: 'chorus', params: { rate: 0.4, depth: 5, mix: 0.45 } }, { id: 'hall', type: 'hall', params: { decay: 3.5, mix: 0.3 } }],
      { voices: 6, gain: 0.5 },
    ),
    noteColumns: 3,
  },
  arp: {
    ...synth(
      { wave1: 0, wave2: 1, pw: 0.4, osc2: 0.5, detune: 6, unison: 2, cutoff: 2200, res: 0.3, drive: 0.15, fenv: 3.5, keytrack: 0.5, fatk: 0.5, fdec: 160, fsus: 0.15, frel: 90, atk: 1, dec: 180, sus: 0.1, rel: 120, vel: 0.5, level: 0.3 },
      [{ id: 'delay', type: 'delay', params: { time: 409, feedback: 0.4, mix: 0.3 } }, { id: 'hall', type: 'hall', params: { decay: 2.5, mix: 0.2 } }],
      { voices: 4, gain: 1.0 },
    ),
    noteColumns: 1,
  },
  lead: {
    ...synth(
      { wave1: 0, wave2: 0, osc2: 0.7, detune: 8, unison: 3, spread: 14, cutoff: 3200, res: 0.2, drive: 0.2, fenv: 1, keytrack: 0.6, fatk: 5, fdec: 500, fsus: 0.6, frel: 300, atk: 8, dec: 400, sus: 0.7, rel: 300, glide: 60, vel: 0.3, level: 0.3 },
      [
        { id: 'chorus', type: 'chorus', params: { mix: 0.3 } },
        { id: 'delay', type: 'delay', params: { time: 409, feedback: 0.35, mix: 0.25 } },
        { id: 'hall', type: 'hall', params: { decay: 3, mix: 0.3 } },
      ],
      { voices: 2, gain: 0.8 },
    ),
    noteColumns: 1,
  },
};

// ---- patterns: a pattern is 16 rows, written as a map from row to its cells ----
const text = cells => Array.from({ length: BAR }, (_, i) => cells[i] ?? '... ..').join('\n');
const hex = n => Math.round(n).toString(16).toUpperCase().padStart(2, '0');

const chords = [
  { root: 'A-1', bass: 'A-1', up: 'A-2', pad: ['A-3', 'C-4', 'E-4'], arp: ['A-4', 'C-5', 'E-5', 'A-5'] },
  { root: 'F-1', bass: 'F-1', up: 'F-2', pad: ['F-3', 'A-3', 'C-4'], arp: ['F-4', 'A-4', 'C-5', 'F-5'] },
  { root: 'C-2', bass: 'C-2', up: 'C-3', pad: ['G-3', 'C-4', 'E-4'], arp: ['C-5', 'E-5', 'G-5', 'C-6'] },
  { root: 'G-1', bass: 'G-1', up: 'G-2', pad: ['G-3', 'B-3', 'D-4'], arp: ['G-4', 'B-4', 'D-5', 'G-5'] },
];
const names = ['am', 'f', 'c', 'g'];

const bassPattern = c => text(Object.fromEntries(Array.from({ length: BAR }, (_, i) =>
  [i, `${i === 14 ? c.up : c.bass} ${hex([0xE0, 0x70, 0x90, 0x70][i % 4])}`])));
const padPattern = c => text({ 0: `${c.pad[0]} 70 ${c.pad[1]} 70 ${c.pad[2]} 70` });
const ARP_STEPS = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 1];
const arpPattern = c => text(Object.fromEntries(ARP_STEPS.map((s, i) => [i, `${c.arp[s]} ${hex([0xD0, 0x60, 0x90, 0x60][i % 4])}`])));

const leadLines = [   // [row, cell] per chord
  [[0, 'E-5 A0'], [6, 'D-5 90'], [8, 'C-5 A0'], [12, '=== ..']],
  [[0, 'A-4 A0'], [6, 'C-5 90'], [8, 'F-5 B0'], [14, '=== ..']],
  [[0, 'E-5 A0'], [6, 'D-5 90'], [8, 'C-5 A0'], [12, 'G-4 90']],
  [[0, 'B-4 A0'], [6, 'D-5 90'], [8, 'G-5 B0'], [14, '=== ..']],
];
const leadPattern = (line, last) => text(Object.fromEntries(line.map(([r, c]) => [r, last && r === 8 ? 'D-5 A0' : c])));

const place = (puid, bar, bars = 1) => Array.from({ length: bars }, (_, i) => ({ puid, start: (bar + i) * BAR, length: BAR }));
const perChord = (prefix, first, bars) => Array.from({ length: bars }, (_, i) => place(`${prefix}${names[(first + i) % 4]}`, first + i)[0]);
const patternsFor = (prefix, make) => Object.fromEntries(chords.map((c, i) => [`${prefix}${names[i]}`, { text: make(c, i) }]));

const kickRows = text({ 0: 'C-2 .. .. ..', 4: 'C-2', 8: 'C-2', 12: 'C-2' });
const snareRows = text({ 4: 'G-3 B0', 12: 'G-3 B0' });
const snareFill = text({ 4: 'G-3 B0', 12: 'G-3 A0', 13: 'G-3 90', 14: 'G-3 C0', 15: 'G-3 F0' });

export const song = {
  name: 'synthwave',
  bpm: 110,
  ticksPerBeat: TPB,
  length: BARS * BAR,
  lanes: [
    { id: 'kick', instrument: 'kick', patterns: { four: { text: kickRows } }, placements: place('four', 0, BARS) },
    {
      id: 'snare', instrument: 'snare',
      patterns: { back: { text: snareRows }, fill: { text: snareFill } },
      placements: [...place('back', 1, 6), ...place('fill', 7)],
    },
    { id: 'bass', instrument: 'bass', patterns: patternsFor('b', bassPattern), placements: perChord('b', 0, BARS) },
    { id: 'pad', instrument: 'pad', patterns: patternsFor('p', padPattern), placements: perChord('p', 0, BARS) },
    { id: 'arp', instrument: 'arp', patterns: patternsFor('a', arpPattern), placements: perChord('a', 2, 6) },
    {
      id: 'lead', instrument: 'lead',
      patterns: Object.fromEntries(chords.map((_, i) => [`l${names[i]}`, { text: leadPattern(leadLines[i], i === 3) }])),
      placements: perChord('l', 0, 4).map((p, i) => ({ ...p, start: (4 + i) * BAR })),
    },
  ],
};

export const createSynthwaveProject = () => ({
  song: structuredClone(song),
  instruments: structuredClone(instruments),
  samples: {},
});
