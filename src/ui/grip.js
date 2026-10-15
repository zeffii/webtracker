// A drag bar under an area that sets its size: drag it, or press Up/Down on it (Shift for bigger steps),
// double-click for the default. `get`/`set` read and change the size in the area's own units (pixels, rows);
// `unit()` is how many pixels one unit is. The size is remembered in this browser under `key`.
export function attachGrip({ grip, get, set, unit = () => 1, key, step = 1, bigStep = 10, normal }) {
  const remember = v => { try { localStorage.setItem(key, String(v)); } catch { /* private window: not remembered */ } };
  try { const saved = Number(localStorage.getItem(key)); if (saved) set(saved); } catch { /* none saved */ }
  grip.addEventListener('pointerdown', e => {
    const startY = e.clientY, start = get(), px = unit();
    grip.setPointerCapture?.(e.pointerId);
    grip.classList.add('dragging');
    const move = ev => set(start + Math.round((ev.clientY - startY) / px));
    const up = () => {
      grip.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      remember(get());
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  grip.addEventListener('keydown', e => {
    const dir = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    set(get() + dir * (e.shiftKey ? bigStep : step));
    remember(get());
    e.preventDefault();
  });
  grip.addEventListener('dblclick', () => { set(normal); remember(get()); });
}
