// The curve popup of Ctrl+I: pick or bend a shape, paint one by hand, lay a wave on it, and see the cells that will be
// written as dots on it. opts: { curve, xs (where the cells sit, 0..1), anchor: { x, y }, onChange(curve), onAccept(), onCancel() }.
// Without a page (the tests) it just accepts what it is given.
import { SHAPES, CURVE_N, shapeTable, curveAt, paintTable, bezierFrom, bezierFix, bezierValue, bezierTable } from '../seq/curve.js';

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
    if (curve.bezier) {   // handles on stems, anchors as squares (a ring marks a broken anchor)
      const pts = curve.bezier, last = pts.length - 1;
      ctx.strokeStyle = ctx.fillStyle = '#9a7a18'; ctx.lineWidth = 1;
      pts.forEach((p, i) => {
        for (const [k, h] of [['l', p.hl], ['r', p.hr]]) {
          if ((k === 'l' && i === 0) || (k === 'r' && i === last)) continue;
          ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(p.x + h.x), Y(p.y + h.y)); ctx.stroke();
          ctx.beginPath(); ctx.arc(X(p.x + h.x), Y(p.y + h.y), 4, 0, 7); ctx.fill();
        }
      });
      pts.forEach(p => { ctx.fillStyle = css('--fg'); ctx.fillRect(X(p.x) - 4, Y(p.y) - 4, 8, 8); if (!p.smooth) { ctx.strokeStyle = '#d04050'; ctx.strokeRect(X(p.x) - 6, Y(p.y) - 6, 12, 12); } });
    }
    ctx.fillStyle = '#2060d0';
    for (const x of xs) { ctx.beginPath(); ctx.arc(X(x), Y(curveAt(curve, x)), 3, 0, 7); ctx.fill(); }
  };
  const changed = () => { draw(); opts.onChange(curve); };
  const label = (text, ...kids) => { const l = doc.createElement('label'); l.append(text, ...kids); return l; };
  const range = (min, max, step, value, on) => { const r = doc.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value; r.addEventListener('input', () => on(Number(r.value))); return r; };

  const presets = doc.createElement('div'); presets.className = 'cp-presets';
  const bend = range(-1, 1, 0.05, curve.bend, v => { curve.bend = v; curve.table = shapeTable(curve.shape, v); curve.custom = false; curve.bezier = null; mark(); changed(); });
  const buttons = SHAPES.map(shape => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = shape;
    b.addEventListener('click', () => { curve.shape = shape; curve.table = shapeTable(shape, curve.bend); curve.custom = false; curve.bezier = null; mark(); changed(); });
    presets.append(b); return [shape, b];
  });
  const bz = doc.createElement('button'); bz.type = 'button'; bz.textContent = 'bezier';
  bz.addEventListener('click', () => { if (!curve.bezier) { curve.bezier = bezierFrom(curve.custom ? 's-curve' : curve.shape); curve.table = bezierTable(bezierFix(curve.bezier)); curve.custom = false; } mark(); changed(); });
  presets.append(bz);
  const mark = () => { for (const [shape, b] of buttons) b.classList.toggle('on', !curve.custom && !curve.bezier && shape === curve.shape); bz.classList.toggle('on', !!curve.bezier); };
  const cycles = range(0, 8, 0.5, curve.cycles, v => { curve.cycles = v; changed(); });
  const depth = range(0, 0.5, 0.01, curve.depth, v => { curve.depth = v; changed(); });
  const empties = doc.createElement('input'); empties.type = 'checkbox'; empties.checked = curve.empties;
  empties.addEventListener('change', () => { curve.empties = empties.checked; changed(); });
  const bar = doc.createElement('div'); bar.className = 'cp-bar';
  const ok = doc.createElement('button'); ok.type = 'button'; ok.textContent = 'Apply (Enter)'; ok.addEventListener('click', () => accept());
  const no = doc.createElement('button'); no.type = 'button'; no.textContent = 'Cancel (Esc)'; no.addEventListener('click', () => cancel());
  bar.append(ok, no);
  const hint = doc.createElement('div'); hint.className = 'cp-hint'; hint.textContent = 'Drag on the curve to draw your own. Dots are the cells that change. Bezier: drag anchors and handles, double-click adds or removes an anchor, Alt-click breaks or joins its handles.';
  box.append(canvas, presets, label('Bend ', bend), label('Wave cycles ', cycles), label('Wave depth ', depth), label(empties, ' include empty cells'), hint, bar);

  let painting = null;
  const at = e => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) * (W / r.width) - pad) / (W - 2 * pad), y: (H - pad - (e.clientY - r.top) * (H / r.height)) / (H - 2 * pad) }; };
  // bezier mode: anchors and handles are picked and dragged; everything is kept inside the rules of bezierFix
  const hit = p => {
    let best = null, bd = 10;
    curve.bezier.forEach((a, i) => {
      const cands = [['a', a.x, a.y]];
      if (i > 0) cands.push(['l', a.x + a.hl.x, a.y + a.hl.y]);
      if (i < curve.bezier.length - 1) cands.push(['r', a.x + a.hr.x, a.y + a.hr.y]);
      for (const [k, x, y] of cands) { const d = Math.hypot(X(x) - X(p.x), Y(y) - Y(p.y)) - (k === 'a' ? 2 : 0); if (d < bd) { bd = d; best = { i, k }; } }
    });
    return best;
  };
  const bezierSet = () => { bezierFix(curve.bezier); curve.table = bezierTable(curve.bezier); changed(); };
  let grab = null;
  canvas.addEventListener('mousedown', e => {
    if (curve.bezier) {
      const h = hit(at(e)); e.preventDefault(); if (!h) return;
      if (e.altKey && h.k === 'a') { curve.bezier[h.i].smooth = !curve.bezier[h.i].smooth; bezierSet(); return; }
      grab = h; return;
    }
    painting = at(e); curve.custom = true; mark(); paintTable(curve.table, painting.x, painting.y, painting.x, painting.y); changed(); e.preventDefault();
  });
  canvas.addEventListener('dblclick', e => {
    if (!curve.bezier) return;
    const p = at(e), h = hit(p), pts = curve.bezier;
    if (h && h.k === 'a') { if (h.i > 0 && h.i < pts.length - 1) { pts.splice(h.i, 1); bezierSet(); } return; }
    const x = Math.min(0.98, Math.max(0.02, p.x)), y = bezierValue(pts, x), d = 0.01, slope = (bezierValue(pts, Math.min(1, x + d)) - bezierValue(pts, Math.max(0, x - d))) / (2 * d);
    pts.push({ x, y, hl: { x: -0.08, y: -slope * 0.08 }, hr: { x: 0.08, y: slope * 0.08 }, smooth: true });
    bezierSet();
  });
  const bezierMove = e => {
    const pts = curve.bezier, a = pts[grab.i], p = at(e), y = Math.min(1, Math.max(0, p.y));
    if (grab.k === 'a') {
      if (grab.i > 0 && grab.i < pts.length - 1) { a.x = Math.min(pts[grab.i + 1].x - 0.004, Math.max(pts[grab.i - 1].x + 0.004, p.x)); a.y = y; }
    } else {
      const left = grab.k === 'l', mine = left ? a.hl : a.hr, other = left ? a.hr : a.hl, sign = left ? -1 : 1;
      const room = left ? a.x - pts[grab.i - 1].x : pts[grab.i + 1].x - a.x;
      mine.x = sign * Math.min(room, Math.max(0, sign * (p.x - a.x))); mine.y = Math.min(1 - a.y, Math.max(-a.y, y - a.y));
      if (a.smooth && (left ? grab.i < pts.length - 1 : grab.i > 0)) {   // the other side points the opposite way, keeping its length
        const len = Math.hypot(other.x, other.y) || 0.15, m = Math.hypot(mine.x, mine.y) || 1e-6, oroom = left ? pts[grab.i + 1].x - a.x : a.x - pts[grab.i - 1].x;
        let ox = -mine.x / m * len, oy = -mine.y / m * len;
        if (Math.abs(ox) > oroom) { const f = oroom / Math.abs(ox); ox *= f; oy *= f; }
        other.x = ox; other.y = oy;
      }
    }
    bezierSet();
  };
  canvas.addEventListener('mousemove', e => { if (curve.bezier && !grab) canvas.style.cursor = hit(at(e)) ? 'grab' : 'crosshair'; });
  const move = e => { if (grab) { bezierMove(e); return; } if (!painting) return; const p = at(e); paintTable(curve.table, painting.x, painting.y, p.x, p.y); painting = p; changed(); };
  const up = () => { painting = null; grab = null; };
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
