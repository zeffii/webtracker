// What the engine has to be told about a project's Node Sequencer, worked out from the project alone (no page needed), so the
// page and the offline tools (tools/wax-mcp, tools/render-ref.mjs) send the audio thread exactly the same thing.
import { GRAPH } from '../instruments.js';
import { playedBy } from '../graph/sidechain.js';

export const EMPTY_GRAPH = { sub: 4, groups: [], nodes: [], wires: [] };

// What the names in the graph mean on this machine: a `set` node's parameter slot and range, and the slots of the eight group columns.
export function resolveNodeseq(project, registry) {
  const graph = project?.song.nodeseq, slots = {};
  for (const node of graph?.nodes ?? []) {
    if (node.type !== 'set' || !node.data?.target) continue;
    const slot = registry.slots.get(node.data.target);
    if (slot === undefined) continue;
    const [instrument, nodeId, param] = node.data.target.split('.');
    const exposed = project.instruments[instrument]?.exposed?.find(e => e.node === nodeId && e.param === param);
    const meta = registry.meta[slot];
    slots[node.id] = { slot, min: meta.min, max: meta.max, int: !!meta.int, log: exposed?.scale === 'log' && meta.min > 0 };
  }
  return { slots, groupSlots: Array.from({ length: 8 }, (_, i) => registry.slots.get(`${GRAPH}.g.g${i + 1}`) ?? -1) };
}

// Which machines each meta machine plays, for the sidechain nodes that listen to a meta machine (they hear those machines added together).
export function metaSourcesOf(project) {
  const map = {};
  for (const [id, def] of Object.entries(project.instruments)) {
    const played = playedBy(def, id).filter(target => target in project.instruments);
    if (played.length) map[id] = played;
  }
  return map;
}

// The graph as the engine gets it: a copy, so later edits on the page do not reach into what was sent.
export const nodeseqMessage = project => JSON.parse(JSON.stringify(project.song.nodeseq ?? EMPTY_GRAPH));
