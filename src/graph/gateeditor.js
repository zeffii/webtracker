import { GATE_STEPS, DEFAULT_GATE, normalizeGate } from '../audio/nodes/gater.js';

// The trance gate's pattern: one bar per step, its height the level the sound is let through at (0 closed, 1 open).
// Click or drag across the bars to draw; the steps beyond the gate's `steps` are dimmed. onChange gets all 64 levels, of which only the first `steps` are shown and played.
const W = 480, H = 110, PAD = 6;

export function createGateEditor({ doc = document, points, getParam, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  let levels = normalizeGate(points);
  let drawing = false;
  const canvas = el('canvas', { width: W, height: H, className: 'gate' });
  const ctx = canvas.getContext('2d');
  const shown = () => Math.min(GATE_STEPS, Math.max(1, Math.round(getParam('steps'))));
  const barW = () => (W - 2 * PAD) / shown();
  const emit = () => onChange(levels.map(v => Math.round(v * 100) / 100));

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const steps = shown(), bw = barW();
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < steps; i++) {
      const x = PAD + i * bw, on = true, h = levels[i] * (H - 2 * PAD - 12);
      ctx.fillStyle = 'rgba(128,128,128,0.16)'; ctx.fillRect(x + 1, PAD, bw - 2, H - 2 * PAD - 12);
      ctx.globalAlpha = on ? 1 : 0.3;
      ctx.fillStyle = i % 4 === 0 ? 'hsl(35 85% 52%)' : 'hsl(35 70% 62%)';
      ctx.fillRect(x + 1, H - PAD - 12 - h, bw - 2, h);
      ctx.fillStyle = ink; ctx.globalAlpha = on ? 0.55 : 0.2;
      if (bw >= 14 || i % 4 === 0) ctx.fillText(String(i + 1), x + 1, H - PAD - 9);
    }
    ctx.globalAlpha = 1;
  };
  const point = e => { const r = canvas.getBoundingClientRect(), s = r.width ? W / r.width : 1; return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }; };
  const paint = e => {
    const { x, y } = point(e);
    const n = shown(), i = Math.min(n - 1, Math.max(0, Math.floor((x - PAD) / barW())));
    const v = Math.min(1, Math.max(0, (H - PAD - 12 - y) / (H - 2 * PAD - 12)));
    levels[i] = v < 0.06 ? 0 : v > 0.94 ? 1 : v;
    emit(); draw();
  };
  canvas.addEventListener('mousedown', e => { drawing = true; paint(e); });
  canvas.addEventListener('mousemove', e => { if (drawing) paint(e); });
  canvas.addEventListener('mouseup', () => { drawing = false; });
  canvas.addEventListener('mouseleave', () => { drawing = false; });

  const pattern = s => [...s].map(c => (c === 'x' ? 1 : c === 'o' ? 0.5 : 0));
  const make = (name, fn) => { const b = el('button', { textContent: name }); b.addEventListener('click', () => { levels = normalizeGate(fn()); emit(); draw(); }); return b; };
  const buttons = el('div', { className: 'curve-presets' },
    make('trance', () => [...DEFAULT_GATE]),
    make('16ths', () => pattern('xxxxxxxxxxxxxxxx')),
    make('8ths', () => pattern('x.x.x.x.x.x.x.x.')),
    make('offbeat', () => pattern('..x...x...x...x.')),
    make('gallop', () => pattern('x.xxx.xxx.xxx.xx')),
    make('swell', () => Array.from({ length: 16 }, (_, i) => (i % 4) / 3)),
    make('random', () => Array.from({ length: GATE_STEPS }, () => (Math.random() < 0.65 ? 1 : Math.random() < 0.4 ? 0.5 : 0))),
    make('open', () => pattern('xxxxxxxxxxxxxxxx')));
  draw();
  return { el: el('div', { className: 'curve-editor gate-editor' }, canvas, buttons), draw, refresh: draw, get points() { return levels.slice(); } };
}
