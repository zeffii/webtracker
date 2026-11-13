import { makeCanvas, drag, forPage, clamp, ORANGE } from './spaceui.js';
import { MAX_POINTS, DEFAULT_PATH, cleanPath, insideDiamond, diamondWeights } from '../audio/nodes/vectorcore.js';

// The diamond of the vector nodes: A at the left point, B at the top, C at the right, D at the bottom.
//
// With a path (compass, vecpath) it shows the points the mix travels through after a note starts, joined by thin lines, the
// first one ringed. Under the diamond is the time bar: one trip from left to right, with a mark where each point is reached.
//   click empty space    add a point after the chosen one        drag a point       move it
//   right-click a point  remove it                               drag a time mark   give the stretches either side more or less time
//   drag the +           shift the whole path (the x and y settings); double-click it to centre it again
// Without a path (vecmix) there is only the +, and a drag anywhere moves it.
//
// It is mouse only and never takes the keyboard.
const W = 240, CX = 120, CY = 112, R = 84;
const BAR = { x0: 22, x1: W - 22, y: 238 };
const H_PATH = 262, H_PLAIN = 212;
const GRAB = 9;
export const LANE_COLOURS = ['hsl(205 70% 52%)', 'hsl(35 85% 52%)', 'hsl(145 55% 42%)', 'hsl(12 75% 58%)'];   // A B C D
const CORNERS = [['A', -1, 0], ['B', 0, 1], ['C', 1, 0], ['D', 0, -1]];
const LOOP = 1;

