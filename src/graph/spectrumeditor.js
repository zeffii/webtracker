import { HARMONICS, SPECTRA, normalizeSpectrum } from '../audio/nodes/spectra.js';

// Draw-your-own harmonic levels: one bar per partial, the fundamental on the left, each 0 to 1.
// Drag across the bars to draw (gaps between mouse events are filled in) or pick a preset.
// onChange gets all HARMONICS levels on every change, so the sound follows the mouse.
export const WIDTH = HARMONICS * 6, HEIGHT = 100;

export function createSpectrumEditor({ doc = document, points, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  let bars = Array.from(normalizeSpectrum(points));
  let drawing = false, last = null;

  const canvas = el('canvas', { width: WIDTH, height: HEIGHT, className: 'curve' });
  const ctx = canvas.getContext('2d');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const emit = () => onChange(bars.map(v => Math.round(v * 1000) / 1000));
  const barW = WIDTH / HARMONICS;

  const draw = () => {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'hsl(35 75% 52%)';
    bars.forEach((v, i) => {
      const h = Math.round(v * (HEIGHT - 2));
      ctx.fillRect(Math.round(i * barW) + 1, HEIGHT - h, Math.max(1, Math.round(barW) - 2), h);
    });
  };

  const paint = (offsetX, offsetY) => {
    const i = clamp(Math.floor(offsetX / barW), 0, HARMONICS - 1);
    const v = clamp(1 - offsetY / (HEIGHT - 2), 0, 1);
    if (last === null) bars[i] = v;
    else {   // fill the bars passed over since the last mouse event
      const step = i >= last.i ? 1 : -1, span = Math.abs(i - last.i) || 1;
      for (let j = last.i, s = 0; s <= span; j += step, s++) bars[j] = last.v + ((v - last.v) * s) / span;
    }
    last = { i, v };
    emit();
    draw();
  };

  canvas.addEventListener('mousedown', e => { drawing = true; last = null; paint(e.offsetX, e.offsetY); });
  canvas.addEventListener('mousemove', e => { if (drawing) paint(e.offsetX, e.offsetY); });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);

  const presets = el('div', { className: 'curve-presets' }, ...Object.keys(SPECTRA).map(name => {
    const b = el('button', { textContent: name });
    b.addEventListener('click', () => { bars = SPECTRA[name](); emit(); draw(); });
    return b;
  }));

  draw();
  return {
    el: el('div', { className: 'curve-editor' }, canvas, presets),
    draw,
    get points() { return bars.slice(); },
  };
}
