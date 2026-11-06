import { PAN_STYLES, PAN_SHAPES, noteName } from '../audio/spacecore.js';
import { ORANGE, BLUE, PINK, makeCanvas, drag, heartbeat, button, clamp } from './spaceui.js';

// The note pan panel: the listener seen from above (facing up) with the notes that sound as dots round them; a dot goes dim as it passes
// behind. The orange wedge is the field the notes are put in (range and centre; drag across the circle to move the centre), the pink arc is how
// far the rotation reaches. Under the circle the same positions are laid out left to right, which is what the speakers get. Live while the
// panel is open: the node reports each sounding note.
const W = 560, H = 330, CX = 150, CY = 150, R = 110, SY = 296;
const STALE = 400;   // ms after which a note that has stopped reporting is gone

export function createNotePanView({ doc = document, getParam, setParam, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const row = doc.createElement('div'); row.className = 'sp-row';
  const styles = PAN_STYLES.map((n, i) => button(doc, n, `Style: ${n}`, () => { setParam('style', i); draw(); }));
  const shapes = PAN_SHAPES.map((n, i) => button(doc, n, `Rotation shape: ${n}`, () => { setParam('shape', i); draw(); }));
  const info = doc.createElement('span'); info.className = 'sp-info';
  row.append(...styles);
  const row2 = doc.createElement('div'); row2.className = 'sp-row';
  row2.append(...shapes, info);
  el.append(canvas, row, row2);
  const voices = new Map();   // voice -> { note, angle, held, t }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function draw() {
    if (!ctx) return;
    const c = ink(), range = getParam('range'), centre = getParam('centre'), rate = getParam('rate'), amp = getParam('amp'), shape = Math.round(getParam('shape'));
    const t = now();
    for (const [k, v] of voices) if (t - v.t > STALE) voices.delete(k);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.lineWidth = 1;
    // the circle, the listener and the front
    ctx.strokeStyle = c; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.stroke();
    ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.moveTo(CX - R, CY); ctx.lineTo(CX + R, CY); ctx.moveTo(CX, CY - R); ctx.lineTo(CX, CY + R); ctx.stroke();
    ctx.fillStyle = c; ctx.globalAlpha = 0.6; ctx.fillText('front', CX - 12, CY - R - 14); ctx.fillText('back', CX - 11, CY + R + 4); ctx.fillText('L', CX - R - 14, CY - 5); ctx.fillText('R', CX + R + 6, CY - 5);
    ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(CX, CY, 9, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(CX - 4, CY - 8); ctx.lineTo(CX, CY - 14); ctx.lineTo(CX + 4, CY - 8); ctx.stroke();
    // the field the notes are put in: from -range to +range round the centre, in front
    const half = Math.PI / 2, a0 = clamp(centre - range, -1, 1) * half, a1 = clamp(centre + range, -1, 1) * half;
    ctx.fillStyle = ORANGE; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R, a0 - half, a1 - half); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ORANGE; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(CX, CY, R, a0 - half, a1 - half); ctx.stroke();
    // how far the rotation reaches
    if (Math.abs(rate) > 0.001) {
      ctx.strokeStyle = PINK; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 4]); ctx.beginPath();
      if (shape === 2) ctx.arc(CX, CY, R + 10, 0, 7); else ctx.arc(CX, CY, R + 10, a0 - half - amp * Math.PI, a1 - half + amp * Math.PI);
      ctx.stroke(); ctx.setLineDash([]);
    }
    // the positions
    ctx.font = '10px ui-monospace, Consolas, monospace';
    const dots = [...voices.values()];
    for (const v of dots) {
      const back = Math.max(0, -Math.cos(v.angle)), x = CX + Math.sin(v.angle) * R, y = CY - Math.cos(v.angle) * R;
      ctx.globalAlpha = (v.held ? 1 : 0.55) * (1 - 0.6 * back); ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(x, y, 7 - 2 * back, 0, 7); ctx.fill();
      ctx.fillStyle = c; ctx.globalAlpha = 0.8 * (1 - 0.6 * back); ctx.fillText(v.note >= 0 ? noteName(v.note) : '', x + 9, y - 5);
    }
    // the same, as the speakers get it
    ctx.strokeStyle = c; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(20, SY); ctx.lineTo(W - 20, SY); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.fillText('L', 8, SY - 5); ctx.fillText('R', W - 12, SY - 5); ctx.fillText('C', W / 2 - 3, SY + 8);
    for (const v of dots) { ctx.globalAlpha = 0.9 * (v.held ? 1 : 0.55); ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(W / 2 + Math.sin(v.angle) * (W / 2 - 30), SY, 5, 0, 7); ctx.fill(); }
    // the list on the right
    ctx.globalAlpha = 0.6; ctx.fillStyle = c; ctx.fillText(dots.length ? 'sounding' : 'play a note', 330, 24);
    dots.sort((a, b) => a.note - b.note).slice(0, 10).forEach((v, i) => {
      const deg = Math.round(v.angle * 180 / Math.PI), wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
      ctx.globalAlpha = v.held ? 0.9 : 0.5; ctx.fillStyle = c; ctx.fillText(`${noteName(v.note)}  ${Math.abs(wrapped) <= 90 ? 'front' : 'back'} ${wrapped === 0 ? 'centre' : `${Math.abs(wrapped)}° ${wrapped > 0 ? 'right' : 'left'}`}`, 330, 44 + i * 16);
    });
    ctx.globalAlpha = 1;
    styles.forEach((b, i) => b.classList.toggle('on', Math.round(getParam('style')) === i));
    shapes.forEach((b, i) => b.classList.toggle('on', shape === i));
    info.textContent = `${Math.abs(rate) < 0.001 ? 'still' : `${rate > 0 ? '' : '−'}${Math.abs(rate).toFixed(2)} Hz`}${shape === 2 ? '  (orbit: amp not used)' : ''}`;
  }

  drag(canvas, W, H, {
    start: (x, y) => Math.hypot(x - CX, y - CY) <= R + 14,
    move(x) { setParam('centre', Math.round(clamp((x - CX) / R, -1, 1) * 100) / 100); draw(); },
  });
  const feed = msg => { voices.set(msg.id, { note: msg.note, angle: msg.angle, held: msg.held, t: now() }); draw(); };
  heartbeat(doc, el, watch);
  const timer = doc.defaultView?.setInterval?.(() => { if (!el.isConnected) { doc.defaultView.clearInterval(timer); return; } if (voices.size) draw(); }, 250);
  draw();
  return { el, refresh: draw, draw, feed };
}
