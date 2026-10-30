// Changes to a Node Sequencer graph (song.nodeseq), as plain functions on the data so they can be tested without a page. The editor calls
// these and then tells the engine. A graph is { sub, groups: [{ name, on }], nodes: [{ id, type, x, y, group?, params?, data? }], wires: [{ from, to }] }.
import { NS_TYPES, defaultParams, findIn, DEFAULT_SCRIPT } from './nodes.js';

export const GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const MAX_NODES = 200;

export const newGraph = () => ({ ui: 2, sub: 4, groups: GROUP_NAMES.map(name => ({ name, on: true })), nodes: [], wires: [] });

// The project's graph, made when there is none (a project without one saves without one until something is put in it).
export function ensureGraph(song) {
  const g = song.nodeseq ??= newGraph();
  g.sub = Math.max(1, Math.min(16, Math.round(g.sub) || 4));
  g.groups ??= GROUP_NAMES.map(name => ({ name, on: true }));
  while (g.groups.length < 8) g.groups.push({ name: GROUP_NAMES[g.groups.length], on: true });
  g.nodes ??= []; g.wires ??= [];
  // Graphs from before the tiles were laid out for nodes five times the size: bring them closer together (once).
  if (g.ui !== 2) { for (const n of g.nodes) { n.x = Math.round(n.x * 0.4 / 8) * 8; n.y = Math.round(n.y * 0.42 / 8) * 8; } g.ui = 2; }
  return g;
}

const uniqueId = (g, type) => {
  const base = type.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'n';
  for (let n = 1; ; n++) if (!g.nodes.some(x => x.id === `${base}${n}`)) return `${base}${n}`;
};

// A node of a type at a place (the editor's own units). Its parameters start at the defaults; the ones with data start with a sensible one.
export function addNode(g, type, x, y, extra = {}) {
  if (!NS_TYPES[type]) throw new Error(`There is no "${type}" node.`);
  if (g.nodes.length >= MAX_NODES) throw new Error(`A graph holds at most ${MAX_NODES} nodes.`);
  const T = NS_TYPES[type], node = { id: uniqueId(g, type), type, x: Math.round(x), y: Math.round(y), group: 0, params: defaultParams(type), ...extra };
  if (T.body === 'steps') node.data = { cells: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] };
  else if (T.body === 'list') node.data = { text: '57 60 64 67' };
  else if (T.body === 'script') node.data = { code: DEFAULT_SCRIPT };
  else if (T.body === 'chord') node.data = { text: 'A min7', weights: [] };
  else if (T.body === 'bars') node.data = { weights: [100, 70, 85, 60, 100, 70, 85, 60] };
  else if (T.data) node.data = { target: '' };
  if (extra.data) node.data = extra.data;
  g.nodes.push(node);
  return node;
}

export const portOf = (g, ref, side) => {
  const [id, name] = String(ref).split('.');
  const node = g.nodes.find(n => n.id === id);
  const port = node && (side === 'out' ? NS_TYPES[node?.type]?.outs.find(p => p.n === name) : node && findIn(node.type, name));
  return port ? { node, port, id, name } : null;
};

// Whether an output can be wired to an input: the two kinds are the same (event to event, control to control), and it is not the same node.
export function canConnect(g, from, to) {
  const a = portOf(g, from, 'out'), b = portOf(g, to, 'in');
  return !!a && !!b && a.port.k === b.port.k && a.node !== b.node;
}

// Wires an output to an input. A control input takes one wire (a new one replaces it); events may fan in and out. Returns the wire, or null
// when it is not allowed or is there already.
export function connect(g, from, to) {
  if (!canConnect(g, from, to)) return null;
  if (g.wires.some(w => w.from === from && w.to === to)) return null;
  const b = portOf(g, to, 'in');
  if (b.port.k !== 'e') g.wires = g.wires.filter(w => w.to !== to);
  const wire = { from, to };
  g.wires.push(wire);
  return wire;
}

export const disconnect = (g, wire) => { g.wires = g.wires.filter(w => w !== wire); };

export function removeNodes(g, ids) {
  const gone = new Set(ids);
  g.nodes = g.nodes.filter(n => !gone.has(n.id));
  g.wires = g.wires.filter(w => !gone.has(w.from.split('.')[0]) && !gone.has(w.to.split('.')[0]));
}

// Copies of nodes with fresh ids, moved aside, and the wires between them. Returns the new nodes.
export function duplicateNodes(g, ids, dx = 24, dy = 24) {
  const from = g.nodes.filter(n => ids.includes(n.id)), map = new Map(), made = [];
  for (const n of from) {
    const c = addNode(g, n.type, n.x + dx, n.y + dy, { group: n.group ?? 0, params: { ...n.params }, ...(n.data ? { data: structuredClone(n.data) } : {}) });
    map.set(n.id, c.id); made.push(c);
  }
  for (const w of [...g.wires]) {
    const [a, ap] = w.from.split('.'), [b, bp] = w.to.split('.');
    if (map.has(a) && map.has(b)) g.wires.push({ from: `${map.get(a)}.${ap}`, to: `${map.get(b)}.${bp}` });
  }
  return made;
}

// A graph that cannot trip the engine: unknown types, repeated ids, and wires between ports that are not there are dropped.
export function cleanGraph(g) {
  const seen = new Set();
  g.nodes = (g.nodes ?? []).filter(n => NS_TYPES[n.type] && typeof n.id === 'string' && !seen.has(n.id) && seen.add(n.id));
  g.wires = (g.wires ?? []).filter(w => canConnect(g, w.from, w.to));
  return g;
}

// The instrument ids a note node can play (every instrument except the machines that have no notes), for the editor's menus.
export const NOTE_INSTRUMENTS = (instruments, skip = []) => Object.entries(instruments ?? {}).filter(([id, def]) => !skip.includes(id) && (def.noteColumns ?? 1) > 0).map(([id]) => id);
