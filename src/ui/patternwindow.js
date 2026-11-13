// The pattern window: one pattern of one instrument in a window of its own (a second screen, say), and a scratch copy beside it.
//
//   The pattern (A) is shown read-only. "Compare" (key C) makes B, a scratch copy of it that is not part of the song: B can be
//   changed freely, played on its own, set back to A, and kept. A and B play through the pattern's instrument in a loop, a row
//   per tick (a quick test of chords, not sample-accurate). The cells that differ are marked: green in B, red in A.
//
//   I   pick another instrument or pattern (the Instruments -> Patterns menu)      C   make B from A
//   A / B   play A or B (again: stop)       Tab   flip between A and B, in the same place       Space   stop
//   R   reset B to A          Enter   keep B: write it over A       Shift+Enter   keep B as a new pattern       Delete  drop B
//   in B:  arrows move, + and - a semitone, ] and [ an octave (hold Alt for the whole row: a chord moves as one),
//          Backspace empties the cell, O puts a note off in it
//
// createPatternWindow({ lanes, voiceFor, transportTick, replaceRows, addCopy, pick, say })
//   lanes()            the project's lanes            voiceFor(li)      { on(midi, vel), off(midi), tickMs() } or { error }
//   transportTick()    the song's playing tick, or -1 replaceRows(li, puid, rows), addCopy(li, rows, name) write to the project
//   pick(at, doc)      opens the Instruments -> Patterns menu in the window's document     say(text)  a message for the page
import { rowLines, visiblePatternColumns, playingRow } from '../seq/patternpop.js';
import { KINDS } from '../seq/cells.js';
import { copyRows, createAudition, diffCells, setToken, shiftCell, shiftRow } from '../seq/patternab.js';

// The window's own colours: the slate and orange of the A/B mock-up, in a dark and a light version (the page's theme picks which).
const PALETTE = {
  dark: '--pw-bg: #0d1218; --pw-panel: #151c24; --pw-fg: #c7d3e0; --pw-dim: #7f90a4; --pw-line: #26333f; --pw-acc: #ff9a2e; --pw-acc-fg: #111; --pw-new: #5fd0b0; --pw-old: #e0607a;',
  light: '--pw-bg: #eef1f4; --pw-panel: #ffffff; --pw-fg: #1d2733; --pw-dim: #5d6c7c; --pw-line: #cfd7df; --pw-acc: #c46a00; --pw-acc-fg: #fff; --pw-new: #0f8a6c; --pw-old: #b3304a;',
};
const STYLE = `
html.pw-dark { ${PALETTE.dark} color-scheme: dark; }
html.pw-light { ${PALETTE.light} color-scheme: light; }
body { background: var(--pw-panel); color: var(--pw-fg); }
.pw-bar { padding: 4px 8px; border-bottom: 1px solid var(--pw-line); font: 13px ui-monospace, Consolas, monospace; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: var(--pw-panel); color: var(--pw-dim); }
.pw-bar button { font: inherit; color: var(--pw-fg); background: transparent; border: 1px solid var(--pw-line); padding: 0 6px; cursor: pointer; }
.pw-bar button:hover { border-color: var(--pw-dim); }
.pw-bar button.on { background: var(--pw-acc); border-color: var(--pw-acc); color: var(--pw-acc-fg); }
.pw-msg { margin-left: auto; font-size: 12px; color: var(--pw-dim); }
#view.pw-view { background: var(--pw-panel); color: var(--pw-fg); }
.pw-ab { display: flex; gap: 0; width: max-content; min-width: 100%; }
.pw-pane { flex: none; padding: 2px 12px; border-right: 1px solid var(--pw-line); }
.pw-pane:last-child { border-right: 0; }
.pw-pane .ln:first-child { color: var(--pw-dim); }
.pw-pane .new { color: var(--pw-new); font-weight: bold; }
.pw-pane .gone { color: var(--pw-old); text-decoration: line-through; }
.pw-pane .pcell { cursor: pointer; }
.pw-pane .g { color: var(--pw-dim); }
.pw-pane .cell { background: color-mix(in srgb, var(--pw-acc) 30%, transparent); }
.pw-pane .now { background: color-mix(in srgb, var(--pw-acc) 15%, transparent); }`;

