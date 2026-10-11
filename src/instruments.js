import { samplerPreset } from './presets.js';

// The sampler's pattern format is fixed by this list. Each entry becomes a 2hex
// column that writes the named node parameter.
const samplerExposed = [
  { node: 'filter', param: 'cutoff', label: 'Cut', scale: 'log' },
  { node: 'filter', param: 'resonance', label: 'Res' },
  { node: 'delay', param: 'mix', label: 'Mix' },
];

const withParams = (graph, overrides) => ({
  ...graph,
  nodes: graph.nodes.map(n => (overrides[n.id] ? { ...n, params: { ...n.params, ...overrides[n.id] } } : n)),
});

export const instruments = {
  // Output gain is lowered so two lanes together stay under full scale.
  lead: { graph: withParams(samplerPreset, { out: { gain: 0.6 } }), exposed: samplerExposed },
  bass: { graph: withParams(samplerPreset, { filter: { cutoff: 500 }, delay: { mix: 0 }, out: { gain: 0.6 } }), exposed: samplerExposed },
};
