// The floating "insert node" menu: a search box over a tree of node types, opened as columns (category, group, node).
// Up/Down move, Right or Enter open a branch (or insert a node), Left goes back, Esc closes. Typing in the box switches to
// a flat list of the nodes that match. It does not know about graphs; picking calls onPick(type, at) with the point the
// menu was opened at.

// How the nodes of a category are grouped. A node that is not listed here still shows up, at the end of its category.
const GROUPS = {
  Sources: [
    ['Synths', ['subsynth', 'oberheim', 'piano', 'addsynth', 'fmsynth', 'dvii', 'wavetable', 'granular', 'specsynth', 'string']],
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

export function createInsertMenu({ parent, nodeTypes, onPick, doc = document }) {
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);
  const box = el('div', { className: 'insert-menu', hidden: true });
  const input = el('input', { type: 'search', placeholder: 'Add node…' });
  input.setAttribute?.('aria-label', 'Add node');
  const list = el('div', { className: 'insert-list' });
  box.appendChild(input);
  box.appendChild(list);
  parent.appendChild(box);

  let shown = [], active = 0, at = { x: 20, y: 30 };
  let sel = [0], depth = 0;   // tree mode: the row chosen in each column, and the column that has the keys

  // The node types that can be placed by hand, matching the text against name and category.
  const entries = text => {
    const q = text.trim().toLowerCase();
    return Object.entries(nodeTypes)
      .filter(([, d]) => !d.master && !d.hidden)
      .map(([type, d]) => ({ type, category: d.category ?? 'Other' }))
      .filter(e => !q || e.type.includes(q) || e.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
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

  const render = () => {
    if (input.value.trim()) {   // searching: a flat list with the category headers
      shown = entries(input.value);
      active = Math.min(active, Math.max(0, shown.length - 1));
      const kids = [];
      let category = null;
      shown.forEach((entry, i) => {
        if (entry.category !== category) {
          category = entry.category;
          kids.push(el('div', { className: 'insert-head', textContent: category }));
        }
        const b = el('button', { textContent: entry.type, className: i === active ? 'active' : '' });
        b.addEventListener('mousedown', e => { e.preventDefault(); pick(entry); });
        kids.push(b);
      });
      if (!kids.length) kids.push(el('div', { className: 'insert-head', textContent: 'No match' }));
      list.className = 'insert-list';
      list.replaceChildren(...kids);
      return;
    }
    const cols = columns();
    list.className = 'insert-list tiers';
    list.replaceChildren(...cols.map((rows, k) => {
      const col = el('div', { className: 'insert-col' });
      rows.forEach((row, i) => {
        const here = sel[k] === i;
        const b = el('button', { textContent: row.label, className: `${row.children ? 'has-sub ' : ''}${here ? (k === depth ? 'active' : 'trail') : ''}`.trim() });
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
      return col;
    }));
  };

  const move = d => {
    const rows = columns()[depth];
    sel = [...sel.slice(0, depth), Math.min(rows.length - 1, Math.max(0, (sel[depth] ?? 0) + d))];
  };

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    const searching = input.value.trim() !== '';
    if (e.key === 'Escape') { close(); e.preventDefault(); return; }
    if (searching) {
      if (e.key === 'ArrowDown') active = Math.min(active + 1, shown.length - 1);
      else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
      else if (e.key === 'Enter') { pick(shown[active]); e.preventDefault(); return; }
      else return;
    } else {
      const row = columns()[depth]?.[sel[depth] ?? 0];
      if (e.key === 'ArrowDown') move(1);
      else if (e.key === 'ArrowUp') move(-1);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (row?.children) { sel = [...sel.slice(0, depth + 1), 0]; depth++; }
        else if (e.key === 'Enter') { pick(row); e.preventDefault(); return; }
      }
      else if (e.key === 'ArrowLeft') { if (depth > 0) { depth--; sel = sel.slice(0, depth + 1); } }
      else return;
    }
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
    active = 0; sel = [0]; depth = 0;
    render();
    input.focus();
  }
  function close() { box.hidden = true; }

  return { open, close, entries, tree, get isOpen() { return !box.hidden; }, box };
}
