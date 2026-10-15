// What a port carries. Ports are audio unless the node type lists them in `kinds`.
// 'audio' and 'control' are mono buffers (control is for envelopes, lfos and triggers);
// 'stereo' is a left/right pair that travels on one wire.
//
// Two node-type flags make a port's kind depend on the graph:
//   stereoOptional: ['out']  the port is stereo when the node has `stereo: true` (a sampler
//                            whose sample has two channels)
//   dual: true               a mono node that runs as two copies, one per channel, when a
//                            stereo signal reaches one of its audio inputs; its audio
//                            ports are then stereo
export const portKind = (def, name, node) =>
  node?.stereo && def.stereoOptional?.includes(name) ? 'stereo' : def.kinds?.[name] ?? 'audio';

// Returns { kindOf(node, port), wide: Set of dual node ids that run as a stereo pair }.
export function resolveKinds(desc, nodeTypes) {
  const byId = new Map(desc.nodes.map(n => [n.id, n]));
  const links = desc.connections.map(([from, to]) => [...from.split('.'), ...to.split('.')]);
  const wide = new Set();
  const kindOf = (node, name) => {
    const def = nodeTypes[node.type], k = portKind(def, name, node);
    return k === 'audio' && wide.has(node.id) ? 'stereo' : k;
  };
  for (let changed = true; changed;) {   // the graph is acyclic, so this settles in at most one pass per node
    changed = false;
    for (const [fromId, fromPort, toId, toPort] of links) {
      const a = byId.get(fromId), b = byId.get(toId);
      if (!a || !b || !nodeTypes[b.type]?.dual || wide.has(toId)) continue;
      if (portKind(nodeTypes[b.type], toPort, b) === 'audio' && kindOf(a, fromPort) === 'stereo') { wide.add(toId); changed = true; }
    }
  }
  return { kindOf, wide };
}
