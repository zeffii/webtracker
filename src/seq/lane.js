import { PAGE_TICKS } from '../audio/sequencer.js';
import { EMPTY, KINDS, encodeCell } from './cells.js';

// An instrument's pattern columns: note and velocity, then one column per exposed
// parameter (2hex, 4hex with bits: 16, or 1hex with bits: 4), then one CCXXYY column if the instrument
// has a command table. For the sampler the lists are fixed; for a graph instrument
// they follow whatever the graph exposes. Each column knows its first channel (ch).
export function buildColumns(instrument, def, registry) {
  const target = (node, param) => {
    const slot = registry.slots.get(`${instrument}.${node}.${param}`);
    if (slot === undefined) throw new Error(`"${instrument}" does not expose ${node}.${param}`);
    const { min, max, int } = registry.meta[slot];
    return { slot, min, max, int };
  };
  const columns = [
    { kind: 'note', token: 'note', label: 'Note', key: 'note' },
    { kind: 'vel', token: '2hex', label: 'Vel', key: 'vel' },
  ];
  for (const e of def.exposed) {
    // bits: 16 is a 4hex column, 4 is a 1hex column (a toggle or an enum), otherwise 2hex.
    const token = e.bits === 16 ? '4hex' : e.bits === 4 ? '1hex' : '2hex';
    const base = `p:${e.node}.${e.param}`;
    columns.push({
      kind: 'param', token, label: e.label, base, key: `${base}:${token}`,
      denom: { '4hex': 65535, '1hex': 15, '2hex': 255 }[token], log: e.scale === 'log', ...target(e.node, e.param),
    });
  }
  if (def.commands?.length) {
    columns.push({
      kind: 'cmd', token: 'cmd', label: 'Cmd', key: 'cmd',
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

// A cell moved to a column of another width for the same parameter keeps its meaning:
// a whole-number parameter keeps its number, any other keeps its place in the range.
function convertCell(token, from, to) {
  if (token === KINDS[from.token].blank) return KINDS[to.token].blank;
  const n = parseInt(token, 16), digits = KINDS[to.token].width;
  const value = to.int ? Math.min(n, 16 ** digits - 1) : Math.round(n / from.denom * to.denom);
  return value.toString(16).toUpperCase().padStart(digits, '0');
}

// After an instrument's graph or exposed parameters change, rebuilds the columns of its
// lanes. Cells follow their column by key, and by parameter when only the width changed
// (they are converted); a column that is new starts empty and one that is gone loses its
// cells. Returns the lanes that changed, with new pages.
export function rebuildInstrumentLanes(lanes, song, instruments, registry, instrumentId) {
  const changed = [];
  for (const lane of lanes) {
    if (lane.instrument !== instrumentId) continue;
    const columns = buildColumns(instrumentId, instruments[instrumentId], registry);
    const from = columns.map(c => {
      let i = lane.columns.findIndex(o => o.key === c.key);
      if (i >= 0) return { i };
      i = c.base ? lane.columns.findIndex(o => o.base === c.base) : -1;
      return i >= 0 ? { i, convert: lane.columns[i] } : null;
    });
    for (const pat of Object.values(lane.patterns)) {
      pat.rows = pat.rows.map(row => columns.map((c, k) => {
        const f = from[k];
        if (!f) return KINDS[c.token].blank;
        return f.convert ? convertCell(row[f.i], f.convert, c) : row[f.i];
      }));
    }
    lane.columns = columns;
    lane.rows = flattenLane(lane, columns, song.length);
    lane.pages = buildPages(lane.rows, columns);
    changed.push(lane);
  }
  return changed;
}
