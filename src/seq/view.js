import { setLoopPoint } from './loop.js';
import * as config from '../ui/config.js';
import { dimLevel, dimFilter } from '../ui/dim.js';
import { createPlayline } from '../ui/playline.js';
import { patternColour } from '../ui/patcolor.js';
import { KINDS, encodeCell, noteSemitones, noteToken } from './cells.js';
import { esc } from './html.js';
import { describeColumn, describeParts } from './describe.js';
import { placementAt } from './edit.js';
import { showContextMenu } from '../ui/ctxmenu.js';
import { showCurvePopup } from '../ui/curvepop.js';
import { newCurve, sampleTable } from './curve.js';

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
export function createTrackerView({ showMenu = (e, items) => showContextMenu(e, items), showCurve = opts => showCurvePopup(opts), random = Math.random, el, statusEl, transport, onToggle, onBack, onMove, onRow = () => {}, onNote = () => {}, onSong = () => {}, readParam = () => undefined, follow = () => false }) {
  let lanes = null, len = 0, widths = [], editor = null, song = null;
  // Solo-edit: one placement of one pattern, shown on its own with its rows numbered from 0. Nothing else can be reached.
  // lo..hi is its span of song ticks; hi is the song's length when not in solo-edit and lo is 0.
  let solo = null, lo = 0, hi = 0;
  // Two ways to show it: 'window' (only the pattern, rows from 0) or 'hatch' (the whole song, everything but the pattern greyed
  // and hatched and locked). Tab flips between them while in solo-edit; it is remembered.
  let soloStyle = 'window';
  soloStyle = config.get('soloStyle');
  const windowed = () => solo !== null && soloStyle === 'window';   // only the pattern is on screen
  const showLo = () => (windowed() ? lo : 0), showHi = () => (windowed() ? hi : len);
  const cur = { lane: 0, tick: 0, col: 0, ch: 0 };
  let octave = 3, message = '';
  let paused = false, lastAuto = null;   // following the song, and the row it last put the caret on
  let nugget = false;      // inside a cell: Left/Right step one character at a time until the next step would leave the cell
  let lastStatus = '';
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
  fontPx = config.get('fontSize');
  const setSize = px => {
    fontPx = Math.max(SIZES.min, Math.min(SIZES.max, px));
    if (el.style) el.style.fontSize = `${fontPx}px`;
    config.set('fontSize', fontPx);
    message = `Font ${fontPx}px.`;
    draw();
    return fontPx;
  };
  if (el.style) el.style.fontSize = `${fontPx}px`;
  // Note preview: with it on, a note typed into the grid also sounds on that lane's instrument, for as long
  // as the key is held. Backslash or Insert switches it on and off; it is remembered.
  let preview = false;
  preview = config.get('notePreview');
  // Settings changed on the Config tab take effect here at once.
  config.onChange((k, v) => {
    if (k === 'notePreview') preview = v;
    else if (k === 'soloStyle' && v !== soloStyle) { soloStyle = v; scrolledFor = null; if (solo) top = soloStyle === 'window' ? lo : Math.max(0, lo - 4); }
    else if (k === 'fontSize' && v !== fontPx) { fontPx = v; if (el.style) el.style.fontSize = `${fontPx}px`; draw(); }
  });
  let tint = config.get('patternTint');
  config.onChange(k => { if (k === 'patternTint') { tint = config.get('patternTint'); if (lanes) draw(); } });
  const playline = createPlayline(el);
  let head = config.get('playhead');   // 'marker': a > in the tick column and a bold row; 'line' and 'band': an overlay that never touches the text
  const overlay = () => head === 'line' || head === 'band';
  config.onChange(k => { if (k === 'playhead') { head = config.get('playhead'); if (lanes) draw(); } });
  let measured = null;   // the line height and top padding, measured again only when the font size changes
  const lineMetrics = () => { if (!measured || measured.px !== fontPx) { const m = metrics(); measured = { px: fontPx, lh: m.lh, up: m.up }; } return measured; };
  const sounding = new Map();   // key -> { instrument, note }, so the release stops what the press started
  const stopSound = k => { const s = sounding.get(k); if (s) { onNote(s.instrument, s.note, false); sounding.delete(k); } };
  const startSound = (k, note) => {
    stopSound(k);
    const l = lanes[cur.lane], vel = l.rows[cur.tick][cur.col + 1];
    const v = l.columns[cur.col + 1]?.kind === 'vel' && /^[0-9A-F]{2}$/i.test(vel ?? '') ? Math.max(0.05, parseInt(vel, 16) / 255) : 1;
    const midi = note + 12;   // a written C-4 plays as MIDI 60 (see encodeCell), so the preview sounds what will play
    sounding.set(k, { instrument: l.instrument, note: midi });
    onNote(l.instrument, midi, true, v);
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
    top = Math.max(showLo(), Math.min(top + rows, showHi() - rowCount));
    scrolledFor = `${cur.lane},${cur.tick}`;
  }, { passive: false });

  const load = ({ lanes: l, song: s, editor: e }) => {
    lanes = l;
    len = s.length;
    solo = null; lo = 0; hi = len;
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

  const moveRow = d => { const n = hi - lo; cur.tick = lo + ((cur.tick - lo + d) % n + n) % n; };
  const hopLane = d => (solo ? solo.lane : (cur.lane + d + lanes.length) % lanes.length);   // the lane a step off the end of one lands in
  const moveLane = d => {
    cur.lane = hopLane(d);
    snapCol();
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
    nugget = false;
  };
  // One character at a time, hopping to the next cell, column and lane at the ends.
  const moveChar = d => {
    cur.ch += d;
    if (cur.ch < 0) {
      const prev = neighbour(cur.lane, cur.col, -1);
      if (prev < 0) {
        cur.lane = hopLane(-1);
        cur.col = visibleCols(cur.lane, -1).at(-1);
      } else cur.col = prev;
      cur.ch = cellWidth() - 1;
    } else if (cur.ch >= cellWidth()) {
      const next = neighbour(cur.lane, cur.col, 1);
      if (next < 0) {
        cur.lane = hopLane(1);
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
      cur.lane = hopLane(d);
      const cols = visibleCols(cur.lane, -1);
      cur.col = d > 0 ? cols[0] : cols.at(-1);
    }
    cur.ch = 0;
  };

  // Left and Right by whole cells: the first character of the next or the previous column, in this lane or the next.
  const moveCell = d => {
    const there = neighbour(cur.lane, cur.col, d);
    if (there >= 0) cur.col = there;
    else {
      cur.lane = hopLane(d);
      const cols = visibleCols(cur.lane, -1);
      cur.col = d > 0 ? cols[0] : cols.at(-1);
    }
    cur.ch = 0;
    nugget = false;
  };
  // In nugget mode: one character inside the cell, and at either end the next step crosses into the neighbouring cell
  // (which is entered at its first character, and the mode is over).
  const nuggetStep = d => {
    const to = cur.ch + d;
    if (to >= 0 && to < cellWidth()) cur.ch = to; else moveCell(d);
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
      if (tick >= hi || col >= lane.columns.length || lane.columns[col].token !== c.token) { skipped++; return; }
      items.push({ tick, col, token: c.cell });
    }));
    const changed = editor.setCells(r.lane, items, 'paste');
    message = changed ? `Pasted ${size({ t0: 0, t1: clipboard.length - 1, c0: 0, c1: clipboard[0].length - 1 })}${skipped ? `, ${skipped} cells did not fit` : ''}.`
      : skipped ? 'Nothing fits here.' : 'Nothing changed (is there a pattern here?).';
    sel = null;
  };

  // Ctrl+D: the selected cells (or the cell under the cursor) are copied to the rows right below, whatever the cursor
  // is, and the selection moves down with the copy, so pressing it again copies it once more by the same number of rows.
  const duplicate = () => {
    const r = rect(), lane = lanes[r.lane], h = r.t1 - r.t0 + 1, items = [];
    let skipped = 0;
    for (let t = r.t0; t <= r.t1; t++) for (let c = r.c0; c <= r.c1; c++) {
      if (t + h >= hi) { skipped++; continue; }
      items.push({ tick: t + h, col: c, token: lane.rows[t][c] });
    }
    if (r.t1 + 1 >= hi) { message = 'No room below.'; return; }
    const changed = editor.setCells(r.lane, items, 'copy down');
    message = changed ? `Copied ${size(r)} cells down${skipped ? `, ${skipped} did not fit` : ''}.` : 'Nothing changed (is there a pattern below?).';
    const to = t => Math.min(hi - 1, t + h);
    if (sel) sel = { ...sel, tick: to(sel.tick) };
    cur.tick = to(cur.tick);
  };

  // Rows are only ever moved inside the pattern they are in: a selection that crosses several patterns is handled one
  // pattern at a time, and nothing is pulled in from, or pushed out into, the pattern next door.
  const patternSpan = t => {
    const lane = lanes[cur.lane], pl = placementAt(lane, t);
    if (!pl) return null;
    return { s: Math.max(pl.start, lo), e: Math.min(pl.start + Math.min(pl.length, lane.patterns[pl.puid].length), hi) };
  };
  // [{ a, b, s, e }]: the selected rows a..b that lie in the pattern spanning s..e (end excluded)
  const pieces = r => {
    const out = [];
    for (let t = r.t0; t <= r.t1;) {
      const p = patternSpan(t);
      if (!p || t >= p.e) { t++; continue; }
      const b = Math.min(r.t1, p.e - 1);
      out.push({ a: t, b, s: p.s, e: p.e });
      t = b + 1;
    }
    return out;
  };
  // Ctrl+Delete (gobble, up = true): the selected cells (the cell under the cursor) are removed and the cells below in
  // the same columns move up to fill the gap. Ctrl+Insert (up = false) is the other way: the rows below move down and
  // the ones that fall off the end of the pattern are lost, leaving empty cells where the selection starts.
  const shiftRows = up => {
    const r = rect(), lane = lanes[r.lane], items = [];
    for (const { a, b, e } of pieces(r)) {
      const h = b - a + 1;
      for (let c = r.c0; c <= r.c1; c++) {
        const blank = KINDS[lane.columns[c].token].blank;
        for (let t = a; t < e; t++) {
          const src = up ? t + h : t - h;
          items.push({ tick: t, col: c, token: (up ? src < e : src >= a) ? lane.rows[src][c] : blank });
        }
      }
    }
    const changed = items.length && editor.setCells(r.lane, items, up ? 'delete and pull up' : 'insert and push down');
    message = changed ? (up ? 'Pulled the rows below up.' : 'Pushed the rows below down.') : 'Nothing to move (is there a pattern here?).';
  };

  // Ctrl+Alt+Up/Down: the contents of the selected rows rotate by one row, column by column; what falls off one end comes
  // in at the other.
  const rotate = (dir, k = 1) => {
    if (!sel) { message = 'Select some rows to rotate.'; return; }
    const r = rect(), lane = lanes[r.lane], items = [];
    for (const { a, b } of pieces(r)) {
      if (b <= a) continue;
      const h = b - a + 1, by = ((k % h) + h) % h;
      if (!by) continue;
      for (let c = r.c0; c <= r.c1; c++) for (let t = a; t <= b; t++) {
        const src = a + ((t - a + (dir < 0 ? by : h - by)) % h);
        items.push({ tick: t, col: c, token: lane.rows[src][c] });
      }
    }
    const changed = items.length && editor.setCells(r.lane, items, 'rotate');
    message = changed ? `Rotated the selection ${dir < 0 ? 'up' : 'down'}${k !== 1 ? ` by ${k}` : ''}.` : 'Nothing to rotate.';
  };

  // Randomizing the selection (Ctrl+R opens the menu). Every new value is one the column already holds in the selection,
  // or a small step from one, so the cells stay valid and the spread is kept. Alt+R rolls again from the cells as
  // they were before the first roll; any other key accepts the result.
  let roll = null;
  const MODES = {
    values: 'Shuffled the values.', cells: 'Shuffled the cells.', redraw: 'Redrew the values from their spread.',
    nudge: 'Nudged the values.', fill: 'Redrew the values, empty cells included.',
  };
  const spreadOf = (kind, tokens) => {   // the numbers behind a column's pitched or hex values: [{ token, n }]
    const n = tokens.map(t => (kind === 'note' ? noteSemitones(t) : kind === 'cmd' ? null : parseInt(t, 16))).filter(v => v !== null && !Number.isNaN(v));
    return n.length ? { lo: Math.min(...n), hi: Math.max(...n) } : null;
  };
  const rollOnce = () => {
    const { r, mode, orig } = roll, lane = lanes[r.lane], items = [];
    const rnd = n => Math.floor(random() * n);
    for (let c = r.c0; c <= r.c1; c++) {
      const kind = lane.columns[c].token, blank = KINDS[kind].blank;
      const cells = orig.filter(o => o.col === c);   // only ticks that a pattern covers
      const filled = cells.filter(o => !isBlank(o.token)), tokens = filled.map(o => o.token);
      if (!filled.length) continue;
      let out = null;
      if (mode === 'values') {
        const pool = tokens.slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = rnd(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        out = new Map(filled.map((o, i) => [o.tick, pool[i]]));
      } else if (mode === 'cells') {
        const pool = cells.map(o => o.token);
        for (let i = pool.length - 1; i > 0; i--) { const j = rnd(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        out = new Map(cells.map((o, i) => [o.tick, pool[i]]));
      } else if (mode === 'redraw') {
        out = new Map(filled.map(o => [o.tick, tokens[rnd(tokens.length)]]));
      } else if (mode === 'fill') {
        const p = filled.length / cells.length;
        out = new Map(cells.map(o => [o.tick, random() < p ? tokens[rnd(tokens.length)] : blank]));
      } else if (mode === 'nudge') {
        const sp = spreadOf(kind, tokens);
        out = new Map();
        if (!sp) continue;
        for (const o of filled) {
          const step = (rnd(2) ? 1 : -1) * (1 + rnd(kind === 'note' ? 2 : Math.max(1, Math.round((sp.hi - sp.lo) * 0.1))));
          try {
            if (kind === 'note') {
              const v = noteSemitones(o.token);
              if (v !== null) out.set(o.tick, noteToken(clamp(v + step, Math.max(0, sp.lo - 2), sp.hi + 2)));
            } else if (kind !== 'cmd') {
              const w = KINDS[kind].width, v = parseInt(o.token, 16);
              out.set(o.tick, clamp(v + step, 0, 16 ** w - 1).toString(16).toUpperCase().padStart(w, '0'));
            }
          } catch { /* out of range: the cell stays */ }
        }
      }
      for (const o of cells) { const t = out.get(o.tick); if (t !== undefined) items.push({ tick: o.tick, col: c, token: t }); }
    }
    if (roll.rolled) editor.undo();   // one undo step for all the rolls
    const changed = editor.setCells(r.lane, items, 'randomize');
    roll.rolled = !!changed;
    message = changed ? MODES[mode] : 'Nothing changed: try again.';
  };
  const randomize = mode => {
    const r = rect(), lane = lanes[r.lane], orig = [];
    for (let t = r.t0; t <= r.t1; t++) {
      if (!patternSpan(t)) continue;
      for (let c = r.c0; c <= r.c1; c++) orig.push({ tick: t, col: c, token: lane.rows[t][c] });
    }
    if (!orig.some(o => !isBlank(o.token))) { message = 'Nothing in the selection to randomize.'; return; }
    roll = { r, mode, orig, rolled: false };
    rollOnce();
  };
  const randomMenu = () => {
    const box = el.getBoundingClientRect?.() ?? { left: 80, top: 80 };
    showMenu({ clientX: box.left + 80, clientY: box.top + 60 }, [
      { label: 'Shuffle the values', hint: 'filled cells stay where they are', run: () => { randomize('values'); draw(); } },
      { label: 'Shuffle the cells', hint: 'empty cells move too', run: () => { randomize('cells'); draw(); } },
      { label: 'Redraw from the spread', hint: 'filled cells only', run: () => { randomize('redraw'); draw(); } },
      { label: 'Nudge', hint: 'small steps from where they are', run: () => { randomize('nudge'); draw(); } },
      { separator: true },
      { label: 'Redraw, empty cells too', hint: 'keeps how full it is', run: () => { randomize('fill'); draw(); } },
    ]);
  };

  // Transposing the selection (or the cell under the cursor). Notes move by semitones (Shift: octaves); every other
  // value moves by one (Shift: a bigger step, one digit up), stopping at its ends. A command's id is left alone.
  // Blank cells stay blank.
  const STEP = { '1hex': [1, 1], '2hex': [1, 16], '4hex': [1, 256], cmd: [1, 256] };
  const transpose = (notes, dir, big, amount) => {
    const r = rect(), lane = lanes[r.lane], items = [];
    let skipped = 0;
    for (let t = r.t0; t <= r.t1; t++) {
      for (let c = r.c0; c <= r.c1; c++) {
        const kind = lane.columns[c].token, token = lane.rows[t][c];
        if (isBlank(token)) continue;
        if (notes) {
          const s = kind === 'note' ? noteSemitones(token) : null;
          if (s === null) continue;
          try { const step = amount ?? (big ? 12 : 1); if (s + dir * step < 0) throw new Error('low'); items.push({ tick: t, col: c, token: noteToken(s + dir * step) }); } catch { skipped++; }
        } else if (kind !== 'note') {
          const head = kind === 'cmd' ? token.slice(0, 2) : '', digits = KINDS[kind].width - head.length;
          const v = parseInt(token.slice(head.length), 16), max = 16 ** digits - 1;
          const next = clamp(v + dir * STEP[kind][big ? 1 : 0], 0, max);
          if (next !== v) items.push({ tick: t, col: c, token: head + next.toString(16).toUpperCase().padStart(digits, '0') });
        }
      }
    }
    const changed = items.length && editor.setCells(r.lane, items, notes ? 'transpose notes' : 'transpose values');
    message = changed ? `${notes ? 'Transposed' : 'Moved'}${amount ? ` by ${amount * dir}` : ''} ${items.length} ${notes ? 'notes' : 'values'}${skipped ? `, ${skipped} out of range` : ''}.`
      : skipped ? 'Out of range.' : `No ${notes ? 'notes' : 'values'} to change (is there a pattern here?).`;
  };

  // Interpolating (Ctrl+I): per column of the selection the first and the last cell that hold a value are the two ends, and
  // the cells between them get values along a curve from one to the other, by row position (so uneven placeholders get
  // the value that belongs at their row). By default only cells that already have a value are written; the popup can
  // include the empty ones as well. Notes go by semitone, note-offs are left alone; command columns are skipped.
  let curve = newCurve(), curveRun = null;
  const curveTargets = (r, empties) => {
    const lane = lanes[r.lane], out = [];
    for (let c = r.c0; c <= r.c1; c++) {
      const kind = lane.columns[c].token;
      if (kind === 'cmd') continue;
      const val = t => { const k = lane.rows[t][c]; if (isBlank(k)) return null; const v = kind === 'note' ? noteSemitones(k) : parseInt(k, 16); return v === null || Number.isNaN(v) ? null : v; };
      let ta = -1, tb = -1;
      for (let t = r.t0; t <= r.t1; t++) if (patternSpan(t) && val(t) !== null) { if (ta < 0) ta = t; tb = t; }
      if (ta < 0 || tb <= ta) continue;
      const ts = [];
      for (let t = ta + 1; t < tb; t++) if (patternSpan(t) && (empties ? (kind !== 'note' || isBlank(lane.rows[t][c]) || val(t) !== null) : val(t) !== null)) ts.push(t);
      out.push({ c, kind, ta, tb, va: val(ta), vb: val(tb), ts });
    }
    return out;
  };
  const curveItems = (r, cv) => {
    const items = [];
    for (const { c, kind, ta, tb, va, vb, ts } of curveTargets(r, cv.empties)) {
      const top = 16 ** KINDS[kind].width - 1, span = vb !== va ? vb - va : (kind === 'note' ? 12 : Math.max(1, top / 4));
      for (const t of ts) {
        const x = (t - ta) / (tb - ta), y = sampleTable(cv.table, x), w = cv.cycles > 0 && cv.depth > 0 ? cv.depth * Math.sin(2 * Math.PI * cv.cycles * x) : 0;
        const v = Math.round(va + (vb - va) * y + span * w);
        try { items.push({ tick: t, col: c, token: kind === 'note' ? noteToken(Math.max(0, v)) : clamp(v, 0, top).toString(16).toUpperCase().padStart(KINDS[kind].width, '0') }); } catch { /* out of the note range: the cell stays */ }
      }
    }
    return items;
  };
  const curveApply = () => {
    const { r } = curveRun;
    if (curveRun.applied) { editor.undo(); curveRun.applied = false; }
    const items = curveItems(r, curve), changed = items.length && editor.setCells(r.lane, items, 'interpolate');
    curveRun.applied = !!changed;
    message = changed ? `Interpolating ${items.length} cells.` : 'Nothing to write: needs a value at both ends of a column (tick "include empty cells" to fill the gaps).';
    draw();
  };
  const interpolate = () => {
    const r = rect();
    if (r.t1 - r.t0 < 2) { message = 'Select at least three rows to interpolate between.'; return; }
    const targets = curveTargets(r, true);
    if (!targets.length) { message = 'Nothing to interpolate: each column needs a value at both ends (command columns are skipped).'; return; }
    const box = el.getBoundingClientRect?.() ?? { left: 80, top: 80 };
    curveRun = { r, applied: false };
    const xs = [...new Set(targets.flatMap(t => t.ts.map(row => (row - t.ta) / (t.tb - t.ta))))];
    const close = () => { curveRun = null; el.focus?.(); draw(); };
    showCurve({
      curve, xs, anchor: { x: (box.right ?? box.left + 600) - 350, y: box.top + 40 },
      onChange: cv => { curve = cv; if (curveRun) curveApply(); },
      onAccept: () => { message = curveRun?.applied ? 'Interpolated.' : message; close(); },
      onCancel: () => { if (curveRun?.applied) editor.undo(); message = 'Interpolation cancelled.'; close(); },
    });
  };


  // Takes a parameter's live value (a slider, or whatever the song last wrote) and turns it into the cell that would
  // write it back: the inverse of how the sequencer reads a cell. Space writes it into the cursor's cell and moves
  // down a row, so a sweep can be recorded with one key press per row; Ctrl+Space writes the live values of every
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
    else { cur.ch = 0; nugget = false; moveRow(1); }
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
          cur.ch = 0; nugget = false; moveRow(1);
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
    const shown = widths.map((w, li) => w.filter((_, ci) => (vis[li] ?? w.map((__, i) => i)).includes(ci)));
    const hit = cellAt({ widths: windowed() ? [shown[solo.lane]] : shown, x: Math.floor(x), line: Math.floor(y), top, len: showHi() });
    if (hit && windowed()) hit.lane = solo.lane;
    if (hit && solo && (hit.lane !== solo.lane || hit.tick < lo || hit.tick >= hi)) return null;   // the locked part cannot be clicked
    return hit && { ...hit, col: (vis[hit.lane] ?? [])[hit.col] ?? hit.col };
  };
  el.addEventListener('mousedown', e => {
    if (!lanes || e.button !== 0) return;
    const hit = pointed(e);
    if (!hit) return;
    const was = [cur.lane, cur.tick];
    Object.assign(cur, hit);
    sel = null;
    nugget = false;
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
    if (lanes && e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Enter') {   // Alt+Enter: solo-edit the pattern under the cursor, or leave it
      if (solo) { solo = null; lo = 0; hi = len; scrolledFor = null; message = 'Solo-edit off.'; }
      else if (!enterSolo(cur.lane, cur.tick)) message = 'No pattern here to solo-edit.';
      e.preventDefault();
      draw();
      return;
    }
    if (lanes && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') {   // Alt+R: roll the randomize again, from the cells as they were before the first roll
      if (roll) rollOnce(); else message = 'Nothing to roll again: use Ctrl+R first.';
      e.preventDefault(); return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {   // Alt+T: tint the patterns by colour, or not
      const on = !tint; config.set('patternTint', on); message = on ? 'Pattern tint on.' : 'Pattern tint off.';
      e.preventDefault(); return;
    }
    if (lanes && e.altKey && e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {   // Ctrl+Alt+Up/Down: rotate the selection
      roll = null;
      rotate(e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault(); draw(); return;
    }
    if (!lanes || e.altKey) return;
    if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) roll = null;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
        e.preventDefault();
        setSize(key === '0' ? SIZES.normal : fontPx + (key === '-' || key === '_' ? -1 : 1));
        return;
      }
      if (key === 'arrowup' || key === 'arrowdown') { transpose(true, key === 'arrowup' ? 1 : -1, e.shiftKey); e.preventDefault(); return; }
      if (key === 'arrowleft' || key === 'arrowright') { moveChar(key === 'arrowright' ? 1 : -1); nugget = true; e.preventDefault(); return; }   // one character inside the cell
      if (key === ',' || key === '.' || key === '<' || key === '>') { transpose(false, key === '.' || key === '>' ? 1 : -1, key === '<' || key === '>'); e.preventDefault(); return; }
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
      if (key === ' ') { insertLive(true); e.preventDefault(); return; }   // Ctrl+Space: the live values of every parameter column of this row
      if (key === 'i') { interpolate(); e.preventDefault(); return; }
      if (key === 'delete' && e.shiftKey) {   // Ctrl+Shift+Delete: take the pattern under the cursor out of the arrangement (it stays in the list)
        if (solo) message = 'Not in solo-edit: Esc first.';
        else message = editor.remove(cur.lane, cur.tick) ? 'Pattern removed from the arrangement. It stays in the list.' : 'No pattern here.';
        e.preventDefault(); return;
      }
      if (key === 'delete') { shiftRows(true); e.preventDefault(); return; }
      if (key === 'insert') { shiftRows(false); e.preventDefault(); return; }
      if (key === 'k') {   // Ctrl+K: the next colour for the pattern under the cursor; Ctrl+Shift+K the previous one
        const ok = editor.color(cur.lane, solo ? solo.start : cur.tick, e.shiftKey ? -1 : 1);
        const pat = ok && lanes[cur.lane].patterns[placementAt(lanes[cur.lane], solo ? solo.start : cur.tick).puid];
        message = !ok ? 'No pattern here.' : Number.isInteger(pat.color) ? `${patternName()}: colour ${pat.color + 1} of 16.` : `${patternName()}: automatic colour.`;
        e.preventDefault(); return;
      }
      if (key === 'r' && !e.shiftKey && !e.altKey) { randomMenu(); e.preventDefault(); return; }   // Ctrl+R: the randomize menu (Ctrl+Shift+R is Rec, in main.js)
      if (key === 'g' && !e.shiftKey) {   // this placement gets its own copy of its pattern, so editing it no longer changes the others
        message = editor.clone(cur.lane, solo ? solo.start : cur.tick) ? `${patternName()} is now this placement's own copy.` : 'No pattern here.';
        sel = null;
        e.preventDefault(); return;
      }
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
      } else if (key === 'd' && !e.shiftKey) {   // copy the selection to the rows right below it; again for the next copy
        duplicate();
        e.preventDefault();
      } else if (key === 'a') {   // the whole lane
        sel = { lane: cur.lane, tick: lo, col: 0 };
        cur.tick = hi - 1; cur.col = lanes[cur.lane].columns.length - 1; cur.ch = 0;
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
    const grow = { ArrowUp: () => { cur.tick = clamp(cur.tick - 1, lo, hi - 1); }, ArrowDown: () => { cur.tick = clamp(cur.tick + 1, lo, hi - 1); },
      ArrowLeft: () => { const n = neighbour(cur.lane, cur.col, -1); if (n >= 0) cur.col = n; }, ArrowRight: () => { const n = neighbour(cur.lane, cur.col, 1); if (n >= 0) cur.col = n; },
      PageUp: () => { cur.tick = clamp(cur.tick - 16, lo, hi - 1); }, PageDown: () => { cur.tick = clamp(cur.tick + 16, lo, hi - 1); },
      Home: () => { cur.tick = lo; }, End: () => { cur.tick = hi - 1; } };
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
      case 'ArrowLeft': if (config.get('arrowStyle') === 'cell') { if (nugget) nuggetStep(-1); else moveCell(-1); } else if (e.repeat) moveColumn(-1); else moveChar(-1); break;
      case 'ArrowRight': if (config.get('arrowStyle') === 'cell') { if (nugget) nuggetStep(1); else moveCell(1); } else if (e.repeat) moveColumn(1); else moveChar(1); break;
      case 'Tab':
        if (solo) {
          soloStyle = soloStyle === 'window' ? 'hatch' : 'window';
          config.set('soloStyle', soloStyle);
          scrolledFor = null; top = soloStyle === 'window' ? lo : Math.max(0, lo - 4);
          message = soloStyle === 'window' ? 'Solo-edit: the pattern on its own.' : 'Solo-edit: the song, with the rest locked.';
        } else moveLane(e.shiftKey ? -1 : 1);
        break;
      case '!': {   // Shift+1: a note off in every note column of this row of this lane
        const items = lanes[cur.lane].columns.flatMap((c, i) => (c.token === 'note' ? [{ tick: cur.tick, col: i, token: '===' }] : []));
        if (!items.length) message = 'This lane has no note columns.';
        else if (editor.setCells(cur.lane, items, 'note off, every column')) { message = `Note off in ${items.length} note ${items.length === 1 ? 'column' : 'columns'}.`; cur.ch = 0; moveRow(1); }
        else message = 'No pattern here. Press Enter to insert one.';
        break;
      }
      case 'PageUp': moveRow(-16); break;
      case 'PageDown': moveRow(16); break;
      case 'Home': cur.tick = lo; break;
      case 'End': cur.tick = hi - 1; break;
      case ' ': insertLive(false); break;   // the live value of the parameter under the cursor (F7 plays the row)
      case '[': octave = Math.max(0, octave - 1); message = `Octave ${octave}`; break;
      case ']': octave = Math.min(9, octave + 1); message = `Octave ${octave}`; break;
      case '\\': case 'Insert':   // note preview on or off
        preview = !preview;
        config.set('notePreview', preview);
        message = `Note preview ${preview ? 'on: typed notes sound' : 'off'}.`;
        break;
      case 'Escape':
        if (solo) { solo = null; lo = 0; hi = len; scrolledFor = null; message = 'Solo-edit off.'; } else { message = ''; onBack(); }
        break;
      case 'Enter':
        if (solo) { message = 'Not in solo-edit: Esc first.'; break; }
        message = editor.insertPattern(cur.lane, cur.tick) ? 'Pattern inserted.' : 'A pattern is already here.';
        break;
      case 'Delete':
      case 'Backspace':
      case '>':   // Shift+. clears the cell under the cursor, like Delete
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
  let painted = '';   // the markup the grid last showed (without a real DOM: in tests)
  // With a real page every row is an element of its own and only the rows whose markup changed are rewritten, so a
  // cursor move touches two rows rather than the whole grid, and an unchanged grid costs nothing at all.
  const real = typeof document !== 'undefined' && typeof el.appendChild === 'function' && typeof el.removeChild === 'function';
  const rowEls = [], rowHtml = [];
  const paintLines = lines => {
    if (!real) { const html = lines.join('\n'); if (html !== painted) { el.innerHTML = html; painted = html; } return; }
    if (!rowEls.length && el.childNodes.length) el.textContent = '';
    while (rowEls.length < lines.length) { const d = document.createElement('div'); d.className = 'ln'; el.appendChild(d); rowEls.push(d); rowHtml.push(null); }
    while (rowEls.length > lines.length) { el.removeChild(rowEls.pop()); rowHtml.pop(); }
    for (let i = 0; i < lines.length; i++) if (rowHtml[i] !== lines[i]) { rowEls[i].innerHTML = lines[i]; rowHtml[i] = lines[i]; }
  };
  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    if (solo) {   // the placement can go (undo, or a change in the arrangement); then solo-edit is over
      const pl = placementAt(lanes[solo.lane], solo.start);
      if (!pl || pl.start !== solo.start) { solo = null; lo = 0; hi = len; message = 'That pattern is gone: solo-edit is off.'; }
      else {
        lo = solo.start; hi = Math.min(len, solo.start + Math.min(pl.length, lanes[solo.lane].patterns[pl.puid].length));
        solo.end = hi; solo.puid = pl.puid;
        cur.lane = solo.lane; cur.tick = Math.max(lo, Math.min(hi - 1, cur.tick));
        if (sel) sel.lane = solo.lane;
      }
    }
    // The window stays where it is while the cursor is inside it (so clicking does not move the grid); when the
    // cursor leaves it, the window jumps to put the cursor a few rows in from the top.
    // Following the song: the cursor goes with the playing row, which stays in the middle of the window.
    // With "the caret may roam" on, moving the caret to another row stops the following until F9 (or the Follow button) asks for it again.
    if (!(follow() && playing)) { paused = false; lastAuto = null; }
    else if (!paused && lastAuto !== null && cur.tick !== lastAuto && config.get('followRoam')) { paused = true; message = 'Follow paused while you move around: F9 follows again.'; }
    const following = follow() && playing && !solo && !paused;
    if (following) { cur.tick = Math.min(len - 1, playTick); lastAuto = cur.tick; sel = null; top = cur.tick - (rowCount >> 1); }
    else {
      if (scrolledFor !== `${cur.lane},${cur.tick}`) scrolledFor = null;
      if (!scrolledFor && (cur.tick < top || cur.tick >= top + rowCount)) top = cur.tick - Math.min(8, rowCount >> 2);
    }
    top = Math.max(showLo(), Math.min(top, showHi() - rowCount));
    const r = sel ? rect() : null;
    vis = lanes.map((_, li) => visibleCols(li));
    const shown = lanes.map((l, li) => ({ l, li })).filter(({ li }) => !windowed() || li === solo.lane);   // the window shows its lane only
    const lines = [
      `<span class="g">${' '.repeat(GUTTER)}</span>${shown.map(({ l, li }) => ` ${esc(l.id.padEnd(block(li)))}`).join('  ')}`,
      `<span class="g">${' '.repeat(GUTTER)}</span>${shown.map(({ l, li }) => ` ${vis[li].map(ci => esc((l.columns[ci].short ?? l.columns[ci].label).padEnd(widths[li][ci]))).join(' ')}`).join('  ')}`,
    ];
    const base = showLo();
    for (let t = top; t < Math.min(showHi(), top + rowCount); t++) {
      const chunks = shown.map(({ l: lane, li }) => {
        const mark = lane.placements.some(p => p.start === t) ? '<span class="ps">▌</span>' : ' ';   // a pattern starts here
        const covered = lane.placements.some(p => t >= p.start && t < p.start + p.length);   // else no pattern here
        const locked = solo && soloStyle === 'hatch' && (li !== solo.lane || t < lo || t >= hi);
        const html = mark + vis[li].map(ci => {
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
        const under = tint && covered ? placementAt(lane, t) : null;
        const tinted = under && lane.patterns[under.puid] ? `<span style="background:${patternColour(lane.patterns[under.puid], 0.13)}">${html}</span>` : html;
        const dim = dimFilter(dimLevel(lane)), shaded = dim ? `<span style="${dim}">${tinted}</span>` : tinted;
        return !solo || soloStyle !== 'hatch' ? shaded : `<span class="${locked ? 'lock' : 'soloblk'}">${shaded}</span>`;
      });
      const inLoop = song.loop && t >= song.loop.start && t < song.loop.end;
      const edge = inLoop ? `${t === song.loop.start ? ' ls' : ''}${t === song.loop.end - 1 ? ' le' : ''}` : '';
      const row = `<span class="g${inLoop ? ` lp${edge}` : ''}">${playing && t === playTick && !overlay() ? '>' : ' '}${String(t - base).padStart(4, '0')} </span>${chunks.join('  ')}`;
      const shade = (t - base) % 16 === 0 ? 'r16' : (t - base) % 4 === 0 ? 'r4' : '';
      const line = playing && t === playTick && !overlay() ? `<b>${following ? `<span class="now">${row}</span>` : row}</b>` : row;
      lines.push(shade ? `<span class="${shade}">${line}</span>` : line);
    }
    while (lines.length < 2 + rowCount) lines.push('');   // always rowCount rows tall, so the drag bar works on a short song
    paintLines(lines);
    if (overlay() && playing && playTick >= top && playTick < Math.min(showHi(), top + rowCount) && playTick >= showLo()) {
      const m = lineMetrics();
      playline.show(m.up - el.clientTop + m.lh * (2 + playTick - top), head === 'band' ? m.lh : 0);
    } else playline.show(null);
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
    // Two lines: where the cursor is, small; and under it the column's name large, with a meter for where the value sits in
    // its range, the value, and the range and the hex it is written as.
    const where1 = [
      solo && `SOLO${lanes[solo.lane].placements.filter(p => p.puid === solo.puid).length > 1 ? ` (shared by ${lanes[solo.lane].placements.filter(p => p.puid === solo.puid).length} placements)` : ''}`,
      lanes[cur.lane].id, compact.has(cur.lane) ? 'empty columns hidden' : '', `row ${cur.tick - base}`, patternName(), `char ${cur.ch + 1}/${cellWidth()}`, preview ? 'preview on' : '',
      sel ? `selected ${size(rect())}` : '', `octave ${octave}`,
    ].filter(Boolean).join(' · ');
    const d = describeParts(lanes[cur.lane], cur.tick, cur.col);
    const cellKind = lanes[cur.lane].columns[cur.col].kind;
    const meter = d.frac === null ? '' : `<span class="pmeter" aria-hidden="true"><i style="width:${Math.max(0, Math.min(1, d.frac)) * 100}%"></i></span>`;
    const html = `<span class="spos">${esc(where1)}${message ? ` · <b>${esc(message)}</b>` : ''}</span><span class="sparam k-${esc(cellKind)}"><span class="pname">${esc(d.name)}</span>${meter}${d.value === null ? '' : `<span class="pval">${esc(d.value)}</span>`}<span class="prng">${esc(d.details.join(' · '))}</span></span>`;
    if (html !== lastStatus) { lastStatus = html; statusEl.innerHTML = html; }
  };

  const goto = (laneIdx, tick) => {
    solo = null; lo = 0; hi = len;
    cur.lane = laneIdx;
    cur.tick = tick;
    snapCol();
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
    message = '';
  };

  // Solo-edit on the placement under the tick, if there is one: only its rows are shown, numbered from 0.
  const enterSolo = (laneIdx, tick) => {
    const pl = placementAt(lanes[laneIdx], tick);
    if (!pl) return false;
    goto(laneIdx, pl.start);
    solo = { lane: laneIdx, start: pl.start };
    lo = pl.start; hi = pl.start + Math.min(pl.length, lanes[laneIdx].patterns[pl.puid].length);
    cur.tick = Math.max(lo, Math.min(hi - 1, tick));
    sel = null; scrolledFor = null; top = lo;
    message = 'Solo-edit: Esc leaves it, Tab changes the view.';
    return true;
  };

  const setRows = n => { rowCount = Math.max(ROWS.min, Math.min(ROWS.max, Math.round(n))); draw(); return rowCount; };
  const lineHeight = () => (lanes ? metrics().lh : 18);
  // What the command console calls: each returns the status line it left.
  const commands = {
    rotate: n => { message = ''; if (n) rotate(n < 0 ? -1 : 1, Math.abs(n)); draw(); return message; },
    transpose: n => { message = ''; if (n) transpose(true, n < 0 ? -1 : 1, false, Math.abs(n)); draw(); return message; },
    clone: () => {
      const cur2 = cur;
      message = editor.clone(cur2.lane, solo ? solo.start : cur2.tick) ? `${patternName()} is now this placement's own copy.` : 'No pattern here.';
      sel = null; draw(); return message;
    },
  };
  return { commands, draw, load, goto, enterSolo, relayout, say: m => { message = m; }, setSize, setRows, lineHeight, get rows() { return rowCount; }, get fontPx() { return fontPx; }, get tick() { return cur.tick; }, get lane() { return cur.lane; }, get col() { return cur.col; }, get ch() { return cur.ch; }, stepRows: n => { moveRow(n); }, resume() { const was = paused; paused = false; lastAuto = null; return was; }, get preview() { return preview; }, get selection() { return sel ? rect() : null; }, get rect() { return rect(); } };
}
