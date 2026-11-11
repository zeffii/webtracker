// A floating panel: a small window over the views with a title bar to drag it by, a close button, and optional extra title buttons.
// Its position is remembered in this browser under its id, a press on it brings it to the front, and it is kept inside the window.
// The caller fills `content` (a div that is a direct child of the panel) and decides when the panel is shown.
//
//   id            names the panel for its remembered position
//   title         the title text (setTitle changes it)
//   buttons       extra title-bar buttons: [{ text, title, onClick }], left of the close button
//   onClose       the close button was pressed (the owner decides what closing means)
//   start         where it first appears: { left, top } or { right, top } in pixels
//   offset        pixels to shift a first-time position by, so panels opened together do not sit on each other
let frontZ = 30;   // panels stack above the page; a pressed panel goes above the others

export function createFloating({ id, title = '', buttons = [], onClose = () => {}, start = { right: 24, top: 90 }, offset = 0, width = 230, doc = document, storageKey = `webtracker.floatPos.${id}` }) {
  const el = doc.createElement('div'), bar = doc.createElement('div'), name = doc.createElement('span'), content = doc.createElement('div');
  el.className = 'fl'; el.dataset.panel = id; el.style.width = `${width}px`;
  bar.className = 'fl-title'; name.textContent = title; content.className = 'fl-body';
  bar.append(name);
  for (const b of buttons) bar.append(titleButton(doc, b.text, b.title, b.onClick));
  bar.append(titleButton(doc, '×', 'Close', () => onClose()));
  el.append(bar, content);
  doc.body.append(el);

  const place = (x, y) => Object.assign(el.style, { left: `${Math.min(innerWidth - 40, Math.max(0, x))}px`, top: `${Math.min(innerHeight - 24, Math.max(0, y))}px`, right: 'auto' });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { /* not remembered */ }
  if (saved) place(saved.x, saved.y);
  else place(start.left ?? innerWidth - width - (start.right ?? 24) + offset, (start.top ?? 90) + offset);

  const raise = () => { el.style.zIndex = String(++frontZ); };
  el.addEventListener('pointerdown', raise);
  raise();

  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const move = ev => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
      const b = el.getBoundingClientRect();
      try { localStorage.setItem(storageKey, JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top) })); } catch { /* private window */ }
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });

  return { el, content, raise, setTitle: text => { name.textContent = text; }, destroy: () => el.remove() };
}

function titleButton(doc, text, title, onClick) {
  const b = doc.createElement('button');
  b.type = 'button'; b.textContent = text; b.title = title; b.tabIndex = -1;
  b.addEventListener('click', onClick);
  return b;
}
