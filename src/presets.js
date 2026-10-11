// The preset instrument: sampler -> filter -> delay -> out, as a plain graph.
export const samplerPreset = {
  nodes: [
    { id: 'sampler', type: 'sampler' },
    { id: 'filter', type: 'filter', params: { cutoff: 3000, resonance: 0.3 } },
    { id: 'delay', type: 'delay' },
    { id: 'out', type: 'out' },
  ],
  connections: [
    ['sampler.out', 'filter.in'],
    ['filter.out', 'delay.in'],
    ['delay.out', 'out.in'],
  ],
};
