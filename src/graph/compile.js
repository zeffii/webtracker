// Graph description -> compiled graph (plain data the audio thread can run).
//
// desc = {
//   nodes: [{ id, type, params?: { name: value } }],
//   connections: [['sampler.out', 'filter.in'], ...],
//   voices?: 1..16,   // copies of the graph that play notes at once (see the voices node)
// }
// Buffer 0 is reserved as silence for unconnected inputs. A mono port is one buffer, a
// stereo port is a pair [left, right]. A mono wire into a stereo input feeds both channels;
// a stereo wire into a mono input is averaged (a hidden fold node); several wires into
// one input are added (a hidden sum node).
import { inputsOf, isLogSpec, resolveKinds } from './kinds.js';
import { nodeLatency } from '../audio/latency.js';
import { expandRanges, rangeTargetOf } from './rangetarget.js';

// With `delayComp` on (and a `sampleRate`), where audio paths of different delay meet at a node, the quicker ones are delayed to
// match the slowest (a hidden `compdelay` node), so a spectral or oversampled branch and its dry sound arrive together.
export function compile(source, { instrument, nodeTypes, registry, delayComp = false, sampleRate = 48000 }) {
  const desc = expandRanges(source, nodeTypes);
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
    for (const name of n.ports ?? []) {
      if (!def.params.some(p => p.name === name)) throw new Error(`node "${n.id}" has no parameter "${name}" to give a port`);
    }
    byId.set(n.id, { ...n, def });
  }

  const links = desc.connections.map(([from, to]) => {
    const [fromId, fromPort] = from.split('.'), [toId, toPort] = to.split('.');
    const a = byId.get(fromId), b = byId.get(toId);
    if (!a) throw new Error(`unknown node "${fromId}" in connection ${from} -> ${to}`);
    if (!b) throw new Error(`unknown node "${toId}" in connection ${from} -> ${to}`);
    const outPort = a.def.outputs.indexOf(fromPort), inPort = inputsOf(b, b.def).indexOf(toPort);
    if (outPort < 0) throw new Error(`"${fromId}" has no output "${fromPort}"`);
    if (inPort < 0) throw new Error(`"${toId}" has no input "${toPort}"`);
    return { fromId, outPort, toId, inPort };
  });

  // Several wires into one input are summed (see the sum node, inserted below).
  const inputSources = new Map();
  for (const l of links) {
    const key = `${l.toId}.${l.inPort}`;
    if (inputSources.has(key)) {
      if (inputSources.get(key).some(o => o.fromId === l.fromId && o.outPort === l.outPort)) throw new Error(`duplicate connection into "${l.toId}" port ${l.inPort}`);
      inputSources.get(key).push(l);
    } else inputSources.set(key, [l]);
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

  const { kindOf, wide } = resolveKinds(desc, nodeTypes);
  let nextBuf = 1;
  const alloc = (n, name) => (kindOf(n, name) === 'stereo' ? [nextBuf++, nextBuf++] : nextBuf++);
  const outBufs = new Map(order.map(id => [id, byId.get(id).def.outputs.map(name => alloc(byId.get(id), name))]));
  const live = ref => (Array.isArray(ref) ? ref[0] !== 0 || ref[1] !== 0 : ref !== 0);

  // A node feeding a parameter port starts at where that parameter's slider is (0 to 1 on its scale), so wiring
  // it up does not jump the sound.
  const hints = new Map();
  for (const l of links) {
    const b = byId.get(l.toId), name = inputsOf(b, b.def)[l.inPort];
    if (!name?.startsWith('@') || hints.has(l.fromId)) continue;
    const spec = b.def.params.find(p => p.name === name.slice(1)), v = b.params?.[spec.name] ?? spec.def;
    const x = isLogSpec(spec) ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min);
    hints.set(l.fromId, Math.min(1, Math.max(0, x)));
  }

  const nodes = [];
  const arrive = new Map();   // node id -> how many samples late what comes out of it is
  const isAudio = (l, fromNode) => { const k = kindOf(fromNode, fromNode.def.outputs[l.outPort]); return k !== 'control' && k !== 'param'; };
  for (const id of order) {
    const n = byId.get(id);
    const audioIn = [...inputSources].filter(([key]) => key.startsWith(`${id}.`)).flatMap(([, ls]) => ls).filter(l => isAudio(l, byId.get(l.fromId)) && !(inputsOf(n, n.def)[l.inPort] ?? '').startsWith('@'));
    const meet = Math.max(0, ...audioIn.map(l => arrive.get(l.fromId) ?? 0));   // the slowest path into this node
    arrive.set(id, meet + nodeLatency(n, n.def, sampleRate));
    const slots = n.def.params.map(p =>
      registry.allocate(`${instrument}.${n.alias ?? id}.${p.name}`, n.params?.[p.name] ?? p.def, p.min, p.max, p.int === true));
    const inNames = inputsOf(n, n.def);
    const inputs = inNames.map((name, i) => {
      const stereo = kindOf(n, name) === 'stereo';
      const feeds = (inputSources.get(`${id}.${i}`) ?? []).map((l, k) => {
        let ref = outBufs.get(l.fromId)[l.outPort];
        const gap = delayComp && audioIn.includes(l) ? meet - (arrive.get(l.fromId) ?? 0) : 0;
        if (gap > 0) {   // a quicker path: delayed to match the slowest
          const late = Array.isArray(ref) ? [nextBuf++, nextBuf++] : nextBuf++;
          nodes.push({ id: `~delay.${id}.${i}.${k}`, type: 'compdelay', slots: [], inputs: [ref], outputs: [late], connected: [true], data: { samples: gap }, stereo: Array.isArray(ref) });
          ref = late;
        }
        if (stereo) return Array.isArray(ref) ? ref : [ref, ref];
        if (!Array.isArray(ref)) return ref;
        const mono = nextBuf++;
        nodes.push({ id: `~fold.${id}.${i}.${k}`, type: 'fold', slots: [], inputs: [ref], outputs: [mono], connected: [true] });
        return mono;
      });
      if (feeds.length === 0) return stereo ? [0, 0] : 0;
      if (feeds.length === 1) return feeds[0];
      const sum = stereo ? [nextBuf++, nextBuf++] : nextBuf++;
      nodes.push({ id: `~sum.${id}.${i}`, type: stereo ? 'sumst' : 'sum', slots: [], inputs: feeds, outputs: [sum], connected: feeds.map(() => true) });
      return sum;
    });
    // parameter ports: which input carries the value of which parameter, and how a 0 to 1 signal maps onto it
    const paramPorts = (n.ports ?? []).map((name, k) => {
      const at = n.def.params.findIndex(p => p.name === name), spec = n.def.params[at];
      return { input: n.def.inputs.length + k, slot: slots[at], min: spec.min, max: spec.max, log: isLogSpec(spec), int: spec.int === true };
    }).filter(p => live(inputs[p.input]));
    nodes.push({ id, type: n.type, slots, inputs, outputs: outBufs.get(id), connected: inputs.map(live), ...(paramPorts.length ? { paramPorts } : {}), ...(hints.get(id) !== undefined ? { init: hints.get(id) } : {}), ...(wide.has(id) ? { dual: true } : {}), ...(n.stereo ? { stereo: true } : {}), ...(n.source ? { source: n.source } : {}), ...(n.data ? { data: n.data } : {}), ...(n.type === 'range' && rangeTargetOf(desc, nodeTypes, id) ? { target: (({ min, max, log, int }) => ({ min, max, log, int }))(rangeTargetOf(desc, nodeTypes, id)) } : {}) });
  }

  const masters = order.filter(id => byId.get(id).def.master);
  if (masters.length !== 1) throw new Error(`expected exactly one master node, found ${masters.length}`);
  const voices = desc.voices ?? 1;
  if (!Number.isInteger(voices) || voices < 1 || voices > 16) throw new Error(`voices must be a whole number from 1 to 16, not ${voices}`);
  // The hidden channel stage after the output node: a level (0..1) the sequencer's Volume curve moves, applied smoothly to the whole machine.
  const amp = registry.allocate(`${instrument}.mix.amp`, 1, 0, 1);
  return { instrument, nodes, bufferCount: nextBuf, master: outBufs.get(masters[0]), voices, amp, latency: arrive.get(masters[0]) ?? 0 };
}
