import { esc } from './html.js';
import { placementAt, puidByIndex, startsAt } from './edit.js';
import { setLoopPoint } from './loop.js';

const ROWS = { min: 6, max: 128, normal: 24 };   // rows shown at once
const CELL = 16;     // ticks in one row
const COLW = 14;     // characters per lane column
const INSET = 6;     // pixels a pattern is inset from the right for each pattern under it
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');

// The arrangement, zoomed out: time runs down the rows (one row is 16 ticks) and each lane is a
// column. The cursor sits on a row; edits happen at the row's start, or at the start of a
// pattern that begins inside it. A pattern is a block that starts with its index and name; a later
// pattern covers the ones under it. Keyboard-driven.
export function createSequenceView({ el, statusEl, listEl, transport, onToggle, onOpen, onMove, onSong = () => {} }) {
  let lanes = null, len = 0, editor = null, song = null;
  const cur = { lane: 0, tick: 0 };
  let typed = '', message = '';

  const load = ({ lanes: l, song: s, editor: e }) => {
    lanes = l; len = s.length; editor = e; song = s;
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
      if ((key === 'b' || key === 'e') && !e.shiftKey) {   // the loop: Ctrl+B starts it at this row, Ctrl+E ends it with this row
        const row = rowStart(cur.tick);
        message = key === 'b' ? setLoopPoint(song, 'start', row) : setLoopPoint(song, 'end', row + CELL);
        onSong();
        e.preventDefault();
        return;
      }
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
      case 'm': {   // start a mute here; again further down to unmute. Shift+M silences the whole lane.
        if (e.shiftKey) { message = editor.silence(li) ? `${lane().id} silenced.` : `${lane().id} is back on.`; break; }
        const row = rowStart(cur.tick);
        if (!editor.toggleMute(li, row)) { message = "Can't mute here."; break; }
        const l = lane();
        message = !l.mutes.includes(row) ? 'Mute marker removed.' : l.mask[row] ? `${l.id} muted from here.` : `${l.id} plays again from here.`;
        break;
      }
      case 'k': act('colour', editor.color(li, t, e.shiftKey ? -1 : 1), 'Pattern colour changed.'); break;   // Shift+K steps back
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

  // The patterns of a lane as blocks: where each starts and ends, and how many patterns lie under it.
  // A pattern placed over another is drawn inset from the right by one step for each pattern under it,
  // so its name stays at the same x and the one below still shows at the edge.
  const layout = l => l.placements.map((pl, i) => {
    const end = pl.start + Math.min(pl.length, l.patterns[pl.puid].length);
    return { pl, i, start: pl.start, end };
  }).map((e, _, all) => ({ ...e, depth: all.filter(o => o.start < e.start && o.end > e.start).length }))
    .sort((a, b) => a.start - b.start || a.i - b.i);

  const colourOf = pat => {
    const c = pat.color;
    if (Number.isInteger(c) && c >= 0 && c < 16) return { cls: `c${c}`, style: '' };
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return { cls: '', style: c };
    return { cls: `p${pat.index % 6}`, style: '' };
  };

  let top = 0;                  // the first row on screen
  // The wheel scrolls the rows without moving the cursor; the view follows the cursor again as soon as it moves.
  let wheelAcc = 0, scrolledFor = null;
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (!lanes || e.deltaY === 0) return;
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    const step = Math.trunc(wheelAcc / 25);   // a notch of a mouse wheel is about four rows
    if (!step) return;
    wheelAcc -= step * 25;
    top = Math.max(0, Math.min(top + step, Math.ceil(len / CELL) - rowCount));
    scrolledFor = `${cur.lane},${cur.tick}`;
    draw();
  }, { passive: false });
  let lastList = '';
  let rowCount = ROWS.normal;   // how many rows are shown; the drag bar under the view changes it
  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    const rows = Math.ceil(len / CELL), curRow = Math.floor(cur.tick / CELL);
    if (scrolledFor !== `${cur.lane},${cur.tick}`) scrolledFor = null;
    if (!scrolledFor && (curRow < top || curRow >= top + rowCount)) top = curRow - Math.min(8, rowCount >> 2);   // only scroll when the cursor leaves the window
    top = Math.max(0, Math.min(top, rows - rowCount));
    const blocks = lanes.map(layout);
    const row = text => `<div class="r">${text}</div>`;
    // the tick numbers: every 64 ticks a subtle shade, a darker one every 256 (a bar)
    const num = t => { const s = String(t).padStart(4, '0'); return t % 64 ? `${s} ` : `<span class="gn ${t % 256 ? 'g2' : 'g1'}">${s} </span>`; };
    const lines = [row(`      ${lanes.map((l, li) => {
      const head = `${li === cur.lane ? '>' : ' '}${esc(l.id.slice(0, COLW - 1).padEnd(COLW - 1))}`;
      return l.silenced ? `<span class="silenced">${head}</span>` : head;
    }).join('')}`)];

    for (let r = top; r < Math.min(rows, top + rowCount); r++) {
      const t = r * CELL;
      const cells = lanes.map((l, li) => {
        const pl = inRow(l, t);
        const level = l.mask?.[t] ?? 0, muted = level > 0, flip = (l.mutes ?? []).includes(t);
        const isCur = li === cur.lane && r === curRow;
        // the patterns that touch this row, lowest first; each is a rect, inset by the patterns under it
        const layers = blocks[li].filter(e => e.start < t + CELL && e.end > t).map(e => {
          const { cls, style } = colourOf(l.patterns[e.pl.puid]);
          const edges = `${e.start >= t ? ' st' : ''}${e.end <= t + CELL && !blocks[li].some(o => o.start === e.end) ? ' en' : ''}`;
          const css = `right:${Math.min(e.depth, 4) * INSET}px${style ? `;--c:${style}` : ''}`;
          return `<i class="L${cls ? ` ${cls}` : ''}${edges}" style="${css}"></i>`;
        }).join('');
        let text = muted && !pl ? '·'.repeat(COLW) : ' '.repeat(COLW);
        let swatch = null;
        if (pl) {
          const pat = l.patterns[pl.puid];
          text = (pl.start >= t ? `${hex2(pat.index)} ${pat.name}` : '').slice(0, COLW).padEnd(COLW);
          if (pl.more) text = `${text.slice(0, COLW - 1)}+`;
          swatch = colourOf(pat);
        }
        // a mute marker is a labelled cell: <mute> from here down, <play> where the lane comes back. The label sits at
        // the right when a pattern starts in the row, so the pattern's name still shows.
        const label = flip ? (muted ? '<mute>' : '<play>') : '';
        const room = COLW - label.length - 1;   // the cell's last character is hidden by the text's left padding
        if (flip) text = `${(pl && pl.start >= t ? text.slice(0, room - 1).trimEnd() : '').padEnd(room)}${label} `;
        const classes = ['cell', level === 2 ? 'silenced' : muted && 'muted', isCur && 'cur'].filter(Boolean).join(' ');
        // The cell under the cursor is drawn in the selection colour, which hides the pattern's own;
        // a small swatch of it is drawn on top so a colour change can be seen.
        let inner = esc(text);
        if (flip) {
          inner = `${esc(text.slice(0, room))}<span class="mk ${muted ? 'mm' : 'mu'}">${esc(label)}</span> `;
        } else if (isCur && swatch) {
          const at = COLW - 2, style = swatch.style ? ` style="background:${swatch.style}"` : '';
          inner = `${esc(text.slice(0, at))}<span class="sw ${swatch.cls}"${style}> </span>${esc(text.slice(at + 1))}`;
        }
        return `<span class="${classes}">${layers}${isCur ? '<i class="cb"></i>' : ''}<span class="t">${inner}</span></span>`;
      });
      const lp = song.loop && t + CELL > song.loop.start && t < song.loop.end ? ` lp${t <= song.loop.start ? ' ls' : ''}${t + CELL >= song.loop.end ? ' le' : ''}` : '';
      lines.push(row(`${lp ? `<span class="${lp.trim()}">` : ''}${playing && playTick >= t && playTick < t + CELL ? '>' : ' '}${num(t)}${lp ? '</span>' : ''}${cells.join('')}`));
    }

    // the rect is always rowCount rows tall, so the drag bar works even when the song has fewer rows
    for (let r = Math.min(rows, top + rowCount) - top; r < rowCount; r++) lines.push(row(''));
    lines.push(row(''));
    const log = editor.log().slice(0, 5).map(esc).join(' < ');
    lines.push(row(`undo: ${log || 'nothing yet'}${editor.hasWaypoint() ? '   [waypoint set]' : ''}`));
    el.innerHTML = lines.join('');

    const owner = here();
    const ownerPat = owner ? lane().patterns[owner.puid] : null;
    statusEl.textContent = [
      `lane ${cur.lane + 1}/${lanes.length} ${lane().id}`, `row ${curRow}/${rows - 1}`, `tick ${editTick()}`,
      ownerPat ? `${hex2(ownerPat.index)} ${ownerPat.name}` : 'no pattern',
      lane().silenced ? 'silenced' : lane().mask?.[rowStart(cur.tick)] && 'muted',
      typed && `typing ${typed}`, message,
    ].filter(Boolean).join(' · ');
    if (listEl) {
      // The patterns of this lane: colour, two-digit shortcut, name and length; the one under the cursor is marked.
      const html = `<div class="ph">${esc(lane().id)}: ${Object.keys(lane().patterns).length} patterns</div>${
        Object.entries(lane().patterns).sort((a, b) => a[1].index - b[1].index).map(([puid, p]) => {
          const { cls, style } = colourOf(p);
          return `<div class="pi${owner && owner.puid === puid ? ' here' : ''}"><span class="sw${cls ? ` ${cls}` : ''}"${style ? ` style="background:${style}"` : ''}> </span> ${hex2(p.index)} ${esc(p.name.padEnd(10))} ${String(p.length).padStart(3)}</div>`;
        }).join('') || '<div class="pi">none yet</div>'}`;
      if (html !== lastList) { lastList = html; listEl.innerHTML = html; }
    }
  };

  const goto = (laneIdx, tick) => { cur.lane = laneIdx; cur.tick = rowStart(tick); typed = ''; };
  const setRows = n => { rowCount = Math.max(ROWS.min, Math.min(ROWS.max, Math.round(n))); draw(); return rowCount; };
  return { draw, load, goto, setRows, get rows() { return rowCount; }, get lane() { return cur.lane; } };
}
