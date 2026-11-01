// Sidechain sources between instruments. A `sidechain` node in an instrument's graph has a `source`: the id of another
// instrument, whose finished sound it outputs. So an instrument can listen to another one (to duck under a kick, say).
// The instruments form a graph of who listens to whom, and it must have no loops: an instrument can never hear
// itself, directly or through others. These helpers keep it that way.

// The node types that name another instrument as their `source`: `sidechain` hears its sound, `listen` its notes. Only a
// sidechain can make a loop of sound; a loop of listeners is stopped by the runtime where it closes.
const LISTENERS = new Set(['sidechain', 'listen']);

// The instruments an instrument listens to (by sound: the ones that decide the order they run in).
export const sourcesOf = def => [...new Set((def?.graph?.nodes ?? []).filter(n => n.type === 'sidechain' && n.source).map(n => n.source))];

// Would listening to `source` from `target` make a loop? True when `source` is `target`, or hears it somewhere along the way.
export function wouldLoop(instruments, target, source) {
  const seen = new Set();
  const walk = id => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return sourcesOf(instruments[id]).some(walk);
  };
  return walk(source);
}

// The instruments `target` may listen to: everything that would not make a loop.
export const eligibleSources = (instruments, target) => Object.keys(instruments).filter(id => !wouldLoop(instruments, target, id));

// An instrument was renamed: every node that listened to it follows.
export function renameSource(instruments, from, to) {
  for (const def of Object.values(instruments)) for (const n of def.graph?.nodes ?? []) if (LISTENERS.has(n.type) && n.source === from) n.source = to;
}

// An instrument was removed: nodes that listened to it listen to nothing.
export function dropSource(instruments, id) {
  for (const def of Object.values(instruments)) for (const n of def.graph?.nodes ?? []) if (LISTENERS.has(n.type) && n.source === id) delete n.source;
}

// Sets a node's source, refusing a loop. Returns true when it was set.
export function setSource(instruments, instrument, nodeId, source) {
  const node = instruments[instrument]?.graph.nodes.find(n => n.id === nodeId && LISTENERS.has(n.type));
  if (!node) throw new Error(`No sidechain node "${nodeId}" in "${instrument}".`);
  if (!source) { delete node.source; return true; }
  if (!instruments[source]) throw new Error(`No instrument called "${source}".`);
  if (node.type === 'sidechain' && wouldLoop(instruments, instrument, source)) throw new Error(`"${instrument}" cannot listen to "${source}": that would make a loop.`);
  node.source = source;
  return true;
}