// Is the page's colour theme a dark one? (the luminance of its background)
function pageIsDark() {
  const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return !m || (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 128;
}

export function createPatternWindow({ lanes, voiceFor, transportTick, replaceRows, addCopy, pick, say }) {
  let win = null, target = null, B = null, cursor = { t: 0, ci: 0 }, side = null, last = {};
  const audition = createAudition({ on: (m, v) => voice?.on(m, v), off: m => voice?.off(m), tickMs: () => voice?.tickMs() ?? 100 });
  let voice = null, timer = null;

  const laneNow = () => lanes()?.[target?.li] ?? null;
  const patNow = () => laneNow()?.patterns?.[target.puid] ?? null;

  function stopPlaying() {
    clearTimeout(timer); timer = null;
    audition.stop(); side = null;
  }
  function tickLoop() {
    if (!win || win.closed || !audition.playing) return;
    const wait = audition.advance(win.performance.now());
    timer = win.setTimeout(tickLoop, Math.max(0, wait));
  }
  function play(which) {
    if (side === which) { stopPlaying(); return; }
    const lane = laneNow(), pat = patNow();
    if (!lane || !pat || (which === 'B' && !B)) return;
    const v = voiceFor(target.li);
    if (v.error) { say(v.error); msg(v.error); return; }
    voice = v;
    const rows = which === 'B' ? B : pat.rows;
    if (audition.playing) audition.swap(rows, lane.columns);   // flipping keeps the place
    else { audition.start(rows, lane.columns, win.performance.now()); clearTimeout(timer); tickLoop(); }
    side = which;
  }
  // after B changes while it is sounding: the loop carries on with the new rows
  const reloadB = () => { if (side === 'B') audition.swap(B, laneNow().columns); };

  let message = '';
  function msg(text) { message = text; }

  function makeB() { const pat = patNow(); if (!pat) return; B = copyRows(pat.rows); cursor = { t: 0, ci: columns()[0] ?? 0 }; widen(); msg('B is a copy of A: change it, play it, keep it.'); }
  function resetB() { const pat = patNow(); if (!pat || !B) return; B = copyRows(pat.rows); reloadB(); msg('B is A again.'); }
  function dropB() { if (side === 'B') stopPlaying(); B = null; msg(''); }
  function keepB(asNew) {
    const lane = laneNow(), pat = patNow();
    if (!lane || !pat || !B) return;
    if (asNew) { const puid = addCopy(target.li, B, `${pat.name} B`); msg(puid ? `Kept as a new pattern (${lanes()[target.li].patterns[puid]?.name}). It is in the pattern list, not yet placed.` : 'No room for another pattern.'); }
    else msg(replaceRows(target.li, target.puid, B) ? 'B is now the pattern (undo with Ctrl+Z in the main window).' : 'Nothing to keep: B is the same as A, or the pattern changed length.');
  }

  const columns = () => {
    const pat = patNow(), lane = laneNow();
    if (!pat || !lane) return [];
    const set = new Set(visiblePatternColumns(lane, pat));
    if (B) for (const ci of visiblePatternColumns(lane, { rows: B })) set.add(ci);
    return [...set].sort((a, b) => a - b);
  };
  function widen() { try { if (win.outerWidth < 900) win.resizeTo(900, win.outerHeight); } catch { /* the browser may refuse */ } }

  // ---- editing B ----
  const edit = fn => { if (!B) return; B = fn(B); reloadB(); };
  function key(e) {
    if (e.ctrlKey || e.metaKey) return;
    const k = e.key, low = k.toLowerCase(), lane = laneNow();
    const handled = () => e.preventDefault();
    if (low === 'i' && !e.altKey) { handled(); choose(); return; }
    if (low === 'c' && !B) { handled(); makeB(); return; }
    if (k === ' ') { handled(); stopPlaying(); return; }
    if (low === 'a' && B) { handled(); play('A'); return; }
    if (low === 'b' && B) { handled(); play('B'); return; }
    if (k === 'Tab' && B && side) { handled(); play(side === 'A' ? 'B' : 'A'); return; }
    if (!B || !lane) return;
    if (low === 'r') { handled(); resetB(); return; }
    if (k === 'Enter') { handled(); keepB(e.shiftKey); return; }
    if (k === 'Delete') { handled(); dropB(); return; }
    const cols = columns();
    const at = cols.indexOf(cursor.ci);
    if (k === 'ArrowUp') { handled(); cursor.t = Math.max(0, cursor.t - 1); return; }
    if (k === 'ArrowDown') { handled(); cursor.t = Math.min(B.length - 1, cursor.t + 1); return; }
    if (k === 'ArrowLeft') { handled(); cursor.ci = cols[Math.max(0, at - 1)] ?? cursor.ci; return; }
    if (k === 'ArrowRight') { handled(); cursor.ci = cols[Math.min(cols.length - 1, at + 1)] ?? cursor.ci; return; }
    const step = { '+': 1, '=': 1, '-': -1, '_': -1, ']': 12, '[': -12 }[k];
    if (step) { handled(); edit(rows => (e.altKey ? shiftRow(rows, cursor.t, lane.columns, step) : shiftCell(rows, cursor.t, cursor.ci, step))); return; }
    if (k === 'Backspace') { handled(); edit(rows => setToken(rows, cursor.t, cursor.ci, KINDS[lane.columns[cursor.ci].token]?.blank ?? '...')); return; }
    if (low === 'o' && lane.columns[cursor.ci]?.kind === 'note') { handled(); edit(rows => setToken(rows, cursor.t, cursor.ci, '===')); }
  }

  function choose() { const b = win.document.getElementById('pw-pick'); const r = b.getBoundingClientRect(); pick({ x: r.left, y: r.bottom + 2 }, win.document); }

  // ---- the window ----
  function open() {
    win = window.open('', 'wax-pattern', 'popup,width=560,height=640');
    if (!win) { say('The browser blocked the pattern window: allow pop-ups for this page.'); return false; }
    const d = win.document;
    d.title = 'Wax pattern';
    for (const sheet of document.head.querySelectorAll('link[rel="stylesheet"], style')) d.head.append(d.importNode(sheet, true));
    d.head.append(Object.assign(d.createElement('style'), { textContent: STYLE }));
    d.documentElement.className = `${document.documentElement.className} ${pageIsDark() ? 'pw-dark' : 'pw-light'}`;
    for (const [k, v] of Object.entries(document.documentElement.dataset)) d.documentElement.dataset[k] = v;
    d.body.style.cssText = 'margin: 0; padding: 0';
    const bar = d.createElement('div'); bar.className = 'pw-bar';
    const button = (text, title, run, id) => { const b = d.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; if (id) b.id = id; b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', run); return b; };
    const ui = {
      pick: button('', 'Pick another instrument or pattern (I)', choose, 'pw-pick'),
      make: button('Compare', 'Make B, a scratch copy of this pattern to try changes on (C)', makeB),
      playA: button('▶ A', 'Play A in a loop (A)', () => play('A')),
      playB: button('▶ B', 'Play B in a loop (B). Tab flips between them in the same place', () => play('B')),
      stop: button('■', 'Stop (Space)', stopPlaying),
      reset: button('Reset B', 'B becomes a copy of A again (R)', resetB),
      keep: button('B → A', 'Write B over A (Enter)', () => keepB(false)),
      keepNew: button('B → new', 'Keep B as a new pattern (Shift+Enter)', () => keepB(true)),
      drop: button('Drop B', 'Throw B away (Delete)', dropB),
    };
    const note = d.createElement('span'); note.className = 'pw-msg';
    bar.append(...Object.values(ui), note);
    const host = d.createElement('div'); host.id = 'view'; host.className = 'pw-view'; host.style.cssText = 'height: calc(100vh - 34px); overflow: auto; box-sizing: border-box; padding: 4px 0';
    const split = d.createElement('div'); split.className = 'pw-ab';
    const paneA = d.createElement('div'), paneB = d.createElement('div'); paneA.className = paneB.className = 'pw-pane';
    split.append(paneA, paneB); host.append(split);
    d.body.replaceChildren(bar, host);
    d.addEventListener('keydown', key);
    paneB.addEventListener('mousedown', e => { const c = e.target.closest?.('.pcell'); if (c) { cursor = { t: Number(c.dataset.t), ci: Number(c.dataset.c) }; } });

    const html = lines => lines.map(l => `<div class="ln">${l}</div>`).join('');
    const loop = () => {
      if (!win || win.closed) return;
      try { draw(ui, note, paneA, paneB, html); } catch (e) { console.error(e); }
      win.requestAnimationFrame(loop);
    };
    win.requestAnimationFrame(loop);
    win.addEventListener('pagehide', () => { stopPlaying(); if (win?.document === d) win = null; });
    addEventListener('pagehide', () => win?.close());
    return true;
  }

  function draw(ui, note, paneA, paneB, html) {
    const lane = laneNow(), pat = patNow();
    const label = lane ? `${lane.id} · ${pat?.name ?? '(gone)'} ▾` : 'pick a pattern ▾';
    if (ui.pick.textContent !== label) { ui.pick.textContent = label; win.document.title = `Wax pattern · ${label}`; }
    ui.make.hidden = !!B;
    for (const k of ['playA', 'playB', 'stop', 'reset', 'keep', 'keepNew', 'drop']) ui[k].hidden = !B;
    ui.playA.classList.toggle('on', side === 'A'); ui.playB.classList.toggle('on', side === 'B');
    if (note.textContent !== message) note.textContent = message;
    let a = '', b = '';
    if (lane && pat) {
      const cols = columns(), diff = B ? diffCells(pat.rows, B) : null;
      const transport = playingRow(lane, target.puid, transportTick());
      const rowA = side === 'A' ? audition.row : side === null ? transport : -1;
      a = html(rowLines(lane, `${B ? 'A · ' : ''}${lane.id} · ${pat.name ?? ''} · ${pat.rows.length} rows`, pat.rows, cols, { playRow: rowA, diff, diffClass: 'gone' }));
      if (B) b = html(rowLines(lane, `B · scratch copy · ${B.length} rows`, B, cols, { playRow: side === 'B' ? audition.row : -1, diff, diffClass: 'new', cursor }));
    } else a = html(['This pattern is gone.']);
    if (a !== last.a) { last.a = a; paneA.innerHTML = a; }
    if (b !== last.b) { last.b = b; paneB.innerHTML = b; paneB.hidden = !B; }
  }

  return {
    // Shows a pattern: in the open window, else in a new one. A different pattern drops B (it was a copy of the other one).
    show(li, puid) {
      if (!target || target.li !== li || target.puid !== puid) { dropB(); stopPlaying(); }
      target = { li, puid };
      if (win && !win.closed) { win.focus(); return; }
      open();
    },
    stop: stopPlaying,   // (the song starting ends the test loop)
    get open() { return !!win && !win.closed; },
  };
}
