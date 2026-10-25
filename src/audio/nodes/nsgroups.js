// The Node Sequencer's group switches as a machine of their own: eight on-off values a pattern lane can write, which start and stop the groups of
// nodes in the Node Sequencer's graph (a 1 starts a group, a 0 stops it; see audio/nodeseq.js). It has no ports and makes no sound.
export const GROUPS = 8;
export default {
  type: 'nsgroups',
  hidden: true,   // made by the Node Sequencer view, not something to add to a graph
  inputs: [],
  outputs: [],
  category: 'Control',
  shape: 'box',
  params: Array.from({ length: GROUPS }, (_, i) => ({ name: `g${i + 1}`, min: 0, max: 1, def: 1, int: true })),
  create() { return { process() {} }; },
};
