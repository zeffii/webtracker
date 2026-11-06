// A handle on the right edge of a code box: drag it sideways to make the box wider or narrower, double-click it to go back to the usual
// width. The width is remembered (per box, in this browser). The box keeps its own height; the text inside lays itself out again.
//   box        the code box (it gets position: relative from the stylesheet)
//   row        an element that holds the box and limits its width (the shader screen's row); its limit is lifted while a custom width is set
//   reserve    () => pixels beside the box that must stay free (the knobs panel next to the shader box)
const KEY = name => `wax.codeWidth.${name}`;
const MIN = 320;

export function attachWidthGrip(box, { name, row = null, reserve = () => 0 }) {
  const grip = Object.assign(document.createElement('div'), { className: 'width-grip', title: 'Drag to make the code box wider or narrower. Double-click: the usual width' });
  grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical');
  box.append(grip);
  const room = () => {   // the width the box's container has to give, less its padding and what must stay free beside the box
    const holder = (row ?? box.parentElement).parentElement, cs = getComputedStyle(holder);
    return holder.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - reserve();
  };
  const apply = px => {
    if (!px) { box.style.width = box.style.maxWidth = box.style.flex = ''; if (row) row.style.maxWidth = ''; return; }
    box.style.width = `${px}px`; box.style.maxWidth = '100%'; box.style.flex = '0 1 auto';   // never wider than the room it is in
    if (row) row.style.maxWidth = 'none';
  };
  const save = px => { try { px ? localStorage.setItem(KEY(name), String(px)) : localStorage.removeItem(KEY(name)); } catch { /* private mode: it just is not remembered */ } };
  let saved = 0;
  try { saved = Number(localStorage.getItem(KEY(name))) || 0; } catch { /* as above */ }
  if (saved >= MIN) apply(saved);

  let drag = null;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    if (row) row.style.maxWidth = 'none';   // measure the room without the usual limit
    drag = { x: e.clientX, w: box.getBoundingClientRect().width, max: Math.max(MIN, room()) };
    grip.classList.add('on');
  });
  grip.addEventListener('pointermove', e => {
    if (!drag) return;
    const px = Math.round(Math.min(drag.max, Math.max(MIN, drag.w + e.clientX - drag.x)));
    apply(px); drag.now = px;
  });
  const end = () => { if (!drag) return; const px = drag.now ? Math.round(box.getBoundingClientRect().width) : 0; drag = null; grip.classList.remove('on'); if (px) save(px); else if (!saved) apply(0); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { apply(0); save(0); saved = 0; });
  return { reset: () => { apply(0); save(0); } };
}
