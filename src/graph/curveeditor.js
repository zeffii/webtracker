import { CURVE_POINTS, PRESETS, normalizeCurve } from '../audio/nodes/curves.js';

// Draw-your-own transfer curve: x runs left to right and y bottom to top, both from -1 to 1.
// Drag on the canvas to draw (gaps between mouse events are filled in), pick a preset, or turn
// on "symmetric" so the left half mirrors the right through the origin. onChange gets the
// whole curve (CURVE_POINTS numbers) on every change, so the sound follows the mouse.
export const SIZE = 180;

export function createCurveEditor({ doc = document, points, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  let curve = Array.from(normalizeCurve(points));
  let drawing = false, last = null, symmetric = false;

  const canvas = el('canvas', { width: SIZE, height: SIZE, className: 'curve' });
  const ctx = canvas.getContext('2d');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const emit = () => onChange(curve.map(v => Math.round(v * 10000) / 10000));

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE);   // axes
    ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2);
    ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0);              // the straight line, for reference
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'hsl(35 75% 52%)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    curve.forEach((y, i) => {
      const px = (i / (CURVE_POINTS - 1)) * (SIZE - 1), py = ((1 - y) / 2) * (SIZE - 1);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.stroke();
  };

  const set = (i, y) => {
    curve[i] = y;
    if (symmetric) {
      curve[CURVE_POINTS - 1 - i] = -y;
      if (i === CURVE_POINTS >> 1) curve[i] = 0;
    }
  };
  const paint = (offsetX, offsetY) => {
    const i = Math.round(clamp(offsetX / (SIZE - 1), 0, 1) * (CURVE_POINTS - 1));
    const y = clamp(1 - (2 * offsetY) / (SIZE - 1), -1, 1);
    if (last === null) set(i, y);
    else {   // fill the points passed over since the last mouse event
      const step = i >= last.i ? 1 : -1, span = Math.abs(i - last.i) || 1;
      for (let j = last.i, s = 0; s <= span; j += step, s++) set(j, last.y + ((y - last.y) * s) / span);
    }
    last = { i, y };
    emit();
    draw();
  };

  canvas.addEventListener('mousedown', e => { drawing = true; last = null; paint(e.offsetX, e.offsetY); });
  canvas.addEventListener('mousemove', e => { if (drawing) paint(e.offsetX, e.offsetY); });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);

  const presets = el('div', { className: 'curve-presets' }, ...Object.keys(PRESETS).map(name => {
    const b = el('button', { textContent: name });
    b.addEventListener('click', () => { curve = PRESETS[name](); if (symmetric) mirror(); emit(); draw(); });
    return b;
  }));
  // the right half is the source, the left half becomes its mirror through the origin
  const mirror = () => {
    for (let i = 0; i < CURVE_POINTS >> 1; i++) curve[i] = -curve[CURVE_POINTS - 1 - i];
    curve[CURVE_POINTS >> 1] = 0;   // an odd curve passes through the origin
  };
  const box = el('input', { type: 'checkbox', checked: false });
  box.addEventListener('change', () => {
    symmetric = box.checked;
    if (symmetric) { mirror(); emit(); draw(); }
  });

  draw();
  return {
    el: el('div', { className: 'curve-editor' }, canvas, presets, el('label', {}, box, ' symmetric')),
    draw,
    get points() { return curve.slice(); },
  };
}
