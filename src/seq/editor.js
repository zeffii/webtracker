import * as ops from './edit.js';

// Every change to patterns and placements goes through the editor, which keeps a
// capped undo stack of labelled entries (it doubles as a recent-changes log) and one
// waypoint to restore all the way back to. Snapshots are whole copies of each lane's
// patterns and placements, which is small and keeps undo simple.
// Patterns start on a multiple of this many ticks (one row of the arrangement), so a start given
// anywhere inside a row means that row's start.
export const START_GRID = 16;
const snap = tick => Math.floor(tick / START_GRID) * START_GRID;

export function createEditor(lanes, length, { limit = 20 } = {}) {
  const undoStack = [], redoStack = [];
  let waypoint = null, lastKey = null;

  const snapshot = () => lanes.map(l => structuredClone({ patterns: l.patterns, placements: l.placements, mutes: l.mutes ?? [] }));
  const restore = state => state.forEach((s, i) => {
    lanes[i].patterns = structuredClone(s.patterns);
    lanes[i].placements = structuredClone(s.placements);
    lanes[i].mutes = [...s.mutes];
    ops.refresh(lanes[i], length);
  });

  // Runs an edit; records an undo entry only if it changed something. Repeated edits
  // with the same key (typing into one cell) share one entry.
  const change = (label, key, fn) => {
    const before = snapshot();
    const result = fn();
    if (!result) return result;
    if (key === null || key !== lastKey) {
      undoStack.push({ label, state: before });
      if (undoStack.length > limit) undoStack.shift();
    }
    lastKey = key;
    redoStack.length = 0;
    return result;
  };

  const step = (from, to) => {
    const entry = from.pop();
    if (!entry) return null;
    to.push({ label: entry.label, state: snapshot() });
    restore(entry.state);
    lastKey = null;
    return entry.label;
  };

  const at = li => lanes[li];
  return {
    setCell: (li, tick, col, token) => change('edit cell', `${li}:${tick}:${col}`, () => ops.setCell(at(li), length, tick, col, token)),
    setCells: (li, items, label = 'edit cells') => change(label, null, () => ops.setCells(at(li), length, items)),
    insertPattern: (li, tick, { overlay = false } = {}) => change('insert pattern', null, () => ops.insertPattern(at(li), length, snap(tick), 16, overlay)),
    placePattern: (li, tick, puid) => change('place pattern', null, () => ops.placePattern(at(li), length, snap(tick), puid)),
    clone: (li, tick) => change('clone pattern', null, () => ops.clonePlacement(at(li), length, tick)),
    slice: (li, tick) => change('slice pattern', null, () => ops.slicePlacement(at(li), length, tick)),
    resize: (li, tick, delta) => change(delta > 0 ? 'extend pattern' : 'shrink pattern', null, () => ops.resizePlacement(at(li), length, tick, delta)),
    move: (li, tick, delta) => change('move pattern', null, () => ops.movePlacement(at(li), length, tick, delta)),
    toggleMute: (li, tick) => change('toggle mute', null, () => ops.toggleMute(at(li), length, tick)),
    remove: (li, tick) => change('remove pattern', null, () => ops.removePlacement(at(li), length, tick)),

    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    setWaypoint() { waypoint = snapshot(); },
    // Restores the waypoint's state; the restore itself can be undone.
    restoreWaypoint() {
      if (!waypoint) return false;
      undoStack.push({ label: 'restore waypoint', state: snapshot() });
      if (undoStack.length > limit) undoStack.shift();
      restore(waypoint);
      redoStack.length = 0;
      lastKey = null;
      return true;
    },
    hasWaypoint: () => waypoint !== null,
    // Forgets all history. Snapshots hold rows laid out for the old columns, so this is
    // called when an instrument's columns change.
    clear() { undoStack.length = 0; redoStack.length = 0; waypoint = null; lastKey = null; },
    // Most recent first.
    log: () => undoStack.map(e => e.label).reverse(),
  };
}
