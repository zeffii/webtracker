import { WAVE_POINTS, WAVES, normalizeWave } from '../audio/nodes/waves.js';

// The oscillator's drawn wave: one cycle, drawn by dragging across the panel, kept as WAVE_POINTS values from -1 to 1.
// A thin line with dots, sitting straight on the page. It is only heard when the oscillator's `wave` is 8 (drawn), so the
// drawing is dimmed otherwise. How the drawing is made may change later; this is the one place that knows.
const W = 320, H = 120, PAD = 8, DRAWN = 8;
const ACCENT = 'hsl(35 80% 55%)';

export function createOscWaveEditor({ doc = document, points, getWave, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  let wave = Array.from(normalizeWave(points));
  let drawing = false, last = null, hover = null;
  const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));   // sharp on a high-density screen
  const canvas = el('canvas', { width: W * dpr, height: H * dpr, className: 'osc-wave-pad' });
  canvas.style && Object.assign(canvas.style, { width: `${W}px`, height: `${H}px` });
  const ctx = canvas.getContext?.('2d') ?? null;   // (a test's stand-in canvas has none)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const xOf = i => PAD + (i / WAVE_POINTS) * (W - 2 * PAD), yOf = v => PAD + ((1 - v) / 2) * (H - 2 * PAD);
  const emit = () => onChange(wave.map(v => Math.round(v * 10000) / 10000));

  const draw = () => {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const live = getWave?.() === DRAWN;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = ink; ctx.fillStyle = ink;
    ctx.globalAlpha = 0.22;   // the centre line, the peaks and the quarter marks
    ctx.beginPath();
    ctx.moveTo(PAD, yOf(0)); ctx.lineTo(W - PAD, yOf(0));
    for (const q of [0.25, 0.5, 0.75]) { ctx.moveTo(xOf(q * WAVE_POINTS), yOf(1)); ctx.lineTo(xOf(q * WAVE_POINTS), yOf(-1)); }
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(PAD, yOf(1)); ctx.lineTo(W - PAD, yOf(1)); ctx.moveTo(PAD, yOf(-1)); ctx.lineTo(W - PAD, yOf(-1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = live ? 1 : 0.4;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.beginPath();
    wave.forEach((v, i) => { if (i) ctx.lineTo(xOf(i), yOf(v)); else ctx.moveTo(xOf(i), yOf(v)); });
    ctx.lineTo(xOf(WAVE_POINTS), yOf(wave[0]));   // the cycle closes on its first point
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    for (let i = 0; i < WAVE_POINTS; i += 8) { ctx.beginPath(); ctx.arc(xOf(i), yOf(wave[i]), 2, 0, 2 * Math.PI); ctx.fill(); }
    if (hover !== null) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(xOf(hover), yOf(wave[hover]), 3.5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.globalAlpha = 0.6; ctx.fillStyle = ink; ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText(live ? 'DRAWN WAVE' : 'DRAWN WAVE (heard when wave is 8)', PAD, 0);
    ctx.globalAlpha = 1;
  };

  const at = e => {
    const r = canvas.getBoundingClientRect(), s = r.width ? W / r.width : 1;
    const x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
    return { i: Math.round(clamp((x - PAD) / (W - 2 * PAD), 0, 1) * WAVE_POINTS) % WAVE_POINTS, v: clamp(1 - (2 * (y - PAD)) / (H - 2 * PAD), -1, 1) };
  };
  const paint = e => {
    const { i, v } = at(e);
    const snapped = Math.abs(v) < 0.04 ? 0 : v;   // a little pull to the centre line, and to the peaks
    const y = snapped > 0.96 ? 1 : snapped < -0.96 ? -1 : snapped;
    if (last === null) wave[i] = y;
    else {   // the points passed over since the last mouse event
      const step = i >= last.i ? 1 : -1, span = Math.abs(i - last.i) || 1;
      for (let j = last.i, s = 0; s <= span; j += step, s++) wave[j % WAVE_POINTS] = last.y + ((y - last.y) * s) / span;
    }
    last = { i, y }; hover = i;
    emit(); draw();
  };
  canvas.addEventListener('mousedown', e => { drawing = true; last = null; paint(e); });
  canvas.addEventListener('mousemove', e => { if (drawing) paint(e); else { hover = at(e).i; draw(); } });
  const stop = () => { drawing = false; last = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', () => { stop(); hover = null; draw(); });

  const set = next => { wave = Array.from(next); emit(); draw(); };
  const action = (label, title, fn) => { const b = el('button', { textContent: label, title, type: 'button' }); b.addEventListener('click', () => set(fn(wave))); return b; };
  const shapes = el('div', { className: 'osc-wave-row' }, ...['sine', 'triangle', 'saw', 'square', 'organ'].map(n => action(n, `Start from a ${n} wave`, () => WAVES[n]())));
  const edits = el('div', { className: 'osc-wave-row' },
    action('smooth', 'Round the wave off a little', w => w.map((v, i) => (w[(i + WAVE_POINTS - 1) % WAVE_POINTS] + 2 * v + w[(i + 1) % WAVE_POINTS]) / 4)),
    action('flip', 'Turn the wave upside down', w => w.map(v => -v)),
    action('reverse', 'Play the cycle backwards', w => w.slice().reverse()),
    action('mirror', 'Make the second half a mirror of the first (a symmetric wave: only odd or only even harmonics)', w => w.map((v, i) => (i < WAVE_POINTS / 2 ? v : w[WAVE_POINTS - i - 1]))),
    action('random', 'A random wave, smoothed', () => { let w = Array.from({ length: WAVE_POINTS }, () => Math.random() * 2 - 1); for (let k = 0; k < 6; k++) w = w.map((v, i) => (w[(i + WAVE_POINTS - 1) % WAVE_POINTS] + 2 * v + w[(i + 1) % WAVE_POINTS]) / 4); const m = Math.max(...w.map(Math.abs)) || 1; return w.map(v => v / m); }));

  draw();
  return { el: el('div', { className: 'curve-editor osc-wave' }, canvas, shapes, edits), draw, refresh: draw, get points() { return wave.slice(); } };
}
