import { SHAPES, cleanSpline, walk, segmentOf, autoHandles } from '../audio/nodes/bezier.js';

// One envelope drawn as a Bezier spline: thin line, dots on the anchors, nothing boxed. Used three times by the drum synth 2 panel.
//   click on empty space    adds an anchor there
//   drag an anchor          moves it (the first and last stay at the ends of the time axis)
//   click an anchor         shows its two handles; drag a handle to bend the curve either side of it
//   double-click an anchor  makes it a corner (no handles), or smooth again
//   right-click an anchor   deletes it
// With `firstHandle` the very first anchor always shows its handle, so the start of the curve can be bent without choosing it first.
// The buttons start from a shape, put every handle back to smooth, or turn the drawing upside down or back to front.
const W = 520, H = 150, PL = 48, PR = 12, PT = 18, PB = 20;
const GRAB = 8;

export function createBezierEditor({ doc = document, title, color, points, fallback = SHAPES.fall, getMs, labels = () => ['100%', '0'], firstHandle = false, onChange }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k); return e; };
  let spline = cleanSpline(points, fallback);
  let selected = null, drag = null;   // drag: { kind: 'anchor' | 'l' | 'r', i }
  const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
  const canvas = el('canvas', { width: W * dpr, height: H * dpr, className: 'bezier-pad' });
  canvas.style && Object.assign(canvas.style, { width: `${W}px`, height: `${H}px` });
  const ctx = canvas.getContext?.('2d') ?? null;   // (a test's stand-in canvas has none)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pw = W - PL - PR, ph = H - PT - PB;
  const X = x => PL + x * pw, Y = y => PT + (1 - y) * ph;
  const handlesOf = i => { const a = autoHandles(spline, i), p = spline[i]; return { l: p.l ?? a.l, r: p.r ?? a.r }; };
  const emit = () => onChange(spline.map(p => ({ x: round(p.x), y: round(p.y), l: p.l && p.l.map(round), r: p.r && p.r.map(round) })));
  const round = v => Math.round(v * 10000) / 10000;

  // the handles on show: both of the chosen anchor's (those it has a neighbour for), and the first anchor's own when it keeps one
  const shownHandles = () => {
    const list = [];
    if (selected !== null && spline[selected]) {
      if (selected > 0) list.push({ i: selected, key: 'l' });
      if (selected < spline.length - 1) list.push({ i: selected, key: 'r' });
    }
    if (firstHandle && !list.some(h => h.i === 0)) list.push({ i: 0, key: 'r' });
    return list;
  };
  const draw = () => {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = ink; ctx.fillStyle = ink;
    ctx.globalAlpha = 0.18; ctx.beginPath();
    for (const v of [0, 0.5, 1]) { ctx.moveTo(PL, Y(v)); ctx.lineTo(W - PR, Y(v)); }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { ctx.moveTo(X(t), Y(0)); ctx.lineTo(X(t), Y(1)); }
    ctx.stroke();
    ctx.globalAlpha = 0.65; ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText(typeof title === 'function' ? title() : title, PL, 2);
    ctx.textAlign = 'right'; const [top, bottom] = labels(); ctx.fillText(top, PL - 4, Y(1) - 5); ctx.fillText(bottom, PL - 4, Y(0) - 5); ctx.textAlign = 'left';
    const ms = getMs();
    for (const t of [0, 0.5, 1]) { ctx.textAlign = t === 0 ? 'left' : t === 1 ? 'right' : 'center'; ctx.fillText(`${Math.round(ms * t)}${t === 1 ? ' ms' : ''}`, X(t), H - PB + 5); }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    walk(spline).forEach(([x, y], k) => { if (k) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); });
    ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
    for (const { i, key } of shownHandles()) {   // the handles of the chosen anchor (and of the first one, when it keeps its own)
      const p = spline[i], q = handlesOf(i)[key], hx = X(p.x + q[0]), hy = Y(p.y + q[1]);
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(hx, hy, 3, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 0.55;
    }
    ctx.globalAlpha = 1;
    spline.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), i === selected ? 4.5 : 3.5, 0, 2 * Math.PI);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();   // hollow, filled when chosen
      if (i === selected) { ctx.fillStyle = color; ctx.fill(); }
    });
  };

  const at = e => {
    const r = canvas.getBoundingClientRect(), s = r.width ? W / r.width : 1;
    const px = (e.clientX - r.left) * s, py = (e.clientY - r.top) * s;
    return { px, py, x: clamp((px - PL) / pw, 0, 1), y: clamp(1 - (py - PT) / ph, 0, 1) };
  };
  const near = (px, py, x, y) => Math.hypot(px - X(x), py - Y(y)) <= GRAB;
  const hitHandle = (px, py) => {
    for (const { i, key } of shownHandles()) { const p = spline[i], q = handlesOf(i)[key]; if (near(px, py, p.x + q[0], p.y + q[1])) return { i, key }; }
    return null;
  };
  const hitAnchor = (px, py) => spline.findIndex(p => near(px, py, p.x, p.y));

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const m = at(e), hh = hitHandle(m.px, m.py);
    if (hh) { drag = { kind: hh.key, i: hh.i }; selected = hh.i; return; }
    let i = hitAnchor(m.px, m.py);
    if (i < 0) {   // a new anchor where the click was
      const x = clamp(m.x, 0.004, 0.996), at2 = spline.findIndex(p => p.x > x);
      spline.splice(at2, 0, { x, y: m.y, l: null, r: null });
      i = at2; emit();
    }
    selected = i; drag = { kind: 'anchor', i }; draw();
  });
  canvas.addEventListener('mousemove', e => {
    if (!drag) return;
    const m = at(e), p = spline[drag.i];
    if (drag.kind === 'anchor') {
      p.y = m.y;
      if (drag.i > 0 && drag.i < spline.length - 1) p.x = clamp(m.x, spline[drag.i - 1].x + 0.004, spline[drag.i + 1].x - 0.004);
    } else {
      const dx = m.x - p.x, dy = m.y - p.y;
      if (drag.kind === 'r') p.r = [Math.max(0, dx), dy]; else p.l = [Math.min(0, dx), dy];
    }
    emit(); draw();
  });
  const stop = () => { drag = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);
  canvas.addEventListener('dblclick', e => {
    const i = hitAnchor(...Object.values(at(e)).slice(0, 2));
    if (i < 0) return;
    const p = spline[i], corner = p.l && p.r && !p.l[0] && !p.l[1] && !p.r[0] && !p.r[1];
    if (corner) { p.l = null; p.r = null; } else { p.l = [0, 0]; p.r = [0, 0]; }
    emit(); draw();
  });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const m = at(e), i = hitAnchor(m.px, m.py);
    if (i > 0 && i < spline.length - 1) { spline.splice(i, 1); selected = null; emit(); draw(); }
  });

  const set = next => { spline = cleanSpline(next, fallback); selected = null; emit(); draw(); };
  const action = (label, tip, fn) => { const b = el('button', { textContent: label, title: tip, type: 'button' }); b.addEventListener('click', () => set(fn(spline))); return b; };
  const shapes = el('div', { className: 'osc-wave-row' }, ...Object.keys(SHAPES).map(n => action(n, `Start from the ${n} shape`, () => SHAPES[n]())));
  const edits = el('div', { className: 'osc-wave-row' },
    action('smooth', 'Put every handle back to smooth', s => s.map(p => ({ ...p, l: null, r: null }))),
    action('flip', 'Turn the drawing upside down', s => s.map(p => ({ ...p, y: 1 - p.y, l: p.l && [p.l[0], -p.l[1]], r: p.r && [p.r[0], -p.r[1]] }))),
    action('reverse', 'Play the drawing back to front', s => s.map(p => ({ x: 1 - p.x, y: p.y, l: p.r && [-p.r[0], p.r[1]], r: p.l && [-p.l[0], p.l[1]] })).reverse()),
    el('span', { className: 'bezier-tip', textContent: 'click adds · drag moves · double-click corner · right-click deletes' }));
  draw();
  return { el: el('div', { className: 'bezier-edit' }, canvas, shapes, edits), draw, refresh: draw, get points() { return spline.map(p => ({ ...p })); } };
}
