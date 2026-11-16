// A message left on the graph for whoever opens the instrument next. It is only text: the node has no ports, makes no sound and the engine never
// hears of it. Its text and whether it is folded are kept in its data ({ text, open }); the graph view draws and edits it (graph/patcher.js).
export default {
  type: 'msg',
  inputs: [],
  outputs: [],
  category: 'Control',
  shape: 'box',
  msg: true,   // the graph view draws it as text, not as a tile
  params: [],
  create() { return { process() {} }; },
};
