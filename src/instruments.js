import { samplerPreset } from './presets.js';

// The sampler's pattern format is fixed by these lists. Each exposed entry becomes
// a column that writes the named node parameter (2hex, or 4hex with bits: 16).
// The command table gives the CCXXYY column its meaning; the ids are free to change.
export const samplerExposed = [
  { node: 'sampler', param: 'sample', label: 'Smp' },             // which sample of the instrument's list: 00 the first
  { node: 'sampler', param: 'offset', label: 'Off', bits: 16 },   // where the note starts: 0000 start, FFFF end
  { node: 'sampler', param: 'retrig', label: 'Rtg', bits: 16 },   // ticks between repeats: 1000 is one tick, 0 off
  { node: 'filter', param: 'cutoff', label: 'Cut', scale: 'log' },
  { node: 'filter', param: 'resonance', label: 'Res' },
  { node: 'delay', param: 'mix', label: 'Mix' },
  { node: 'delay', param: 'time', label: 'Time', bits: 16 },
];

export const samplerCommands = [
  { id: 0x01, node: 'filter', param: 'cutoff', scale: 'log' },
  { id: 0x02, node: 'filter', param: 'resonance' },
  { id: 0x03, node: 'delay', param: 'time' },
  { id: 0x04, node: 'delay', param: 'feedback' },
  { id: 0x05, node: 'delay', param: 'mix' },
  { id: 0x06, node: 'sampler', param: 'nnaFade' },
  // Repeats (Off and Rtg are columns); each stays set until written again. 07 repeats: how many (a count;
  // 0 until the note ends). 08 shift: how far each repeat's start moves (8000 none, above goes forward, below
  // back). 09 ramp: each repeat's volume multiplier (C000 is x1, 8000 halves it). 0A reverse: 1 plays backwards,
  // the offset then counting from the end.
  { id: 0x07, node: 'sampler', param: 'repeats' },
  { id: 0x08, node: 'sampler', param: 'shift' },
  { id: 0x09, node: 'sampler', param: 'ramp' },
  { id: 0x0A, node: 'sampler', param: 'reverse' },
  // 10 slice: start at a slice marker of the sample (set on the Samples screen), 0000 the first, 0001 the second
  // and so on, sorted by position. It wins over the Off column while it points at a marker; FFFF puts Off back in charge.
  { id: 0x10, node: 'sampler', param: 'slice' },
];

export const withParams = (graph, overrides) => ({
  ...graph,
  nodes: graph.nodes.map(n => (overrides[n.id] ? { ...n, params: { ...n.params, ...overrides[n.id] } } : n)),
});

// A bass drum built from nodes: a pitch envelope sweeps a sine oscillator down, and an
// amplitude envelope shapes it. The oscillator restarts its phase on every note, so every
// hit starts the same way. Played from note C-2.
export const kickGraph = {
  nodes: [
    { id: 'pitchEnv', type: 'env', params: { attack: 0.2, decay: 70, sustain: 0, release: 50, amount: 2.5 } },
    { id: 'osc', type: 'osc', params: { wave: 0, reset: 1, phase: 0.25 } },
    { id: 'ampEnv', type: 'env', params: { attack: 0.5, decay: 300, sustain: 0, release: 40 } },
    { id: 'vca', type: 'gain' },
    { id: 'out', type: 'out', params: { gain: 0.35 } },
  ],
  connections: [
    ['pitchEnv.out', 'osc.fm'],
    ['osc.out', 'vca.in'],
    ['ampEnv.out', 'vca.cv'],
    ['vca.out', 'out.in'],
  ],
};

export const instruments = {
  // Output gain is lowered so two lanes together stay under full scale.
  lead: {
    graph: withParams(samplerPreset, { out: { gain: 0.45 } }),
    layout: 2,
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },   // node id -> sample id
  },
  bass: {
    graph: withParams(samplerPreset, { filter: { cutoff: 500 }, delay: { mix: 0 }, out: { gain: 0.45 } }),
    layout: 2,
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },
  },
  kick: {
    graph: kickGraph,
    exposed: [
      { node: 'pitchEnv', param: 'amount', label: 'Pit' },
      { node: 'ampEnv', param: 'decay', label: 'Dec', scale: 'log' },
    ],
  },
};

// A new sampler instrument playing the given sample, with the same fixed pattern columns
// as the demo's sampler instruments.
export const newSamplerInstrument = sampleId => structuredClone({
  graph: withParams(samplerPreset, { out: { gain: 0.45 } }),
  layout: 2,
  exposed: samplerExposed,
  commands: samplerCommands,
  samples: { sampler: sampleId },
});

