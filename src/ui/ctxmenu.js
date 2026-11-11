// A small popup menu at the mouse. items: [{ label, hint?, run, disabled? } | { separator: true }]. It closes on a
// click elsewhere, on Escape or when the page scrolls; Up/Down/Enter work as well as the mouse. Returns close().
// Escape, the click elsewhere and the scroll are the popup stack's (src/ui/kit/popups.js); this file keeps the arrows and Enter.
import { popups } from './kit/popups.js';

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
  const close = () => { menu.remove(); layer.release(); if (open === close) open = null; };
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
  // Arrow keys move the mark, Enter runs the marked item. Returns true if it took the key.
  const onKey = ev => {
    const live = rows.map((r, i) => (r.item.disabled ? -1 : i)).filter(i => i >= 0);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const d = ev.key === 'ArrowDown' ? 1 : -1, p = live.indexOf(at);
      mark(live[(p + d + live.length) % live.length] ?? live[0]);
      return true;
    }
    if (ev.key === 'Enter' && at >= 0) { run(rows[at].item); return true; }
    return false;
  };
  doc.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX, vw - w - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY, vh - h - 4))}px`;
  const layer = popups.open({ name: 'context menu', element: menu, close, onKey, closeOnScroll: true, doc });   // (a long menu scrolls itself: a scroll inside it does not close it)
  open = close;
  return close;
}
