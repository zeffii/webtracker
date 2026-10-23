// A small popup menu at the mouse. items: [{ label, hint?, run, disabled? } | { separator: true }]. It closes on a
// click elsewhere, on Escape or when the page scrolls; Up/Down/Enter work as well as the mouse. Returns close().
let open = null;
export function showContextMenu(e, items, { doc = document } = {}) {
  open?.();
  const menu = doc.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  const rows = [];
  let at = -1;
  const mark = i => { at = i; rows.forEach((r, k) => r.classList.toggle('on', k === i)); };
  const close = () => { menu.remove(); doc.removeEventListener('mousedown', away, true); doc.removeEventListener('keydown', keys, true); doc.removeEventListener('scroll', onScroll, true); if (open === close) open = null; };
  const run = item => { close(); item.run(); };
  for (const item of items) {
    if (item.separator) { const s = doc.createElement('div'); s.className = 'ctx-sep'; menu.append(s); continue; }
    const row = doc.createElement('div');
    row.className = `ctx-item${item.disabled ? ' off' : ''}`;
    row.setAttribute('role', 'menuitem');
    const label = doc.createElement('span'); label.textContent = item.label;
    row.append(label);
    if (item.hint) { const h = doc.createElement('span'); h.className = 'ctx-hint'; h.textContent = item.hint; row.append(h); }
    if (!item.disabled) {
      row.addEventListener('mouseenter', () => mark(rows.indexOf(row)));
      row.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); run(item); });
    }
    row.item = item;
    rows.push(row);
    menu.append(row);
  }
  const onScroll = ev => { if (!menu.contains(ev.target)) close(); };   // a long menu scrolls itself
  const away = ev => { if (!menu.contains(ev.target)) close(); };
  const keys = ev => {
    const live = rows.map((r, i) => (r.item.disabled ? -1 : i)).filter(i => i >= 0);
    if (ev.key === 'Escape') close();
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const d = ev.key === 'ArrowDown' ? 1 : -1, p = live.indexOf(at);
      mark(live[(p + d + live.length) % live.length] ?? live[0]);
    } else if (ev.key === 'Enter' && at >= 0) run(rows[at].item);
    else return;
    ev.preventDefault(); ev.stopPropagation();
  };
  doc.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX, vw - w - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY, vh - h - 4))}px`;
  doc.addEventListener('mousedown', away, true);
  doc.addEventListener('keydown', keys, true);
  doc.addEventListener('scroll', onScroll, true);
  open = close;
  return close;
}
