// The meta machine's columns. A meta machine plays other instruments: each of its pattern columns is a proxy for one thing of another
// instrument (its notes, a velocity, a trigger, or an exposed parameter), so one lane can drive many machines. def.meta.columns lists the
// proxies in the order they stand:
//   { id, instrument, role, ...}   role is one of
//     'note'   the instrument's note column nc (0 the first), written as a note, like its own column
//     'rnote'  the same, as a 2hex cell relative to a root note: 80 is the root, 81 a semitone above, 7F one below, 00 a note off
//     'vel'    the velocity of the note column nc (it goes with the 'note' or 'rnote' column of that instrument and nc)
//     'trig'   trigger tc of the instrument (a hit, 1 to F loud)
//     'param'  an exposed parameter (node, param), as wide as the instrument shows it, or `bits` 4, 8 or 16
//   header: a short name of your own for the column; otherwise n1 n2 (notes), v1 (velocities), t1 (triggers), p1 p2 (parameters),
//   numbered in the order they stand. root: the MIDI number of an 'rnote' column's root note (60 is C-4).
// The columns come out in the same shape as an instrument's own (see buildColumns in lane.js), with `target`, the instrument a note or a
// trigger is sent to, and for the relative notes `rel` and `root`.
import { noteToken } from './cells.js';
import { longName } from './names.js';

export const DEFAULT_ROOT = 60;
export const rootName = root => noteToken(Math.max(0, Math.min(127, root)) - 12);   // 60 -> "C-4"

export function metaColumns(selfId, def, registry, instruments) {
  const columns = [], counts = { n: 0, v: 0, t: 0, p: 0 }, noteAt = new Map();
  let notes = 0, trigs = 0;
  const add = (letter, spec, col) => { const n = ++counts[letter]; columns.push({ ...col, key: `m:${spec.id}${col.kind === 'param' ? `:${col.token}` : ''}`, base: col.kind === 'param' ? `m:${spec.id}` : undefined, label: spec.header || `${letter}${n}`, short: spec.header || `${letter}${n}`, spec: spec.id }); };
  for (const spec of def.meta?.columns ?? []) {
    const target = instruments[spec.instrument];
    if (!target || spec.instrument === selfId) continue;   // a machine that is gone has no column
    const nc = spec.nc ?? 0, name = spec.instrument;
    if (spec.role === 'note' || spec.role === 'rnote') {
      noteAt.set(`${name}:${nc}`, notes);
      const rel = spec.role === 'rnote', root = spec.root ?? DEFAULT_ROOT;
      add('n', spec, {
        kind: 'note', token: rel ? '2hex' : 'note', nc: notes++, target: name, long: rel ? `${name} · note, 80 = ${rootName(root)}, 00 = off` : `${name} · note`,
        ...(rel ? { rel: true, root } : {}),
      });
    } else if (spec.role === 'vel') {
      const partner = noteAt.get(`${name}:${nc}`);
      if (partner !== undefined) add('v', spec, { kind: 'vel', token: '2hex', nc: partner, target: name, long: `${name} · velocity` });
    } else if (spec.role === 'trig') {
      const t = target.triggers?.[spec.tc ?? 0];
      if (t) add('t', spec, { kind: 'trig', token: '1hex', tc: trigs++, target: name, note: t.note ?? spec.tc ?? 0, long: `${name} · ${t.long ?? t.label}` });
    } else if (spec.role === 'param') {
      const e = target.exposed?.find(x => x.node === spec.node && x.param === spec.param), slot = registry.slots.get(`${name}.${spec.node}.${spec.param}`);
      if (!e || slot === undefined) continue;
      const bits = spec.bits ?? e.bits, token = bits === 16 ? '4hex' : bits === 4 ? '1hex' : '2hex', { min, max, int } = registry.meta[slot];
      const node = target.graph.nodes.find(n => n.id === e.node);
      add('p', spec, {
        kind: 'param', token, slot, min, max, int, denom: { '4hex': 65535, '1hex': 15, '2hex': 255 }[token], log: e.scale === 'log',
        long: `${name} · ${e.long ?? longName(e.param)}`, node: e.node, param: e.param, type: node?.type, dflt: node?.params?.[e.param] ?? registry.values[slot], target: name,
      });
    }
  }
  return columns;
}

// What an instrument offers a meta machine to proxy, as specs ready to add: its note columns (each with a velocity), its triggers and its
// exposed parameters. `label` is what the list shows.
export function proxyChoices(instrumentId, def) {
  const out = [];
  const pairs = def.noteColumns === 0 ? 0 : Math.max(1, Math.min(8, def.noteColumns ?? 1));
  for (let nc = 0; nc < pairs; nc++) {
    const suffix = pairs > 1 ? ` ${nc + 1}` : '';
    out.push({ label: `Note${suffix}`, spec: { instrument: instrumentId, role: 'note', nc } }, { label: `Note${suffix}, relative to a root`, spec: { instrument: instrumentId, role: 'rnote', nc } });
    if (!def.noVel) out.push({ label: `Velocity${suffix}`, spec: { instrument: instrumentId, role: 'vel', nc } });
  }
  (def.triggers ?? []).forEach((t, tc) => out.push({ label: t.long ?? t.label, spec: { instrument: instrumentId, role: 'trig', tc } }));
  for (const e of def.exposed ?? []) out.push({ label: e.long ?? longName(e.param), spec: { instrument: instrumentId, role: 'param', node: e.node, param: e.param } });
  return out;
}
