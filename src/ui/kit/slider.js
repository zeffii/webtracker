// The one drag behaviour for every slider in Wax: a parameter bar, a mixer fader, a level.
//
// dragSlider(el, { axis, inset, snap, onStart, onChange, onEnd, onReset, ignore }) makes `el` a slider track:
//   - press anywhere on it to jump there, drag to move (the pointer is captured, so leaving the track is fine);
//   - double-click calls onReset;
//   - onChange(p, event) gets the position from 0 to 1 ('x': left to right, 'y': bottom to top);
//   - snap(p, event) may adjust the position before onChange (e.g. tick lines; the caller decides what Alt does);
//   - onStart(event) runs on press (before the first onChange), onEnd(event) on release, ignore(event) true skips a press.
// It draws nothing: the look of a track is the stylesheet's job, so every slider can share one look.
export function dragSlider(el, { axis = 'x', inset = 0, snap, onStart, onChange, onEnd, onReset, ignore } = {}) {
  let dragging = false;
  const position = e => {
    const r = el.getBoundingClientRect();
    const p = axis === 'y'
      ? (r.bottom - e.clientY - inset) / Math.max(1, r.height - 2 * inset)
      : (e.clientX - r.left - inset) / Math.max(1, r.width - 2 * inset);
    const p01 = Math.max(0, Math.min(1, p));
    return snap ? snap(p01, e) : p01;
  };
  el.addEventListener('pointerdown', e => {
    if (ignore?.(e)) return;
    e.preventDefault();   // (the view that had the keyboard keeps it)
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
    onStart?.(e);
    onChange?.(position(e), e);
  });
  el.addEventListener('pointermove', e => { if (dragging) onChange?.(position(e), e); });
  const end = e => { if (!dragging) return; dragging = false; el.releasePointerCapture?.(e.pointerId); onEnd?.(e); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  if (onReset) el.addEventListener('dblclick', onReset);
  return { get dragging() { return dragging; } };
}
