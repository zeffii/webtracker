import { createBezierEditor } from './bezieredit.js';
import { makeCanvas, forPage, ORANGE, BLUE } from './spaceui.js';
import { REGISTERS, DEFAULT_AMP, registerMix } from '../audio/nodes/khufu.js';

// The Khufu panel, in one row: the registers and the amplitude drawing.
// The picture shows two cycles of the low register: each register on its own, faint, and the three added up as they are
// mixed (before the filters). The registers are cut from one phase, so the picture is exact and never drifts.
const W = 260, H = 150, PL = 8, PR = 8, TOP = 22, CYCLES = 2;
const COLOURS = [BLUE, ORANGE, 'hsl(145 55% 45%)'];   // low, mid, high

export function createKhufuView({ doc = document, env = {}, getParam, onChange }) {
  const el = doc.createElement('div'); el.className = 'curve-editor drum2 khufu-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'khufu-pad');
  const amp = createBezierEditor({
    doc, title: 'AMPLITUDE', color: ORANGE, points: env.amp, fallback: DEFAULT_AMP, knot: true,
    getMs: () => getParam('atime'), onChange: points => onChange('amp', points),
  });

  function trace(valueAt, colour, width, alpha, scale) {
    const mid = TOP + (H - TOP) / 2, tall = (H - TOP) / 2 - 8, span = W - PL - PR;
    ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.globalAlpha = alpha;
    for (let px = 0; px <= span * 2; px++) {
      const x = PL + px / 2, y = mid - valueAt(((px / 2 / span) * CYCLES) % 1) * scale * tall;
      px ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  function drawRegisters() {
    if (!ctx) return;
    const page = ink(), levels = REGISTERS.map(r => getParam(r.name)), total = Math.max(1, levels[0] + levels[1] + levels[2]);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    let x = PL;
    REGISTERS.forEach((register, i) => {   // the legend: each register's name and level, in its colour
      const text = `${register.name} ${Math.round(levels[i] * 100)}%`;
      ctx.globalAlpha = levels[i] > 0 ? 1 : 0.4; ctx.fillStyle = forPage(COLOURS[i], page); ctx.fillText(text, x, 4);
      x += ctx.measureText(text).width + 14;
    });
    ctx.globalAlpha = 0.15; ctx.fillStyle = page; ctx.fillRect(PL, Math.round(TOP + (H - TOP) / 2), W - PL - PR, 1);
    REGISTERS.forEach((register, i) => {
      if (levels[i] <= 0) return;
      const only = [0, 0, 0]; only[i] = levels[i];
      trace(phase => registerMix(phase, only), forPage(COLOURS[i], page), 1, 0.45, 1 / total);
    });
    trace(phase => registerMix(phase, levels), page, 1.6, 1, 1 / total);
    ctx.globalAlpha = 1;
  }

  const draw = () => { drawRegisters(); amp.draw(); };
  el.append(canvas, amp.el);
  draw();
  doc.defaultView?.requestAnimationFrame?.(draw);   // again once it is on the page, for the page's colours
  return { el, draw, refresh: draw };
}
