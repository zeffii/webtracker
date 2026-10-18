// The floating "insert node" menu, in two parts. The tree is an ordinary cascading menu (categories, groups, nodes), each level
// opening beside the row that opened it: Up/Down move (and wrap), Right or Enter open a branch (or insert a node), Left or Esc
// go back a level (Esc at the top closes), and the underlined letter of a row is its hotkey. The search is a flat list of the
// nodes that match what is typed, with the same keys; press / (or Tab, or click the box) for it, Esc to get back to the tree.
// It does not know about graphs; picking calls onPick(type, at) with the point the menu was opened at.

// How the nodes of a category are grouped. A node that is not listed here still shows up, at the end of its category.
const GROUPS = {
  Sources: [
    ['Synths', ['subsynth', 'oberheim', 'piano', 'addsynth', 'fmsynth', 'dvii', 'wavetable', 'granular', 'specsynth', 'string', 'hat808', 'modchan']],
    ['Basic', ['osc', 'sampler']],
    ['Modulators', ['env', 'lfo']],
    ['Routing', ['sidechain']],
  ],
  Effects: [
    ['Filter & EQ', ['filter', 'eq', 'exciter', 'dcblock']],
    ['Dynamics', ['compressor', 'gate', 'transient', 'envfx']],
    ['Modulation', ['chorus', 'phaser', 'flanger', 'gater', 'freqshift']],
    ['Delay', ['delay', 'multitap', 'shiva']],
    ['Reverb', ['hall', 'plate', 'shimmer']],
    ['Spectral', ['blur']],
    ['Distortion', ['distortion', 'waveshaper', 'crusher']],
    ['Routing', ['split']],
  ],
};
const ORDER = ['Sources', 'Effects', 'Control', 'Mix & level'];

const ROW = 21;   // px: the height of a row, so a submenu can start level with the row that opened it

// The hotkey of each row of a menu level: the first letter or digit of its label that no earlier row has taken.
export function hotkeys(labels) {
  const taken = new Set();
  return labels.map(label => {
    const i = [...label.toLowerCase()].findIndex(c => /[a-z0-9]/.test(c) && !taken.has(c));
    if (i < 0) return -1;
    taken.add(label.toLowerCase()[i]);
    return i;   // the index of the letter in the label
  });
}

