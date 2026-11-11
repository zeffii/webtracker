import { createBezierEditor } from './bezieredit.js';
import { makeCanvas, forPage, ORANGE, BLUE } from './spaceui.js';
import { pulsaretWave, DEFAULT_WINDOW, windowTable } from '../audio/nodes/pulsarcore.js';
import { readEnvelope } from '../audio/nodes/bezier.js';
import { DEFAULT_SWEEP } from '../audio/nodes/pulsar.js';

// The pulsar panel: the pulse train as it will sound (a few periods at A3, 220 Hz, with the masking drawn faint), and under it the
// drawings: the window over each pulsaret and, for the synth, the formant sweep that follows a note's start.
const W = 560, H = 110, PERIODS = 5, SHOWN_HZ = 220;

export function createPulsarView({ doc = document, getParam, env = {}, sweep = false, onChange }) {
  const el = doc.createElement('div'); el.className = 'curve-editor drum2 pulsar-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  let points = env.window;
  const change = (slot, p) => { if (slot === 'window') points = p; onChange(slot, p); };
  const win = createBezierEditor({
    doc, title: 'WINDOW', color: ORANGE, points: env.window, fallback: DEFAULT_WINDOW,
    getMs: () => 1000 / getParam('formant'), onChange: p => { change('window', p); draw(); },
  });
  const editors = [win];
  if (sweep) editors.push(createBezierEditor({
    doc, title: 'FORMANT SWEEP', color: BLUE, points: env.sweep, fallback: DEFAULT_SWEEP,
    getMs: () => getParam('sweepms'), labels: () => ['+sweep', '0'], onChange: p => change('sweep', p),
  }));
  const draw = () => {
    for (const e of editors) e.draw();
    if (!ctx) return;
    const table = windowTable(points), formant = getParam('formant'), wave = Math.round(getParam('wave'));
    const mask = getParam('mask'), duty = SHOWN_HZ / formant;   // how much of a period one pulsaret fills
    const mid = H / 2, amp = H * 0.4, per = W / PERIODS;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = ink(); ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let p = 0; p < PERIODS; p++) {
      const kept = !(mask > 0 && ((p * 0.618) % 1) < mask);
      ctx.globalAlpha = kept ? 1 : 0.18; ctx.strokeStyle = kept ? forPage(ORANGE, ink()) : ink();
      ctx.beginPath();
      const len = Math.min(1, duty);   // a pulsaret longer than the period is cut off by the next one
      const steps = Math.max(8, Math.round(per * len / 1.5));
      for (let i = 0; i <= steps; i++) {
        const q = (i / steps) * len / duty;
        const v = pulsaretWave(wave, q, rand) * readEnvelope(table, q);
        const x = p * per + (i / steps) * len * per, y = mid - v * amp;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5; ctx.fillStyle = ink(); ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.fillText(`${PERIODS} periods at 220 Hz · formant ${Math.round(formant)} Hz · duty ${Math.round(duty * 100)}%`, 4, 3);
    ctx.globalAlpha = 1;
  };
  el.append(canvas);
  for (const e of editors) el.appendChild(e.el);
  draw();
  return { el, refresh: draw, draw };
}
