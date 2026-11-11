import { SHAPES, cleanSpline, walk, autoHandles, splitSegment, nearestOnSpline } from '../audio/nodes/bezier.js';
import { forPage } from './spaceui.js';

// One envelope drawn as a Bezier spline, edited the way the glyph editor edits a path: square anchors, round handles on thin arms,
// the chosen anchor in pink, a ring on the first anchor, the area under the curve lightly filled. The drawing is a function of
// time, so the first and last anchors stay at the ends of the time axis and the others never pass their neighbours.
//
//   click empty space         add an anchor there                  double-click a curve   put an anchor on it, the shape unchanged (or I)
//   click / drag an anchor    choose and move it                   double-click an anchor sharp or smooth
//   drag a handle             bend the curve (Alt: break the point's handles apart)
//   S  E  F  X                the chosen anchor smooth, equal (handles mirrored), free or sharp (a corner)
//   B  or  right-click curve  a segment line or curve              right-click an anchor, or Delete   remove it
//   K                         the chosen anchor the sustain knot (with `knot`): the envelope waits there while the note is held
//   arrows                    nudge (Shift for 10)                 Ctrl+Shift-drag   only along time or only along level
//   Ctrl+Z, Ctrl+Shift+Z      undo and redo
//   time button              linear time, or log time: the start of the drawing gets most of the room (for transients) and the ticks of the
//                            ruler draw closer together towards the tail. Only the view changes; the drawing is the same in both.
// With `firstHandle` the first anchor always shows its handle, so the start of the curve can be bent without choosing it first.
const W = 520, H = 150, PL = 48, PR = 12, PT = 18, PB = 20;
const GRAB = 8, PINK = 'hsl(335 80% 62%)', ARM = 'hsl(195 75% 58%)', HISTORY = 100;
const SNAPS = [0, 8, 16, 32];   // off, or the number of steps across the drawing

// Round times (ms) for the ruler of log time, up to the end of the drawing: 1, 2, 5, 10, 20, 50 ... and the end itself.
function msMarks(total) {
  const marks = [];
  for (let decade = 0.1; decade <= total; decade *= 10) for (const m of [1, 2, 5]) { const v = Math.round(decade * m * 100) / 100; if (v <= total && v >= 1) marks.push(v); }
  return [...new Set(marks)].sort((a, b) => a - b);
}