export function createInsertMenu({ parent, nodeTypes, onPick, doc = document }) {
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);
  const box = el('div', { className: 'insert-menu', hidden: true });
  const input = el('input', { type: 'search', placeholder: 'Add node: letters pick, / searches' });
  input.setAttribute?.('aria-label', 'Add node');
  const list = el('div', { className: 'insert-list' });
  const hint = el('div', { className: 'insert-hint' });
  box.appendChild(input);
  box.appendChild(list);
  box.appendChild(hint);
  parent.appendChild(box);

  let shown = [], active = 0, at = { x: 20, y: 30 };
  let sel = [0], depth = 0;   // tree: the row chosen in each column, and the column that has the keys
  let searching = false;      // search: a flat list of what the text matches

  // The node types that can be placed by hand, matching the text against name and category.
  const entries = text => {
    const q = text.trim().toLowerCase();
    return Object.entries(nodeTypes)
      .filter(([, d]) => !d.master && !d.hidden)
      .map(([type, d]) => ({ type, category: d.category ?? 'Other' }))
      .filter(e => !q || e.type.includes(q) || e.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
  };
  // The same, best match first: names that start with the text, then names that contain it, then categories.
  const search = text => {
    const q = text.trim().toLowerCase();
    const rank = e => (!q ? 0 : e.type.startsWith(q) ? 0 : e.type.includes(q) ? 1 : 2);
    return entries(text).sort((a, b) => rank(a) - rank(b) || a.type.localeCompare(b.type));
  };

  // The tree: categories, then groups, then nodes. Rows are { label, children } or { label, type }.
  const tree = () => {
    const byCategory = new Map();
    for (const e of entries('')) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e.type]);
    const names = [...ORDER.filter(c => byCategory.has(c)), ...[...byCategory.keys()].filter(c => !ORDER.includes(c)).sort()];
    return names.map(category => {
      const left = new Set(byCategory.get(category));
      const groups = (GROUPS[category] ?? []).map(([label, types]) => {
        const children = types.filter(t => left.delete(t)).map(type => ({ label: type, type }));
        return { label, children };
      }).filter(g => g.children.length);
      return { label: category, children: [...groups, ...[...left].map(type => ({ label: type, type }))] };
    });
  };

  const pick = entry => {
    if (!entry) return;
    close();
    onPick(entry.type, at);
  };

  // The columns for the current choice: the categories, then the children of the chosen row, and so on.
  const columns = () => {
    const cols = [tree()];
    for (let k = 0; k < sel.length; k++) {
      const row = cols[k][sel[k]];
      if (row?.children) cols.push(row.children); else break;
    }
    return cols;
  };

  // A label with the letter at `i` underlined.
  const labelled = (b, label, i) => {
    if (i < 0) { b.textContent = label; return; }
    b.appendChild(el('span', { textContent: label.slice(0, i) }));
    b.appendChild(el('u', { textContent: label[i] }));
    b.appendChild(el('span', { textContent: label.slice(i + 1) }));
  };

  const render = () => {
    hint.textContent = searching ? 'Up/Down, Enter inserts, Esc back to the menu' : 'Underlined letters, arrows and Enter · / searches';
    if (searching) {   // a flat list, best match first
      shown = search(input.value);
      active = Math.min(active, Math.max(0, shown.length - 1));
      const q = input.value.trim().toLowerCase();
      const kids = shown.map((entry, i) => {
        const b = el('button', { className: i === active ? 'active' : '' });
        const at0 = q ? entry.type.indexOf(q) : -1;
        if (at0 >= 0) {
          b.appendChild(el('span', { textContent: entry.type.slice(0, at0) }));
          b.appendChild(el('u', { textContent: entry.type.slice(at0, at0 + q.length) }));
          b.appendChild(el('span', { textContent: entry.type.slice(at0 + q.length) }));
        } else b.appendChild(el('span', { textContent: entry.type }));
        b.appendChild(el('i', { className: 'cat', textContent: entry.category }));
        b.addEventListener('mouseenter', () => { if (active !== i) { active = i; render(); } });
        b.addEventListener('mousedown', e => { e.preventDefault(); pick(entry); });
        return b;
      });
      if (!kids.length) kids.push(el('div', { className: 'insert-head', textContent: 'No match' }));
      list.className = 'insert-list';
      list.replaceChildren(...kids);
      kids[active]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    const cols = columns();
    list.className = 'insert-list tiers';
    let top = 0;   // each level starts level with the row that opened it
    const built = cols.map((rows, k) => {
      const col = el('div', { className: 'insert-col' });
      col.style.marginTop = `${top}px`;
      const keys = hotkeys(rows.map(r => r.label));
      rows.forEach((row, i) => {
        const here = sel[k] === i;
        const b = el('button', { className: `${row.children ? 'has-sub ' : ''}${here ? (k === depth ? 'active' : 'trail') : ''}`.trim() });
        labelled(b, row.label, keys[i]);
        b.addEventListener('mouseenter', () => {
          if (sel[k] === i && depth === k) return;
          sel = [...sel.slice(0, k), i]; depth = k; render();
        });
        b.addEventListener('mousedown', e => {
          e.preventDefault();
          if (row.children) { sel = [...sel.slice(0, k), i, 0]; depth = k + 1; render(); } else pick(row);
        });
        col.appendChild(b);
      });
      top += (sel[k] ?? 0) * ROW;
      return col;
    });
    list.replaceChildren(...built);
    built[depth]?.children?.[sel[depth] ?? 0]?.scrollIntoView?.({ block: 'nearest' });
  };

  const move = d => {
    const n = columns()[depth].length;
    sel = [...sel.slice(0, depth), (((sel[depth] ?? 0) + d) % n + n) % n];   // wraps, like a menu
  };
  const jump = to => { sel = [...sel.slice(0, depth), Math.max(0, Math.min(columns()[depth].length - 1, to))]; };
  const enter = row => {   // into a branch, or insert
    if (row?.children) { sel = [...sel.slice(0, depth + 1), 0]; depth++; return true; }
    pick(row);
    return false;
  };
  const toSearch = () => { searching = true; active = 0; };
  const toTree = () => { searching = false; input.value = ''; };

  input.addEventListener('input', () => { if (input.value.trim()) searching = true; active = 0; render(); });
  input.addEventListener('mousedown', () => { if (!searching) { toSearch(); render(); } });
  input.addEventListener('keydown', e => {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searching) toTree();
      else if (depth > 0) { depth--; sel = sel.slice(0, depth + 1); }
      else { close(); return; }
      render();
      return;
    }
    if (searching) {
      if (e.key === 'ArrowDown') active = shown.length ? (active + 1) % shown.length : 0;
      else if (e.key === 'ArrowUp') active = shown.length ? (active + shown.length - 1) % shown.length : 0;
      else if (e.key === 'PageDown') active = Math.min(active + 8, shown.length - 1);
      else if (e.key === 'PageUp') active = Math.max(active - 8, 0);
      else if (e.key === 'Enter') { pick(shown[active]); e.preventDefault(); return; }
      else if (e.key === 'Tab') toTree();
      else return;
      e.preventDefault();
      render();
      return;
    }
    const rows = columns()[depth], row = rows?.[sel[depth] ?? 0];
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') jump(0);
    else if (e.key === 'End') jump(rows.length - 1);
    else if (e.key === 'PageDown') jump((sel[depth] ?? 0) + 8);
    else if (e.key === 'PageUp') jump((sel[depth] ?? 0) - 8);
    else if (e.key === 'ArrowRight') { if (row?.children) enter(row); }
    else if (e.key === 'Enter') { if (!enter(row)) { e.preventDefault(); return; } }
    else if (e.key === 'ArrowLeft') { if (depth > 0) { depth--; sel = sel.slice(0, depth + 1); } }
    else if (e.key === '/' || e.key === 'Tab') toSearch();
    else if (plain && e.key.length === 1) {   // a hotkey: the underlined letter of a row in this level
      const keys = hotkeys(rows.map(r => r.label)), c = e.key.toLowerCase();
      const i = keys.findIndex((k, n) => k >= 0 && rows[n].label.toLowerCase()[k] === c);
      if (i >= 0) { sel = [...sel.slice(0, depth), i]; if (!enter(rows[i])) { e.preventDefault(); return; } }
    } else return;
    e.preventDefault();
    render();
  });

  function open(x, y) {
    at = { x, y };
    const room = (parent.clientWidth || 0) - 3 * 192 - 8;   // keep the three columns inside the graph when there is room
    box.style.left = `${room > 0 ? Math.min(x, room) : x}px`;
    box.style.top = `${y}px`;
    box.hidden = false;
    input.value = '';
    active = 0; sel = [0]; depth = 0; searching = false;
    render();
    input.focus();
  }
  function close() { box.hidden = true; }

  return { open, close, entries, search, tree, get isOpen() { return !box.hidden; }, box };
}
