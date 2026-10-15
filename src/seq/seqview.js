import { esc } from './html.js';
import { placementAt, puidByIndex, startsAt } from './edit.js';

const ROWS = 24;     // rows shown at once
const CELL = 16;     // ticks in one row
const COLW = 14;     // characters per lane column
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');

// The arrangement, zoomed out: time runs down the rows (one row is 16 ticks) and each lane is a
// column. The cursor sits on a row; edits happen at the row's start, or at the start of a
// pattern that begins inside it. A pattern is a block that starts with its index and name; a later
// pattern covers the ones under it. Keyboard-driven.
export function createSequenceView({ el, statusEl, transport, onToggle, onOpen, onMove }) {
  let lanes = null, len = 0, editor = null;
  const cur = { lane: 0, tick: 0 };
  let typed = '', message = '';

  const load = ({ lanes: l, song, editor: e }) => {
    lanes = l; len = song.length; editor = e;
    Object.assign(cur, { lane: 0, tick: 0 });
    typed = ''; message = '';
  };

  const lane = () => lanes[cur.lane];
  const rowStart = t => Math.floor(t / CELL) * CELL;
  const moveTick = d => { cur.tick = rowStart(Math.min(len - 1, Math.max(0, rowStart(cur.tick) + d * CELL))); typed = ''; };
  const moveLane = d => { cur.lane = (cur.lane + d + lanes.length) % lanes.length; typed = ''; };
  // what a row of lane l shows: the first pattern that starts inside it, else the one covering it.
  // `more` is true when several patterns start in the row (a short one was placed over another).
  const inRow = (l, t0) => {
    const starts = l.placements.filter(p => p.start >= t0 && p.start < t0 + CELL).sort((a, b) => a.start - b.start);
    const pl = starts.length ? placementAt(l, starts[0].start) : placementAt(l, t0);
    return pl ? { ...pl, more: starts.length > 1 } : null;
  };
  const here = () => inRow(lane(), rowStart(cur.tick));
  const editTick = () => { const pl = here(); return pl && pl.start > rowStart(cur.tick) ? pl.start : rowStart(cur.tick); };

  // Placing a pattern by its two-digit shorthand; the cursor then jumps to the end of
  // it, so typing pairs of digits lays patterns out one after another.
  const place = index => {
    const puid = puidByIndex(lane(), index);
    if (puid === undefined) { message = `No pattern ${hex2(index)} in ${lane().id}.`; return; }
    if (startsAt(lane(), cur.tick)) { message = 'A pattern already starts here.'; return; }
    const placed = editor.placePattern(cur.lane, cur.tick, puid);
    if (!placed) { message = 'It does not fit here.'; return; }
    message = `Placed ${lane().patterns[puid].name}.`;
    cur.tick = rowStart(Math.min(len - 1, cur.tick + placed));
  };

  // Each edit reports through the message line.
  const act = (label, result, ok) => { message = result ? ok : `Can't ${label} here.`; return result; };

  el.addEventListener('keydown', e => {
    if (!lanes || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        const redo = key === 'y' || e.shiftKey;
        const label = redo ? editor.redo() : editor.undo();
        message = label ? `${redo ? 'Redid' : 'Undid'} ${label}.` : `Nothing to ${redo ? 'redo' : 'undo'}.`;
        e.preventDefault();
      }
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const li = cur.lane, t = editTick(), before = cur.tick;
    let used = true;
    switch (k) {
      case 'ArrowUp': moveTick(-1); break;
      case 'ArrowDown': moveTick(1); break;
      case 'ArrowLeft': moveLane(-1); break;
      case 'ArrowRight': moveLane(1); break;
      case 'Tab': moveLane(e.shiftKey ? -1 : 1); break;
      case 'PageUp': moveTick(-16); break;
      case 'PageDown': moveTick(16); break;
      case 'Home': cur.tick = 0; typed = ''; break;
      case 'End': cur.tick = rowStart(len - 1); typed = ''; break;
      case ' ': onToggle(); break;
      case 'Escape': typed = ''; message = ''; break;
      case 'Enter':   // open the pattern under the cursor in the grid, or start a new one
        if (here()) onOpen(li, t);
        else act('insert a pattern', editor.insertPattern(li, t), 'Pattern inserted.');
        break;
      case 'i': act('insert a pattern', editor.insertPattern(li, t, { overlay: true }), 'Pattern inserted.'); break;
      case 'n': act('clone', editor.clone(li, t), 'Cloned: this placement now has its own copy.'); break;
      case 's': act('slice', editor.slice(li, t), 'Sliced.'); break;
      case '+': case '=': act('extend', editor.resize(li, t, 16), 'Extended.'); break;
      case '-': act('shrink', editor.resize(li, t, -16), 'Shrunk.'); break;
      case '.': case ',': case '>': case '<': {
        const delta = { '.': CELL, ',': -CELL, '>': 16 * CELL, '<': -16 * CELL }[k];
        const moved = editor.move(li, t, delta);
        if (act('move', moved, 'Moved.')) cur.tick = moved.start;
        break;
      }
      case 'Delete': case 'Backspace': act('remove', editor.remove(li, t), 'Removed. The pattern stays in the list.'); break;
      case 'w':
        if (e.shiftKey) message = editor.restoreWaypoint() ? 'Restored the waypoint.' : 'No waypoint set.';
        else { editor.setWaypoint(); message = 'Waypoint set.'; }
        break;
      default:
        if (/^[0-9a-f]$/.test(k)) {
          typed += k.toUpperCase();
          if (typed.length === 2) { place(parseInt(typed, 16)); typed = ''; }
        } else used = false;
    }
    if (used) e.preventDefault();
    if (onMove && (cur.lane !== li || cur.tick !== before)) onMove(cur.lane, cur.tick);   // keep the grid in step
  });

  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    const rows = Math.ceil(len / CELL), curRow = Math.floor(cur.tick / CELL);
    const top = Math.max(0, Math.min(curRow - 8, rows - ROWS));
    const lines = [`      ${lanes.map((l, li) => `${li === cur.lane ? '>' : ' '}${esc(l.id.slice(0, COLW - 1).padEnd(COLW - 1))}`).join(' ')}`];

    for (let r = top; r < Math.min(rows, top + ROWS); r++) {
      const t = r * CELL;
      const cells = lanes.map((l, li) => {
        const pl = inRow(l, t);
        let text = ' '.repeat(COLW), cls = '';
        if (pl) {
          const pat = l.patterns[pl.puid];
          text = (pl.start >= t ? `▌${hex2(pat.index)} ${pat.name}` : '│').slice(0, COLW).padEnd(COLW);
          if (pl.more) text = `${text.slice(0, COLW - 1)}+`;
          cls = `p${pat.index % 6}`;
        }
        const classes = [cls, li === cur.lane && r === curRow && 'cur'].filter(Boolean).join(' ');
        return classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text);
      });
      lines.push(`${playing && playTick >= t && playTick < t + CELL ? '>' : ' '}${String(t).padStart(4, '0')} ${cells.join(' ')}`);
    }

    const pool = Object.values(lane().patterns).sort((a, b) => a.index - b.index)
      .map(p => `${hex2(p.index)} ${esc(p.name)} (${p.length})`).join('  ');
    lines.push('', `${esc(lane().id)} patterns: ${pool || 'none yet'}`);
    const log = editor.log().slice(0, 5).map(esc).join(' < ');
    lines.push(`undo: ${log || 'nothing yet'}${editor.hasWaypoint() ? '   [waypoint set]' : ''}`);
    el.innerHTML = lines.join('\n');

    const owner = here();
    statusEl.textContent = [
      lane().id, `tick ${editTick()}`,
      owner ? `${hex2(lane().patterns[owner.puid].index)} ${lane().patterns[owner.puid].name}` : 'no pattern',
      typed && `typing ${typed}`, message,
    ].filter(Boolean).join(' · ');
  };

  const goto = (laneIdx, tick) => { cur.lane = laneIdx; cur.tick = rowStart(tick); typed = ''; };
  return { draw, load, goto };
}
