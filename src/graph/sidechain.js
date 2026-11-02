// Sidechain sources between instruments. A `sidechain` node in an instrument's graph has a `source`: the id of another
// instrument, whose finished sound it outputs. So an instrument can listen to another one (to duck under a kick, say).
// The instruments form a graph of who listens to whom, and it must have no loops: an instrument can never hear
// itself, directly or through others. These helpers keep it that way.

// The node types that name another instrument as their `source`: `sidechain` hears its sound, `listen` its notes. Only a
// sidechain can make a loop of sound; a loop of listeners is stopped by the runtime where it closes.
const LISTENERS = new Set(['sidechain', 'listen']);

// The machines a meta machine plays: the ones its note, relative note and trigger columns send to. A sidechain node that listens to
// a meta machine hears these, added together (or the ones it ticks): a meta machine makes no sound of its own.
export const playedBy = (def, self = null) => [...new Set((def?.meta?.columns ?? []).filter(c => ['note', 'rnote', 'trig'].includes(c.role) && c.instrument && c.instrument !== self).map(c => c.instrument))];

// The instruments an instrument listens to (by sound: the ones that decide the order they run in). Listening to a meta machine
// is listening to the machines it plays as well.
export const sourcesOf = (def, instruments = null) => {
  const named = [...new Set((def?.graph?.nodes ?? []).filter(n => n.type === 'sidechain' && n.source).map(n => n.source))];
  return instruments ? [...new Set(named.flatMap(id => [id, ...playedBy(instruments[id], id)]))] : named;
};

// Would listening to `source` from `target` make a loop? True when `source` is `target`, or hears it somewhere along the way.
export function wouldLoop(instruments, target, source) {
  const seen = new Set();
  const walk = id => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return sourcesOf(instruments[id], instruments).some(walk);
  };
  return [source, ...playedBy(instruments[source], source)].some(walk);   // a meta machine is heard as the machines it plays
}

// The instruments `target` may listen to: everything that would not make a loop.
export const eligibleSources = (instruments, target) => Object.keys(instruments).filter(id => !wouldLoop(instruments, target, id));

// An instrument was renamed: every node that listened to it follows.
export function renameSource(instruments, from, to) {
  for (const def of Object.values(instruments)) for (const n of def.graph?.nodes ?? []) {
    if (LISTENERS.has(n.type) && n.source === from) n.source = to;
    if (n.parts?.includes(from)) n.parts = n.parts.map(id => (id === from ? to : id));
  }
}

// An instrument was removed: nodes that listened to it listen to nothing.
export function dropSource(instruments, id) {
  for (const def of Object.values(instruments)) for (const n of def.graph?.nodes ?? []) {
    if (LISTENERS.has(n.type) && n.source === id) { delete n.source; delete n.parts; }
    if (n.parts?.includes(id)) { n.parts = n.parts.filter(p => p !== id); if (!n.parts.length) delete n.parts; }
  }
}

// Sets a node's source, refusing a loop. Returns true when it was set.
export function setSource(instruments, instrument, nodeId, source) {
  const node = instruments[instrument]?.graph.nodes.find(n => n.id === nodeId && LISTENERS.has(n.type));
  if (!node) throw new Error(`No sidechain node "${nodeId}" in "${instrument}".`);
  if (!source) { delete node.source; return true; }
  if (!instruments[source]) throw new Error(`No instrument called "${source}".`);
  if (node.type === 'sidechain' && wouldLoop(instruments, instrument, source)) throw new Error(`"${instrument}" cannot listen to "${source}": that would make a loop.`);
  if (node.source !== source) delete node.parts;   // a new source starts with all of what it plays
  node.source = source;
  return true;
}

// Which of a meta machine's machines a sidechain node hears: a list of instrument ids, or none for all of them. A list that holds
// every machine it plays is the same as none.
export function setParts(instruments, instrument, nodeId, parts) {
  const node = instruments[instrument]?.graph.nodes.find(n => n.id === nodeId && n.type === 'sidechain');
  if (!node) throw new Error(`No sidechain node "${nodeId}" in "${instrument}".`);
  const all = playedBy(instruments[node.source], node.source);
  const keep = (parts ?? []).filter(id => all.includes(id));
  if (!parts || keep.length === all.length) delete node.parts; else node.parts = keep;
  return node.parts;
}