// names: which parameters hold the shift, the trip time, the mode and how far the path is followed (null: there is none)
export function createVectorPad({ doc = document, path: stored, withPath = true, getParam, setParam, names = { x: 'x', y: 'y', time: 'pathms', mode: 'pmode', amount: null }, onPath = () => {} }) {
  const H = withPath ? H_PATH : H_PLAIN;
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'vector-pad');
  let path = withPath ? cleanPath(stored) : [];
  let selected = withPath ? 0 : null;
  let grab = null;   // { kind: 'point', i } | { kind: 'shift' } | { kind: 'mark', i }
  const weights = new Float32Array(4);

  const X = x => CX + x * R, Y = y => CY - y * R;
  const fromScreen = (sx, sy) => insideDiamond(clamp((sx - CX) / R, -1, 1), clamp((CY - sy) / R, -1, 1));
  const round = v => Math.round(v * 1000) / 1000;
  const emit = () => onPath(path.map(p => ({ x: round(p.x), y: round(p.y), d: round(p.d) })));
  const closed = () => Math.round(getParam(names.mode)) === LOOP && path.length > 1;
  const shift = () => [getParam(names.x), getParam(names.y)];

  // The stretches of one trip in the order they are travelled, as [{ to: point index, length }], and their total.
  const stretches = () => {
    const list = [];
    for (let i = 1; i < path.length; i++) list.push({ to: i, length: path[i].d });
    if (closed()) list.push({ to: 0, length: path[0].d });
    return { list, total: list.reduce((sum, s) => sum + s.length, 0) || 1 };
  };
  // Where each stretch ends on the time bar, in pixels.
  const marks = () => {
    const { list, total } = stretches();
    let at = 0;
    return list.map(s => { at += s.length; return BAR.x0 + (at / total) * (BAR.x1 - BAR.x0); });
  };

  const secondsText = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);

  function drawDiamond(page) {
    ctx.strokeStyle = page; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.moveTo(X(-1), Y(0)); ctx.lineTo(X(0), Y(1)); ctx.lineTo(X(1), Y(0)); ctx.lineTo(X(0), Y(-1)); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.moveTo(X(-1), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.moveTo(X(0), Y(1)); ctx.lineTo(X(0), Y(-1)); ctx.stroke();
    // the four sources, each with a short bar that shows its share at the +
    const [sx, sy] = shift();
    diamondWeights(clamp(sx, -1, 1), clamp(sy, -1, 1), weights);
    ctx.font = '11px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    CORNERS.forEach(([name, x, y], k) => {
      const colour = forPage(LANE_COLOURS[k], page), lx = X(x * 1.2), ly = Y(y * 1.17);
      ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.fillText(name, lx, ly);
      ctx.globalAlpha = 0.25; ctx.fillStyle = page; ctx.fillRect(lx - 10, ly + 9, 20, 2);
      ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.fillRect(lx - 10, ly + 9, 20 * weights[k], 2);
    });
  }

  function drawPath(page) {
    const accent = forPage(ORANGE, page);
    ctx.lineWidth = 1.5; ctx.strokeStyle = page; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
    if (closed()) {   // the way back to the first point
      ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(X(path.at(-1).x), Y(path.at(-1).y)); ctx.lineTo(X(path[0].x), Y(path[0].y)); ctx.stroke();
      ctx.setLineDash([]);
    }
    path.forEach((p, i) => {
      ctx.globalAlpha = 1; ctx.fillStyle = i === selected ? accent : page;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3.5, 0, 7); ctx.fill();
      if (i === 0) { ctx.strokeStyle = page; ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 7, 0, 7); ctx.stroke(); }
    });
  }

  function drawTimeBar(page) {
    const accent = forPage(ORANGE, page), ends = marks(), { list } = stretches();
    ctx.globalAlpha = 0.45; ctx.fillStyle = page; ctx.fillRect(BAR.x0, BAR.y, BAR.x1 - BAR.x0, 1);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.75; ctx.textAlign = 'left'; ctx.fillText('1', BAR.x0 - 3, BAR.y + 7);
    ctx.textAlign = 'right'; ctx.fillText(secondsText(getParam(names.time)), BAR.x1, BAR.y - 16);
    ctx.textAlign = 'left'; ctx.fillText('one trip', BAR.x0, BAR.y - 16);
    ctx.globalAlpha = 0.7; ctx.fillRect(BAR.x0, BAR.y - 4, 1, 9);
    ends.forEach((x, s) => {
      const to = list[s].to;
      ctx.globalAlpha = 1; ctx.fillStyle = to === selected ? accent : page;
      ctx.fillRect(Math.round(x), BAR.y - 4, 1, 9);
      ctx.beginPath(); ctx.arc(Math.round(x) + 0.5, BAR.y, 2.5, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.75; ctx.fillStyle = page; ctx.textAlign = 'center'; ctx.fillText(`${to + 1}`, x, BAR.y + 7);
    });
  }

  function drawShift(page) {
    const [sx, sy] = shift(), [px, py] = insideDiamond(clamp(sx, -1, 1), clamp(sy, -1, 1)), x = X(px), y = Y(py), arm = withPath ? 5 : 7;
    ctx.globalAlpha = 1; ctx.strokeStyle = forPage(ORANGE, page); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y); ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm); ctx.stroke();
    if (!withPath) { ctx.beginPath(); ctx.arc(x, y, arm + 4, 0, 7); ctx.stroke(); }
  }

  function draw() {
    if (!ctx) return;
    const page = ink();
    ctx.clearRect(0, 0, W, H);
    drawDiamond(page);
    if (withPath) { drawPath(page); drawTimeBar(page); }
    drawShift(page);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  const near = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) <= GRAB;
  const pointAt = (sx, sy) => path.findIndex(p => near(sx, sy, X(p.x), Y(p.y)));
  const onShift = (sx, sy) => { const [x, y] = shift(); return near(sx, sy, X(clamp(x, -1, 1)), Y(clamp(y, -1, 1))); };
  const inDiamond = (sx, sy) => Math.abs(sx - CX) + Math.abs(sy - CY) <= R + 6;

  // Dragging the mark at the end of stretch s moves time between that stretch and the next one; their sum stays the same.
  function moveMark(s, sx) {
    const { list } = stretches(), ends = marks();
    if (s >= list.length - 1) return;   // the last mark is the end of the trip
    const start = s === 0 ? BAR.x0 : ends[s - 1], end = ends[s + 1];
    const both = list[s].length + list[s + 1].length, pixels = Math.max(1, end - start);
    const first = clamp(((sx - start) / pixels) * both, both * 0.03, both * 0.97);
    path[list[s].to].d = first; path[list[s + 1].to].d = both - first;
  }

  function dragStart(sx, sy) {
    if (!withPath) { grab = { kind: 'shift' }; dragMove(sx, sy); return true; }
    const mark = marks().findIndex(x => Math.abs(sx - x) <= 6 && Math.abs(sy - BAR.y) <= 10);
    if (mark >= 0) { grab = { kind: 'mark', i: mark }; selected = stretches().list[mark].to; draw(); return true; }
    const hit = pointAt(sx, sy);
    if (hit >= 0) { grab = { kind: 'point', i: hit }; selected = hit; draw(); return true; }
    if (onShift(sx, sy)) { grab = { kind: 'shift' }; return true; }
    if (!inDiamond(sx, sy) || path.length >= MAX_POINTS) return false;
    // empty space: a new point after the chosen one
    const [x, y] = fromScreen(sx, sy), at = (selected ?? path.length - 1) + 1;
    path.splice(at, 0, { x, y, d: 1 });
    selected = at; grab = { kind: 'point', i: at };
    emit(); draw();
    return true;
  }
  function dragMove(sx, sy) {
    if (!grab) return;
    if (grab.kind === 'shift') {
      const [x, y] = fromScreen(sx, sy);
      setParam(names.x, round(x)); setParam(names.y, round(y));
    } else if (grab.kind === 'point') {
      const [x, y] = fromScreen(sx, sy);
      path[grab.i].x = x; path[grab.i].y = y;
      emit();
    } else { moveMark(grab.i, sx); emit(); }
    draw();
  }
  drag(canvas, W, H, { start: dragStart, move: dragMove, done: () => { grab = null; } });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!withPath || path.length < 2) return;
    const r = canvas.getBoundingClientRect(), hit = pointAt(e.clientX - r.left, e.clientY - r.top);
    if (hit < 0) return;
    path.splice(hit, 1);
    selected = Math.min(hit, path.length - 1);
    emit(); draw();
  });
  canvas.addEventListener('dblclick', e => {
    const r = canvas.getBoundingClientRect();
    if (onShift(e.clientX - r.left, e.clientY - r.top)) { setParam(names.x, 0); setParam(names.y, 0); draw(); }
  });

  // replaces the whole path (the buttons under the pad)
  const setPath = next => { path = cleanPath(next); selected = 0; emit(); draw(); };
  draw();
  return {
    el: canvas, draw, refresh: draw, setPath,
    get path() { return path.map(p => ({ ...p })); },
    tour: () => setPath(DEFAULT_PATH()),
    // the same trip the other way round: each stretch keeps its time
    reverse: () => { const back = [...path].reverse(); setPath(back.map((p, i) => ({ ...p, d: back[(i + back.length - 1) % back.length].d }))); },
    still: () => setPath([{ x: 0, y: 0, d: 1 }]),
  };
}
