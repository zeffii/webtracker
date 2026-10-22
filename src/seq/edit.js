import { KINDS } from './cells.js';
import { flattenLane, writeMask, writePages } from './lane.js';

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
function addPattern(lane, rows, name, color) {
  const index = nextIndex(lane);
  if (index === null) return null;
  const puid = makePuid();
  lane.patterns[puid] = { name: name ?? `pat${hex2(index)}`, index, length: rows.length, rows, ...(color !== undefined ? { color } : {}) };
  return puid;
}

// One-pass full rewrite of the lane's pages from its patterns and placements.
export function refresh(lane, length) {
  lane.rows = flattenLane(lane, lane.columns, length);
  writePages(lane.rows, lane.columns, lane.pages);
  writeMask(lane, length);
}

export const refreshMask = (lane, length) => writeMask(lane, length);

// Solo: the lanes with `solo` set play, every other lane (except the master) lets go of its notes and plays none until
// the solo is taken away. Not undoable and not saved: a performance switch. Returns whether any lane is soloed.
export function applySolo(lanes, length) {
  const any = lanes.some(l => l.solo);
  for (const l of lanes) {
    const want = any && !l.solo && l.instrument !== 'master';
    if (want !== !!l.soloMuted) { l.soloMuted = want; writeMask(l, length); }
  }
  return any;
}

// Flips the mute at a tick: puts a flip there, or takes the one that is there away.
export function toggleMute(lane, length, tick) {
  if (tick < 0 || tick >= length) return false;
  const flips = lane.mutes ?? [];
  lane.mutes = flips.includes(tick) ? flips.filter(t => t !== tick) : [...flips, tick].sort((a, b) => a - b);
  writeMask(lane, length);
  return true;
}

