import { PAGE_TICKS } from '../audio/sequencer.js';
import { EMPTY, KINDS, encodeCell } from './cells.js';

// An instrument's pattern columns: note and velocity, then one column per exposed
// parameter (2hex, or 4hex with bits: 16), then one CCXXYY column if the instrument
// has a command table. For the sampler the lists are fixed; for a graph instrument
// they follow whatever the graph exposes. Each column knows its first channel (ch).
export function buildColumns(instrument, def, registry) {
  const target = (node, param) => {
    const slot = registry.slots.get(`${instrument}.${node}.${param}`);
    if (slot === undefined) throw new Error(`"${instrument}" does not expose ${node}.${param}`);
    const { min, max } = registry.meta[slot];
    return { slot, min, max };
  };
  const columns = [
    { kind: 'note', token: 'note', label: 'Note' },
    { kind: 'vel', token: '2hex', label: 'Vel' },
  ];
  for (const e of def.exposed) {
    const wide = e.bits === 16;
    columns.push({
      kind: 'param', token: wide ? '4hex' : '2hex', label: e.label,
      denom: wide ? 65535 : 255, log: e.scale === 'log', ...target(e.node, e.param),
    });
  }
  if (def.commands?.length) {
    columns.push({
      kind: 'cmd', token: 'cmd', label: 'Cmd',
      commands: def.commands.map(c => ({ id: c.id, log: c.scale === 'log', ...target(c.node, c.param) })),
    });
  }
  let ch = 0;
  for (const c of columns) { c.ch = ch; ch += KINDS[c.token].channels; }
  return columns;
}

export const channelCount = columns => columns.reduce((n, c) => n + KINDS[c.token].channels, 0);

// Pattern text: one row per line, cells separated by spaces, one cell per column.
// Missing cells at the end of a row are empty, so a pattern written before a column
// existed still loads.
export function parsePattern(text, columns) {
  const rows = text.trim().split('\n').map((line, i) => {
    const cells = line.trim().split(/\s+/);
    if (cells.length > columns.length) {
      throw new Error(`pattern row ${i}: ${cells.length} cells but only ${columns.length} columns`);
    }
    while (cells.length < columns.length) cells.push(KINDS[columns[cells.length].token].blank);
    cells.forEach((cell, c) => encodeCell(cell, columns[c].token));   // validates
    return cells;
  });
  return { length: rows.length, rows };
}

// Placements become one row of tokens per tick. Patterns are opaque overlays: a
// placement that starts later overwrites the ticks it covers, and the pattern
// underneath carries on after it ends. A pattern is either { text } or parsed
// { length, rows }.
export function flattenLane(lane, columns, length) {
  const blank = columns.map(c => KINDS[c.token].blank);
  const rows = Array.from({ length }, () => blank);
  const parsed = {};
  for (const [puid, p] of Object.entries(lane.patterns)) parsed[puid] = p.rows ? p : parsePattern(p.text, columns);
  for (const pl of [...lane.placements].sort((a, b) => a.start - b.start)) {
    const pat = parsed[pl.puid];
    if (!pat) throw new Error(`lane "${lane.id}": unknown pattern "${pl.puid}"`);
    const n = Math.min(pl.length, pat.length);
    for (let t = 0; t < n && pl.start + t < length; t++) rows[pl.start + t] = pat.rows[t];
  }
  return rows;
}

// Overwrites every tick in place, so a lane that is playing never sees a tick
// cleared and refilled.
export function writePages(rows, columns, pages) {
  const channels = channelCount(columns);
  rows.forEach((cells, tick) => {
    const page = pages[(tick / PAGE_TICKS) | 0], base = (tick % PAGE_TICKS) * channels;
    cells.forEach((cell, c) => {
      encodeCell(cell, columns[c].token).forEach((v, i) => { page[base + columns[c].ch + i] = v; });
    });
  });
}

// Rows of tokens -> pages of floats on shared memory. A placement that crosses a
// page boundary needs no special case: the tick index picks the page.
export function buildPages(rows, columns) {
  const channels = channelCount(columns);
  const count = Math.max(1, Math.ceil(rows.length / PAGE_TICKS));
  const pages = Array.from({ length: count },
    () => new Float32Array(new SharedArrayBuffer(PAGE_TICKS * channels * 4)).fill(EMPTY));
  writePages(rows, columns, pages);
  return pages;
}

// Instruments must already be compiled so their parameter slots exist. The lanes
// returned are working copies (parsed patterns, placements, flattened rows, pages)
// that the editor changes; the song description itself is left alone.
export function prepareSong(song, instruments, registry) {
  return song.lanes.map(src => {
    const columns = buildColumns(src.instrument, instruments[src.instrument], registry);
    const taken = new Set(Object.values(src.patterns).map(p => p.index).filter(i => i !== undefined));
    const lane = {
      id: src.id,
      instrument: src.instrument,
      columns,
      patterns: Object.fromEntries(Object.entries(src.patterns).map(([puid, p]) => {
        let index = p.index;   // shorthand 0..255, kept once assigned; lowest free one otherwise
        if (index === undefined) {
          index = 0;
          while (taken.has(index)) index++;
          taken.add(index);
        }
        return [puid, { name: p.name ?? puid, index, ...parsePattern(p.text, columns) }];
      })),
      placements: src.placements.map(p => ({ ...p })),
    };
    lane.rows = flattenLane(lane, columns, song.length);
    lane.pages = buildPages(lane.rows, columns);
    return lane;
  });
}
