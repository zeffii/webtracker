// The Chord node's editor: the 256 slots (hex 00 to FF) in pages of 16, each a box for a chord name with the notes it
// makes beside it, and under them the list of what can be typed. A name that cannot be read is marked, with the reason.
import { parseChord, noteName, chordNotes, SYNTAX } from '../seq/chordname.js';

const PAGE = 16;
const hex2 = i => i.toString(16).toUpperCase().padStart(2, '0');

export function createChordView({ doc = document, get, set, current = () => -1, octave = () => 4 }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  const root = el('div', { className: 'chordview' });
  const pages = el('div', { className: 'chordview-pages' });
  const list = el('div', { className: 'chordview-list' });
  let page = Math.max(0, Math.min(15, current() >> 4));
  const rows = [];

  const show = (row, i, text) => {
    const name = String(text ?? '').trim();
    const c = name ? parseChord(name) : null;
    row.notes.textContent = !name ? '(plays the note as it is)' : c.error ? c.error : chordNotes(c, { octave: octave() }).map(noteName).join(' ');
    row.notes.className = `chordview-notes${!name ? ' empty' : c.error ? ' bad' : ''}`;
    row.box.classList.toggle('bad', Boolean(c?.error));
  };

  for (let k = 0; k < PAGE; k++) {
    const label = el('span', { className: 'chordview-idx' });
    const box = el('input', { type: 'text', className: 'chordview-box', spellcheck: false, autocomplete: 'off' });
    const notes = el('span', { className: 'chordview-notes' });
    const row = { label, box, notes, i: 0 };
    box.addEventListener('input', () => show(row, row.i, box.value));
    box.addEventListener('change', () => { set(row.i, box.value.trim()); refresh(); });
    for (const type of ['keydown', 'keyup', 'keypress']) box.addEventListener(type, e => e.stopPropagation());
    rows.push(row);
    list.appendChild(el('div', { className: 'chordview-row' }, label, box, notes));
  }

  const buttons = Array.from({ length: 16 }, (_, p) => {
    const b = el('button', { type: 'button', className: 'chordview-page', textContent: `${p.toString(16).toUpperCase()}x`, ariaLabel: `Slots ${hex2(p * PAGE)} to ${hex2(p * PAGE + 15)}` });
    b.addEventListener('click', () => { page = p; refresh(); b.blur?.(); });
    pages.appendChild(b);
    return b;
  });

  const syntax = el('details', { className: 'chordview-syntax' }, el('summary', { textContent: 'What can be typed' }));
  const table = el('div', { className: 'chordview-ref' });
  for (const [what, how] of SYNTAX) table.append(el('span', { className: 'what', textContent: what }), el('span', { className: 'how', textContent: how }));
  syntax.append(table);

  root.append(pages, list, syntax);

  function refresh() {
    const now = current();
    rows.forEach((row, k) => {
      const i = page * PAGE + k;
      row.i = i;
      row.label.textContent = hex2(i);
      row.label.classList.toggle('now', i === now);
      if (doc.activeElement !== row.box) row.box.value = get(i) ?? '';
      show(row, i, row.box.value);
    });
    buttons.forEach((b, p) => {
      b.classList.toggle('on', p === page);
      let used = false;
      for (let k = 0; k < PAGE; k++) if (get(p * PAGE + k)) { used = true; break; }
      b.classList.toggle('used', used);
      b.classList.toggle('now', p === now >> 4);
    });
  }
  refresh();
  return { el: root, refresh };
}
