// The Int node's number box: a number you can type, with - and + buttons that nudge it by one (Shift: ten).
export function createIntView({ doc = document, get, set, min = -128, max = 128 }) {
  const el = doc.createElement('div');
  el.className = 'intview';
  const mk = (text, label, by) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = text; b.ariaLabel = label; b.className = 'intview-btn';
    b.addEventListener('click', e => { put(get() + by * (e.shiftKey ? 10 : 1)); b.blur?.(); });
    return b;
  };
  const box = doc.createElement('input');
  box.type = 'text'; box.inputMode = 'numeric'; box.className = 'intview-box'; box.ariaLabel = 'Integer value';
  const put = v => { set(Math.min(max, Math.max(min, Math.round(v)))); refresh(); };
  box.addEventListener('change', () => { const v = Number.parseFloat(box.value); if (Number.isFinite(v)) put(v); else refresh(); });
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { put(get() + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); e.preventDefault(); }
    e.stopPropagation();
  });
  el.append(mk('−', 'Subtract one', -1), box, mk('+', 'Add one', 1));
  function refresh() { if (doc.activeElement !== box) box.value = String(Math.round(get())); }
  refresh();
  return { el, refresh };
}
