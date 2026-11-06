import { reflections, SPEED } from '../audio/spacecore.js';
import { ORANGE, BLUE, PINK, makeCanvas, drag, clamp } from './spaceui.js';

// The reflections panel: the plan of the room seen from above with the sound (orange) and the listener (blue, facing up) to drag, the corner
// of the room to drag to change its size, and under it the echoes in time: one bar for each reflection, leaning left or right by the side it
// comes from. What is drawn is the same list the node plays (spacecore.js).
const W = 560, PLAN_H = 250, ECHO_H = 110, H = PLAN_H + ECHO_H + 24, PAD = 14;

export function createReflectView({ doc = document, getParam, setParam }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);

  const room = () => ({ w: getParam('width'), d: getParam('depth'), h: getParam('height'), s: { x: getParam('srcx'), y: getParam('srcy') }, l: { x: getParam('lisx'), y: getParam('lisy') }, absorb: getParam('absorb') });
  const layout = r => {   // pixels per metre so the room fits the plan, and its top-left corner
    const k = Math.min((W - 2 * PAD - 120) / r.w, (PLAN_H - 2 * PAD) / r.d);
    return { k, x0: PAD + 20, y0: PAD };
  };

  function draw() {
    if (!ctx) return;
    const r = room(), { k, x0, y0 } = layout(r), c = ink();
    const taps = Math.round(getParam('taps')), { direct, list } = reflections(r, taps);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    // the room
    const rw = r.w * k, rd = r.d * k;
    ctx.strokeStyle = c; ctx.globalAlpha = 0.7; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, rw, rd);
    ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.fillRect(x0 + rw - 5, y0 + rd - 5, 10, 10);   // the corner to drag
    ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    ctx.fillText(`${r.w.toFixed(1)} m`, x0 + rw / 2 - 14, y0 + rd + 5); ctx.fillText(`${r.d.toFixed(1)} m`, x0 + rw + 8, y0 + rd / 2);
    // the images of the source (first order are the mirror copies across a wall), only those that land near the plan
    ctx.fillStyle = ORANGE;
    list.forEach(t => {
      if (t.order > 1) return;
      const px = x0 + t.from.x * k, py = y0 + t.from.y * k;
      if (px < 2 || py < 2 || px > W - 2 || py > PLAN_H - 2) return;
      ctx.globalAlpha = 0.15 + 0.5 * Math.min(1, t.gain); ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
    });
    // source and listener
    const sx = x0 + r.s.x * rw, sy = y0 + r.s.y * rd, lx = x0 + r.l.x * rw, ly = y0 + r.l.y * rd;
    ctx.globalAlpha = 0.35; ctx.strokeStyle = ORANGE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fill();
    ctx.fillStyle = BLUE; ctx.beginPath(); ctx.moveTo(lx, ly - 9); ctx.lineTo(lx + 7, ly + 6); ctx.lineTo(lx - 7, ly + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c; ctx.globalAlpha = 0.7; ctx.fillText('sound', sx + 10, sy - 5); ctx.fillText('you', lx + 10, ly - 5);
    // the echoes in time, after the dry sound
    const y1 = PLAN_H + 8, ph = ECHO_H, last = Math.max(0.03, ...list.map(t => t.delay - direct)), tmax = last * 1.05;
    ctx.globalAlpha = 0.25; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(PAD, y1 + ph + 0.5); ctx.lineTo(W - PAD, y1 + ph + 0.5); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 2;
    for (const t of list) {
      const x = PAD + ((t.delay - direct) / tmax) * (W - 2 * PAD), hgt = clamp(t.gain, 0, 1) * (ph - 8);
      ctx.strokeStyle = t.pan < -0.2 ? BLUE : t.pan > 0.2 ? PINK : c; ctx.globalAlpha = t.pan >= -0.2 && t.pan <= 0.2 ? 0.7 : 1;
      ctx.beginPath(); ctx.moveTo(x, y1 + ph); ctx.lineTo(x, y1 + ph - hgt); ctx.stroke();
    }
    ctx.globalAlpha = 0.6; ctx.fillStyle = c; ctx.fillText('0', PAD, y1 + ph + 4); ctx.fillText(`${Math.round(tmax * 1000)} ms after the dry sound   (left blue, right pink)`, W / 2 - 150, y1 + ph + 4);
    ctx.globalAlpha = 1;
    info.textContent = `direct ${(direct * 1000).toFixed(1)} ms (${(direct * SPEED).toFixed(1)} m)   first echo ${list[0] ? ((list[0].delay - direct) * 1000).toFixed(1) : '-'} ms   ${list.length} reflections`;
  }

  let what = null;
  drag(canvas, W, H, {
    start(x, y) {
      const r = room(), { k, x0, y0 } = layout(r), rw = r.w * k, rd = r.d * k;
      const near = (px, py, d) => Math.hypot(x - px, y - py) <= d;
      if (near(x0 + r.s.x * rw, y0 + r.s.y * rd, 12)) what = 'src';
      else if (near(x0 + r.l.x * rw, y0 + r.l.y * rd, 12)) what = 'lis';
      else if (near(x0 + rw, y0 + rd, 12)) what = 'size';
      else return false;
      return true;
    },
    move(x, y) {
      const r = room(), { k, x0, y0 } = layout(r), rw = r.w * k, rd = r.d * k;
      if (what === 'size') { setParam('width', clamp(Math.round((x - x0) / k * 2) / 2, 2, 60)); setParam('depth', clamp(Math.round((y - y0) / k * 2) / 2, 2, 60)); }
      else { const px = clamp((x - x0) / rw, 0, 1), py = clamp((y - y0) / rd, 0, 1); const [a, b] = what === 'src' ? ['srcx', 'srcy'] : ['lisx', 'lisy']; setParam(a, px); setParam(b, py); }
      draw();
    },
  });
  draw();
  return { el, refresh: draw, draw };
}
