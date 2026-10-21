// The Script tab: a modest code editor (a transparent textarea over a coloured copy of the text), a Run button, an
// output strip and a one-line playground. The script runs in a Worker (client.js) on a copy of the pattern the
// pattern editor is on, and the edits it asks for are applied as one undo step.
//
// The page gives `target()`: { error } or { request, apply(edits), label }.
import { highlight } from './highlight.js';
import { findPatterns, renderViz } from './euclidviz.js';
import { noteToken } from '../seq/cells.js';

export function createScriptScreen({ area, hl, viz = null, runButton, status, out, line, runner, target, onText = () => {}, midi = () => ({ window: 60, order: 'pitch' }) }) {
  let loaded = false;
  const history = [];
  let hist = -1;

  const paint = () => { hl.innerHTML = `${highlight(area.value)}\n`; hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; };
  // The Euclidean preview under the editor: redrawn as you type (and when the caret changes line, to mark the card of that line).
  let patterns = [];
  const caretLine = () => area.value.slice(0, area.selectionStart).split('\n').length;
  const drawViz = () => { if (viz) renderViz(viz, patterns, caretLine()); };
  const scanViz = () => { if (viz) { patterns = findPatterns(area.value); drawViz(); } };
  const info = () => { status.textContent = `${area.value ? area.value.split('\n').length : 0} lines · ${area.value.length} characters`; };

  const show = (lines, error = false) => {
    out.replaceChildren();
    for (const l of lines) {
      const row = document.createElement('div');
      if (error && l.err) row.className = 'err';
      row.textContent = l.text ?? l;
      out.append(row);
    }
    out.scrollTop = 0;
  };

  // Runs `code` (the whole script, a selection, or a typed line) on the pattern under the cursor. Returns a one-line summary.
  async function run(code, { expr = false, lineBase = 0 } = {}) {
    const t = target();
    if (t.error) { show([{ text: t.error, err: true }], true); return t.error; }
    runButton.disabled = true;
    out.replaceChildren(Object.assign(document.createElement('div'), { textContent: 'Running...' }));
    let res;
    try { res = await runner.run({ code, expr, ...t.request }); } finally { runButton.disabled = false; }
    const logs = (res.logs ?? []).map(text => ({ text }));
    if (!res.ok) {
      const where = res.error.line ? `Line ${res.error.line + lineBase}: ` : '';
      const text = `${where}${res.error.message}`;
      show([...logs, { text, err: true }], true);
      return text;
    }
    const wrote = res.edits.length ? t.apply(res.edits) : 0;
    const summary = `${t.label}: ${res.edits.length ? `${res.edits.length} cell${res.edits.length === 1 ? '' : 's'} written` : 'nothing changed'} (seed ${res.seed})`;
    show([...logs, ...(res.value !== undefined ? [{ text: `= ${res.value}` }] : []), ...res.echo.map(text => ({ text })), { text: wrote === 0 && res.edits.length ? `${summary}, but the pattern did not take them` : summary }]);
    return summary;
  }

  // The selected code, or all of it.
  const runText = () => {
    const a = area.selectionStart, b = area.selectionEnd;
    if (b > a) return run(area.value.slice(a, b), { lineBase: area.value.slice(0, a).split('\n').length - 1 });
    return run(area.value);
  };

  // Inserts text at the caret as one undoable step (the browser's own undo keeps working).
  const insert = text => {
    area.focus();
    if (!document.execCommand?.('insertText', false, text)) { area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input')); }
  };

  area.addEventListener('input', () => { paint(); info(); scanViz(); if (loaded) onText(area.value); });
  for (const ev of ['keyup', 'click']) area.addEventListener(ev, drawViz);
  area.addEventListener('scroll', () => { hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; });
  area.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); runText(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const v = area.value, a = area.selectionStart, b = area.selectionEnd;
      const from = v.lastIndexOf('\n', a - 1) + 1;
      if (e.shiftKey || (b > a && v.slice(a, b).includes('\n'))) {   // indent or outdent the lines the selection touches
        const end = (() => { const i = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b); return i < 0 ? v.length : i; })();
        const block = v.slice(from, end), text = block.split('\n').map(l => (e.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
        area.setSelectionRange(from, end);
        insert(text);
        area.setSelectionRange(from, from + text.length);
      } else insert('  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {   // keep the indentation of the line, and add a step after an opening brace
      const v = area.value, a = area.selectionStart, from = v.lastIndexOf('\n', a - 1) + 1, text = v.slice(from, a);
      const indent = /^[ \t]*/.exec(text)[0] + (/[{[(]\s*$/.test(text) ? '  ' : '');
      e.preventDefault();
      insert(`\n${indent}`);
    }
  });
  runButton.addEventListener('click', () => { runText(); });

  line.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = line.value.trim();
      if (!code) return;
      e.preventDefault();
      if (history[history.length - 1] !== code) history.push(code);
      hist = history.length;
      run(code, { expr: true });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      hist = Math.max(0, Math.min(history.length, hist + (e.key === 'ArrowUp' ? -1 : 1)));
      line.value = history[hist] ?? '';
    }
  });

  // MIDI keys fill a note list: the keys struck within the chord window become one entry, 'C-3 E-3 G-3'. Inside a
  // string the names go in with spaces; elsewhere the entry is quoted, with a comma after the one before it.
  let held = [], timer = null;
  const flush = () => {
    timer = null;
    const { order } = midi(), notes = order === 'played' ? held : [...held].sort((x, y) => x - y);
    held = [];
    const names = notes.map(m => { try { return noteToken(m - 12); } catch { return null; } }).filter(Boolean);
    if (!names.length) return;
    const v = area.value, a = area.selectionStart, before = v.slice(v.lastIndexOf('\n', a - 1) + 1, a);
    const inString = ["'", '"', '`'].some(q => (before.match(new RegExp(`(?<!\\\\)${q}`, 'g')) ?? []).length % 2 === 1);
    const prev = before.trimEnd().slice(-1);
    if (inString) insert(`${/[^\s'"`]$/.test(before) ? ' ' : ''}${names.join(' ')}`);
    else insert(`${/['"]$/.test(prev) ? ', ' : ''}'${names.join(' ')}'`);
  };
  const midiNote = m => {
    if (!held.includes(m)) held.push(m);
    if (timer === null) timer = setTimeout(flush, Math.max(5, midi().window));
  };

  return {
    run: () => run(area.value),
    runText,
    midiNote,
    focus: () => area.focus(),
    get text() { return area.value; },
    load(text) { loaded = false; area.value = text ?? ''; paint(); info(); scanViz(); loaded = true; out.replaceChildren(); },
    refresh: () => { paint(); },
  };
}
