// Range nodes: which port a range node feeds, and the limits of that port, so the node can speak in real values.
import { isLogSpec } from './kinds.js';

// The first parameter port that the node's output goes to: { node, param, spec, min, max, log, int } or null.
export function rangeTargetOf(desc, nodeTypes, id) {
  for (const [from, to] of desc.connections) {
    if (from !== `${id}.out`) continue;
    const [toId, toPort] = to.split('.');
    const b = desc.nodes.find(n => n.id === toId);
    if (!b || !toPort?.startsWith('@') || !nodeTypes[b.type]) continue;
    const spec = nodeTypes[b.type].params.find(p => p.name === toPort.slice(1));
    if (spec) return { node: toId, type: b.type, param: spec.name, spec, min: spec.min, max: spec.max, log: isLogSpec(spec), int: spec.int === true };
  }
  return null;
}

// A range node feeding several ports becomes one copy per wire (ids "id~2" ...; the copies share the original's parameters via
// `alias`), each scaled to its own port. The copy's inputs are wired the same as the original's.
export function expandRanges(desc, nodeTypes) {
  const outs = new Map();
  for (const n of desc.nodes) if (n.type === 'range') outs.set(n.id, desc.connections.filter(([f]) => f === `${n.id}.out`));
  if (![...outs.values()].some(l => l.length > 1)) return desc;
  const nodes = [...desc.nodes], connections = desc.connections.map(c => [...c]);
  for (const [id, links] of outs) {
    if (links.length < 2) continue;
    const src = desc.nodes.find(n => n.id === id);
    links.slice(1).forEach((link, k) => {
      const cid = `${id}~${k + 2}`;
      nodes.push({ ...src, id: cid, alias: src.alias ?? id });
      const at = connections.findIndex(c => c[0] === link[0] && c[1] === link[1]);
      connections[at][0] = `${cid}.out`;
      for (const [f, t] of desc.connections) if (t.split('.')[0] === id) connections.push([f, `${cid}.${t.split('.')[1]}`]);
    });
  }
  return { ...desc, nodes, connections };
}
