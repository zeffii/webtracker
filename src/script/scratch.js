// The scratch pattern in the Script tab: a small grid (time down, one column per voice) to fill with triggers and look at,
// before anything is written to a real pattern. Cells toggle by click or drag; the script can fill it (hatched cells are
// the script's), it can be turned back into tbin(...) lines, played through the instrument under the pattern cursor, and
// sent to the pattern editor when it is right. Nothing here touches the song.
import { noteSemitones } from '../seq/cells.js';
import { TEMPLATES } from './templates.js';

export const MAX_COLS = 8;

// A template as grid columns.
export const fromTemplate = t => t.cols.slice(0, 8).map(([note, bits]) => ({ note, on: [...bits].map(c => c === 'x'), src: Array(bits.length).fill(false) }));
export const LENGTHS = [8, 12, 16, 24, 32, 48, 64];

const blankCol = (rows, note = 'C-3') => ({ note, on: Array(rows).fill(false), src: Array(rows).fill(false) });

// 'x...x...' for one column.
export const bitsOf = on => on.map(b => (b ? 'x' : '.')).join('');

// The cells a script run gave back ({ row, col, token }) as columns: one per note column with a hit, named by its first note.
export function fromEdits(edits, rows) {
  const by = new Map();
  for (const e of edits) {
    if (!by.has(e.col)) by.set(e.col, blankCol(rows, null));
    const c = by.get(e.col);
    if (e.row >= rows || e.row < 0) continue;
    if (noteSemitones(e.token) === null) continue;   // a note off or a cut is not a trigger
    c.note ??= e.token;
    c.on[e.row] = true; c.src[e.row] = true;
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => ({ ...c, note: c.note ?? 'C-3' })).filter(c => c.on.some(Boolean));
}

// The grid as script lines, a tbin per column. A column whose pattern is shorter than the grid and repeats is written short.
export function toScript(cols) {
  const lines = [];
  for (const c of cols) {
    if (!c.on.some(Boolean)) continue;
    let bits = bitsOf(c.on);
    for (let p = 1; p < bits.length; p++) {
      if (bits.length % p === 0 && bits.slice(0, p).repeat(bits.length / p) === bits) { bits = bits.slice(0, p); break; }
    }
    lines.push(`tbin('${bits}', '${c.note}')`);
  }
  return lines.join('\n');
}

const turn = (on, n) => { const k = ((n % on.length) + on.length) % on.length; return on.slice(k).concat(on.slice(0, k)); };
export const ops = {
  invert: c => { c.on = c.on.map(b => !b); },
  rotate: (c, n = 1) => { c.on = turn(c.on, n); c.src = turn(c.src, n); },
  reverse: c => { c.on = [...c.on].reverse(); c.src = [...c.src].reverse(); },
  clear: c => { c.on = c.on.map(() => false); },
};

// Cells to write into a lane: for each scratch column the note on a hit and a blank elsewhere, from `row` on, into the
// lane's note columns in order. noteCols are the lane's note column indexes.
export function sendEdits(cols, noteCols, row, laneRows, blank = '...') {
  if (cols.length > noteCols.length) return { error: `the scratch pattern has ${cols.length} columns and this lane only ${noteCols.length} note column${noteCols.length === 1 ? '' : 's'}` };
  const edits = [];
  cols.forEach((c, i) => c.on.forEach((b, r) => { if (row + r < laneRows) edits.push({ row: row + r, col: noteCols[i], token: b ? c.note : blank }); }));
  return { edits };
}

