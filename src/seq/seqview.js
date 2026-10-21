import { esc } from './html.js';
import * as config from '../ui/config.js';
import { dimLevel, dimFilter } from '../ui/dim.js';
import { createPlayline } from '../ui/playline.js';
import { placementAt, puidByIndex, startsAt } from './edit.js';
import { setLoopPoint, toggleLoop } from './loop.js';
import { createMinimap } from './minimap.js';

const ROWS = { min: 6, max: 128, normal: 24 };   // rows shown at once
let CELL = 16;      // ticks in one row: a bar by default (the beats in a bar times the ticks in a beat); Ctrl+wheel halves it down to a beat and back
const COLW = 14;     // characters per lane column
const INSET = 6;     // pixels a pattern is inset from the right for each pattern under it
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');

// The arrangement, zoomed out: time runs down the rows (one row is 16 ticks) and each lane is a
// column. The cursor sits on a row; edits happen at the row's start, or at the start of a
// pattern that begins inside it. A pattern is a block that starts with its index and name; a later
// pattern covers the ones under it. Keyboard-driven.
export function createSequenceView({ el, statusEl, listEl, transport, onToggle, onOpen, onMove, onSeek, onSong = () => {}, follow = () => false }) {
  let lanes = null, len = 0, editor = null, song = null;
  const cur = { lane: 0, tick: 0 };
  let typed = '', message = '';
  let paused = false, lastAuto = null;   // following the song, and the row it last put the cursor on
  let sel = null;          // { lane, tick }: the corner opposite the cursor, while a block of lanes and rows is selected
  let clipboard = null;    // { w, h, items } from the last copy
  let dragging = null;     // the cell where a mouse drag began

  // The row sizes on offer: the divisors of a bar that are at least a beat, biggest first (16, 8, 4 for 4/4 at 4 ticks a beat).
  const barTicks = () => Math.max(1, Math.round(song?.beatsPerBar ?? 4)) * Math.max(1, song?.ticksPerBeat ?? 4);
  const cellSizes = () => {
    const bar = barTicks(), beat = Math.min(bar, Math.max(1, song?.ticksPerBeat ?? 4)), out = [];
    for (let d = bar; d >= beat; d--) if (bar % d === 0) out.push(d);
    return out;
  };
  let wantCell = 0;
  try { wantCell = Number(localStorage.getItem('webtracker.arrangementRow')) || 0; } catch { /* no storage */ }
  const syncCell = () => { const sizes = cellSizes(); const was = CELL; CELL = sizes.includes(wantCell) ? wantCell : sizes[0]; return CELL !== was; };
  const zoomRows = dir => {   // dir 1: smaller rows (zoom in), -1: bigger
    const sizes = cellSizes(), at = sizes.indexOf(CELL), next = Math.max(0, Math.min(sizes.length - 1, (at < 0 ? 0 : at) + dir));
    if (sizes[next] === CELL) { message = `Rows are ${CELL} ticks${CELL === sizes[0] ? ' (a bar)' : ''}: the ${dir > 0 ? 'smallest' : 'biggest'} size.`; return; }
    const topTick = top * CELL;
    wantCell = CELL = sizes[next];
    try { localStorage.setItem('webtracker.arrangementRow', String(CELL)); } catch { /* no storage */ }
    top = Math.floor(topTick / CELL); sel = null; typed = '';
    message = `Rows are ${CELL} ticks.`;
  };

  const load = ({ lanes: l, song: s, editor: e }) => {
    lanes = l; len = s.length; editor = e; song = s; syncCell();
    Object.assign(cur, { lane: 0, tick: 0 });
    typed = ''; message = ''; sel = null;
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

  // The selected block: lanes l0..l1, and rows from t0 to t1 (each the start tick of a row). Without a selection it is
  // the pattern under the cursor, as many rows tall as it is, in the cursor's lane.
  const block = () => {
    const row = rowStart(cur.tick);
    if (sel) return { l0: Math.min(sel.lane, cur.lane), l1: Math.max(sel.lane, cur.lane), t0: Math.min(sel.tick, row), t1: Math.max(sel.tick, row) };
    const pl = here();
    if (!pl) return { l0: cur.lane, l1: cur.lane, t0: row, t1: row };
    return { l0: cur.lane, l1: cur.lane, t0: rowStart(pl.start), t1: rowStart(pl.start + Math.min(pl.length, lane().patterns[pl.puid].length) - 1) };
  };
  const sigOf = l => l.columns.map(c => `${c.token}:${c.label}`).join('|');   // lanes with the same columns can take each other's patterns

  // The placements that start inside a block, remembered with a copy of their patterns, relative to the block's corner.
  const capture = b => {
    const items = [];
    for (let li = b.l0; li <= b.l1; li++) {
      const l = lanes[li];
      for (const p of l.placements) {
        if (p.start < b.t0 || p.start >= b.t1 + CELL) continue;
        const pat = l.patterns[p.puid];
        items.push({ dl: li - b.l0, dt: p.start - b.t0, length: p.length, lane: l.id, puid: p.puid, key: `${l.id}:${p.puid}`, sig: sigOf(l), pattern: { name: pat.name, rows: pat.rows.map(r => r.slice()), color: pat.color } });
      }
    }
    return { w: b.l1 - b.l0 + 1, h: (b.t1 - b.t0) / CELL + 1, items };
  };

  // Puts a captured block down with its corner at lane li0, tick t0, over whatever starts there. A pattern goes back into
  // its own lane as the same pattern; into another lane it is copied, if that lane has the same columns.
  const placeClip = (clip, li0, t0, label) => {
    const jobs = [];
    let skipped = 0;
    for (let i = 0; i < clip.w; i++) {
      const li = li0 + i, mine = clip.items.filter(it => it.dl === i);
      if (li >= lanes.length) { skipped += mine.length; continue; }
      const l = lanes[li], sig = sigOf(l), placements = [];
      let fits = true;
      for (const it of mine) {
        const same = it.lane === l.id && l.patterns[it.puid];
        if (!same && it.sig !== sig) { fits = false; break; }
        placements.push({ start: t0 + it.dt, length: it.length, ...(same ? { puid: it.puid } : { key: it.key, pattern: it.pattern }) });
      }
      if (!fits) { skipped += mine.length; continue; }
      jobs.push({ li, from: t0, to: t0 + clip.h * CELL, placements });
    }
    return { changed: jobs.length ? editor.placeBlocks(jobs, label) : 0, skipped };
  };

  const clearBlock = (b, label) => editor.placeBlocks(Array.from({ length: b.l1 - b.l0 + 1 }, (_, i) => ({ li: b.l0 + i, from: b.t0, to: b.t1 + CELL, placements: [] })), label);
  const count = n => `${n} pattern${n === 1 ? '' : 's'}`;
  const selectBlock = (l0, t0, l1, t1) => {   // the cursor takes the far corner
    if (l0 === l1 && t0 === t1) { sel = null; Object.assign(cur, { lane: l0, tick: t0 }); return; }
    sel = { lane: l0, tick: t0 };
    Object.assign(cur, { lane: l1, tick: t1 });
  };

  const copy = () => {
    const b = block(), clip = capture(b);
    if (!clip.items.length) { message = 'Nothing to copy here.'; return null; }
    clipboard = clip;
    message = `Copied ${count(clip.items.length)}.`;
    return b;
  };
  const paste = () => {
    if (!clipboard) { message = 'Nothing copied.'; return; }
    const at = sel ? block() : { l0: cur.lane, t0: rowStart(cur.tick) };
    if (at.t0 >= len) { message = 'No room here.'; return; }
    const { changed, skipped } = placeClip(clipboard, at.l0, at.t0, 'paste');
    message = changed ? `Pasted ${count(clipboard.items.length - skipped)}${skipped ? `, ${skipped} did not fit` : ''}.` : skipped ? 'Those lanes have different columns.' : 'Nothing changed.';
    if (changed) selectBlock(at.l0, at.t0, Math.min(lanes.length - 1, at.l0 + clipboard.w - 1), rowStart(Math.min(len - 1, at.t0 + (clipboard.h - 1) * CELL)));
  };
  // Ctrl+D: the block is copied to the rows right below it, whatever the cursor is, and the selection moves down with the
  // copy, so pressing it again copies it once more, by the same number of rows.
  const duplicate = () => {
    const b = block(), clip = capture(b);
    if (!clip.items.length) { message = 'Nothing to copy here.'; return; }
    const down = clip.h * CELL, t0 = b.t0 + down;
    if (t0 >= len) { message = 'No room below.'; return; }
    const { changed } = placeClip(clip, b.l0, t0, 'copy down');
    message = changed ? `Copied ${count(clip.items.length)} down.` : 'Nothing changed.';
    const last = rowStart(len - 1);
    if (sel) { sel.tick = Math.min(last, sel.tick + down); cur.tick = Math.min(last, rowStart(cur.tick) + down); }
    else selectBlock(b.l0, t0, b.l1, Math.min(last, t0 + down - CELL));
  };

  // Mouse: click puts the cursor on a cell, dragging selects a block of cells.
  const pointed = e => {
    const cell = e.target?.closest?.('.cell'), rowEl = cell?.parentElement;
    if (!cell || !rowEl) return null;
    const ri = Array.prototype.indexOf.call(el.children, rowEl) - 1, li = Array.from(rowEl.querySelectorAll('.cell')).indexOf(cell);
    return ri < 0 || li < 0 ? null : { lane: li, tick: (top + ri) * CELL };
  };
  // The tick column: a click there puts the playhead on that tick (the row's height covers its ticks), and plays from it
  // when the song is stopped.
  const tickAt = e => {
    const rowEl = e.target?.closest?.('.r');
    if (!rowEl || e.target.closest('.cell')) return null;
    const ri = Array.prototype.indexOf.call(el.children, rowEl) - 1, first = rowEl.querySelector('.cell');
    if (ri < 0 || !first || e.clientX >= first.getBoundingClientRect().left || (top + ri) * CELL >= len) return null;
    const box = rowEl.getBoundingClientRect(), f = Math.min(0.999, Math.max(0, (e.clientY - box.top) / box.height));
    return Math.min(len - 1, (top + ri) * CELL + Math.floor(f * CELL));
  };
  el.addEventListener('mousedown', e => {
    if (!lanes || e.button !== 0) return;
    const at = onSeek ? tickAt(e) : null;
    if (at !== null) {
      e.preventDefault(); el.focus?.();
      cur.tick = rowStart(at); sel = null; typed = '';
      message = `Playing from tick ${at}.`;
      onMove?.(cur.lane, cur.tick);
      onSeek(at);
      return;
    }
    const hit = pointed(e);
    if (!hit) return;
    Object.assign(cur, hit);
    sel = null; typed = ''; message = '';
    dragging = hit;
    e.preventDefault();
    el.focus?.();
    onMove?.(cur.lane, cur.tick);
  });
  el.addEventListener('mousemove', e => {
    if (!lanes || !dragging || !(e.buttons & 1)) return;
    const hit = pointed(e);
    if (!hit || (hit.lane === cur.lane && hit.tick === cur.tick)) return;
    sel = hit.lane === dragging.lane && hit.tick === dragging.tick ? null : { ...dragging };
    Object.assign(cur, hit);
    onMove?.(cur.lane, cur.tick);
  });
  // Double-click a pattern: open it in the pattern editor (Ctrl+double-click: on its own, solo-edit).
  el.addEventListener('dblclick', e => {
    if (!lanes || e.button !== 0 || !pointed(e)) return;
    if (here()) onOpen(cur.lane, editTick(), { solo: e.ctrlKey || e.metaKey });
  });
  const stopDrag = () => { dragging = null; };
  el.addEventListener('mouseup', stopDrag);
  el.addEventListener('mouseleave', stopDrag);

  // A note-off marker on this row: the lane lets go of what is sounding there.
  const noteOffMark = () => {
    const row = rowStart(cur.tick);
    message = editor.toggleOff(cur.lane, row) ? (lane().offs.includes(row) ? 'Note off from this row.' : 'Note-off marker removed.') : "Can't put one here.";
  };

  // Each edit reports through the message line.
  const act = (label, result, ok) => { message = result ? ok : `Can't ${label} here.`; return result; };

  // A small question over the grid: Y or Enter is yes, N is no, Esc cancels. `answer(true | false)` runs on yes or no.
  let dialog = null;
  const closeDialog = () => { dialog?.box.remove(); dialog = null; el.focus(); };
  const askEmpty = (names, answer) => {
    const box = document.createElement('div');
    box.className = 'dlg';
    box.setAttribute('role', 'alertdialog');
    const text = document.createElement('p');
    text.textContent = `Create patterns in the empty lanes (${names.join(', ')})?`;
    const row = document.createElement('div');
    const mk = (label, fn) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick: () => { closeDialog(); fn(); } });
    row.append(mk('Yes (Y)', () => answer(true)), mk('No (N)', () => answer(false)), mk('Cancel (Esc)', () => {}));
    box.append(text, row);
    box.addEventListener('keydown', ev => {
      const k = ev.key.toLowerCase(), buttons = [...row.children], at = buttons.indexOf(document.activeElement);
      if (k === 'y') buttons[0].click();
      else if (k === 'n') buttons[1].click();
      else if (k === 'escape') buttons[2].click();
      else if (k === 'arrowleft' || k === 'arrowright') buttons[(at + (k === 'arrowright' ? 1 : buttons.length - 1)) % buttons.length].focus();
      else if (k !== 'enter' && k !== 'tab') return;
      if (k !== 'tab') ev.preventDefault();
      ev.stopPropagation();
    });
    el.parentNode.append(box);
    dialog = { box, answer };
    row.firstChild.focus();
  };

  el.addEventListener('keydown', e => {
    if (!lanes || e.altKey) return;
    if (dialog) { return; }
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase(), li0 = cur.lane, tick0 = cur.tick;
      if ((key === 'b' || key === 'e') && !e.shiftKey) {   // the loop: Ctrl+B starts it at this row, Ctrl+E ends it where this row starts (this row is not in the loop)
        const row = rowStart(cur.tick);
        message = key === 'b' ? setLoopPoint(song, 'start', row) : setLoopPoint(song, 'end', row);
        onSong();
        e.preventDefault();
        return;
      }
      if (key === 'l' && !e.shiftKey) { message = toggleLoop(song); onSong(); e.preventDefault(); return; }   // Ctrl+L: the loop on or off
      if (key === 'z' || key === 'y') {
        const redo = key === 'y' || e.shiftKey;
        const label = redo ? editor.redo() : editor.undo();
        message = label ? `${redo ? 'Redid' : 'Undid'} ${label}.` : `Nothing to ${redo ? 'redo' : 'undo'}.`;
        sel = null;
        e.preventDefault();
      } else if (key === '1') { noteOffMark(); e.preventDefault();
      } else if (key === 'c' || key === 'x') {
        const b = copy();
        if (b && key === 'x') { clearBlock(b, 'cut'); message = `Cut ${count(clipboard.items.length)}.`; }
        e.preventDefault();
      } else if (key === 'v') { paste(); e.preventDefault(); }
      else if (key === 'd' && !e.shiftKey) { duplicate(); e.preventDefault(); }
      else if (key === 'enter') { if (here()) onOpen(cur.lane, editTick(), { solo: true }); else message = 'No pattern here.'; e.preventDefault(); }
      if (onMove && (cur.lane !== li0 || cur.tick !== tick0)) onMove(cur.lane, cur.tick);
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const li = cur.lane, t = editTick(), before = cur.tick;
    let used = true;
    // Shift with a movement key grows a block of lanes and rows from where the cursor was; Delete removes the patterns in it;
    // any other key drops it.
    if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) {
      sel ??= { lane: cur.lane, tick: rowStart(cur.tick) };
      typed = '';
      if (k === 'ArrowLeft') cur.lane = Math.max(0, cur.lane - 1);
      else if (k === 'ArrowRight') cur.lane = Math.min(lanes.length - 1, cur.lane + 1);
      else if (k === 'ArrowUp') moveTick(-1);
      else if (k === 'ArrowDown') moveTick(1);
      else if (k === 'PageUp') moveTick(-16);
      else if (k === 'PageDown') moveTick(16);
      else if (k === 'Home') cur.tick = 0;
      else cur.tick = rowStart(len - 1);
      e.preventDefault();
      if (onMove && (cur.lane !== li || cur.tick !== before)) onMove(cur.lane, cur.tick);
      return;
    }
    if (sel && (k === 'Delete' || k === 'Backspace')) {
      const b = block(), n = capture(b).items.length;
      clearBlock(b, 'clear');
      message = n ? `Removed ${count(n)}.` : 'Nothing there.';
      sel = null;
      e.preventDefault();
      return;
    }
    if (k === 'g' && !e.shiftKey) {   // glue the selected block into one new pattern per lane
      const b = sel ? block() : null;
      if (!b) message = 'Select a block first (Shift+arrows).';
      else {
        const from = b.t0, to = b.t1 + CELL;
        const empty = [];
        for (let li = b.l0; li <= b.l1; li++) if (!lanes[li].placements.some(p => p.start < to && p.start + Math.min(p.length, lanes[li].patterns[p.puid].length) > from)) empty.push(lanes[li].id);
        const run = fillEmpty => {
          const n = editor.mergeRange(b.l0, b.l1, from, to, { fillEmpty });
          message = n ? `Merged into ${n === 1 ? 'one new pattern' : `${n} new patterns, one per lane`}.` : 'Nothing to merge there.';
          draw();
        };
        // Several lanes and some of them empty: ask whether those get an empty pattern too. One lane: of course it does.
        if (b.l1 > b.l0 && empty.length) { askEmpty(empty, run); e.preventDefault(); return; }
        run(true);
      }
      e.preventDefault();
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(k)) sel = null;
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
      case 'Escape': typed = ''; message = ''; break;
      case 'Enter':   // open the pattern under the cursor in the grid, or start a new one
        if (here()) onOpen(li, t);
        else act('insert a pattern', editor.insertPattern(li, t), 'Pattern inserted.');
        break;
      case 'h': config.set('seqNames', !config.get('seqNames')); message = config.get('seqNames') ? 'Pattern names shown.' : 'Pattern names hidden.'; break;   // H: pattern names in the cells on or off
      case 'v': config.set('minimapOn', !config.get('minimapOn')); message = config.get('minimapOn') ? 'Pattern minimaps on.' : 'Pattern minimaps off.'; break;   // V: the pattern minimaps in the cells on or off
      case 'l': message = toggleLoop(song); onSong(); break;   // L: the loop on or off (Ctrl+L too, where the browser lets it through)
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
      case 'o': noteOffMark(); break;   // the same as Ctrl+1, which some browsers keep for switching tabs
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

  const playline = createPlayline(el), minimap = createMinimap(el);
  let lineMode = config.get('playhead') === 'line';
  config.onChange(k => { if (k === 'playhead') { lineMode = config.get('playhead') === 'line'; draw(); } });
  let top = 0;                  // the first row on screen
  // The wheel scrolls the rows without moving the cursor; the view follows the cursor again as soon as it moves.
  let wheelAcc = 0, scrolledFor = null, zoomAt = null;
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) {   // Ctrl+wheel: the size of a row (a bar, half a bar, a beat), one step for each notch
      const now = performance.now();
      if (lanes && e.deltaY !== 0 && now - (zoomAt ?? 0) > 120) { zoomAt = now; zoomRows(e.deltaY < 0 ? 1 : -1); draw(); }
      return;
    }
    if (!lanes || e.deltaY === 0 || (follow() && !paused && Atomics.load(transport, 1) === 1)) return;
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
  let painted = '';   // the markup last shown
  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    // Following the song: the cursor goes with the playing row, which stays in the middle of the view while the rows scroll.
    if (!(follow() && playing)) { paused = false; lastAuto = null; }
    else if (!paused && lastAuto !== null && cur.tick !== lastAuto && config.get('followRoam')) { paused = true; message = 'Follow paused while you move around: F9 follows again.'; }
    const following = follow() && playing && !paused, nowRow = following ? Math.floor(Math.min(len - 1, playTick) / CELL) : -1;
    if (following) { cur.tick = nowRow * CELL; lastAuto = cur.tick; sel = null; typed = ''; }
    const rows = Math.ceil(len / CELL), curRow = Math.floor(cur.tick / CELL);
    if (following) top = nowRow - (rowCount >> 1);
    else {
      if (scrolledFor !== `${cur.lane},${cur.tick}`) scrolledFor = null;
      if (!scrolledFor && (curRow < top || curRow >= top + rowCount)) top = curRow - Math.min(8, rowCount >> 2);   // only scroll when the cursor leaves the window
    }
    top = Math.max(0, Math.min(top, rows - rowCount));
    const picked = sel ? block() : null;
    const blocks = lanes.map(layout);
    const row = (text, cls = '') => `<div class="r${cls}">${text}</div>`;
    // the tick numbers: every four bars a subtle shade, a darker one every sixteen
    if (syncCell()) top = 0;   // the bar changed under us: the row size follows it
    const bar = barTicks(), num = t => { const s = String(t).padStart(4, '0'); return t % (bar * 4) ? `${s} ` : `<span class="gn ${t % (bar * 16) ? 'g2' : 'g1'}">${s} </span>`; };
    const lines = [row(`      ${lanes.map((l, li) => {
      const head = `${li === cur.lane ? '>' : ' '}${esc(l.id.slice(0, COLW - 1).padEnd(COLW - 1))}`;
      const dim = dimFilter(dimLevel(l));
      return l.silenced ? `<span class="silenced">${head}</span>` : dim ? `<span style="${dim}">${head}</span>` : head;
    }).join('')}`)];

    for (let r = top; r < Math.min(rows, top + rowCount); r++) {
      const t = r * CELL;
      const cells = lanes.map((l, li) => {
        const pl = inRow(l, t);
        const raw = (l.mask?.[t] ?? 0) & 3, level = raw === 3 ? 0 : raw, dim = dimFilter(dimLevel(l)), muted = level > 0, flip = (l.mutes ?? []).includes(t), off = (l.offs ?? []).includes(t);
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
          text = (pl.start >= t ? (config.get('seqNames') ? `${hex2(pat.index)} ${pat.name}` : hex2(pat.index)) : '').slice(0, COLW).padEnd(COLW);
          if (pl.more) text = `${text.slice(0, COLW - 1)}+`;
          swatch = colourOf(pat);
        }
        // a mute marker is a labelled cell: <mute> from here down, <play> where the lane comes back. The label sits at
        // the right when a pattern starts in the row, so the pattern's name still shows.
        const label = `${off ? '<off>' : ''}${flip ? (muted ? '<mute>' : '<play>') : ''}`;
        const room = COLW - label.length - 1;   // the cell's last character is hidden by the text's left padding
        if (label) text = `${(pl && pl.start >= t ? text.slice(0, room - 1).trimEnd() : '').padEnd(room)}${label} `;
        const classes = ['cell', level === 2 ? 'silenced' : muted && 'muted', isCur && 'cur', picked && li >= picked.l0 && li <= picked.l1 && t >= picked.t0 && t <= picked.t1 && 'sel'].filter(Boolean).join(' ');
        // The cell under the cursor is drawn in the selection colour, which hides the pattern's own;
        // a small swatch of it is drawn on top so a colour change can be seen.
        let inner = esc(text);
        if (label) {
          inner = `${esc(text.slice(0, room))}<span class="mk ${muted ? 'mm' : 'mu'}">${esc(label)}</span> `;
        } else if (isCur && swatch) {
          const at = COLW - 2, style = swatch.style ? ` style="background:${swatch.style}"` : '';
          inner = `${esc(text.slice(0, at))}<span class="sw ${swatch.cls}"${style}> </span>${esc(text.slice(at + 1))}`;
        }
        return `<span class="${classes}"${dim ? ` style="${dim}"` : ''}>${layers}${isCur ? '<i class="cb"></i>' : ''}<span class="t">${inner}</span></span>`;
      });
      const lp = song.loop && t + CELL > song.loop.start && t < song.loop.end ? ` lp${song.loop.off ? ' off' : ''}${t <= song.loop.start ? ' ls' : ''}${t + CELL >= song.loop.end ? ' le' : ''}` : '';
      lines.push(row(`${lp ? `<span class="${lp.trim()}">` : ''}${playing && playTick >= t && playTick < t + CELL && !lineMode ? '>' : ' '}${num(t)}${lp ? '</span>' : ''}${cells.join('')}`, r === nowRow ? ' now' : ''));
    }

    // the rect is always rowCount rows tall, so the drag bar works even when the song has fewer rows
    for (let r = Math.min(rows, top + rowCount) - top; r < rowCount; r++) lines.push(row(''));
    lines.push(row(''));
    const log = editor.log().slice(0, 5).map(esc).join(' < ');
    lines.push(row(`undo: ${log || 'nothing yet'}${editor.hasWaypoint() ? '   [waypoint set]' : ''}`));
    const html = lines.join('');
    if (html !== painted) { el.innerHTML = html; painted = html; }   // unchanged: leave the page alone
    const head = el.firstElementChild;
    if (lineMode && playing && head && playTick / CELL >= top && playTick / CELL < Math.min(rows, top + rowCount)) {
      playline.show(head.offsetTop + head.offsetHeight * (1 + playTick / CELL - top));
    } else playline.show(null);

    if (config.get('minimapOn')) minimap.paint({ lanes, first: top, last: Math.min(rows, top + rowCount), CELL, html, opts: { lengths: config.get('minimapLengths'), caps: config.get('minimapCaps'), params: config.get('minimapParams') } });
    else minimap.hide();

    const owner = here();
    const ownerPat = owner ? lane().patterns[owner.puid] : null;
    statusEl.textContent = [
      `lane ${cur.lane + 1}/${lanes.length} ${lane().id}`, `row ${curRow}/${rows - 1}`, `tick ${editTick()}`,
      ownerPat ? `${hex2(ownerPat.index)} "${ownerPat.name}" used ${lane().placements.filter(p => p.puid === owner.puid).length}x in this lane` : 'no pattern',
      lane().silenced ? 'silenced' : lane().soloMuted ? 'quiet: another lane is soloed' : lane().solo ? 'solo' : (lane().mask?.[rowStart(cur.tick)] & 3) && 'muted',
      picked && `selected ${picked.l1 - picked.l0 + 1}x${(picked.t1 - picked.t0) / CELL + 1}`, typed && `typing ${typed}`, message,
    ].filter(Boolean).join(' · ');
    if (listEl) {
      // The patterns of this lane: colour, two-digit shortcut, name and length; the one under the cursor is marked.
      const html = `<div class="ph"><span>${esc(lane().id)}: ${Object.keys(lane().patterns).length} patterns</span><span>len</span></div>${
        Object.entries(lane().patterns).sort((a, b) => a[1].index - b[1].index).map(([puid, p]) => {
          const { cls, style } = colourOf(p);
          return `<div class="pi${owner && owner.puid === puid ? ' here' : ''}"><span class="sw${cls ? ` ${cls}` : ''}"${style ? ` style="background:${style}"` : ''}> </span><span>${hex2(p.index)}</span><span class="pn">${esc(p.name)}</span><span class="pl">${p.length}</span></div>`;
        }).join('') || '<div class="pi">none yet</div>'}`;
      if (html !== lastList) { lastList = html; listEl.innerHTML = html; }
    }
  };

  const goto = (laneIdx, tick) => { cur.lane = laneIdx; cur.tick = rowStart(tick); typed = ''; sel = null; };
  const setRows = n => { rowCount = Math.max(ROWS.min, Math.min(ROWS.max, Math.round(n))); draw(); return rowCount; };
  // What the command console calls here: only the placement under the cursor can be cloned.
  const commands = {
    clone: () => { act('clone', editor.clone(cur.lane, editTick()), 'Cloned: this placement now has its own copy.'); draw(); return message; },
  };
  return { commands, draw, load, goto, setRows, resume() { const was = paused; paused = false; lastAuto = null; return was; }, say: m => { message = m; }, get rows() { return rowCount; }, get lane() { return cur.lane; }, get tick() { return cur.tick; } };
}
