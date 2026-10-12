// Edits to a graph description ({ nodes, connections }) and an instrument definition
// ({ graph, exposed, commands, samples }). Plain data in, plain data out, so the
// patcher UI and the tests drive the same functions.

const splitPort = ref => ref.split('.');

// Does a path of connections lead from node a to node b? (a reaches itself.)
function reaches(desc, a, b) {
  const seen = new Set();
  const stack = [a];
  while (stack.length) {
    const id = stack.pop();
    if (id === b) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const [from, to] of desc.connections) if (splitPort(from)[0] === id) stack.push(splitPort(to)[0]);
  }
  return false;
}

export function addNode(desc, nodeTypes, type, pos = { x: 20, y: 20 }) {
  const def = nodeTypes[type];
  if (!def) throw new Error(`Unknown node type "${type}".`);
  if (def.master && desc.nodes.some(n => nodeTypes[n.type].master)) throw new Error('There is already an out node.');
  let i = 1;
  while (desc.nodes.some(n => n.id === `${type}${i}`)) i++;
  const id = `${type}${i}`;
  desc.nodes.push({ id, type, x: pos.x, y: pos.y });
  return id;
}

export function removeNode(desc, nodeTypes, id) {
  const node = desc.nodes.find(n => n.id === id);
  if (!node) return false;
  if (nodeTypes[node.type].master) throw new Error('The out node cannot be removed.');
  desc.nodes = desc.nodes.filter(n => n.id !== id);
  desc.connections = desc.connections.filter(([from, to]) => splitPort(from)[0] !== id && splitPort(to)[0] !== id);
  return true;
}

// Connects an output port to an input port, replacing whatever fed that input.
export function connect(desc, nodeTypes, from, to) {
  const [fromId, fromPort] = splitPort(from), [toId, toPort] = splitPort(to);
  const a = desc.nodes.find(n => n.id === fromId), b = desc.nodes.find(n => n.id === toId);
  if (!a || !b) throw new Error('Unknown node.');
  if (!nodeTypes[a.type].outputs.includes(fromPort)) throw new Error(`"${fromId}" has no output "${fromPort}".`);
  if (!nodeTypes[b.type].inputs.includes(toPort)) throw new Error(`"${toId}" has no input "${toPort}".`);
  const rest = desc.connections.filter(([, t]) => t !== to);
  if (reaches({ ...desc, connections: rest }, toId, fromId)) throw new Error('That would make a loop.');
  desc.connections = [...rest, [from, to]];
}

export function disconnect(desc, from, to) {
  const before = desc.connections.length;
  desc.connections = desc.connections.filter(([f, t]) => !(f === from && t === to));
  return desc.connections.length !== before;
}

export function setParam(desc, nodeId, name, value) {
  const node = desc.nodes.find(n => n.id === nodeId);
  node.params = { ...node.params, [name]: value };
}

// Marks a node parameter as exposed to the pattern (a column) or not.
export function setExposed(def, nodeTypes, nodeId, param, on) {
  const node = def.graph.nodes.find(n => n.id === nodeId);
  const spec = nodeTypes[node.type].params.find(p => p.name === param);
  const at = def.exposed.findIndex(e => e.node === nodeId && e.param === param);
  if (!on) { if (at >= 0) def.exposed.splice(at, 1); return; }
  if (at >= 0) return;
  let label = param.slice(0, 3).replace(/^./, c => c.toUpperCase());
  while (def.exposed.some(e => e.label === label)) label = label.slice(0, 2) + (Number(label[2]) + 1 || 2);
  // Whole-number parameters (toggles, enums) get a 1hex column; the rest a 2hex one.
  def.exposed.push({
    node: nodeId, param, label,
    ...(spec.int ? { bits: 4 } : {}),
    ...(spec.min > 0 && spec.max / spec.min >= 50 ? { scale: 'log' } : {}),
  });
}

// Drops exposures, commands and sample mappings that point at nodes or parameters that
// no longer exist.
export function pruneDef(def, nodeTypes) {
  const has = (nodeId, param) => {
    const node = def.graph.nodes.find(n => n.id === nodeId);
    return node && (param === undefined || nodeTypes[node.type].params.some(p => p.name === param));
  };
  def.exposed = def.exposed.filter(e => has(e.node, e.param));
  if (def.commands) def.commands = def.commands.filter(c => has(c.node, c.param));
  if (def.samples) def.samples = Object.fromEntries(Object.entries(def.samples).filter(([id]) => has(id)));
}

// Gives every node without a position one, by how far it is from the sources.
export function autoLayout(desc, nodeTypes) {
  const depth = {};
  const visit = id => {
    if (depth[id] !== undefined) return depth[id];
    depth[id] = 0;   // guards against loops
    const feeds = desc.connections.filter(([, to]) => splitPort(to)[0] === id).map(([from]) => splitPort(from)[0]);
    depth[id] = feeds.length ? 1 + Math.max(...feeds.map(visit)) : 0;
    return depth[id];
  };
  const rows = {};
  for (const n of desc.nodes) {
    const d = visit(n.id);
    rows[d] = (rows[d] ?? 0) + 1;
    if (n.x === undefined || n.y === undefined) { n.x = 20 + d * 190; n.y = 20 + (rows[d] - 1) * 110; }
  }
}
