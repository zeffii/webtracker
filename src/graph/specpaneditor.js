import { bandPans, crossovers } from '../audio/nodes/specpan.js';

// The spectral panner's view: frequency along the bottom (log), the pan of each band as a bar up (left) or down (right)
// from the centre line, as far as `spread` carries it. Below `lowMono` the sound is mono and the bars are cut off. It
// only shows; the sliders change it, and with the custom shape the b1..b10 sliders are the bars.
const W = 360, H = 150, PL = 22, PR = 8, PT = 14, PB = 18;
const F_LO = 20, F_HI = 20000;

export function createSpecPanView({ doc = document, getParam }) {
  const canvas = doc.createElement('canvas');
  canvas.width = W; canvas.height = H; canvas.className = 'specpan';
  const ctx = canvas.getContext('2d');
  const pw = W - PL - PR, ph = H - PT - PB, mid = PT + ph / 2;
  const xOf = f => PL + (Math.log(Math.min(F_HI, Math.max(F_LO, f)) / F_LO) / Math.log(F_HI / F_LO)) * pw;
  const colour = (p, a = 1) => { const f = (p + 1) / 2; return `rgba(${Math.round(60 + 180 * f)}, 150, ${Math.round(230 - 180 * f)}, ${a})`; };

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const shape = Math.round(getParam('shape')), spread = getParam('spread'), rotate = getParam('rotate'), lowMono = getParam('lowMono');
    const custom = Array.from({ length: 10 }, (_, k) => getParam(`b${k + 1}`));
    const pans = bandPans(shape, rotate, custom);
    const edges = [F_LO, ...crossovers(), F_HI];
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {   // frequency grid
      ctx.globalAlpha = 0.13;
      const x = Math.round(xOf(f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x - 8, H - PB + 4);
    }
    ctx.globalAlpha = 0.55;
    ctx.fillText('L', 6, PT - 2); ctx.fillText('R', 6, PT + ph - 9);
    ctx.globalAlpha = 0.35;
    ctx.fillRect(PL, Math.round(mid), pw, 1);
    ctx.globalAlpha = 1;
    for (let k = 0; k < 10; k++) {   // one bar per band; up is left, as in the tap view
      const x0 = xOf(Math.max(edges[k], lowMono)), x1 = xOf(edges[k + 1]);
      if (x1 - x0 < 1) continue;
      const p = Math.max(-1, Math.min(1, pans[k])) * spread, h = p * (ph / 2);
      ctx.fillStyle = colour(pans[k], 0.85);
      ctx.fillRect(x0 + 1, h < 0 ? mid + h : mid, Math.max(1, x1 - x0 - 2), Math.max(1, Math.abs(h)));
    }
    const xm = xOf(lowMono);   // the mono region
    ctx.globalAlpha = 0.12; ctx.fillStyle = ink;
    ctx.fillRect(PL, PT, xm - PL, ph);
    ctx.globalAlpha = 0.6;
    ctx.fillText('mono', PL + 3, PT + 2);
    ctx.globalAlpha = 1;
  };

  draw();
  return { el: canvas, refresh: draw };
}
