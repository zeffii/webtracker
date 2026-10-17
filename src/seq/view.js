import { setLoopPoint } from './loop.js';
import { KINDS, encodeCell, noteSemitones, noteToken } from './cells.js';
import { esc } from './html.js';
import { describeColumn } from './describe.js';

import { LOWER, UPPER } from './piano.js';
const ROWS = { min: 6, max: 128, normal: 24 };   // rows shown at once
const isBlank = token => /^\.+$/.test(token);
const isNote = token => /^[A-G][-#]\d$/.test(token);

// Which cell is under a point of the text grid? x is in characters from the left of the text, line
// is the line (the two header lines come first), top the first tick on screen. The layout is the
// one draw() writes: a six-character gutter (playhead marker, four digits of tick, a space), then each lane as a one-character marker and its
// columns separated by single spaces, with two spaces between lanes. Returns null in the header
// or the gutter; to the right of a lane's last column, or between lanes, it picks the nearest cell.
export const GUTTER = 6;
export function cellAt({ widths, x, line, top, len }) {
  const tick = top + line - 2;
  if (line < 2 || tick >= len || x < GUTTER) return null;
  let start = GUTTER, lane = 0;
  const starts = widths.map(w => { const s = start; start += 1 + w.reduce((a, b) => a + b, 0) + w.length - 1 + 2; return s; });
  starts.forEach((s, i) => { if (x >= s) lane = i; });
  let col = 0, at = starts[lane] + 1;
  widths[lane].forEach((w, ci) => { if (x >= at) col = ci; at += w + 1; });
  const colStart = starts[lane] + 1 + widths[lane].slice(0, col).reduce((a, b) => a + b + 1, 0);
  return { lane, tick, col, ch: Math.max(0, Math.min(widths[lane][col] - 1, x - colStart)) };
}

// Keyboard-driven view of every lane side by side. The cursor sits on one character
// of one cell. Edits go straight into the shared pages, so they are heard on the next
// tick while the song plays. Call load() with the prepared lanes before drawing.
export function createTrackerView({ el, statusEl, transport, onToggle, onBack, onMove, onNote = () => {}, onSong = () => {}, readParam = () => undefined }) {
  let lanes = null, len = 0, widths = [], editor = null, song = null;
  const cur = { lane: 0, tick: 0, col: 0, ch: 0 };
  let octave = 3, message = '';
  let sel = null;          // { lane, tick, col }: the corner opposite the cursor, while a rectangle is selected
  let clipboard = null;    // rows of { token, cell } from the last copy
  let top = 0;             // the first tick on screen, as last drawn
  // Hiding empty columns, lane by lane (Ctrl+Shift+H, for the lane the cursor is in). A hidden column has no value at
  // any row of the lane; the column the cursor is in always stays, so nothing disappears from under it. The cursor
  // steps over hidden columns; show them again to type into one.
  const compact = new Set();   // indexes of the lanes whose empty columns are hidden
  let vis = [];                // the columns shown in each lane, as of the last draw
  let shownAt = '';        // where the cursor was when the view last scrolled sideways to follow it
  let rowCount = ROWS.normal;   // how many rows are shown; the drag bar under the view changes it

  // The whole view is measured in characters and lines of its monospace font, so its size is the font size.
  // Ctrl + and Ctrl - (or Ctrl + wheel) change it, Ctrl 0 puts it back; it is remembered.
  const SIZES = { min: 8, max: 40, normal: 13 };
  let fontPx = SIZES.normal;
  try { fontPx = Number(localStorage.getItem('patternFontSize')) || SIZES.normal; } catch {}
  const setSize = px => {
    fontPx = Math.max(SIZES.min, Math.min(SIZES.max, px));
    if (el.style) el.style.fontSize = `${fontPx}px`;
    try { localStorage.setItem('patternFontSize', String(fontPx)); } catch {}
    message = `Font ${fontPx}px.`;
    draw();
    return fontPx;
  };
  if (el.style) el.style.fontSize = `${fontPx}px`;
  // Note preview: with it on, a note typed into the grid also sounds on that lane's instrument, for as long
  // as the key is held. Backslash or Insert switches it on and off; it is remembered.
  let preview = false;
  try { preview = localStorage.getItem('patternPreview') === '1'; } catch {}
  const sounding = new Map();   // key -> { instrument, note }, so the release stops what the press started
  const stopSound = k => { const s = sounding.get(k); if (s) { onNote(s.instrument, s.note, false); sounding.delete(k); } };
  const startSound = (k, note) => {
    stopSound(k);
    const l = lanes[cur.lane], vel = l.rows[cur.tick][cur.col + 1];
    const v = l.columns[cur.col + 1]?.kind === 'vel' && /^[0-9A-F]{2}$/i.test(vel ?? '') ? Math.max(0.05, parseInt(vel, 16) / 255) : 1;
    sounding.set(k, { instrument: l.instrument, note });
    onNote(l.instrument, note, true, v);
  };
  el.addEventListener('keyup', e => stopSound(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  el.addEventListener('blur', () => { for (const k of [...sounding.keys()]) stopSound(k); });
  // The wheel scrolls the rows without moving the cursor; the view follows the cursor again as soon as it moves.
  let wheelAcc = 0, scrolledFor = null;
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) { setSize(fontPx + (e.deltaY < 0 ? 1 : -1)); return; }
    if (!lanes || e.deltaY === 0) return;
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    const rows = Math.trunc(wheelAcc / 25);   // a notch of a mouse wheel is about four rows
    if (!rows) return;
    wheelAcc -= rows * 25;
    top = Math.max(0, Math.min(top + rows, len - rowCount));
    scrolledFor = `${cur.lane},${cur.tick}`;
  }, { passive: false });

  const load = ({ lanes: l, song: s, editor: e }) => {
    lanes = l;
    len = s.length;
    song = s;
    editor = e;
    widths = lanes.map(lane => lane.columns.map(c => Math.max((c.short ?? c.label).length, KINDS[c.token].width)));
    Object.assign(cur, { lane: 0, tick: 0, col: 0, ch: 0 });
    message = '';
    sel = null;
  };

  // After a lane's columns change.
  const relayout = () => {
    widths = lanes.map(lane => lane.columns.map(c => Math.max((c.short ?? c.label).length, KINDS[c.token].width)));
    cur.col = Math.min(cur.col, lanes[cur.lane].columns.length - 1);
    cur.ch = Math.min(cur.ch, KINDS[lanes[cur.lane].columns[cur.col].token].width - 1);
  };

  const column = (li = cur.lane, ci = cur.col) => lanes[li].columns[ci];
  const cellWidth = (li = cur.lane, ci = cur.col) => KINDS[column(li, ci).token].width;
  const block = li => vis[li].reduce((a, ci) => a + widths[li][ci], 0) + vis[li].length - 1;

  // The columns of a lane that are shown. `keep` is a column that stays whatever it holds (the cursor's, in its own lane).
  const visibleCols = (li, keep = li === cur.lane ? cur.col : -1) => {
    const all = lanes[li].columns.map((_, ci) => ci);
    if (!compact.has(li)) return all;
    const rows = lanes[li].rows, shown = all.filter(ci => ci === keep || rows.some(r => !isBlank(r[ci])));
    return shown.length ? shown : [keep >= 0 ? keep : 0];
  };
  const nearest = (cols, ci) => cols.reduce((best, c) => (Math.abs(c - ci) < Math.abs(best - ci) ? c : best), cols[0]);
  const neighbour = (li, ci, dir) => { const v = visibleCols(li), i = v.indexOf(ci); return i < 0 ? nearest(v, ci) : v[i + dir] ?? -1; };
  const snapCol = () => { cur.col = nearest(visibleCols(cur.lane, -1), Math.min(cur.col, lanes[cur.lane].columns.length - 1)); };

  const moveRow = d => { cur.tick = (cur.tick + d + len) % len; };
  const moveLane = d => {
    cur.lane = (cur.lane + d + lanes.length) % lanes.length;
    snapCol();
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
  };
  // One character at a time, hopping to the next cell, column and lane at the ends.
  const moveChar = d => {
    cur.ch += d;
    if (cur.ch < 0) {
      const prev = neighbour(cur.lane, cur.col, -1);
      if (prev < 0) {
        cur.lane = (cur.lane + lanes.length - 1) % lanes.length;
        cur.col = visibleCols(cur.lane, -1).at(-1);
      } else cur.col = prev;
      cur.ch = cellWidth() - 1;
    } else if (cur.ch >= cellWidth()) {
      const next = neighbour(cur.lane, cur.col, 1);
      if (next < 0) {
        cur.lane = (cur.lane + 1) % lanes.length;
        cur.col = visibleCols(cur.lane, -1)[0];
      } else cur.col = next;
      cur.ch = 0;
    }
  };

  // A held arrow key (the repeats the browser sends) moves a whole column at a time, to the start of it: to the right,
  // the next column; to the left, the start of this column, and then of each one before it. Lanes are hopped at the ends.
  const moveColumn = d => {
    if (d < 0 && cur.ch > 0) { cur.ch = 0; return; }
    const there = neighbour(cur.lane, cur.col, d);
    if (there >= 0) cur.col = there;
    else {
      cur.lane = (cur.lane + d + lanes.length) % lanes.length;
      const cols = visibleCols(cur.lane, -1);
      cur.col = d > 0 ? cols[0] : cols.at(-1);
    }
    cur.ch = 0;
  };

  // The selected rectangle (or just the cursor's cell): ticks t0..t1 and columns c0..c1 of one lane.
  const rect = () => {
    const a = sel ?? { lane: cur.lane, tick: cur.tick, col: cur.col };
    return { lane: cur.lane, t0: Math.min(a.tick, cur.tick), t1: Math.max(a.tick, cur.tick), c0: Math.min(a.col, cur.col), c1: Math.max(a.col, cur.col) };
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const blankAll = r => {
    const items = [];
    for (let t = r.t0; t <= r.t1; t++) for (let c = r.c0; c <= r.c1; c++) items.push({ tick: t, col: c, token: KINDS[column(r.lane, c).token].blank });
    return items;
  };
  const copy = () => {
    const r = rect(), lane = lanes[r.lane];
    clipboard = [];
    for (let t = r.t0; t <= r.t1; t++) clipboard.push(Array.from({ length: r.c1 - r.c0 + 1 }, (_, i) => ({ token: lane.columns[r.c0 + i].token, cell: lane.rows[t][r.c0 + i] })));
    const text = clipboard.map(row => row.map(c => c.cell).join(' ')).join('\n');
    try { globalThis.navigator?.clipboard?.writeText(text)?.catch(() => {}); } catch { /* the in-page clipboard is enough */ }
    return r;
  };
  const size = r => `${r.t1 - r.t0 + 1}x${r.c1 - r.c0 + 1}`;
  // Pastes at the cursor (the top left of a selection). A cell goes only into a column of the same
  // kind, and only where a pattern is, so notes land in note columns and nothing is written into
  // empty space.
  const paste = () => {
    if (!clipboard) { message = 'Nothing copied.'; return; }
    const r = sel ? rect() : { lane: cur.lane, t0: cur.tick, c0: cur.col };
    const lane = lanes[r.lane], items = [];
    let skipped = 0;
    clipboard.forEach((row, i) => row.forEach((c, j) => {
      const tick = r.t0 + i, col = r.c0 + j;
      if (tick >= len || col >= lane.columns.length || lane.columns[col].token !== c.token) { skipped++; return; }
      items.push({ tick, col, token: c.cell });
    }));
    const changed = editor.setCells(r.lane, items, 'paste');
    message = changed ? `Pasted ${size({ t0: 0, t1: clipboard.length - 1, c0: 0, c1: clipboard[0].length - 1 })}${skipped ? `, ${skipped} cells did not fit` : ''}.`
      : skipped ? 'Nothing fits here.' : 'Nothing changed (is there a pattern here?).';
    sel = null;
  };

  // Transposing the selection (or the cell under the cursor). Notes move by semitones (Shift: octaves); every other
  // value moves by one (Shift: a bigger step, one digit up), stopping at its ends. A command's id is left alone.
  // Blank cells stay blank.
  const STEP = { '1hex': [1, 1], '2hex': [1, 16], '4hex': [1, 256], cmd: [1, 256] };
  const transpose = (notes, dir, big) => {
    const r = rect(), lane = lanes[r.lane], items = [];
    let skipped = 0;
    for (let t = r.t0; t <= r.t1; t++) {
      for (let c = r.c0; c <= r.c1; c++) {
        const kind = lane.columns[c].token, token = lane.rows[t][c];
        if (isBlank(token)) continue;
        if (notes) {
          const s = kind === 'note' ? noteSemitones(token) : null;
          if (s === null) continue;
          try { if (s + dir * (big ? 12 : 1) < 0) throw new Error('low'); items.push({ tick: t, col: c, token: noteToken(s + dir * (big ? 12 : 1)) }); } catch { skipped++; }
        } else if (kind !== 'note') {
          const head = kind === 'cmd' ? token.slice(0, 2) : '', digits = KINDS[kind].width - head.length;
          const v = parseInt(token.slice(head.length), 16), max = 16 ** digits - 1;
          const next = clamp(v + dir * STEP[kind][big ? 1 : 0], 0, max);
          if (next !== v) items.push({ tick: t, col: c, token: head + next.toString(16).toUpperCase().padStart(digits, '0') });
        }
      }
    }
    const changed = items.length && editor.setCells(r.lane, items, notes ? 'transpose notes' : 'transpose values');
    message = changed ? `${notes ? 'Transposed' : 'Moved'} ${items.length} ${notes ? 'notes' : 'values'}${skipped ? `, ${skipped} out of range` : ''}.`
      : skipped ? 'Out of range.' : `No ${notes ? 'notes' : 'values'} to change (is there a pattern here?).`;
  };

  // Fills the rows between the first and last row of the selection with a straight line from one end to the other,
  // column by column. Notes, 2hex and 4hex columns take part; command and 1hex columns are left alone, and so is
  // a column whose first or last cell is empty (or, for notes, is not a note).
  const interpolate = () => {
    const r = rect(), lane = lanes[r.lane], items = [];
    if (r.t1 - r.t0 < 2) { message = 'Select at least three rows to interpolate between.'; return; }
    for (let c = r.c0; c <= r.c1; c++) {
      const kind = lane.columns[c].token, a = lane.rows[r.t0][c], b = lane.rows[r.t1][c];
      if (kind === 'cmd' || kind === '1hex' || isBlank(a) || isBlank(b)) continue;
      const isN = kind === 'note', va = isN ? noteSemitones(a) : parseInt(a, 16), vb = isN ? noteSemitones(b) : parseInt(b, 16);
      if (va === null || vb === null || Number.isNaN(va) || Number.isNaN(vb)) continue;
      for (let t = r.t0 + 1; t < r.t1; t++) {
        const v = Math.round(va + ((vb - va) * (t - r.t0)) / (r.t1 - r.t0));
        items.push({ tick: t, col: c, token: isN ? noteToken(v) : v.toString(16).toUpperCase().padStart(KINDS[kind].width, '0') });
      }
    }
    const changed = items.length && editor.setCells(r.lane, items, 'interpolate');
    message = changed ? `Interpolated ${items.length} cells.` : 'Nothing to interpolate: each column needs a value at both ends (command and 1hex columns are skipped).';
  };

  // Takes a parameter's live value (a slider, or whatever the song last wrote) and turns it into the cell that would
  // write it back: the inverse of how the sequencer reads a cell. Ctrl+Enter writes it into the cursor's cell and moves
  // down a row, so a sweep can be recorded with one key press per row; Ctrl+Shift+Enter writes the live values of every
  // parameter column of the row at once (not the notes, velocities or commands) and moves down.
  const liveToken = col => {
    const v = readParam(col.slot);
    if (!Number.isFinite(v)) return null;
    const x = col.int ? v - col.min : col.log ? (Math.log(v / col.min) / Math.log(col.max / col.min)) * col.denom : ((v - col.min) / (col.max - col.min)) * col.denom;
    return clamp(Math.round(x), 0, col.denom).toString(16).toUpperCase().padStart(KINDS[col.token].width, '0');
  };
  const insertLive = whole => {
    const lane = lanes[cur.lane], items = [];
    lane.columns.forEach((col, c) => {
      if (col.kind !== 'param' || (!whole && c !== cur.col)) return;
      const token = liveToken(col);
      if (token !== null) items.push({ tick: cur.tick, col: c, token });
    });
    if (!items.length) { message = whole ? 'This lane has no parameter columns with a live value.' : 'Only parameter columns have a live value; move to one.'; return; }
    if (editor.setCells(cur.lane, items, 'insert live value')) { message = `Inserted ${items.length} live ${items.length === 1 ? 'value' : 'values'}.`; moveRow(1); }
    else message = 'No pattern here. Press Enter to insert one.';
  };

  const write = token => {
    if (editor.setCell(cur.lane, cur.tick, cur.col, token)) { message = ''; return true; }
    message = 'No pattern here. Press Enter to insert one.';
    return false;
  };
  // After typing a character: the next character, or the next row after the last one.
  const advance = () => {
    if (cur.ch + 1 < cellWidth()) cur.ch += 1;
    else { cur.ch = 0; moveRow(1); }
  };

  // Returns true if the key was used.
  const typeKey = k => {
    const kind = column().token, old = lanes[cur.lane].rows[cur.tick][cur.col];
    if (kind === 'note') {
      if (cur.ch === 0) {   // first character: a whole note at once
        let next = null, note = null;
        if (k === '1') next = '===';
        else if (k === '`') next = '^^^';
        else {
          const n = Object.hasOwn(LOWER, k) ? LOWER[k] : Object.hasOwn(UPPER, k) ? UPPER[k] : null;
          if (n === null) return false;
          try { next = noteToken(octave * 12 + n); } catch { message = 'Note out of range.'; return true; }
          note = octave * 12 + n;
        }
        if (write(next)) {
          if (preview && note !== null) startSound(k, note);   // before the cursor moves: the velocity is read from this row
          cur.ch = 0; moveRow(1);
        }
        return true;
      }
      // Second and third characters edit a note that is already there.
      let next = null;
      if (cur.ch === 1 && (k === '-' || k === '#')) next = old[0] + k + old[2];
      else if (cur.ch === 2 && /^\d$/.test(k)) next = old.slice(0, 2) + k;
      else return false;
      if (!isNote(old)) { message = 'Only a filled note can be edited by character.'; return true; }
      try { encodeCell(next, 'note'); } catch { message = 'Not a valid note.'; return true; }
      if (write(next)) advance();
      return true;
    }
    if (!/^[0-9a-f]$/.test(k)) return false;
    // An empty cell becomes zeros with this digit in place; a filled cell changes one character.
    const base = isBlank(old) ? '0'.repeat(cellWidth()) : old;
    if (write(base.slice(0, cur.ch) + k.toUpperCase() + base.slice(cur.ch + 1))) advance();
    return true;
  };

  // The size of one character and line of the text, and where it starts inside the element.
  const metrics = () => {
    const cs = getComputedStyle(el), probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font};line-height:${cs.lineHeight}`;
    probe.textContent = 'MMMMMMMMMM\nMMMMMMMMMM';
    el.parentNode.appendChild(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    return { cw: box.width / 10, lh: box.height / 2, left: el.clientLeft + parseFloat(cs.paddingLeft), up: el.clientTop + parseFloat(cs.paddingTop) };
  };
  let dragging = null;   // the cell where a mouse drag began
  const pointed = e => {
    const m = metrics(), box = el.getBoundingClientRect();
    const x = (e.clientX - box.left - m.left + el.scrollLeft) / m.cw, y = (e.clientY - box.top - m.up + el.scrollTop) / m.lh;
    // measured on the columns that are shown, then translated back to the lane's own column numbers
    const hit = cellAt({ widths: widths.map((w, li) => w.filter((_, ci) => (vis[li] ?? w.map((__, i) => i)).includes(ci))), x: Math.floor(x), line: Math.floor(y), top, len });
    return hit && { ...hit, col: (vis[hit.lane] ?? [])[hit.col] ?? hit.col };
  };
  el.addEventListener('mousedown', e => {
    if (!lanes || e.button !== 0) return;
    const hit = pointed(e);
    if (!hit) return;
    const was = [cur.lane, cur.tick];
    Object.assign(cur, hit);
    sel = null;
    dragging = { lane: hit.lane, tick: hit.tick, col: hit.col };
    message = '';
    el.focus?.();
    if (onMove && (cur.lane !== was[0] || cur.tick !== was[1])) onMove(cur.lane, cur.tick);
  });
  el.addEventListener('mousemove', e => {
    if (!lanes || !dragging || !(e.buttons & 1)) return;
    const hit = pointed(e);
    if (!hit) return;
    // a rectangle stays in the lane where the drag began
    const last = lanes[dragging.lane].columns.length - 1;
    const col = hit.lane < dragging.lane ? 0 : hit.lane > dragging.lane ? last : hit.col;
    if (col === dragging.col && hit.tick === dragging.tick) { sel = null; return; }
    sel = { ...dragging };
    Object.assign(cur, { lane: dragging.lane, tick: hit.tick, col, ch: 0 });
  });
  const stopDrag = () => { dragging = null; };
  el.addEventListener('mouseup', stopDrag);
  el.addEventListener('mouseleave', stopDrag);

  el.addEventListener('keydown', e => {
    if (!lanes || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
        e.preventDefault();
        setSize(key === '0' ? SIZES.normal : fontPx + (key === '-' || key === '_' ? -1 : 1));
        return;
      }
      if (key === 'arrowup' || key === 'arrowdown') { transpose(true, key === 'arrowup' ? 1 : -1, e.shiftKey); e.preventDefault(); return; }
      if (key === 'arrowleft' || key === 'arrowright') { transpose(false, key === 'arrowright' ? 1 : -1, e.shiftKey); e.preventDefault(); return; }
      if (key === 'h' && e.shiftKey) {   // hide or show the empty columns of the lane the cursor is in
        const li = cur.lane, on = !compact.has(li);
        if (on) compact.add(li); else compact.delete(li);
        message = on ? `Hiding empty columns in ${lanes[li].id}.` : `Showing every column of ${lanes[li].id}.`;
        e.preventDefault(); return;
      }
      if ((key === 'b' || key === 'e') && !e.shiftKey) {   // the loop: Ctrl+B starts it at this tick, Ctrl+E ends it with this tick
        message = key === 'b' ? setLoopPoint(song, 'start', cur.tick) : setLoopPoint(song, 'end', cur.tick + 1);
        onSong();
        e.preventDefault(); return;
      }
      if (key === 'enter') { insertLive(e.shiftKey); e.preventDefault(); return; }
      if (key === 'i') { interpolate(); e.preventDefault(); return; }
      if (key === 'z' || key === 'y') {
        const redo = key === 'y' || e.shiftKey;
        const label = redo ? editor.redo() : editor.undo();
        message = label ? `${redo ? 'Redid' : 'Undid'} ${label}.` : `Nothing to ${redo ? 'redo' : 'undo'}.`;
        sel = null;
        e.preventDefault();
      } else if (key === 'c' || key === 'x') {
        const r = copy();
        if (key === 'x') {
          editor.setCells(r.lane, blankAll(r), 'cut');
          message = `Cut ${size(r)} cells.`;
        } else message = `Copied ${size(r)} cells.`;
        e.preventDefault();
      } else if (key === 'v') {
        paste();
        e.preventDefault();
      } else if (key === 'a') {   // the whole lane
        sel = { lane: cur.lane, tick: 0, col: 0 };
        cur.tick = len - 1; cur.col = lanes[cur.lane].columns.length - 1; cur.ch = 0;
        message = 'Selected the lane.';
        e.preventDefault();
      }
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const was = [cur.lane, cur.tick];
    let used = true;
    // Shift with a movement key grows a rectangle from where the cursor was, by whole cells and
    // within the lane; Delete clears it; any other key drops it.
    const grow = { ArrowUp: () => { cur.tick = clamp(cur.tick - 1, 0, len - 1); }, ArrowDown: () => { cur.tick = clamp(cur.tick + 1, 0, len - 1); },
      ArrowLeft: () => { const n = neighbour(cur.lane, cur.col, -1); if (n >= 0) cur.col = n; }, ArrowRight: () => { const n = neighbour(cur.lane, cur.col, 1); if (n >= 0) cur.col = n; },
      PageUp: () => { cur.tick = clamp(cur.tick - 16, 0, len - 1); }, PageDown: () => { cur.tick = clamp(cur.tick + 16, 0, len - 1); },
      Home: () => { cur.tick = 0; }, End: () => { cur.tick = len - 1; } };
    if (e.shiftKey && Object.hasOwn(grow, k)) {
      sel ??= { lane: cur.lane, tick: cur.tick, col: cur.col };
      grow[k]();
      cur.ch = 0;
      e.preventDefault();
      if (onMove && cur.tick !== was[1]) onMove(cur.lane, cur.tick);
      return;
    }
    if (sel && (k === 'Delete' || k === 'Backspace')) {
      const r = rect();
      editor.setCells(r.lane, blankAll(r), 'clear cells');
      message = `Cleared ${size(r)} cells.`;
      e.preventDefault();
      return;
    }
    if (sel && k === 'Escape') { sel = null; message = ''; e.preventDefault(); return; }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(k)) sel = null;
    switch (k) {
      case 'ArrowUp': moveRow(-1); break;
      case 'ArrowDown': moveRow(1); break;
      case 'ArrowLeft': if (e.repeat) moveColumn(-1); else moveChar(-1); break;
      case 'ArrowRight': if (e.repeat) moveColumn(1); else moveChar(1); break;
      case 'Tab': moveLane(e.shiftKey ? -1 : 1); break;
      case 'PageUp': moveRow(-16); break;
      case 'PageDown': moveRow(16); break;
      case 'Home': cur.tick = 0; break;
      case 'End': cur.tick = len - 1; break;
      case ' ': onToggle(); break;
      case '[': octave = Math.max(0, octave - 1); message = `Octave ${octave}`; break;
      case ']': octave = Math.min(9, octave + 1); message = `Octave ${octave}`; break;
      case '\\': case 'Insert':   // note preview on or off
        preview = !preview;
        try { localStorage.setItem('patternPreview', preview ? '1' : '0'); } catch {}
        message = `Note preview ${preview ? 'on: typed notes sound' : 'off'}.`;
        break;
      case 'Escape': message = ''; onBack(); break;
      case 'Enter':
        message = editor.insertPattern(cur.lane, cur.tick) ? 'Pattern inserted.' : 'A pattern is already here.';
        break;
      case 'Delete':
      case 'Backspace':
        write(KINDS[column().token].blank);   // clearing does not advance
        break;
      default: used = typeKey(k);
    }
    if (used) e.preventDefault();
    if (onMove && (cur.lane !== was[0] || cur.tick !== was[1])) onMove(cur.lane, cur.tick);   // keep the arrangement in step
  });

  // The name of the pattern that owns the tick under the cursor: the one that started last.
  const patternName = () => {
    const l = lanes[cur.lane];
    const pl = l.placements.filter(p => cur.tick >= p.start && cur.tick < p.start + p.length).sort((a, b) => b.start - a.start)[0];
    return pl ? l.patterns[pl.puid]?.name : 'no pattern';
  };
  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    // The window stays where it is while the cursor is inside it (so clicking does not move the grid); when the
    // cursor leaves it, the window jumps to put the cursor a few rows in from the top.
    if (scrolledFor !== `${cur.lane},${cur.tick}`) scrolledFor = null;
    if (!scrolledFor && (cur.tick < top || cur.tick >= top + rowCount)) top = cur.tick - Math.min(8, rowCount >> 2);
    top = Math.max(0, Math.min(top, len - rowCount));
    const r = sel ? rect() : null;
    vis = lanes.map((_, li) => visibleCols(li));
    const lines = [
      `<span class="g">${' '.repeat(GUTTER)}</span>${lanes.map((l, li) => ` ${esc(l.id.padEnd(block(li)))}`).join('  ')}`,
      `<span class="g">${' '.repeat(GUTTER)}</span>${lanes.map((l, li) => ` ${vis[li].map(ci => esc((l.columns[ci].short ?? l.columns[ci].label).padEnd(widths[li][ci]))).join(' ')}`).join('  ')}`,
    ];
    for (let t = top; t < Math.min(len, top + rowCount); t++) {
      const chunks = lanes.map((lane, li) => {
        const mark = lane.placements.some(p => p.start === t) ? '<span class="ps">▌</span>' : ' ';   // a pattern starts here
        const covered = lane.placements.some(p => t >= p.start && t < p.start + p.length);   // else no pattern here
        return mark + vis[li].map(ci => {
          const c = lane.columns[ci];
          const text = lane.rows[t][ci].padEnd(widths[li][ci]);
          const isCur = li === cur.lane && ci === cur.col && t === cur.tick;
          // Characters one at a time so the cursor and the command id can each be styled.
          const html = Array.from(text, (ch, i) => {
            const cls = [isCur && i === cur.ch ? 'cur' : '', c.token === 'cmd' && i < 2 ? 'cc' : ''].filter(Boolean).join(' ');
            return cls ? `<span class="${cls}">${esc(ch)}</span>` : esc(ch);
          }).join('').replace(/\.+/g, dots => `<span class="d">${dots}</span>`);   // empty digits, dimmer
          const picked = r && li === r.lane && t >= r.t0 && t <= r.t1 && ci >= r.c0 && ci <= r.c1;
          if (isCur) return `<span class="cell${picked ? ' sel' : ''}">${html}</span>`;
          if (picked) return `<span class="sel">${html}</span>`;
          return covered ? html : `<span class="off">${html}</span>`;
        }).join(' ');
      });
      const inLoop = song.loop && t >= song.loop.start && t < song.loop.end;
      const edge = inLoop ? `${t === song.loop.start ? ' ls' : ''}${t === song.loop.end - 1 ? ' le' : ''}` : '';
      const row = `<span class="g${inLoop ? ` lp${edge}` : ''}">${playing && t === playTick ? '>' : ' '}${String(t).padStart(4, '0')} </span>${chunks.join('  ')}`;
      const shade = t % 16 === 0 ? 'r16' : t % 4 === 0 ? 'r4' : '';
      const line = playing && t === playTick ? `<b>${row}</b>` : row;
      lines.push(shade ? `<span class="${shade}">${line}</span>` : line);
    }
    while (lines.length < 2 + rowCount) lines.push('');   // always rowCount rows tall, so the drag bar works on a short song
    el.innerHTML = lines.join('\n');
    // When the cursor has moved, scroll sideways just far enough to keep it in view, clear of the sticky tick numbers.
    const where = `${cur.lane}:${cur.col}:${cur.ch}`;
    if (where !== shownAt && el.querySelector) {
      shownAt = where;
      const caret = el.querySelector('.cur'), gutter = el.querySelector('.g');
      if (caret && el.scrollWidth > el.clientWidth) {
        const box = el.getBoundingClientRect(), c = caret.getBoundingClientRect(), pad = c.width * 3;
        const left = box.left + (gutter ? gutter.getBoundingClientRect().width : 0) + pad;
        if (c.left < left) el.scrollLeft -= left - c.left;
        else if (c.right + pad > box.right) el.scrollLeft += c.right + pad - box.right;
      }
    }
    statusEl.textContent = [
      lanes[cur.lane].id, compact.has(cur.lane) ? 'empty columns hidden' : '', `row ${cur.tick}`, patternName(), describeColumn(lanes[cur.lane], cur.tick, cur.col), `char ${cur.ch + 1}/${cellWidth()}`, preview ? 'preview on' : '',
      sel ? `selected ${size(rect())}` : '', `octave ${octave}`, message,
    ].filter(Boolean).join(' · ');
  };

  const goto = (laneIdx, tick) => {
    cur.lane = laneIdx;
    cur.tick = tick;
    snapCol();
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
    message = '';
  };

  const setRows = n => { rowCount = Math.max(ROWS.min, Math.min(ROWS.max, Math.round(n))); draw(); return rowCount; };
  const lineHeight = () => (lanes ? metrics().lh : 18);
  return { draw, load, goto, relayout, setSize, setRows, lineHeight, get rows() { return rowCount; }, get fontPx() { return fontPx; }, get preview() { return preview; } };
}
