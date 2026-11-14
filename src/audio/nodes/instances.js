// How many nodes of a kind have been made so far. The nodes that roll dice (random, westcoast, oberheim) seed their
// generator from this count, so every node, and every voice of it, wanders its own way.
// An offline render starts the counts again (see buildOffline in audio/export.js), so a song renders the same every time,
// whatever was played or rendered before it.
const made = new Map();

export function nextInstance(kind) {
  const count = (made.get(kind) ?? 0) + 1;
  made.set(kind, count);
  return count;
}

export function resetInstances() { made.clear(); }
