import { WAVE_POINTS, WAVES, OPERATORS, normalizeWaves } from '../audio/nodes/waves.js';

// Draw-your-own single-cycle waveforms for the FM synth, one per operator (pick it with the buttons 1 to 4).
// Drag across the canvas to draw (gaps between mouse events are filled in) or pick a preset; "smooth" rounds
// the wave off. onChange gets all four waves (WAVE_POINTS numbers from -1 to 1 each) on every change.
export const WIDTH = 256, HEIGHT = 110;

export function createWaveEditor({ doc = document, waves, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  const all = normalizeWaves(waves).map(w => Array.from(w));
  let op = 0, drawing = false, last = null;

  const canvas = el('canvas', { width: WIDTH, height: HEIGHT, className: 'curve' });
  const ctx = canvas.getContext('2d');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const emit = () => onChange(all.map(w => w.map(v => Math.round(v * 10000) / 10000)));

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2); ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'hsl(35 75% 52%)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    all[op].forEach((y, i) => {
      const px = (i / (WAVE_POINTS - 1)) * (WIDTH - 1), py = ((1 - y) / 2) * (HEIGHT - 1);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.stroke();
  };

  const paint = (offsetX, offsetY) => {
    const w = all[op];
    const i = Math.round(clamp(offsetX / (WIDTH - 1), 0, 1) * (WAVE_POINTS - 1));
    const y = clamp(1 - (2 * offsetY) / (HEIGHT - 1), -1, 1);
    if (last === null) w[i] = y;
    else {   // fill the points passed over since the last mouse event
      const step = i >= last.i ? 1 : -1, span = Math.abs(i - last.i) || 1;
      for (let j = last.i, s = 0; s <= span; j += step, s++) w[j] = last.y + ((y - last.y) * s) / span;
    }
    last = { i, y };
    emit(); draw();
  };
  canvas.addEventListener('mousedown', e => { drawing = true; last = null; paint(e.offsetX, e.offsetY); });
  canvas.addEventListener('mousemove', e => { if (drawing) paint(e.offsetX, e.offsetY); });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);

  const tabs = Array.from({ length: OPERATORS }, (_, k) => {
    const b = el('button', { textContent: `op ${k + 1}`, title: `Draw the waveform of operator ${k + 1}` });
    b.addEventListener('click', () => { op = k; mark(); draw(); });
    return b;
  });
  const mark = () => tabs.forEach((b, k) => { b.style.fontWeight = k === op ? 'bold' : 'normal'; });

  const presets = el('div', { className: 'curve-presets' }, ...Object.keys(WAVES).map(name => {
    const b = el('button', { textContent: name });
    b.addEventListener('click', () => { all[op] = WAVES[name](); emit(); draw(); });
    return b;
  }));
  const smooth = el('button', { textContent: 'smooth', title: 'Round the wave off a little' });
  smooth.addEventListener('click', () => {
    const w = all[op];
    all[op] = w.map((v, i) => (w[(i + WAVE_POINTS - 1) % WAVE_POINTS] + 2 * v + w[(i + 1) % WAVE_POINTS]) / 4);
    emit(); draw();
  });
  presets.appendChild(smooth);

  mark(); draw();
  return {
    el: el('div', { className: 'curve-editor' }, el('div', { className: 'curve-presets' }, ...tabs), canvas, presets),
    draw,
    get waves() { return all.map(w => w.slice()); },
  };
}
