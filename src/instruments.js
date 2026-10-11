import { samplerPreset } from './presets.js';

// The sampler's pattern format is fixed by these lists. Each exposed entry becomes
// a column that writes the named node parameter (2hex, or 4hex with bits: 16).
// The command table gives the CCXXYY column its meaning; the ids are free to change.
const samplerExposed = [
  { node: 'filter', param: 'cutoff', label: 'Cut', scale: 'log' },
  { node: 'filter', param: 'resonance', label: 'Res' },
  { node: 'delay', param: 'mix', label: 'Mix' },
  { node: 'delay', param: 'time', label: 'Time', bits: 16 },
];

const samplerCommands = [
  { id: 0x01, node: 'filter', param: 'cutoff', scale: 'log' },
  { id: 0x02, node: 'filter', param: 'resonance' },
  { id: 0x03, node: 'delay', param: 'time' },
  { id: 0x04, node: 'delay', param: 'feedback' },
  { id: 0x05, node: 'delay', param: 'mix' },
];

const withParams = (graph, overrides) => ({
  ...graph,
  nodes: graph.nodes.map(n => (overrides[n.id] ? { ...n, params: { ...n.params, ...overrides[n.id] } } : n)),
});

export const instruments = {
  // Output gain is lowered so two lanes together stay under full scale.
  lead: {
    graph: withParams(samplerPreset, { out: { gain: 0.6 } }),
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },   // node id -> sample id
  },
  bass: {
    graph: withParams(samplerPreset, { filter: { cutoff: 500 }, delay: { mix: 0 }, out: { gain: 0.6 } }),
    exposed: samplerExposed,
    commands: samplerCommands,
    samples: { sampler: 'pluck' },
  },
};
