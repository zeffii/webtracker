import { KINDS } from './cells.js';
import { flattenLane, writePages } from './lane.js';

let counter = 0;
// Pattern ids: unix time plus a tiebreak counter.
export const makePuid = () => `${Date.now()}-${counter++}`;

// The placement that owns a tick: of those covering it, the one that starts last.
export function placementAt(lane, tick) {
  let found = null;
  for (const pl of lane.placements) {
    const end = pl.start + Math.min(pl.length, lane.patterns[pl.puid].length);
    if (pl.start <= tick && tick < end && (!found || pl.start > found.start)) found = pl;
  }
  return found;
}

export const startsAt = (lane, tick) => lane.placements.some(p => p.start === tick);

// A pattern's shorthand index (0..255) is stable: it is assigned once and kept.
export const puidByIndex = (lane, index) => Object.keys(lane.patterns).find(k => lane.patterns[k].index === index);

function nextIndex(lane) {
  const used = new Set(Object.values(lane.patterns).map(p => p.index));
  for (let i = 0; i < 256; i++) if (!used.has(i)) return i;
  return null;
}

const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');
const copyRows = rows => rows.map(r => r.slice());
const blankRow = lane => lane.columns.map(c => KINDS[c.token].blank);

// Adds a pattern definition to the lane's pool. Returns its puid, or null if all 256 indices are taken.
function addPattern(lane, rows, name) {
  const index = nextIndex(lane);
  if (index === null) return null;
  const puid = makePuid();
  lane.patterns[puid] = { name: name ?? `pat${hex2(index)}`, index, length: rows.length, rows };
  return puid;
}

// One-pass full rewrite of the lane's pages from its patterns and placements.
export function refresh(lane, length) {
  lane.rows = flattenLane(lane, lane.columns, length);
  writePages(lane.rows, lane.columns, lane.pages);
}

// Edits the pattern under the tick, so every placement of that pattern changes.
export function setCell(lane, length, tick, col, token) {
  const pl = placementAt(lane, tick);
  if (!pl) return false;
  const pat = lane.patterns[pl.puid];
  const row = pat.rows[tick - pl.start].slice();
  row[col] = token;
  pat.rows[tick - pl.start] = row;
  refresh(lane, length);
  return true;
}

// Writes many cells at once ([{ tick, col, token }]): one refresh, and one undo entry when the
// editor wraps it. Cells that no pattern covers are skipped. Returns the number of cells that
// changed, or 0 when nothing did.
export function setCells(lane, length, items) {
  let changed = 0;
  for (const { tick, col, token } of items) {
    const pl = placementAt(lane, tick);
    if (!pl) continue;
    const pat = lane.patterns[pl.puid], at = tick - pl.start;
    if (pat.rows[at][col] === token) continue;
    const row = pat.rows[at].slice();
    row[col] = token;
    pat.rows[at] = row;
    changed++;
  }
  if (changed) refresh(lane, length);
  return changed;
}

// New empty pattern at a tick. By default only where no pattern is; with overlay it
// may sit on top of one. Never where a pattern already starts. Returns its puid.
export function insertPattern(lane, length, tick, rowCount = 16, overlay = false) {
  if (startsAt(lane, tick) || (!overlay && placementAt(lane, tick))) return null;
  const puid = addPattern(lane, Array.from({ length: rowCount }, () => blankRow(lane)));
  if (puid === null) return null;
  lane.placements.push({ puid, start: tick, length: Math.min(rowCount, length - tick) });
  refresh(lane, length);
  return puid;
}

// Places an existing pattern. Returns the placement length, or 0 if it does not fit.
export function placePattern(lane, length, tick, puid) {
  const n = Math.min(lane.patterns[puid].length, length - tick);
  if (startsAt(lane, tick) || n < 1) return 0;
  lane.placements.push({ puid, start: tick, length: n });
  refresh(lane, length);
  return n;
}

// Detaches the placement under the tick into its own copy of the pattern, so
// changing it no longer changes the other placements of the old one.
export function clonePlacement(lane, length, tick) {
  const pl = placementAt(lane, tick);
  if (!pl) return null;
  const pat = lane.patterns[pl.puid];
  const puid = addPattern(lane, copyRows(pat.rows), `${pat.name} copy`);
  if (puid === null) return null;
  pl.puid = puid;
  refresh(lane, length);
  return puid;
}

// Splits the placement under the tick in two at that tick. Both halves are new
// patterns, so other placements of the old pattern are untouched.
export function slicePlacement(lane, length, tick) {
  const pl = placementAt(lane, tick);
  if (!pl || Object.keys(lane.patterns).length > 254) return false;
  const pat = lane.patterns[pl.puid];
  const n = Math.min(pl.length, pat.length), k = tick - pl.start;
  if (k <= 0 || k >= n) return false;
  const first = addPattern(lane, copyRows(pat.rows.slice(0, k)), `${pat.name}.1`);
  const second = addPattern(lane, copyRows(pat.rows.slice(k, n)), `${pat.name}.2`);
  pl.puid = first;
  pl.length = k;
  lane.placements.push({ puid: second, start: tick, length: n - k });
  refresh(lane, length);
  return true;
}

// Changes the placement's length by delta ticks, clipped to the song. Growing past
// the pattern's own length appends empty rows to the pattern. Returns the new length.
export function resizePlacement(lane, length, tick, delta) {
  const pl = placementAt(lane, tick);
  if (!pl) return 0;
  const newLen = Math.min(Math.max(1, pl.length + delta), length - pl.start);
  if (newLen === pl.length) return 0;
  const pat = lane.patterns[pl.puid];
  while (pat.rows.length < newLen) pat.rows.push(blankRow(lane));
  pat.length = pat.rows.length;
  pl.length = newLen;
  refresh(lane, length);
  return newLen;
}

// Moves the placement by delta ticks. Not onto a tick where another pattern starts.
export function movePlacement(lane, length, tick, delta) {
  const pl = placementAt(lane, tick);
  if (!pl) return null;
  const start = pl.start + delta;
  if (start < 0 || start >= length || lane.placements.some(p => p !== pl && p.start === start)) return null;
  pl.start = start;
  refresh(lane, length);
  return { start };
}

// Removes the placement under the tick. The pattern stays in the pool.
export function removePlacement(lane, length, tick) {
  const pl = placementAt(lane, tick);
  if (!pl) return false;
  lane.placements = lane.placements.filter(p => p !== pl);
  refresh(lane, length);
  return true;
}
