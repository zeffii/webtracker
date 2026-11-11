// The list of commands in effect at the cursor (the ? key in a Cmd column): number, name, value. Any key closes it.
// Without a page (the tests) it does nothing.
import { popups } from './kit/popups.js';

export function showCommandList({ rows, title, anchor }, { doc = typeof document === 'undefined' ? null : document } = {}) {
  if (!doc) return () => {};
  const box = doc.createElement('div');
  box.className = 'cmd-list-pop';
  box.tabIndex = -1;
  const h = doc.createElement('div'); h.className = 'cl-title'; h.textContent = title; box.append(h);
  if (!rows.length) { const p = doc.createElement('div'); p.className = 'cl-none'; p.textContent = 'Every command is at its default.'; box.append(p); }
  for (const r of rows) {
    const line = doc.createElement('div'); line.className = 'cl-row';
    const a = doc.createElement('span'); a.className = 'cl-hex'; a.textContent = `${r.hex}${r.token.slice(2)}`;
    const b = doc.createElement('span'); b.className = 'cl-name'; b.textContent = r.name;
    const c = doc.createElement('span'); c.className = 'cl-val'; c.textContent = r.value;
    line.append(a, b, c); box.append(line);
  }
  const close = () => { box.remove(); };
  doc.body.append(box);
  const w = box.offsetWidth, hh = box.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  box.style.left = `${Math.max(0, Math.min(anchor?.x ?? 40, vw - w - 4))}px`;
  box.style.top = `${Math.max(0, Math.min(anchor?.y ?? 40, vh - hh - 4))}px`;
  popups.open({ name: 'command list', element: box, close, onKey: () => false, closeOnScroll: true, doc });
  return close;
}