export function createScratch({ el, run, getCode, insert, send, voice, say = () => {} }) {
  let rows = 16, cols = [], sel = -1, playing = null, head = -1, paint = null;
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const resize = n => { for (const c of cols) { while (c.on.length < n) { c.on.push(false); c.src.push(false); } c.on.length = c.src.length = n; } rows = n; };
  const targets = () => (sel >= 0 && cols[sel] ? [cols[sel]] : cols);

  const bar = mk('div', 'sc-bar'), grid = mk('div', 'sc-grid'), foot = mk('div', 'sc-foot'), code = mk('pre', 'sc-code'), hint = mk('div', 'sc-hint');
  const btn = (label, title, fn, cls = '') => { const b = mk('button', cls, label); b.type = 'button'; b.title = title; b.addEventListener('click', () => { fn(); b.blur(); }); return b; };
  const playBtn = btn('play', 'Play the grid in a loop on the instrument under the pattern cursor', () => toggle(), 'sc-play');
  const lenSel = mk('select'); lenSel.title = 'Rows in the grid'; lenSel.setAttribute('aria-label', 'Scratch rows');
  for (const n of LENGTHS) lenSel.append(Object.assign(mk('option', '', `${n} rows`), { value: n, selected: n === rows }));
  lenSel.addEventListener('change', () => { resize(Number(lenSel.value)); draw(); });
  const tplSel = mk('select'); tplSel.title = 'Start from a rhythm'; tplSel.setAttribute('aria-label', 'Rhythm template');
  tplSel.append(Object.assign(mk('option', '', 'template\u2026'), { value: '' }));
  for (const g of [...new Set(TEMPLATES.map(t => t.group))]) {
    const og = mk('optgroup'); og.label = g;
    TEMPLATES.forEach((t, i) => { if (t.group === g) og.append(Object.assign(mk('option', '', t.name), { value: i })); });
    tplSel.append(og);
  }
  tplSel.addEventListener('change', () => {
    const t = TEMPLATES[Number(tplSel.value)]; tplSel.value = '';
    if (!t) return;
    const c = fromTemplate(t); resize(c[0].on.length); cols = c; sel = -1; lenSel.value = rows; draw();
    say(`${t.name}: ${cols.length} columns. Change it however you like.`);
  });
  const edit = fn => () => { for (const c of targets()) fn(c); draw(); };
  bar.append(playBtn, tplSel,
    btn('clear', 'Empty the grid (or the selected column)', edit(ops.clear)),
    btn('invert', 'Swap hits and rests: the anti-pattern', edit(ops.invert)),
    btn('rot →', 'Rotate down one row', edit(c => ops.rotate(c, -1))),
    btn('rot ←', 'Rotate up one row', edit(c => ops.rotate(c, 1))),
    btn('reverse', 'Play the pattern backwards', edit(ops.reverse)),
    lenSel,
    btn('+ col', 'Add a column', () => { if (cols.length < MAX_COLS) { cols.push(blankCol(rows, ['C-2', 'D-2', 'F#2', 'A-2', 'C-3', 'E-3', 'G-3', 'B-3'][cols.length])); draw(); } }),
    btn('− col', 'Remove the selected column, or the last', () => { cols.splice(sel >= 0 ? sel : cols.length - 1, 1); sel = -1; draw(); }));
  foot.append(
    btn('to script', 'Write the grid into the editor as tbin(...) lines, at the caret', () => { const t = toScript(cols); if (t) insert(`${t}\n`); else say('The grid is empty.'); }),
    btn('script → grid', 'Run the script into the grid (each tbin fills the next column); your pattern is not touched', () => fromScript()),
    btn('send to pattern', 'Write the grid into the pattern under the cursor in the pattern editor (the selection start, or its first row)', () => { const m = send(cols); if (m) say(m); }, 'hot'));
  hint.textContent = 'Click or drag cells. Hatched = from the script, not yours yet. Click a column number to work on just that column.';
  el.replaceChildren(bar, grid, code, foot, hint);

  function draw() {
    grid.replaceChildren();
    const nums = mk('div', 'sc-rows');
    nums.append(mk('b', '', ''), mk('u', '', ''));
    for (let r = 0; r < rows; r++) nums.append(mk('i', r % 4 === 0 ? 'beat' : '', r.toString(16).toUpperCase().padStart(2, '0')));
    grid.append(nums);
    cols.forEach((c, ci) => {
      const col = mk('div', `sc-col${ci === sel ? ' sel' : ''}`);
      const head = mk('b', '', String(ci + 1)); head.title = 'Select this column';
      head.addEventListener('click', () => { sel = sel === ci ? -1 : ci; draw(); });
      const note = mk('input'); note.value = c.note; note.size = 3; note.spellcheck = false; note.setAttribute('aria-label', `Note of column ${ci + 1}`);
      note.addEventListener('keydown', e => e.stopPropagation());
      note.addEventListener('change', () => { const t = note.value.trim().toUpperCase(); if (noteSemitones(t) !== null) c.note = t; note.value = c.note; code.textContent = toScript(cols); });
      col.append(head, note);
      for (let r = 0; r < rows; r++) {
        const cell = mk('i', `${r % 4 === 0 ? 'beat ' : ''}${c.on[r] ? (c.src[r] ? 'on src' : 'on') : ''}${r === playing?.row ? ' play' : ''}`);
        cell.dataset.c = ci; cell.dataset.r = r;
        col.append(cell);
      }
      grid.append(col);
    });
    if (!cols.length) grid.append(mk('div', 'sc-empty', 'Empty. Add a column, or run "script → grid".'));
    code.textContent = toScript(cols);
    playBtn.textContent = playing ? 'stop' : 'play';
  }
  const setCell = (ci, r, v) => {
    const c = cols[ci]; if (!c || c.on[r] === v) return;
    c.on[r] = v; c.src[r] = false;
    const cell = grid.querySelectorAll('.sc-col')[ci]?.querySelectorAll('i')[r];
    if (cell) cell.className = `${r % 4 === 0 ? 'beat ' : ''}${v ? 'on' : ''}${r === playing?.row ? ' play' : ''}`;
    code.textContent = toScript(cols);
  };
  grid.addEventListener('pointerdown', e => {
    const t = e.target.closest('.sc-col i'); if (!t) return;
    const ci = Number(t.dataset.c), r = Number(t.dataset.r);
    paint = !cols[ci].on[r]; setCell(ci, r, paint); e.preventDefault();
  });
  grid.addEventListener('pointerover', e => { if (paint === null) return; const t = e.target.closest('.sc-col i'); if (t) setCell(Number(t.dataset.c), Number(t.dataset.r), paint); });
  addEventListener('pointerup', () => { paint = null; });

  async function fromScript() {
    const res = await run(getCode(), rows);
    if (!res.ok) { say(res.error?.message ?? 'The script did not run.'); return; }
    const got = fromEdits(res.edits, rows);
    if (!got.length) { say('The script put no tbin hits in the scratch pattern (tbin and scatter fill it).'); return; }
    cols = got.slice(0, MAX_COLS); sel = -1; draw();
    say(`${cols.length} column${cols.length === 1 ? '' : 's'} from the script.`);
  }

  // Plays the grid in a loop, a row per tick, through the instrument under the cursor.
  function toggle() {
    if (playing) { stop(); return; }
    const v = voice();
    if (v.error) { say(v.error); return; }
    if (!cols.some(c => c.on.some(Boolean))) { say('The grid is empty.'); return; }
    playing = { row: -1, held: [] };
    let next = performance.now();
    const step = () => {
      if (!playing) return;
      if (!el.offsetParent) { stop(); return; }   // the tab was left
      for (const m of playing.held) v.off(m);
      playing.held = [];
      playing.row = (playing.row + 1) % rows;
      for (const c of cols) if (c.on[playing.row]) { const m = noteSemitones(c.note) + 12; v.on(m); playing.held.push(m); }
      mark();
      next += v.tickMs();
      playing.timer = setTimeout(step, Math.max(0, next - performance.now()));
    };
    playing.stopVoice = () => { for (const m of playing.held) v.off(m); };
    playBtn.textContent = 'stop';
    step();
  }
  function mark() {
    grid.querySelectorAll('.sc-col').forEach(col => col.querySelectorAll('i').forEach((cell, r) => cell.classList.toggle('play', r === playing?.row)));
  }
  function stop() {
    if (!playing) return;
    clearTimeout(playing.timer); playing.stopVoice(); playing = null; mark(); playBtn.textContent = 'play';
  }

  cols = [blankCol(rows, 'C-2'), blankCol(rows, 'D-2')];
  draw();
  return { stop, get cols() { return cols; }, set: (c, n) => { cols = c; if (n) { rows = n; lenSel.value = n; } draw(); }, fromScript, draw, get rows() { return rows; } };
}
