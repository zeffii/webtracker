// How late a sound comes out of a node, and out of a whole graph.
//
// A node type that delays its sound (a spectral effect works in frames, an oversampled one filters up and down) says so with
//
//   latency: (p, sampleRate) => samples
//
// where `p` holds the node's settings by name (what the user set, or the default). A type with no `latency` adds none.
// The delay of a graph is the longest path from any source to its output node, counting audio wires only (a control wire
// carries a slow signal, and what it controls does not come out later).
import { Oversampler } from './nodes/oversample.js';

// The delay in samples of the half-band filters for an oversampling factor of 1, 2 or 4.
export const oversampleLatency = factor => new Oversampler(factor).latency;

// The settings of a node by name: the defaults, then what the graph description sets.
export function settingsOf(node, def) {
  const p = {};
  for (const spec of def.params) p[spec.name] = node.params?.[spec.name] ?? spec.def;
  return p;
}

export const nodeLatency = (node, def, sampleRate) => Math.max(0, def.latency ? Math.round(def.latency(settingsOf(node, def), sampleRate)) : 0);

// For every node in a graph description, the delay in samples of what comes out of it, and the delay of the whole graph
// at its master node. Returns { total, at: Map(id -> samples) }.
export function graphLatency(desc, nodeTypes, sampleRate) {
  const byId = new Map(desc.nodes.map(n => [n.id, n]));
  const incoming = new Map(desc.nodes.map(n => [n.id, []]));
  for (const [from, to] of desc.connections) {
    const [fromId, fromPort] = from.split('.'), [toId] = to.split('.');
    const a = byId.get(fromId), b = byId.get(toId);
    if (!a || !b) continue;
    const kind = nodeTypes[a.type]?.kinds?.[fromPort];
    if (kind === 'control' || kind === 'param') continue;
    incoming.get(toId).push(fromId);
  }
  const at = new Map(), busy = new Set();
  const arrival = id => {
    if (at.has(id)) return at.get(id);
    if (busy.has(id)) return 0;   // a loop: compile() reports it; here it just stops
    busy.add(id);
    const node = byId.get(id), def = nodeTypes[node.type];
    const before = Math.max(0, ...incoming.get(id).map(arrival));
    busy.delete(id);
    const total = before + (def ? nodeLatency(node, def, sampleRate) : 0);
    at.set(id, total);
    return total;
  };
  for (const id of byId.keys()) arrival(id);
  const master = desc.nodes.find(n => nodeTypes[n.type]?.master);
  return { total: master ? at.get(master.id) : Math.max(0, ...at.values()), at };
}
