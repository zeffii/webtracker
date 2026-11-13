// A number you change by dragging it up or down (or with the wheel while the mouse is over it): a dim label and the value,
// no box around it. Double-click puts it back to `reset`. It never takes the keyboard, so the piano keys keep playing.
//   get()            the value now            set(value)   called with each new value, already held inside min..max
//   step             the smallest change      perPixel     how much one pixel of drag is worth (default: one step per 3 px)
//   format(value)    the text shown
export function createDragNumber({ doc = document, label, title = '', get, set, min, max, step = 1, perPixel = step / 3, reset = null, format = v => `${v}` }) {
  const el = doc.createElement('span');
  el.className = 'drag-number'; el.title = title;
  const name = doc.createElement('span'); name.className = 'drag-number-label'; name.textContent = label;
  const value = doc.createElement('span'); value.className = 'drag-number-value';
  el.append(name, value);
  const hold = v => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const refresh = () => { value.textContent = format(get()); };
  let from = null;   // { y, value } while dragging
  el.addEventListener('pointerdown', e => { from = { y: e.clientY, value: get() }; el.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (!from) return; set(hold(from.value + (from.y - e.clientY) * perPixel)); refresh(); });
  const end = () => { from = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => { e.preventDefault(); set(hold(get() + (e.deltaY < 0 ? step : -step))); refresh(); }, { passive: false });
  el.addEventListener('dblclick', () => { if (reset !== null) { set(reset); refresh(); } });
  refresh();
  return { el, refresh };
}
