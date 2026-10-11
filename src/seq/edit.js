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

// One-pass full rewrite of the lane's pages from its patterns and placements.
function refresh(lane, length) {
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

// New empty pattern at a tick that no placement covers. Returns its puid.
export function insertPattern(lane, length, tick, rowCount = 16) {
  if (placementAt(lane, tick)) return null;
  const puid = makePuid();
  const blank = lane.columns.map(c => KINDS[c.token].blank);
  lane.patterns[puid] = { name: puid, length: rowCount, rows: Array.from({ length: rowCount }, () => blank.slice()) };
  lane.placements.push({ puid, start: tick, length: Math.min(rowCount, length - tick) });
  refresh(lane, length);
  return puid;
}
