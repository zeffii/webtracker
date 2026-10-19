// The curve popup of Ctrl+I: pick or bend a shape, paint one by hand, lay a wave on it, and see the cells that will be
// written as dots on it. opts: { curve, xs (where the cells sit, 0..1), anchor: { x, y }, onChange(curve), onAccept(), onCancel() }.
// Without a page (the tests) it just accepts what it is given.
import { SHAPES, CURVE_N, shapeTable, curveAt, paintTable } from '../seq/curve.js';

export function showCurvePopup(opts, { doc = typeof document === 'undefined' ? null : document } = {}) {
  const { curve, xs } = opts;
  if (!doc) { opts.onChange(curve); opts.onAccept(); return () => {}; }
  const box = doc.createElement('div');
  box.className = 'curve-pop';
  const W = 300, H = 160, pad = 10;
  const canvas = doc.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const css = n => getComputedStyle(doc.documentElement).getPropertyValue(n) || '#888';
  const X = x => pad + x * (W - 2 * pad), Y = y => H - pad - y * (H - 2 * pad);
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(128,128,128,.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(X(0), Y(1), X(1) - X(0), Y(0) - Y(1));
    ctx.beginPath(); ctx.moveTo(X(0), Y(0.5)); ctx.lineTo(X(1), Y(0.5)); ctx.moveTo(X(0.5), Y(0)); ctx.lineTo(X(0.5), Y(1)); ctx.stroke();
    ctx.strokeStyle = '#d04050'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= CURVE_N * 2; i++) { const x = i / (CURVE_N * 2), y = curveAt(curve, x); i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); }
    ctx.stroke();
    ctx.fillStyle = '#2060d0';
    for (const x of xs) { ctx.beginPath(); ctx.arc(X(x), Y(curveAt(curve, x)), 3, 0, 7); ctx.fill(); }
  };
  const changed = () => { draw(); opts.onChange(curve); };
  const label = (text, ...kids) => { const l = doc.createElement('label'); l.append(text, ...kids); return l; };
  const range = (min, max, step, value, on) => { const r = doc.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value; r.addEventListener('input', () => on(Number(r.value))); return r; };

  const presets = doc.createElement('div'); presets.className = 'cp-presets';
  const bend = range(-1, 1, 0.05, curve.bend, v => { curve.bend = v; curve.table = shapeTable(curve.shape, v); curve.custom = false; mark(); changed(); });
  const buttons = SHAPES.map(shape => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = shape;
    b.addEventListener('click', () => { curve.shape = shape; curve.table = shapeTable(shape, curve.bend); curve.custom = false; mark(); changed(); });
    presets.append(b); return [shape, b];
  });
  const mark = () => { for (const [shape, b] of buttons) b.classList.toggle('on', !curve.custom && shape === curve.shape); };
  const cycles = range(0, 8, 0.5, curve.cycles, v => { curve.cycles = v; changed(); });
  const depth = range(0, 0.5, 0.01, curve.depth, v => { curve.depth = v; changed(); });
  const empties = doc.createElement('input'); empties.type = 'checkbox'; empties.checked = curve.empties;
  empties.addEventListener('change', () => { curve.empties = empties.checked; changed(); });
  const bar = doc.createElement('div'); bar.className = 'cp-bar';
  const ok = doc.createElement('button'); ok.type = 'button'; ok.textContent = 'Apply (Enter)'; ok.addEventListener('click', () => accept());
  const no = doc.createElement('button'); no.type = 'button'; no.textContent = 'Cancel (Esc)'; no.addEventListener('click', () => cancel());
  bar.append(ok, no);
  const hint = doc.createElement('div'); hint.className = 'cp-hint'; hint.textContent = 'Drag on the curve to draw your own. Dots are the cells that change.';
  box.append(canvas, presets, label('Bend ', bend), label('Wave cycles ', cycles), label('Wave depth ', depth), label(empties, ' include empty cells'), hint, bar);

  let painting = null;
  const at = e => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) * (W / r.width) - pad) / (W - 2 * pad), y: (H - pad - (e.clientY - r.top) * (H / r.height)) / (H - 2 * pad) }; };
  canvas.addEventListener('mousedown', e => { painting = at(e); curve.custom = true; mark(); paintTable(curve.table, painting.x, painting.y, painting.x, painting.y); changed(); e.preventDefault(); });
  const move = e => { if (!painting) return; const p = at(e); paintTable(curve.table, painting.x, painting.y, p.x, p.y); painting = p; changed(); };
  const up = () => { painting = null; };
  doc.addEventListener('mousemove', move); doc.addEventListener('mouseup', up);

  let closed = false;
  const close = () => { closed = true; box.remove(); doc.removeEventListener('keydown', keys, true); doc.removeEventListener('mousedown', away, true); doc.removeEventListener('mousemove', move); doc.removeEventListener('mouseup', up); };
  const accept = () => { if (closed) return; close(); opts.onAccept(); };
  const cancel = () => { if (closed) return; close(); opts.onCancel(); };
  const keys = e => {
    if (e.key === 'Escape') cancel(); else if (e.key === 'Enter') accept(); else return;
    e.preventDefault(); e.stopPropagation();
  };
  const away = e => { if (!box.contains(e.target)) accept(); };
  doc.body.append(box);
  const w = box.offsetWidth, h = box.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  box.style.left = `${Math.max(0, Math.min(opts.anchor.x, vw - w - 8))}px`;
  box.style.top = `${Math.max(0, Math.min(opts.anchor.y, vh - h - 8))}px`;
  doc.addEventListener('keydown', keys, true); doc.addEventListener('mousedown', away, true);
  mark(); draw(); opts.onChange(curve);
  return cancel;
}
