import { PAGE_TICKS } from '../audio/sequencer.js';
import { EMPTY, encodeCell } from './cells.js';

// An instrument's pattern columns: note and velocity, then one 2hex column per
// exposed parameter. For the sampler the exposed list is fixed; for a graph
// instrument it follows whatever the graph exposes.
export function buildColumns(instrument, def, registry) {
  const columns = [
    { kind: 'note', token: 'note', label: 'Note' },
    { kind: 'vel', token: '2hex', label: 'Vel' },
  ];
  for (const e of def.exposed) {
    const slot = registry.slots.get(`${instrument}.${e.node}.${e.param}`);
    if (slot === undefined) throw new Error(`"${instrument}" does not expose ${e.node}.${e.param}`);
    const { min, max } = registry.meta[slot];
    columns.push({ kind: 'param', token: '2hex', label: e.label, slot, min, max, log: e.scale === 'log' });
  }
  return columns;
}

// Pattern text: one row per line, cells separated by spaces, one cell per column.
export function parsePattern(text, columns) {
  const rows = text.trim().split('\n').map((line, i) => {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== columns.length) {
      throw new Error(`pattern row ${i}: expected ${columns.length} cells, got ${cells.length}`);
    }
    cells.forEach((cell, c) => encodeCell(cell, columns[c].token));   // validates
    return cells;
  });
  return { length: rows.length, rows };
}

// Placements become one row of tokens per tick. Patterns are opaque overlays: a
// placement that starts later overwrites the ticks it covers, and the pattern
// underneath carries on after it ends.
export function flattenLane(lane, columns, length) {
  const blank = columns.map(c => (c.token === 'note' ? '...' : '..'));
  const rows = Array.from({ length }, () => blank);
  const parsed = {};
  for (const [puid, p] of Object.entries(lane.patterns)) parsed[puid] = parsePattern(p.text, columns);
  for (const pl of [...lane.placements].sort((a, b) => a.start - b.start)) {
    const pat = parsed[pl.puid];
    if (!pat) throw new Error(`lane "${lane.id}": unknown pattern "${pl.puid}"`);
    const n = Math.min(pl.length, pat.length);
    for (let t = 0; t < n && pl.start + t < length; t++) rows[pl.start + t] = pat.rows[t];
  }
  return rows;
}

// Rows of tokens -> pages of floats on shared memory. A placement that crosses a
// page boundary needs no special case: the tick index picks the page.
export function buildPages(rows, columns) {
  const channels = columns.length;
  const count = Math.max(1, Math.ceil(rows.length / PAGE_TICKS));
  const pages = Array.from({ length: count },
    () => new Float32Array(new SharedArrayBuffer(PAGE_TICKS * channels * 4)).fill(EMPTY));
  rows.forEach((cells, tick) => {
    const page = pages[(tick / PAGE_TICKS) | 0], base = (tick % PAGE_TICKS) * channels;
    cells.forEach((cell, c) => { page[base + c] = encodeCell(cell, columns[c].token); });
  });
  return pages;
}

// Instruments must already be compiled so their parameter slots exist.
export function prepareSong(song, instruments, registry) {
  return song.lanes.map(lane => {
    const columns = buildColumns(lane.instrument, instruments[lane.instrument], registry);
    const rows = flattenLane(lane, columns, song.length);
    return { id: lane.id, instrument: lane.instrument, columns, rows, pages: buildPages(rows, columns) };
  });
}
