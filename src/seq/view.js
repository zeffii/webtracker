import { KINDS, encodeCell, noteToken } from './cells.js';
import { esc } from './html.js';

// Piano keys: semitones above the base octave. Lower row Z..M with S D G H J as
// sharps, upper row Q..U one octave up with 2 3 5 6 7, then I O P with 9 0.
const LOWER = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11 };
const UPPER = { q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
const ROWS = 24;
const isBlank = token => /^\.+$/.test(token);
const isNote = token => /^[A-G][-#]\d$/.test(token);

// Which cell is under a point of the text grid? x is in characters from the left of the text, line
// is the line (the two header lines come first), top the first tick on screen. The layout is the
// one draw() writes: a four-character gutter, then each lane as a one-character marker and its
// columns separated by single spaces, with two spaces between lanes. Returns null in the header
// or the gutter; to the right of a lane's last column, or between lanes, it picks the nearest cell.
export function cellAt({ widths, x, line, top, len }) {
  const tick = top + line - 2;
  if (line < 2 || tick >= len || x < 4) return null;
  let start = 4, lane = 0;
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
export function createTrackerView({ el, statusEl, transport, onToggle, onBack, onMove }) {
  let lanes = null, len = 0, widths = [], editor = null;
  const cur = { lane: 0, tick: 0, col: 0, ch: 0 };
  let octave = 3, message = '';
  let sel = null;          // { lane, tick, col }: the corner opposite the cursor, while a rectangle is selected
  let clipboard = null;    // rows of { token, cell } from the last copy
  let top = 0;             // the first tick on screen, as last drawn

  const load = ({ lanes: l, song, editor: e }) => {
    lanes = l;
    len = song.length;
    editor = e;
    widths = lanes.map(lane => lane.columns.map(c => Math.max(c.label.length, KINDS[c.token].width)));
    Object.assign(cur, { lane: 0, tick: 0, col: 0, ch: 0 });
    message = '';
    sel = null;
  };

  // After a lane's columns change.
  const relayout = () => {
    widths = lanes.map(lane => lane.columns.map(c => Math.max(c.label.length, KINDS[c.token].width)));
    cur.col = Math.min(cur.col, lanes[cur.lane].columns.length - 1);
    cur.ch = Math.min(cur.ch, KINDS[lanes[cur.lane].columns[cur.col].token].width - 1);
  };

  const column = (li = cur.lane, ci = cur.col) => lanes[li].columns[ci];
  const cellWidth = (li = cur.lane, ci = cur.col) => KINDS[column(li, ci).token].width;
  const block = li => widths[li].reduce((a, w) => a + w, 0) + widths[li].length - 1;

  const moveRow = d => { cur.tick = (cur.tick + d + len) % len; };
  const moveLane = d => {
    cur.lane = (cur.lane + d + lanes.length) % lanes.length;
    cur.col = Math.min(cur.col, lanes[cur.lane].columns.length - 1);
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
  };
  // One character at a time, hopping to the next cell, column and lane at the ends.
  const moveChar = d => {
    cur.ch += d;
    if (cur.ch < 0) {
      if (--cur.col < 0) {
        cur.lane = (cur.lane + lanes.length - 1) % lanes.length;
        cur.col = lanes[cur.lane].columns.length - 1;
      }
      cur.ch = cellWidth() - 1;
    } else if (cur.ch >= cellWidth()) {
      if (++cur.col >= lanes[cur.lane].columns.length) {
        cur.lane = (cur.lane + 1) % lanes.length;
        cur.col = 0;
      }
      cur.ch = 0;
    }
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
        let next = null;
        if (k === '1') next = '===';
        else if (k === '`') next = '^^^';
        else {
          const n = Object.hasOwn(LOWER, k) ? LOWER[k] : Object.hasOwn(UPPER, k) ? UPPER[k] : null;
          if (n === null) return false;
          try { next = noteToken(octave * 12 + n); } catch { message = 'Note out of range.'; return true; }
        }
        if (write(next)) { cur.ch = 0; moveRow(1); }
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
    return cellAt({ widths, x: Math.floor(x), line: Math.floor(y), top, len });
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
      ArrowLeft: () => { cur.col = clamp(cur.col - 1, 0, lanes[cur.lane].columns.length - 1); }, ArrowRight: () => { cur.col = clamp(cur.col + 1, 0, lanes[cur.lane].columns.length - 1); },
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
      case 'ArrowLeft': moveChar(-1); break;
      case 'ArrowRight': moveChar(1); break;
      case 'Tab': moveLane(e.shiftKey ? -1 : 1); break;
      case 'PageUp': moveRow(-16); break;
      case 'PageDown': moveRow(16); break;
      case 'Home': cur.tick = 0; break;
      case 'End': cur.tick = len - 1; break;
      case ' ': onToggle(); break;
      case '[': octave = Math.max(0, octave - 1); message = `Octave ${octave}`; break;
      case ']': octave = Math.min(9, octave + 1); message = `Octave ${octave}`; break;
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

  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    top = Math.max(0, Math.min(cur.tick - 8, len - ROWS));
    const r = sel ? rect() : null;
    const lines = [
      `    ${lanes.map((l, li) => ` ${esc(l.id.padEnd(block(li)))}`).join('  ')}`,
      `    ${lanes.map((l, li) => ` ${l.columns.map((c, ci) => esc(c.label.padEnd(widths[li][ci]))).join(' ')}`).join('  ')}`,
    ];
    for (let t = top; t < Math.min(len, top + ROWS); t++) {
      const chunks = lanes.map((lane, li) => {
        const mark = lane.placements.some(p => p.start === t) ? '▌' : ' ';   // a pattern starts here
        const covered = lane.placements.some(p => t >= p.start && t < p.start + p.length);   // else no pattern here
        return mark + lane.columns.map((c, ci) => {
          const text = lane.rows[t][ci].padEnd(widths[li][ci]);
          const isCur = li === cur.lane && ci === cur.col && t === cur.tick;
          // Characters one at a time so the cursor and the command id can each be styled.
          const html = Array.from(text, (ch, i) => {
            const cls = [isCur && i === cur.ch ? 'cur' : '', c.token === 'cmd' && i < 2 ? 'cc' : ''].filter(Boolean).join(' ');
            return cls ? `<span class="${cls}">${esc(ch)}</span>` : esc(ch);
          }).join('');
          const picked = r && li === r.lane && t >= r.t0 && t <= r.t1 && ci >= r.c0 && ci <= r.c1;
          if (isCur) return `<span class="cell${picked ? ' sel' : ''}">${html}</span>`;
          if (picked) return `<span class="sel">${html}</span>`;
          return covered ? html : `<span class="off">${html}</span>`;
        }).join(' ');
      });
      const row = `${playing && t === playTick ? '>' : ' '}${String(t).padStart(2, '0')} ${chunks.join('  ')}`;
      lines.push(playing && t === playTick ? `<b>${row}</b>` : row);
    }
    el.innerHTML = lines.join('\n');
    statusEl.textContent = [
      lanes[cur.lane].id, `row ${cur.tick}`, column().label, `char ${cur.ch + 1}/${cellWidth()}`,
      sel ? `selected ${size(rect())}` : '', `octave ${octave}`, message,
    ].filter(Boolean).join(' · ');
  };

  const goto = (laneIdx, tick) => {
    cur.lane = laneIdx;
    cur.tick = tick;
    cur.col = Math.min(cur.col, lanes[laneIdx].columns.length - 1);
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
    message = '';
  };

  return { draw, load, goto, relayout };
}
