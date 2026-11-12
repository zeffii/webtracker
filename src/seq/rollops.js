// Editing the notes of a pattern from the piano roll. Each function works out the cells to write ({ tick, col, token } items for
// editor.setCells) and writes nothing itself, so the roll can do the whole drag as one undoable edit.
//
// What a note is in the cells: a note cell starts it, and it lasts until the next cell of the same column that is not blank (another
// note, `===` off or `^^^` cut) or until the pattern ends. So a note's length is real pattern data, and a later note on the same column
// interrupts it. A note that should stop earlier than that gets a `===` where it ends, and only where that cell is blank: nothing
// that is written is ever overwritten to make a length.
import { noteToken } from './cells.js';

const BLANK = '...', NO_VEL = '..';

// A working view of one pattern: reads see the cells with the edits made so far, and `items` collects the writes.
export function rollContext(lane, data) {
  const pending = new Map(), items = [];
  const key = (row, col) => `${row}:${col}`;
  return {
    data, items,
    get: (row, col) => pending.get(key(row, col)) ?? lane.rows[data.start + row]?.[col],
    set(row, col, token) { pending.set(key(row, col), token); items.push({ tick: data.start + row, col, token }); },
  };
}

const hex2 = v => Math.max(1, Math.min(255, Math.round(v * 255))).toString(16).toUpperCase().padStart(2, '0');

// Where a note starts in column k (0 for the first pair), with the velocity token it should carry (null for the default).
function write(ctx, { col, row, pitch, len, velTok }) {
  const { data } = ctx, nc = data.noteCols[col], vc = data.velCols[col];
  ctx.set(row, nc, noteToken(pitch));
  if (vc !== undefined) ctx.set(row, vc, velTok ?? NO_VEL);
  const end = row + len;
  if (end < data.length && ctx.get(end, nc) === BLANK) ctx.set(end, nc, '===');   // where the note is to stop
}

// Takes a note out: its cells, and the `===` that was ending it.
export function clearNote(ctx, n) {
  const { data } = ctx, nc = data.noteCols[n.col], vc = data.velCols[n.col], end = n.row + n.len;
  ctx.set(n.row, nc, BLANK);
  if (vc !== undefined) ctx.set(n.row, vc, NO_VEL);
  if (end < data.length && ctx.get(end, nc) === '===') ctx.set(end, nc, BLANK);
}

// The first note column that can take a note at `row`: a blank cell, preferring a column with nothing sounding there.
export function freeColumn(ctx, row, prefer = 0) {
  const { data } = ctx, order = [...data.noteCols.keys()].sort((a, b) => (a === prefer ? -1 : b === prefer ? 1 : a - b));
  const blank = order.filter(k => ctx.get(row, data.noteCols[k]) === BLANK);
  const sounding = k => data.notes.some(n => n.col === k && n.row < row && row < n.row + n.len);
  return blank.find(k => !sounding(k)) ?? blank[0] ?? -1;
}

// A new note of `len` rows. Returns { col, row, len, pitch } or null when every note column is taken at that row.
export function createNote(ctx, { row, pitch, len }) {
  const col = freeColumn(ctx, row);
  if (col < 0) return null;
  const n = { col, row, len: Math.max(1, Math.min(len, ctx.data.length - row)), pitch, velTok: null };
  write(ctx, n);
  return n;
}

// Moves a note to another row and/or pitch (in its own column when it can). Returns the note as it now is, or null (nothing written).
export function moveNote(ctx, n, { row, pitch }) {
  if (row < 0 || row >= ctx.data.length) return null;
  clearNote(ctx, n);
  const col = freeColumn(ctx, row, n.col);
  if (col < 0) return null;
  const moved = { ...n, col, row, pitch, len: Math.min(n.len, ctx.data.length - row) };
  write(ctx, moved);
  return moved;
}

// Gives a note a new length (at least one row). A later note in the column still cuts it short.
export function resizeNote(ctx, n, len) {
  const { data } = ctx, nc = data.noteCols[n.col], was = n.row + n.len, end = n.row + Math.max(1, len);
  if (was < data.length && ctx.get(was, nc) === '===') ctx.set(was, nc, BLANK);
  if (end < data.length && ctx.get(end, nc) === BLANK) ctx.set(end, nc, '===');
  return { ...n, len: Math.max(1, len) };
}

// A new velocity (0 to 1) for a note, in the velocity column paired with its note column.
export function setVelocity(ctx, n, vel) {
  const vc = ctx.data.velCols[n.col];
  if (vc === undefined) return null;
  ctx.set(n.row, vc, hex2(vel));
  return { ...n, vel, velTok: hex2(vel) };
}
