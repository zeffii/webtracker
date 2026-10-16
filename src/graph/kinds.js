// What a port carries. Ports are audio unless the node type lists them in `kinds`.
// 'audio', 'control' and 'param' are mono buffers (control is for envelopes, lfos and triggers; param is what a ctrl
// node sends into a parameter port, drawn in its own colour);
// 'stereo' is a left/right pair that travels on one wire.
//
// Two node-type flags make a port's kind depend on the graph:
//   stereoOptional: ['out']  the port is stereo when the node has `stereo: true` (a sampler
//                            whose sample has two channels)
//   dual: true               a mono node that runs as two copies, one per channel, when a
//                            stereo signal reaches one of its audio inputs; its audio
//                            ports are then stereo
export const portKind = (def, name, node) =>
  name.startsWith('@') ? 'param' : node?.stereo && def.stereoOptional?.includes(name) ? 'stereo' : def.kinds?.[name] ?? 'audio';

// A node's input ports: those of its type, then one for each parameter it has been given a port for
// (node.ports, a list of parameter names). A parameter port is named '@name' and carries a control signal from 0 to 1
// (a ctrl node's output) that is mapped onto the parameter's own range, on its own scale; while a wire is
// connected it replaces the value of the parameter's slider.
export const inputsOf = (node, def) => (node?.ports?.length ? [...def.inputs, ...node.ports.map(p => `@${p}`)] : def.inputs);

// Whether a wide positive range is logarithmic (the patcher's sliders and the exposed pattern columns use the same rule).
export const isLogSpec = spec => spec.min > 0 && spec.max / spec.min >= 50;

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