// Puts a note-off marker at a tick, or takes the one that is there away: the lane lets go of what is sounding there.
export function toggleOff(lane, length, tick) {
  if (tick < 0 || tick >= length) return false;
  const marks = lane.offs ?? [];
  lane.offs = marks.includes(tick) ? marks.filter(t => t !== tick) : [...marks, tick].sort((a, b) => a - b);
  writeMask(lane, length);
  return true;
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

// Places an existing pattern. Returns the placement length, or 0 if it does not fit. Where a pattern already starts, the
// new one takes its place (a different pattern; the old one stays in the list).
export function placePattern(lane, length, tick, puid) {
  const n = Math.min(lane.patterns[puid].length, length - tick);
  if (n < 1) return 0;
  const here = lane.placements.find(p => p.start === tick);
  if (here) { if (here.puid === puid) return 0; here.puid = puid; here.length = n; }
  else lane.placements.push({ puid, start: tick, length: n });
  refresh(lane, length);
  return n;
}

// Detaches the placement under the tick into its own copy of the pattern, so
// changing it no longer changes the other placements of the old one.
export function clonePlacement(lane, length, tick) {
  const pl = placementAt(lane, tick);
  if (!pl) return null;
  const pat = lane.patterns[pl.puid];
  const puid = addPattern(lane, copyRows(pat.rows), `${pat.name} copy`, pat.color);
  if (puid === null) return null;
  // the copy has to look different at once: an explicit colour moves to the next preset, and an automatic one (the
  // index's, one of six) that comes out the same as the original's gets a preset of its own
  const copy = lane.patterns[puid];
  if (Number.isInteger(pat.color)) copy.color = (pat.color + 1) % COLOR_PRESETS;
  else if (pat.color !== undefined) copy.color = pat.index % COLOR_PRESETS;
  else if (copy.index % 6 === pat.index % 6) copy.color = (pat.index + 8) % COLOR_PRESETS;
  pl.puid = puid;
  refresh(lane, length);
  return puid;
}

// Steps the colour of the pattern under the tick through the 16 presets and back to the automatic
// colour (no `color` set), forwards for a delta of 1 and backwards for -1. A custom colour (a
// '#rrggbb' string) counts as the automatic one when stepping. Every placement of the pattern changes.
export const COLOR_PRESETS = 16;
export function colorPattern(lane, tick, delta) {
  const pl = placementAt(lane, tick);
  if (!pl) return false;
  const pat = lane.patterns[pl.puid];
  const at = Number.isInteger(pat.color) ? pat.color : -1;   // -1: automatic
  const next = ((at + 1 + delta) % (COLOR_PRESETS + 1) + COLOR_PRESETS + 1) % (COLOR_PRESETS + 1) - 1;
  if (next < 0) delete pat.color; else pat.color = next;
  return true;
}

// Splits the placement under the tick in two at that tick. Both halves are new
// patterns, so other placements of the old pattern are untouched.
export function slicePlacement(lane, length, tick) {
  const pl = placementAt(lane, tick);
  if (!pl || Object.keys(lane.patterns).length > 254) return false;
  const pat = lane.patterns[pl.puid];
  const n = Math.min(pl.length, pat.length), k = tick - pl.start;
  if (k <= 0 || k >= n) return false;
  const first = addPattern(lane, copyRows(pat.rows.slice(0, k)), `${pat.name}.1`, pat.color);
  const second = addPattern(lane, copyRows(pat.rows.slice(k, n)), `${pat.name}.2`, pat.color);
  pl.puid = first;
  pl.length = k;
  lane.placements.push({ puid: second, start: tick, length: n - k });
  refresh(lane, length);
  return true;
}

// Makes one new pattern of everything in this lane from tick `from` up to `to` (what the lane plays there: where patterns
// overlap the top one wins, and ticks with no pattern are empty rows). Patterns that cross `from` or `to` are cut there so
// nothing overlaps: the part outside stays (the head by shortening its placement, a tail as a new pattern), the part inside
// goes into the new one, and the placements that started inside are removed. A lane with no pattern in the span gets an empty pattern of the span's length.
// Returns true if the lane changed.
export function mergeRange(lane, length, from, to, { fillEmpty = true } = {}) {
  to = Math.min(to, length);
  if (from < 0 || from >= to) return false;
  const visible = pl => pl.start + Math.min(pl.length, lane.patterns[pl.puid].length);
  const touching = lane.placements.filter(p => p.start < to && visible(p) > from);
  if (!touching.length && !fillEmpty) return false;
  if (Object.keys(lane.patterns).length + touching.length + 1 > 255) return false;
  const rows = copyRows(lane.rows.slice(from, to));
  const keep = [], tails = [];
  for (const pl of lane.placements) {
    if (!touching.includes(pl)) { keep.push(pl); continue; }
    const end = visible(pl), pat = lane.patterns[pl.puid];
    if (pl.start < from) { keep.push(pl); pl.length = from - pl.start; }
    if (end > to) tails.push({ start: to, length: end - to, rows: copyRows(pat.rows.slice(to - pl.start, end - pl.start)), name: `${pat.name}.2`, color: pat.color });
  }
  const taken = new Set(keep.map(p => p.start));
  lane.placements = keep;
  for (const t of tails) {
    if (taken.has(t.start)) continue;
    const puid = addPattern(lane, t.rows, t.name, t.color);
    if (puid === null) continue;
    lane.placements.push({ puid, start: t.start, length: t.length });
    taken.add(t.start);
  }
  const made = addPattern(lane, rows, undefined, undefined);
  lane.placements.push({ puid: made, start: from, length: to - from });
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

// Shifts every placement that starts at or after `from` by delta ticks: positive makes room (refused if the last one
// would fall off the end), negative pulls them up towards `from` (at most as far as the gap, so none lands on or before
// the caret or on another). Returns how far they moved, 0 if nothing did.
export function shiftPlacements(lane, length, from, delta) {
  const later = lane.placements.filter(p => p.start >= from);
  if (!later.length || !delta) return 0;
  if (delta > 0) {
    if (Math.max(...later.map(p => p.start)) + delta >= length) return 0;
  } else {
    const before = lane.placements.filter(p => p.start < from).map(p => p.start + Math.min(p.length, lane.patterns[p.puid].length));
    const floor = Math.max(from, ...before);
    delta = -Math.min(-delta, Math.min(...later.map(p => p.start)) - floor);
    if (!delta) return 0;
  }
  for (const p of later) p.start += delta;
  refresh(lane, length);
  return delta;
}

// Copies a pattern (a { name, rows, color } as saved with a copied block) into this lane's pool. Returns its puid, or
// null if all 256 indices are taken.
export const adoptPattern = (lane, pattern) => addPattern(lane, copyRows(pattern.rows), pattern.name, pattern.color);

// Puts a block of placements into a lane over a span of its time: the placements that start in [from, to) go first, then
// each of `placements` ({ puid, start, length }) is placed, clipped to the song; one that starts past the end is dropped.
// Returns how many placements were removed and added.
export function placeBlock(lane, length, { from, to, placements }) {
  const incoming = placements.filter(p => p.start >= 0 && p.start < length);
  const keep = lane.placements.filter(p => (p.start < from || p.start >= to) && !incoming.some(i => i.start === p.start));
  const changed = lane.placements.length - keep.length + incoming.length;
  lane.placements = [...keep, ...incoming.map(p => ({ puid: p.puid, start: p.start, length: Math.min(p.length, length - p.start) }))];
  if (changed) refresh(lane, length);
  return changed;
}
