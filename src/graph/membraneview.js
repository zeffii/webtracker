import { describeModes, bessel, STRIKE_ANGLE } from '../audio/nodes/membrane.js';
import { sharpCanvas } from './sharp.js';

// The picture of the Membrane machine: what it is simulating, drawn from its parameters (the sliders move it).
//   left    the drum head seen from above, with the pattern of the mode you picked. Each dot is a bit of skin: a filled dot moves up,
//           a hollow one moves down, the size is how far, and the empty lines between them are the nodal lines that stay still.
//           A cross marks where the head is struck (`position`).
//   right   every mode as a stem, along its pitch (as a multiple of the lowest). The height is how hard the strike sets it going, from
//           the Bessel function at the strike point, the beater and the decay. Click a stem to see its pattern on the head.
// Everything comes from describeModes() and bessel() in the machine's own file, so the picture agrees with the sound.
const W = 360, H = 196, HEAD = 78, HEAD_X = 92, HEAD_Y = 100, SX = 196, SW = 150, SY = 22, SH = 112;
const ACCENT = 'hsl(205 70% 52%)', WARM = 'hsl(35 85% 52%)';
const RATIO_MAX = 8;
let picked = null;   // the mode last clicked, "m,n": kept for the session, so the picture stays where you left it

export function createMembraneView({ doc = document, getParam }) {
  const canvas = sharpCanvas(doc, W, H, 'drumview');
  const ctx = canvas.getContext('2d');
  let stems = [];   // where each stem is on the canvas, for clicks

  const values = () => ({
    position: getParam('position'), strike: getParam('strike'), stiffness: getParam('stiffness'), damping: getParam('damping'),
    highdamp: getParam('highdamp'), quality: getParam('quality'),
  });
  const plural = (n, word) => `${n === 0 ? 'no' : n} ${word}${n === 1 ? '' : 's'}`;
  const countsText = m => `${plural(m.m, 'nodal line')}, ${plural(m.n - 1, 'nodal circle')}`;   // lines across the head, circles inside the rim

  // How loud a mode is at the strike point, from 0 to 1: its weight, the beater's low-pass at a nominal drum pitch, and a little for decay.
  const levels = (modes, strike) => {
    const lowest = 160, fc = 300 * Math.pow(60, strike);
    const raw = modes.map(m => {
      const f = m.ratio * lowest, lp = 1 / (1 + (f / fc) ** 2);   // two one-pole filters: 12 dB per octave
      return Math.abs(m.weight) * lp * Math.min(1, 0.25 + m.t60 * 2);
    });
    const top = Math.max(1e-9, ...raw);
    return raw.map(v => v / top);
  };

  function drawHead(ink, v, mode) {
    ctx.save();
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(HEAD_X, HEAD_Y, HEAD + 0.5, 0, Math.PI * 2); ctx.stroke();   // the rim, held still
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.arc(HEAD_X, HEAD_Y, HEAD * 0.9, 0, Math.PI * 2); ctx.stroke();   // the furthest the strike can go
    ctx.globalAlpha = 1;
    // the pattern: rings of dots, more dots on the bigger rings so they are spread evenly
    const rings = 11, last = mode.j;
    const dots = [];
    for (let r = 1; r <= rings; r++) {
      const rho = r / (rings + 0.6), count = Math.max(6, Math.round(rho * 44));
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        dots.push({ rho, theta, z: bessel(mode.m, last * rho) * Math.cos(mode.m * theta) });
      }
    }
    dots.push({ rho: 0, theta: 0, z: bessel(mode.m, 0) });
    const peak = Math.max(1e-9, ...dots.map(d => Math.abs(d.z)));
    for (const d of dots) {
      const size = Math.abs(d.z) / peak * 3.4;
      if (size < 0.5) continue;
      const x = HEAD_X + Math.cos(d.theta) * d.rho * HEAD, y = HEAD_Y + Math.sin(d.theta) * d.rho * HEAD;
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
      if (d.z > 0) { ctx.fillStyle = ACCENT; ctx.fill(); } else { ctx.strokeStyle = WARM; ctx.stroke(); }
    }
    // where it is struck: a cross
    const sx = HEAD_X + Math.cos(STRIKE_ANGLE) * v.position * 0.9 * HEAD, sy = HEAD_Y + Math.sin(STRIKE_ANGLE) * v.position * 0.9 * HEAD;
    ctx.strokeStyle = ink; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.moveTo(sx - 5, sy); ctx.lineTo(sx + 5, sy); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx, sy + 5); ctx.stroke();
    ctx.restore();
  }

  function drawStems(ink, modes, level, mode) {
    ctx.save();
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2; ctx.fillRect(SX, SY + SH, SW, 1);                       // the baseline
    ctx.globalAlpha = 0.5;
    for (let r = 1; r <= 7; r++) {                                                    // 1x, 2x ... of the lowest
      const x = SX + (r / RATIO_MAX) * SW;
      ctx.fillRect(Math.round(x), SY + SH, 1, 3); ctx.fillText(`${r}`, x - 2, SY + SH + 5);
    }
    ctx.globalAlpha = 0.75; ctx.fillText('pitch (times the lowest)', SX, SY + SH + 17);
    stems = [];
    modes.forEach((md, i) => {
      const x = Math.round(SX + (md.ratio / RATIO_MAX) * SW) + 0.5, h = Math.max(1, level[i] * SH), on = md === mode;
      ctx.globalAlpha = on ? 1 : 0.55 + 0.3 * level[i];
      ctx.strokeStyle = on ? ACCENT : ink; ctx.lineWidth = on ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x, SY + SH); ctx.lineTo(x, SY + SH - h); ctx.stroke();
      ctx.fillStyle = on ? ACCENT : ink;
      ctx.beginPath(); ctx.arc(x, SY + SH - h, on ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      stems.push({ x, mode: md });
      if (level[i] > 0.45 || on) { ctx.globalAlpha = on ? 1 : 0.7; ctx.fillText(`${md.m},${md.n}`, x - 7, SY + SH - h - 14); }
    });
    ctx.restore();
  }

  function draw() {
    const ink = (typeof getComputedStyle === 'function' && getComputedStyle(canvas).color) || '#888';   // (empty until the canvas is on the page)
    const v = values(), modes = describeModes(v), level = levels(modes, v.strike);
    let mode = modes.find(md => `${md.m},${md.n}` === picked);
    if (!mode) mode = modes.find(md => md.m === 1 && md.n === 1) ?? modes[0];
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = ink; ctx.globalAlpha = 0.75;
    ctx.fillText('membrane', 6, 4);
    ctx.fillText(`mode ${mode.m},${mode.n} · ${mode.ratio.toFixed(2)}x · ${countsText(mode)}`, 6, H - 14);
    ctx.globalAlpha = 1;
    drawHead(ink, v, mode);
    drawStems(ink, modes, level, mode);
  }

  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
    let best = null;
    for (const s of stems) if (!best || Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
    if (best && Math.abs(best.x - x) < 8) { picked = `${best.mode.m},${best.mode.n}`; draw(); }
  });

  draw();
  Promise.resolve().then(draw);   // again once it has been put on the page, where its colour is known
  return { el: canvas, refresh: draw };
}
