import { samplerPreset } from './presets.js';

// The sampler's pattern format is fixed by these lists. Each exposed entry becomes
// a column that writes the named node parameter (2hex, or 4hex with bits: 16).
// The command table gives the CCXXYY column its meaning; the ids are free to change.
export const samplerExposed = [
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
];

export const withParams = (graph, overrides) => ({
  ...graph,
  nodes: graph.nodes.map(n => (overrides[n.id] ? { ...n, params: { ...n.params, ...overrides[n.id] } } : n)),
});

// A bass drum built from nodes: a pitch envelope sweeps a sine oscillator down, and an
// amplitude envelope shapes it. The oscillator restarts its phase on every note, so every
// hit starts the same way. Played from note C-2.
const kickGraph = {
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
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },   // node id -> sample id
  },
  bass: {
    graph: withParams(samplerPreset, { filter: { cutoff: 500 }, delay: { mix: 0 }, out: { gain: 0.45 } }),
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
  exposed: samplerExposed,
  commands: samplerCommands,
  samples: { sampler: sampleId },
});
