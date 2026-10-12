// Graph description -> compiled graph (plain data the audio thread can run).
//
// desc = {
//   nodes: [{ id, type, params?: { name: value } }],
//   connections: [['sampler.out', 'filter.in'], ...],
// }
// Buffer 0 is reserved as silence for unconnected inputs.
export function compile(desc, { instrument, nodeTypes, registry }) {
  const byId = new Map();
  for (const n of desc.nodes) {
    if (byId.has(n.id)) throw new Error(`duplicate node id "${n.id}"`);
    const def = nodeTypes[n.type];
    if (!def) throw new Error(`unknown node type "${n.type}"`);
    for (const name of Object.keys(n.params ?? {})) {
      if (!def.params.some(p => p.name === name)) {
        throw new Error(`node "${n.id}" has no parameter "${name}"`);
      }
    }
    byId.set(n.id, { ...n, def });
  }

  const links = desc.connections.map(([from, to]) => {
    const [fromId, fromPort] = from.split('.'), [toId, toPort] = to.split('.');
    const a = byId.get(fromId), b = byId.get(toId);
    if (!a) throw new Error(`unknown node "${fromId}" in connection ${from} -> ${to}`);
    if (!b) throw new Error(`unknown node "${toId}" in connection ${from} -> ${to}`);
    const outPort = a.def.outputs.indexOf(fromPort), inPort = b.def.inputs.indexOf(toPort);
    if (outPort < 0) throw new Error(`"${fromId}" has no output "${fromPort}"`);
    if (inPort < 0) throw new Error(`"${toId}" has no input "${toPort}"`);
    return { fromId, outPort, toId, inPort };
  });

  const inputSource = new Map();
  for (const l of links) {
    const key = `${l.toId}.${l.inPort}`;
    if (inputSource.has(key)) throw new Error(`input "${l.toId}" port ${l.inPort} has two connections`);
    inputSource.set(key, l);
  }

  // Topological order (Kahn). Anything left over is part of a cycle.
  const indegree = new Map([...byId.keys()].map(id => [id, 0]));
  for (const l of links) indegree.set(l.toId, indegree.get(l.toId) + 1);
  const queue = [...byId.keys()].filter(id => indegree.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const l of links) {
      if (l.fromId !== id) continue;
      const d = indegree.get(l.toId) - 1;
      indegree.set(l.toId, d);
      if (d === 0) queue.push(l.toId);
    }
  }
  if (order.length !== byId.size) throw new Error('graph has a cycle');

  let nextBuf = 1;
  const outBufs = new Map(order.map(id => [id, byId.get(id).def.outputs.map(() => nextBuf++)]));

  const nodes = order.map(id => {
    const n = byId.get(id);
    const slots = n.def.params.map(p =>
      registry.allocate(`${instrument}.${id}.${p.name}`, n.params?.[p.name] ?? p.def, p.min, p.max, p.int === true));
    const inputs = n.def.inputs.map((_, i) => {
      const l = inputSource.get(`${id}.${i}`);
      return l ? outBufs.get(l.fromId)[l.outPort] : 0;
    });
    return { id, type: n.type, slots, inputs, outputs: outBufs.get(id), connected: inputs.map(i => i !== 0) };
  });

  const masters = order.filter(id => byId.get(id).def.master);
  if (masters.length !== 1) throw new Error(`expected exactly one master node, found ${masters.length}`);
  return { instrument, nodes, bufferCount: nextBuf, master: outBufs.get(masters[0]) };
}
