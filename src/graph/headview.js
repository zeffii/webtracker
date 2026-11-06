import { headOf } from '../audio/spacecore.js';
import { ORANGE, BLUE, PINK, makeCanvas, drag, clamp } from './spaceui.js';

// The head pan panel: the head seen from above (nose up) with the sound to drag round it, its distance the distance from the head. On the
// right, what each ear gets: how late, how loud and how dull.
const W = 560, H = 260, CX = 150, CY = 130, R_HEAD = 30, R_MAX = 112;

export function createHeadView({ doc = document, getParam, setParam }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);
  const radius = dist => R_HEAD + 14 + clamp(Math.log2(dist / 0.5) / Math.log2(40), 0, 1) * (R_MAX - R_HEAD - 14);   // distance is drawn on a log scale
  const distAt = rad => 0.5 * Math.pow(40, clamp((rad - R_HEAD - 14) / (R_MAX - R_HEAD - 14), 0, 1));

  function draw() {
    if (!ctx) return;
    const c = ink(), angle = getParam('angle'), dist = getParam('distance');
    const h = headOf({ angle, distance: dist, head: getParam('head'), shadow: getParam('shadow') });
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    for (const m of [1, 3, 10]) { ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(CX, CY, radius(m), 0, 7); ctx.stroke(); ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.fillText(`${m} m`, CX + radius(m) * 0.71 + 2, CY - radius(m) * 0.71 - 12); }
    // the head, with a nose and two ears
    ctx.globalAlpha = 0.8; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(CX, CY, R_HEAD, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX - 6, CY - R_HEAD + 1); ctx.lineTo(CX, CY - R_HEAD - 9); ctx.lineTo(CX + 6, CY - R_HEAD + 1); ctx.stroke();
    ctx.fillStyle = BLUE; ctx.globalAlpha = 1; ctx.fillRect(CX - R_HEAD - 6, CY - 6, 6, 12);
    ctx.fillStyle = PINK; ctx.fillRect(CX + R_HEAD, CY - 6, 6, 12);
    // the sound
    const a = angle * Math.PI / 180, rr = radius(dist), sx = CX + Math.sin(a) * rr, sy = CY - Math.cos(a) * rr;
    ctx.globalAlpha = 0.4; ctx.strokeStyle = ORANGE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill();
    // each ear: late, loud, dull
    const ear = (x, name, colour, far) => {
      const late = far ? h.itd * 1e6 : 0, gain = h.gain * (far ? h.farGain : 1), cut = Math.min(far ? h.farCut : 20000, h.rearCut);
      const db = 20 * Math.log10(gain);
      ctx.fillStyle = colour; ctx.globalAlpha = 1; ctx.fillText(name, x, 40);
      ctx.fillStyle = c; ctx.globalAlpha = 0.8;
      ctx.fillText(`${late.toFixed(0)} µs late`, x, 62); ctx.fillText(`${db.toFixed(1)} dB`, x, 80); ctx.fillText(`low-pass ${cut >= 19000 ? 'open' : `${(cut / 1000).toFixed(1)} kHz`}`, x, 98);
      ctx.globalAlpha = 0.25; ctx.fillRect(x, 130, 100, 8); ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.fillRect(x, 130, 100 * clamp(gain, 0, 1), 8);
      ctx.fillStyle = c; ctx.globalAlpha = 0.25; ctx.fillRect(x, 150, 100, 8); ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.fillRect(x, 150, 100 * clamp(Math.log2(cut / 1000) / Math.log2(20), 0.02, 1), 8);
    };
    ear(340, 'left ear', BLUE, h.far === 'l'); ear(460, 'right ear', PINK, h.far === 'r');
    ctx.fillStyle = c; ctx.globalAlpha = 0.5; ctx.fillText('level', 340, 119); ctx.fillText('brightness', 340, 139);
    ctx.globalAlpha = 1;
    const side = Math.abs(angle) <= 180 ? (angle > 0 ? `${Math.round(angle)}° right` : angle < 0 ? `${Math.round(-angle)}° left` : 'ahead') : '';
    info.textContent = `${side}, ${dist.toFixed(1)} m   time difference ${(h.itd * 1e6).toFixed(0)} µs   (drag the orange dot; round the head sets the angle, in and out the distance)`;
  }

  drag(canvas, W, H, {
    start: (x, y) => { const a = getParam('angle') * Math.PI / 180, rr = radius(getParam('distance')); return Math.hypot(x - (CX + Math.sin(a) * rr), y - (CY - Math.cos(a) * rr)) <= 14; },
    move(x, y) {
      let deg = Math.atan2(x - CX, -(y - CY)) * 180 / Math.PI;
      if (Math.abs(deg) < 3) deg = 0;
      setParam('angle', Math.round(deg)); setParam('distance', Math.round(distAt(Math.hypot(x - CX, y - CY)) * 10) / 10);
      draw();
    },
  });
  draw();
  return { el, refresh: draw, draw };
}
