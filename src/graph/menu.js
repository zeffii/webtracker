// The floating "insert node" menu: a search box over the node types, grouped by category.
// Type to filter, Up/Down to move, Enter to insert, Esc to close. It does not know about
// graphs; picking calls onPick(type, at) with the point the menu was opened at.
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

  // The node types that can be placed by hand, matching the text against name and category.
  const entries = text => {
    const q = text.trim().toLowerCase();
    return Object.entries(nodeTypes)
      .filter(([, d]) => !d.master && !d.hidden)
      .map(([type, d]) => ({ type, category: d.category ?? 'Other' }))
      .filter(e => !q || e.type.includes(q) || e.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
  };

  const pick = entry => {
    if (!entry) return;
    close();
    onPick(entry.type, at);
  };

  const render = () => {
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
    list.replaceChildren(...kids);
  };

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, shown.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter') { pick(shown[active]); e.preventDefault(); return; }
    else if (e.key === 'Escape') { close(); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    render();
  });

  function open(x, y) {
    at = { x, y };
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.hidden = false;
    input.value = '';
    active = 0;
    render();
    input.focus();
  }
  function close() { box.hidden = true; }

  return { open, close, entries, get isOpen() { return !box.hidden; }, box };
}
