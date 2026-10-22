// The machine help panel: a small floating window beside the pattern editor that says what the columns of the cursor's
// machine hold and what each of its commands (the Cmd column) does. It follows the cursor lane; Ctrl+Alt+H or the
// pattern editor's right-click menu opens it. Click a command to type it into the Cmd cell under the cursor.
import { commandRows } from '../seq/cmdhelp.js';
import { rangeText } from '../seq/describe.js';

const POS = 'webtracker.helpPos';

// What a column holds, in a few words.
export function columnNote(c) {
  if (c.kind === 'note') return 'a note; === ends it';
  if (c.kind === 'vel') return '00 to FF, FF full volume; keeps its value until changed';
  if (c.kind === 'trig') return '1 to F: how hard it hits';
  if (c.kind === 'param') return rangeText(c);
  if (c.kind === 'cmd') return 'a command (two digits) and its value (four)';
  return '';
}

export function createMachineHelp({ doc = document, onInsert = () => {}, onClose = () => {} } = {}) {
  const box = doc.createElement('div');
  box.className = 'mh'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Machine help');
  const bar = doc.createElement('div'); bar.className = 'mh-bar';
  const title = doc.createElement('span'); title.className = 'mh-title';
  const find = doc.createElement('input'); find.type = 'search'; find.placeholder = 'find'; find.className = 'mh-find'; find.setAttribute('aria-label', 'Find a command or column');
  const x = doc.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Close (Ctrl+Alt+H)'; x.setAttribute('aria-label', 'Close the machine help');
  bar.append(title, find, x);
  const body = doc.createElement('div'); body.className = 'mh-body';
  box.append(bar, body);
  doc.body.append(box);

  let lane = null, focus = null, open = false;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const hexId = id => id.toString(16).toUpperCase().padStart(2, '0');

  function render() {
    body.textContent = '';
    if (!lane) { body.append(el('p', 'mh-none', 'No lane.')); return; }
    const q = find.value.trim().toLowerCase(), has = (...t) => !q || t.some(s => s && s.toLowerCase().includes(q));
    title.textContent = `${lane.id} · machine help`;
    const cols = lane.columns.filter(c => c.kind !== 'cmd' && has(c.short ?? c.label, c.long ?? c.label, columnNote(c)));
    if (cols.length) {
      body.append(el('h6', '', 'COLUMNS'));
      for (const c of cols) {
        const row = el('div', 'mh-row');
        row.append(el('b', '', c.short ?? c.label), el('span', 'mh-name', c.long ?? c.label), el('span', 'mh-note', columnNote(c)));
        body.append(row);
      }
    }
    const cmdCol = lane.columns.find(c => c.kind === 'cmd');
    const rows = commandRows(cmdCol, rangeText).filter(r => has(r.hex, r.name, r.help, r.range));
    if (cmdCol) body.append(el('h6', '', 'COMMANDS · in the Cmd column: two digits, then a four-digit value'));
    let focusRow = null;
    for (const r of rows) {
      const row = el('div', 'mh-row cmd');
      row.title = 'Click to type this command into the Cmd cell under the cursor';
      row.append(el('b', '', r.hex), el('span', 'mh-name', r.name), el('span', 'mh-note', r.range ?? ''));
      if (r.help) row.append(el('p', 'mh-help', r.help));
      row.addEventListener('click', () => onInsert(r.id, r));
      if (focus !== null && (r.id === focus || r.covers?.(focus))) { row.classList.add('on'); focusRow = row; }
      body.append(row);
    }
    if (cmdCol && !rows.length) body.append(el('p', 'mh-none', 'No command matches.'));
    if (!cmdCol) body.append(el('p', 'mh-none', 'This machine has no commands; everything it takes is in the columns above.'));
    focusRow?.scrollIntoView?.({ block: 'nearest' });
  }

  find.addEventListener('input', render);
  find.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { if (find.value) { find.value = ''; render(); } else api.hide(); } });
  x.addEventListener('click', () => api.hide());

  try {
    const pos = JSON.parse(localStorage.getItem(POS) ?? 'null');
    if (pos) { box.style.left = `${pos.x}px`; box.style.top = `${pos.y}px`; box.style.right = 'auto'; }
  } catch { /* none kept */ }
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button, input')) return;
    const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.setPointerCapture?.(e.pointerId);
    const move = ev => Object.assign(box.style, { left: `${Math.min(innerWidth - 40, Math.max(0, ev.clientX - dx))}px`, top: `${Math.min(innerHeight - 24, Math.max(0, ev.clientY - dy))}px`, right: 'auto' });
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
      const b = box.getBoundingClientRect();
      try { localStorage.setItem(POS, JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top) })); } catch { /* not kept */ }
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });

  const api = {
    get open() { return open; },
    show(l, focusId = null) { lane = l; focus = focusId; open = true; box.hidden = false; render(); },
    // the cursor moved to another lane: follow it
    update(l) { if (!open || l === lane) return; lane = l; focus = null; render(); },
    // the cursor is on a command cell: mark it
    point(l, id) { if (!open) return; if (l === lane && id === focus) return; lane = l; focus = id; render(); },
    hide() { if (!open) return; open = false; box.hidden = true; onClose(); },
    toggle(l) { if (open) api.hide(); else api.show(l); },
    el: box,
  };
  return api;
}
