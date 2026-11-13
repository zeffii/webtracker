import { makeCanvas, forPage, ORANGE, BLUE } from './spaceui.js';
import { LINES, delayMs } from '../audio/nodes/ensemble.js';

// The ensemble's panel: how long each of the three delays is over a few seconds. Each line is a slow wave with a fast
// ripple on it, a third of a turn behind the one before, which is why the three copies are never in tune together.
const W = 320, H = 150, PL = 34, PR = 8, TOP = 18, BOTTOM = 18, SECONDS = 4;
const COLOURS = [BLUE, ORANGE, 'hsl(145 55% 45%)'];
const LOW_MS = 3.5, HIGH_MS = 8.5;   // the range of the picture

export function createEnsembleView({ doc = document, getParam }) {
  const el = doc.createElement('div'); el.className = 'ensemble-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'ensemble-pad');
  el.append(canvas);

  function draw() {
    if (!ctx) return;
    const page = ink(), slow = getParam('slow'), fast = getParam('fast'), depth = getParam('depth'), shimmer = getParam('shimmer');
    const span = W - PL - PR, tall = H - TOP - BOTTOM, Y = ms => TOP + (1 - (ms - LOW_MS) / (HIGH_MS - LOW_MS)) * tall;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.fillStyle = page; ctx.textAlign = 'right';
    for (const ms of [4, 6, 8]) {
      ctx.globalAlpha = ms === 6 ? 0.25 : 0.12; ctx.fillRect(PL, Math.round(Y(ms)), span, 1);
      ctx.globalAlpha = 0.6; ctx.fillText(`${ms} ms`, PL - 4, Y(ms));
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.globalAlpha = 0.6;
    ctx.fillText('three delays', PL, 2);
    ctx.textAlign = 'right'; ctx.fillText(`${SECONDS} s`, W - PR, H - 12);
    for (let line = 0; line < LINES; line++) {
      ctx.beginPath(); ctx.strokeStyle = forPage(COLOURS[line], page); ctx.lineWidth = 1.3; ctx.globalAlpha = 1;
      for (let px = 0; px <= span * 2; px++) {
        const t = (px / 2 / span) * SECONDS, y = Y(delayMs(line, t * slow, t * fast, depth, shimmer));
        px ? ctx.lineTo(PL + px / 2, y) : ctx.moveTo(PL + px / 2, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  draw();
  doc.defaultView?.requestAnimationFrame?.(draw);   // again once it is on the page, for the page's colours
  return { el, draw, refresh: draw };
}