// Synth instruments: one synth node into out, with a few parameters exposed as pattern columns.
export const synthKinds = {
  subtractive: {
    label: 'Subtractive synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'subsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'cutoff', label: 'Cut', scale: 'log' },
        { node: 'synth', param: 'res', label: 'Res' },
        { node: 'synth', param: 'fenv', label: 'Env' },
        { node: 'synth', param: 'detune', label: 'Det' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'cutoff', scale: 'log' },
        { id: 0x02, node: 'synth', param: 'res' },
        { id: 0x03, node: 'synth', param: 'fenv' },
        { id: 0x04, node: 'synth', param: 'drive' },
        { id: 0x05, node: 'synth', param: 'glide' },
      ],
    }),
  },
  fm: {
    label: 'FM synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'fmsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 10 },
      noteColumns: 5,   // five note and velocity lanes
      exposed: [
        { node: 'synth', param: 'algo', label: 'Alg' },
        { node: 'synth', param: 'index', label: 'Idx' },
        { node: 'synth', param: 'fb', label: 'Fb' },
        { node: 'synth', param: 'ratio2', label: 'Rt2' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'index' },
        { id: 0x02, node: 'synth', param: 'fb' },
        { id: 0x03, node: 'synth', param: 'algo' },
        { id: 0x04, node: 'synth', param: 'glide' },
        { id: 0x05, node: 'synth', param: 'level2' },
        { id: 0x06, node: 'synth', param: 'level3' },
        { id: 0x07, node: 'synth', param: 'level4' },
        { id: 0x08, node: 'synth', param: 'ratio2' },
        { id: 0x09, node: 'synth', param: 'ratio3' },
        { id: 0x0A, node: 'synth', param: 'ratio4' },
      ],
    }),
  },
  wavetable: {
    label: 'Wavetable synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'wavetable' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'mix', label: 'Mix' },
        { node: 'synth', param: 'pamt', label: 'PAm' },
        { node: 'synth', param: 'source', label: 'Src' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'mix' },
        { id: 0x03, node: 'synth', param: 'source' },
        { id: 0x04, node: 'synth', param: 'pamt' },
        { id: 0x05, node: 'synth', param: 'pdec' },
        { id: 0x06, node: 'synth', param: 'lfoDepth' },
        { id: 0x07, node: 'synth', param: 'lfoRate' },
        { id: 0x08, node: 'synth', param: 'snap' },
        { id: 0x09, node: 'synth', param: 'glide' },
      ],
    }),
  },
  granular: {
    label: 'Granular synth',
    needsSample: true,   // plays the project's samples: the first one is listed when it is added
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'granular' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 4 },
      noteColumns: 2,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'size', label: 'Siz' },
        { node: 'synth', param: 'density', label: 'Den' },
        { node: 'synth', param: 'spray', label: 'Spr' },
        { node: 'synth', param: 'sample', label: 'Smp' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'size' },
        { id: 0x03, node: 'synth', param: 'density' },
        { id: 0x04, node: 'synth', param: 'spray' },
        { id: 0x05, node: 'synth', param: 'scan' },
        { id: 0x06, node: 'synth', param: 'pitchRand' },
        { id: 0x07, node: 'synth', param: 'reverse' },
        { id: 0x08, node: 'synth', param: 'spread' },
        { id: 0x09, node: 'synth', param: 'shape' },
        { id: 0x0A, node: 'synth', param: 'tune' },
      ],
    }),
  },
  spectral: {
    label: 'Spectral synth',
    needsSample: true,   // takes its timbre from the project's samples: the first one is listed when it is added
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'specsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'position', label: 'Pos' },
        { node: 'synth', param: 'contrast', label: 'Con' },
        { node: 'synth', param: 'blur', label: 'Blr' },
        { node: 'synth', param: 'sample', label: 'Smp' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'position' },
        { id: 0x02, node: 'synth', param: 'scan' },
        { id: 0x03, node: 'synth', param: 'blur' },
        { id: 0x04, node: 'synth', param: 'contrast' },
        { id: 0x05, node: 'synth', param: 'partials' },
        { id: 0x06, node: 'synth', param: 'tilt' },
        { id: 0x07, node: 'synth', param: 'evenodd' },
        { id: 0x08, node: 'synth', param: 'stretch' },
        { id: 0x09, node: 'synth', param: 'tune' },
      ],
    }),
  },
  string: {
    label: 'Plucked string',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'string' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'decay', label: 'Dec', scale: 'log' },
        { node: 'synth', param: 'damp', label: 'Dmp' },
        { node: 'synth', param: 'bright', label: 'Brt' },
        { node: 'synth', param: 'pos', label: 'Pos' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'decay', scale: 'log' },
        { id: 0x02, node: 'synth', param: 'damp' },
        { id: 0x03, node: 'synth', param: 'bright' },
        { id: 0x04, node: 'synth', param: 'pos' },
        { id: 0x05, node: 'synth', param: 'release' },
        { id: 0x06, node: 'synth', param: 'tune' },
      ],
    }),
  },
  additive: {
    label: 'Additive synth',
    make: () => ({
      graph: { nodes: [{ id: 'synth', type: 'addsynth' }, { id: 'poly', type: 'voices' }, { id: 'out', type: 'out', params: { gain: 0.5 } }], connections: [['synth.out', 'poly.in'], ['poly.out', 'out.in']], voices: 6 },
      noteColumns: 3,
      exposed: [
        { node: 'synth', param: 'tilt', label: 'Tlt' },
        { node: 'synth', param: 'evenodd', label: 'E/O' },
        { node: 'synth', param: 'stretch', label: 'Str' },
        { node: 'synth', param: 'hdecay', label: 'HDc' },
      ],
      commands: [
        { id: 0x01, node: 'synth', param: 'tilt' },
        { id: 0x02, node: 'synth', param: 'evenodd' },
        { node: 'synth', id: 0x03, param: 'stretch' },
        { id: 0x04, node: 'synth', param: 'hdecay' },
        { id: 0x05, node: 'synth', param: 'glide' },
      ],
    }),
  },
};