export function createBezierEditor({ doc = document, title, color, points, fallback = SHAPES.fall, getMs, labels = () => ['100%', '0'], firstHandle = false, knot = false, onChange }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k); return e; };
  let spline = cleanSpline(points, fallback);
  let selected = null, drag = null, hover = null, snapAt = 0;   // hover: { kind: 'anchor' | 'l' | 'r' | 'curve', i }
  let undo = [], redo = [], mouse = null;
  // Log time: x (the drawing's own time, 0 to 1) is shown at u = log(1 + K x) / log(1 + K), so the first few percent fill a good part of the width.
  let logTime = false;
  try { logTime = localStorage.getItem('wax.envLogTime') === '1'; } catch { /* no storage */ }
  const LOG_K = 50, LOG_D = Math.log(1 + LOG_K);
  const toView = x => (logTime ? Math.log(1 + LOG_K * x) / LOG_D : x);
  const fromView = u => (logTime ? (Math.exp(u * LOG_D) - 1) / LOG_K : u);
  const viewSlope = x => (logTime ? LOG_K / ((1 + LOG_K * x) * LOG_D) : 1);   // screen width per unit of x, relative to linear
  const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
  const canvas = el('canvas', { width: W * dpr, height: H * dpr, className: 'bezier-pad', tabIndex: 0 });
  canvas.style && Object.assign(canvas.style, { width: `${W}px`, height: `${H}px`, outline: 'none' });
  const ctx = canvas.getContext?.('2d') ?? null;   // (a test's stand-in canvas has none)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round = v => Math.round(v * 10000) / 10000;
  const pw = W - PL - PR, ph = H - PT - PB;
  const X = x => PL + toView(x) * pw, Y = y => PT + (1 - y) * ph;
  const handlesOf = i => { const a = autoHandles(spline, i), p = spline[i]; return { l: p.l ?? a.l, r: p.r ?? a.r }; };
  const kindOf = p => p.t ?? 'smooth';
  const emit = () => onChange(spline.map(p => ({ x: round(p.x), y: round(p.y), l: p.l && p.l.map(round), r: p.r && p.r.map(round), ...(p.t ? { t: p.t } : {}), ...(p.s ? { s: true } : {}) })));
  const snapshot = () => JSON.stringify(spline);
  const remember = () => { undo.push(snapshot()); if (undo.length > HISTORY) undo.shift(); redo = []; };
  const restore = text => { spline = JSON.parse(text); selected = selected !== null && selected < spline.length ? selected : null; emit(); draw(); };
  const snapped = (v, on = true) => (snapAt && on ? Math.round(v * snapAt) / snapAt : v);

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
    // the grid: the snap steps when snapping, else quarters, with the middle and the ends a little stronger
    const stepsX = snapAt || 4, stepsY = snapAt || 4, totalMs = getMs(), marks = logTime ? msMarks(totalMs) : [];
    ctx.globalAlpha = 0.09; ctx.beginPath();
    if (logTime) for (const m of marks) { ctx.moveTo(X(m / totalMs), Y(0)); ctx.lineTo(X(m / totalMs), Y(1)); }
    else for (let k = 0; k <= stepsX; k++) { ctx.moveTo(X(k / stepsX), Y(0)); ctx.lineTo(X(k / stepsX), Y(1)); }
    for (let k = 0; k <= stepsY; k++) { ctx.moveTo(PL, Y(k / stepsY)); ctx.lineTo(W - PR, Y(k / stepsY)); }
    ctx.stroke();
    ctx.globalAlpha = 0.2; ctx.beginPath();
    for (const v of [0, 0.5, 1]) { ctx.moveTo(PL, Y(v)); ctx.lineTo(W - PR, Y(v)); }
    if (!logTime) for (const t of [0, 0.5, 1]) { ctx.moveTo(X(t), Y(0)); ctx.lineTo(X(t), Y(1)); }
    ctx.stroke();
    ctx.globalAlpha = 0.65; ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText(typeof title === 'function' ? title() : title, PL, 2);
    ctx.textAlign = 'right'; const [top, bottom] = labels(); ctx.fillText(top, PL - 6, Y(1) - 5); ctx.fillText(bottom, PL - 6, Y(0) - 5); ctx.textAlign = 'left';
    const ms = getMs();
    if (logTime) {   // the ruler: round times, closer together towards the tail, a label when there is room for it
      let lastRight = -Infinity; ctx.textAlign = 'center';
      for (const m of marks) {
        const x = X(m / ms), label = m >= 1000 ? `${m / 1000}s` : `${m}`, w = ctx.measureText(label).width;
        if (x - w / 2 > lastRight + 4 && x + w / 2 < W - PR + 14) { ctx.fillText(label, x, H - PB + 5); lastRight = x + w / 2; }
      }
      ctx.textAlign = 'right'; ctx.fillText('log time, ms', W - PR - 70, 2); ctx.textAlign = 'left';
    } else for (const t of [0, 0.5, 1]) { ctx.textAlign = t === 0 ? 'left' : t === 1 ? 'right' : 'center'; ctx.fillText(`${Math.round(ms * t)}${t === 1 ? ' ms' : ''}`, X(t), H - PB + 5); }
    ctx.textAlign = 'left';
    // the curve, and the area under it
    const line = walk(spline);
    const tint = forPage(color, ink);
    ctx.globalAlpha = 0.1; ctx.fillStyle = tint; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (const [x, y] of line) ctx.lineTo(X(x), Y(y));
    ctx.lineTo(X(1), Y(0)); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = tint; ctx.lineWidth = hover?.kind === 'curve' ? 2.4 : 1.6; ctx.beginPath();
    line.forEach(([x, y], k) => { if (k) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); });
    ctx.stroke();
    // the handles: a thin arm and a round end
    ctx.lineWidth = 1;
    for (const { i, key } of shownHandles()) {
      const p = spline[i], q = handlesOf(i)[key], hx = X(p.x + q[0]), hy = Y(p.y + q[1]), on = hover?.kind === key && hover.i === i;
      ctx.strokeStyle = ARM; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(hx, hy, on ? 4.5 : 3.5, 0, 2 * Math.PI); ctx.fillStyle = on ? ARM : 'rgba(0,0,0,0)'; ctx.fill(); ctx.stroke();
    }
    const knotAt = spline.findIndex(p => p.s);
    if (knotAt >= 0) {   // the sustain knot: a dashed line, the part after it (the release) a little darker, and a label
      const kx = X(spline[knotAt].x);
      ctx.globalAlpha = 0.07; ctx.fillStyle = PINK; ctx.fillRect(kx, PT, X(1) - kx, ph);
      ctx.globalAlpha = 0.7; ctx.strokeStyle = PINK; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(kx, Y(1)); ctx.lineTo(kx, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = PINK; ctx.fillText('sustain', kx + 4, Y(0) - 13); ctx.textAlign = 'right'; ctx.fillText('release', W - PR - 2, Y(0) - 13); ctx.textAlign = 'left';
    }
    // the anchors: squares, pink when chosen, a ring on the first
    spline.forEach((p, i) => {
      const x = X(p.x), y = Y(p.y), r = i === selected || (hover?.kind === 'anchor' && hover.i === i) ? 4.5 : 3.5;
      if (i === 0) { ctx.strokeStyle = ink; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.strokeStyle = i === selected ? PINK : ink; ctx.fillStyle = i === selected ? PINK : 'rgba(0,0,0,0)';
      ctx.lineWidth = 1.4; ctx.beginPath(); ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
      if (p.s) { ctx.globalAlpha = 1; ctx.strokeStyle = PINK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.stroke(); }   // the knot wears a pink ring
      if (kindOf(p) === 'equal') { ctx.fillStyle = 'hsl(30 90% 55%)'; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 2 * Math.PI); ctx.fill(); }   // an equal pair is marked with a dot in the anchor
    });
    ctx.globalAlpha = 0.5; ctx.fillStyle = ink;
    ctx.textAlign = 'right'; ctx.fillText(snapAt ? `snap 1/${snapAt}` : '', W - PR, 2); ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  };

  const at = e => {
    const r = canvas.getBoundingClientRect(), s = r.width ? W / r.width : 1;
    const px = (e.clientX - r.left) * s, py = (e.clientY - r.top) * s;
    return { px, py, x: clamp(fromView(clamp((px - PL) / pw, 0, 1)), 0, 1), y: clamp(1 - (py - PT) / ph, 0, 1) };
  };
  const near = (px, py, x, y) => Math.hypot(px - X(x), py - Y(y)) <= GRAB;
  const hitHandle = (px, py) => {
    for (const { i, key } of shownHandles()) { const p = spline[i], q = handlesOf(i)[key]; if (near(px, py, p.x + q[0], p.y + q[1])) return { kind: key, i }; }
    return null;
  };
  const hitAnchor = (px, py) => spline.findIndex(p => near(px, py, p.x, p.y));
  const hitCurve = m => { const n = nearestOnSpline(spline, m.x, m.y, [pw * viewSlope(m.x), ph]); return n && n.d <= 6 ? n : null; };
  const target = m => {
    const h = hitHandle(m.px, m.py); if (h) return h;
    const a = hitAnchor(m.px, m.py); if (a >= 0) return { kind: 'anchor', i: a };
    const c = hitCurve(m); return c ? { kind: 'curve', i: c.i, near: c } : null;
  };

  // every handle written out, so a drag can move one and the point's type can move the other
  const materialize = i => { const h = handlesOf(i), p = spline[i]; p.l = i > 0 ? h.l : [0, 0]; p.r = i < spline.length - 1 ? h.r : [0, 0]; };
  const setHandle = (i, key, x, y, alt) => {
    const p = spline[i]; materialize(i);
    const h = key === 'r' ? [Math.max(0, x - p.x), y - p.y] : [Math.min(0, x - p.x), y - p.y];
    p[key] = h;
    if (alt && kindOf(p) !== 'free') p.t = 'free';
    const other = key === 'r' ? 'l' : 'r', hasOther = key === 'r' ? i > 0 : i < spline.length - 1;
    if (!hasOther) return;
    const kind = kindOf(p), len = Math.hypot(h[0], h[1]);
    if (kind === 'equal') p[other] = [-h[0], -h[1]];
    else if (kind === 'smooth' && len > 1e-9) {   // in line with this one, keeping its own length
      const keep = Math.hypot(p[other][0], p[other][1]) || len;
      p[other] = [-h[0] / len * keep, -h[1] / len * keep];
    }
  };
  const setKind = (i, kind) => {
    const p = spline[i]; if (!p) return;
    if (kind === 'sharp') { p.t = 'sharp'; p.l = [0, 0]; p.r = [0, 0]; return; }
    const was = kindOf(p);
    if (was === 'sharp') { p.l = null; p.r = null; }   // out of a corner: smooth again by itself
    p.t = kind === 'smooth' ? undefined : kind;
    if (kind === 'free') { materialize(i); return; }
    if (kind === 'equal' && i > 0 && i < spline.length - 1) { materialize(i); const m = (Math.hypot(...p.l) + Math.hypot(...p.r)) / 2, d = Math.hypot(...p.r) || 1; p.r = p.r.map(v => v / d * m); p.l = [-p.r[0], -p.r[1]]; }
    else if (kind === 'smooth' && p.l && p.r && i > 0 && i < spline.length - 1) { const d = Math.hypot(...p.r); if (d > 1e-9) { const k = Math.hypot(...p.l); p.l = [-p.r[0] / d * k, -p.r[1] / d * k]; } }
  };
  const addAnchor = (x, y) => { const px = clamp(x, 0.004, 0.996), k = spline.findIndex(p => p.x > px); spline.splice(k, 0, { x: px, y, l: null, r: null }); return k; };
  const insertOn = n => {
    const { point, left, right } = splitSegment(spline, n.i, n.t), p = spline[n.i], q = spline[n.i + 1];
    p.r = left; q.l = right;
    spline.splice(n.i + 1, 0, point);
    return n.i + 1;
  };
  const setKnot = i => { const was = spline[i]?.s; for (const p of spline) delete p.s; if (!was && i < spline.length - 1) spline[i].s = true; };   // one knot, never on the last anchor; again to take it off
  const removeAnchor = i => { if (i > 0 && i < spline.length - 1) { spline.splice(i, 1); selected = null; return true; } return false; };
  const toggleLine = i => {   // a segment between two anchors: a straight line (no handles) or a curve with handles at a third and two thirds
    const p = spline[i], q = spline[i + 1]; if (!q) return;
    const a = p.r ?? autoHandles(spline, i).r, b = q.l ?? autoHandles(spline, i + 1).l, flat = !a[0] && !a[1] && !b[0] && !b[1];
    if (flat) { p.r = [(q.x - p.x) / 3, (q.y - p.y) / 3]; q.l = [-(q.x - p.x) / 3, -(q.y - p.y) / 3]; }
    else { p.r = [0, 0]; q.l = [0, 0]; }
  };

  const place = (m, e) => {   // where a dragged point or handle tip goes: on the grid (as drawn, so log time snaps to the log grid), along one axis with Ctrl+Shift
    let x = fromView(snapped(toView(m.x), !e.altKey)), y = snapped(m.y, !e.altKey);
    return { x, y };
  };
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    canvas.focus?.();
    const m = at(e), t = target(m);
    mouse = m;
    if (t && (t.kind === 'l' || t.kind === 'r')) { remember(); drag = { kind: t.kind, i: t.i, before: snapshot() }; selected = t.i; return; }
    if (t && t.kind === 'anchor') { remember(); selected = t.i; drag = { kind: 'anchor', i: t.i, from: { x: spline[t.i].x, y: spline[t.i].y, mx: m.x, my: m.y }, before: snapshot() }; draw(); return; }
    if (t && t.kind === 'curve') { selected = null; draw(); return; }   // a click on the curve itself adds nothing: double-click puts an anchor there
    remember();
    const k = addAnchor(fromView(snapped(toView(m.x))), snapped(m.y)); selected = k; drag = { kind: 'anchor', i: k, from: { x: spline[k].x, y: spline[k].y, mx: m.x, my: m.y }, before: null };   // (a new anchor is a step even if it is not moved)
    emit(); draw();
  });
  canvas.addEventListener('mousemove', e => {
    const m = at(e); mouse = m;
    if (!drag) { const t = target(m), same = (hover?.kind ?? null) === (t?.kind ?? null) && hover?.i === t?.i; hover = t; if (!same) draw(); return; }
    const p = spline[drag.i];
    let { x, y } = place(m, e);
    if (e.ctrlKey && e.shiftKey && drag.kind === 'anchor') {   // along time only, or along level only, whichever way the mouse has gone further
      if (Math.abs(m.x - drag.from.mx) * pw > Math.abs(m.y - drag.from.my) * ph) y = drag.from.y; else x = drag.from.x;
    }
    if (drag.kind === 'anchor') {
      p.y = y;
      if (drag.i > 0 && drag.i < spline.length - 1) p.x = clamp(x, spline[drag.i - 1].x + 0.004, spline[drag.i + 1].x - 0.004);
    } else setHandle(drag.i, drag.kind, x, y, e.altKey);
    emit(); draw();
  });
  const stop = () => { if (drag && drag.before !== null && snapshot() === drag.before) undo.pop(); drag = null; };   // a click that moved nothing is not a step to undo
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', () => { stop(); hover = null; draw(); });
  canvas.addEventListener('dblclick', e => {
    const m = at(e), t = target(m);
    if (!t) return;
    remember();
    if (t.kind === 'anchor') { const p = spline[t.i]; setKind(t.i, kindOf(p) === 'sharp' ? 'smooth' : 'sharp'); selected = t.i; }
    else if (t.kind === 'curve') selected = insertOn(t.near);
    else return;
    emit(); draw();
  });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const m = at(e), t = target(m);
    if (!t) return;
    remember();
    if (t.kind === 'anchor') { if (!removeAnchor(t.i)) { undo.pop(); return; } }
    else if (t.kind === 'curve') toggleLine(t.i);
    else { undo.pop(); return; }
    emit(); draw();
  });
  const act = fn => { remember(); fn(); emit(); draw(); };
  canvas.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } } else if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } return; }
    if (k === 'delete' || k === 'backspace') { if (selected !== null && spline[selected] && selected > 0 && selected < spline.length - 1) { e.preventDefault(); act(() => removeAnchor(selected)); } return; }
    if (k.startsWith('arrow') && selected !== null && spline[selected]) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1), p = spline[selected], first = selected === 0, last = selected === spline.length - 1;
      act(() => {
        if (k === 'arrowup') p.y = clamp(p.y + step / ph, 0, 1);
        else if (k === 'arrowdown') p.y = clamp(p.y - step / ph, 0, 1);
        else if (!first && !last) p.x = clamp(fromView(toView(p.x) + (k === 'arrowright' ? step : -step) / pw), spline[selected - 1].x + 0.004, spline[selected + 1].x - 0.004);
      });
      return;
    }
    if (selected !== null && spline[selected]) {
      const kind = { s: 'smooth', e: 'equal', f: 'free', x: 'sharp' }[k];
      if (kind) { e.preventDefault(); act(() => setKind(selected, kind)); return; }
    }
    if (knot && k === 'k' && selected !== null && spline[selected]) { e.preventDefault(); act(() => setKnot(selected)); return; }
    if (k === 'i' && mouse) { const c = hitCurve(mouse); if (c) { e.preventDefault(); act(() => { selected = insertOn(c); }); } return; }
    if (k === 'b' && mouse) { const c = hitCurve(mouse); if (c) { e.preventDefault(); act(() => toggleLine(c.i)); } }
  });

  const set = next => { remember(); spline = cleanSpline(next, fallback); selected = null; emit(); draw(); };
  const action = (label, tip, fn) => { const b = el('button', { textContent: label, title: tip, type: 'button' }); b.addEventListener('click', fn); return b; };
  const shape = n => action(n, `Start from the ${n} shape`, () => set(SHAPES[n]()));
  const kindButton = (label, kind, tip) => action(label, tip, () => { if (selected === null) return; act(() => setKind(selected, kind)); });
  const snapButton = action('snap off', 'Snap anchors and handles to a grid (click to change the size)', () => { snapAt = SNAPS[(SNAPS.indexOf(snapAt) + 1) % SNAPS.length]; snapButton.textContent = snapAt ? `snap 1/${snapAt}` : 'snap off'; draw(); });
  const timeButton = action(logTime ? 'time: log' : 'time: linear', 'Show time evenly (linear), or give the start of the drawing most of the room (log) so a transient is easy to shape', () => {
    logTime = !logTime; timeButton.textContent = logTime ? 'time: log' : 'time: linear';
    try { localStorage.setItem('wax.envLogTime', logTime ? '1' : '0'); } catch { /* no storage */ }
    draw();
  });
  const shapes = el('div', { className: 'osc-wave-row' }, ...Object.keys(SHAPES).map(shape));
  const kinds = el('div', { className: 'osc-wave-row' },
    kindButton('sharp', 'sharp', 'The chosen anchor a corner (X)'), kindButton('smooth', 'smooth', 'Its handles stay in line (S)'), kindButton('equal', 'equal', 'In line and the same length, mirrored as you drag (E)'), kindButton('free', 'free', 'Each handle on its own (F, or Alt-drag a handle)'),
    action('auto', 'Put every handle back to smooth, worked out by itself', () => act(() => { spline = spline.map(p => ({ x: p.x, y: p.y, l: null, r: null })); })),
    action('flip', 'Turn the drawing upside down', () => act(() => { spline = spline.map(p => ({ ...p, y: 1 - p.y, l: p.l && [p.l[0], -p.l[1]], r: p.r && [p.r[0], -p.r[1]] })); })),
    action('reverse', 'Play the drawing back to front', () => act(() => { spline = spline.map(p => ({ ...p, s: undefined, x: 1 - p.x, l: p.r && [-p.r[0], p.r[1]], r: p.l && [-p.l[0], p.l[1]] })).reverse(); selected = null; })),
    action('undo', 'Undo (Ctrl+Z)', () => { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } }),
    action('redo', 'Redo (Ctrl+Shift+Z)', () => { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } }),
    ...(knot ? [action('sustain', 'Make the chosen anchor the sustain knot, or take it off (K): the envelope waits there while the note is held', () => { if (selected !== null) act(() => setKnot(selected)); })] : []),
    snapButton, timeButton);
  const tip = el('div', { className: 'bezier-tip', textContent: 'click adds · double-click a curve inserts · double-click an anchor sharp/smooth · right-click deletes an anchor or flips a segment line/curve · S E F X types · B line/curve · I insert · arrows nudge' });
  draw();
  return { el: el('div', { className: 'bezier-edit' }, canvas, shapes, kinds, tip), draw, refresh: draw, get points() { return spline.map(p => ({ ...p })); } };
}
