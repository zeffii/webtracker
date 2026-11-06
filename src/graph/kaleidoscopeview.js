import { F_MIN, F_MAX, LOW_MIN, HIGH_MAX, bandOf, overtoneRatio, overtoneGain } from '../audio/kalcore.js';

// The kaleidoscope panel: the spectrum the node hears with the band lit and its two ends to drag, and below it the spectrum it makes,
// with the seams of the copies marked and the mirrored ones tinted. Frequency runs along the bottom, in octaves. The spectra are live:
// the node reports them while the panel asks (every second), and they fall away a little slower than they rise so they can be read.
const W = 560, PL = 34, PR = 10, PANEL = 98, GAP = 34, TOP = 20;
const H = TOP + PANEL + GAP + PANEL + 20;
const PINK = 'hsl(335 80% 62%)', BLUE = 'hsl(195 75% 58%)';
const LABELS = [[55, '55'], [110, '110'], [220, '220'], [440, '440'], [880, '880'], [1760, '1.8k'], [3520, '3.5k'], [7040, '7k'], [14080, '14k']];

const hz = v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 2).replace(/\.?0+$/, '')} kHz` : `${Math.round(v)} Hz`);

export function createKaleidoscopeView({ doc = document, getParam, setParam, watch = () => {} }) {
  const el = doc.createElement('div');
  el.className = 'kaleidoscope';
  const dpr = Math.max(1, Math.min(3, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = doc.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.className = 'kal-pad';
  if (canvas.style) Object.assign(canvas.style, { width: `${W}px`, height: `${H}px`, touchAction: 'none' });
  const ctx = canvas.getContext?.('2d') ?? null;

  const row = doc.createElement('div');
  row.className = 'kal-row';
  const button = (label, mode) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.className = 'kal-btn'; b.addEventListener('click', () => { setParam('mode', mode); draw(); }); return b; };
  const mirrorBtn = button('mirror', 0), repeatBtn = button('repeat', 1), overtoneBtn = button('overtone', 2);
  const info = doc.createElement('span'); info.className = 'kal-info';
  const step = (label, name, by, title) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.className = 'kal-btn kal-step'; b.addEventListener('click', () => { setParam(name, Math.max(0, getParam(name) + by)); draw(); }); return b; };
  const stepper = doc.createElement('span'); stepper.className = 'kal-steps';
  stepper.append(step('\u2212', 'overtones', -1, 'One overtone fewer'), step('+', 'overtones', 1, 'One overtone more'));
  row.append(mirrorBtn, repeatBtn, overtoneBtn, stepper, info);
  el.append(canvas, row);

  const lo = Math.log2(F_MIN), hi = Math.log2(F_MAX), pw = W - PL - PR;
  const X = o => PL + (o - lo) / (hi - lo) * pw;
  const octaveAt = x => lo + (x - PL) / pw * (hi - lo);
  const shown = { input: new Float32Array(200), output: new Float32Array(200), live: false };
  let queued = false;

  const feed = msg => {
    for (const key of ['input', 'output']) { const a = msg[key], s = shown[key]; for (let i = 0; i < s.length; i++) s[i] = Math.max(a[i], s[i] * 0.8); }
    shown.live = true;
    if (!queued) { queued = true; (doc.defaultView?.requestAnimationFrame ?? (f => f()))(() => { queued = false; draw(); }); }
  };

  const panel = (y0, values, colour, ink) => {
    ctx.save();
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.13; ctx.lineWidth = 1;
    for (let o = Math.ceil(lo); o <= hi; o++) { ctx.beginPath(); ctx.moveTo(Math.round(X(o)) + 0.5, y0); ctx.lineTo(Math.round(X(o)) + 0.5, y0 + PANEL); ctx.stroke(); }
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(PL, y0 + PANEL + 0.5); ctx.lineTo(W - PR, y0 + PANEL + 0.5); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(PL, y0 + PANEL);
    const steps = values.length;
    for (let i = 0; i < steps; i++) ctx.lineTo(PL + (i + 0.5) / steps * pw, y0 + PANEL - values[i] * (PANEL - 8));
    ctx.lineTo(W - PR, y0 + PANEL); ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fillStyle = colour; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.lineWidth = 1.2; ctx.stroke();
  };
  const axis = (y, ink) => {
    ctx.fillStyle = ink; ctx.globalAlpha = 0.6; ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [f, t] of LABELS) ctx.fillText(t, X(Math.log2(f)), y + 4);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  };

  function draw() {
    if (!ctx) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const band = bandOf(getParam('low'), getParam('high')), mode = Math.round(getParam('mode')), rotate = getParam('rotate'), copies = Math.round(getParam('copies'));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    const yIn = TOP, yOut = TOP + PANEL + GAP;
    ctx.fillStyle = ink; ctx.globalAlpha = 0.65;
    ctx.fillText('INPUT', PL, yIn - 14); ctx.fillText('OUTPUT  (the band arrayed, every second copy mirrored)', PL, yOut - 14);
    if (mode === 1) { ctx.clearRect(PL, yOut - 14, 400, 12); ctx.fillText('OUTPUT  (the band repeated)', PL, yOut - 14); }
    if (mode === 2) { ctx.clearRect(PL, yOut - 14, 400, 12); ctx.fillText('OUTPUT  (the band copied to its overtones and undertones)', PL, yOut - 14); }
    ctx.globalAlpha = 1;

    // input, with the band lit and its two ends
    const x0 = X(band.b0), x1 = X(band.b0 + band.width);
    ctx.fillStyle = PINK; ctx.globalAlpha = 0.14; ctx.fillRect(x0, yIn, x1 - x0, PANEL); ctx.globalAlpha = 1;
    panel(yIn, shown.input, ink, ink);
    ctx.strokeStyle = PINK; ctx.lineWidth = 1.5; ctx.fillStyle = PINK;
    for (const x of [x0, x1]) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yIn); ctx.lineTo(Math.round(x) + 0.5, yIn + PANEL); ctx.stroke(); ctx.fillRect(Math.round(x) - 4, yIn - 4, 8, 8); }
    axis(yIn + PANEL, ink);
    if (!shown.live) { ctx.fillStyle = ink; ctx.globalAlpha = 0.45; ctx.textAlign = 'center'; ctx.fillText('play something through it to see the spectrum', PL + pw / 2, yIn + PANEL / 2 - 5); ctx.textAlign = 'left'; ctx.globalAlpha = 1; }

    // output, with the tiles (or, for overtones, the band where each copy puts it, drawn the lighter the quieter it is)
    if (mode === 2) {
      const stretch = getParam('stretch'), decay = getParam('decay'), up = Math.round(getParam('overtones')), down = Math.round(getParam('under'));
      for (let k = -down; k <= up; k++) {
        const shift = Math.log2(overtoneRatio(k, stretch)), a = band.b0 + shift, bEnd = a + band.width, g = overtoneGain(k, decay);
        if (bEnd < lo || a > hi) continue;
        const xa = Math.max(PL, X(a)), xb = Math.min(W - PR, X(bEnd));
        if (xb <= xa) continue;
        ctx.fillStyle = PINK; ctx.globalAlpha = 0.1 * g; ctx.fillRect(xa, yOut, xb - xa, PANEL); ctx.globalAlpha = 1;   // the louder the copy, the stronger the tint
        if (a > lo) { ctx.strokeStyle = PINK; ctx.globalAlpha = 0.2 + 0.5 * g; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(xa) + 0.5, yOut); ctx.lineTo(Math.round(xa) + 0.5, yOut + PANEL); ctx.stroke(); ctx.globalAlpha = 1; }
        const name = k === 0 ? 'source' : k === -1 ? 'x1/2' : k > 0 && k < 7 ? `x${k + 1}` : '';
        if (name && a > lo) { ctx.fillStyle = PINK; ctx.fillText(name, xa + 3, yOut + 3); }
      }
    }
    const first = Math.floor((lo - band.b0 - rotate * band.width) / band.width), last = Math.ceil((hi - band.b0 - rotate * band.width) / band.width);
    for (let k = mode === 2 ? 1 : first; k <= (mode === 2 ? 0 : last); k++) {
      const a = band.b0 + rotate * band.width + k * band.width, b = a + band.width;
      if (copies > 0 && Math.abs(k) > copies) continue;
      const xa = Math.max(PL, X(a)), xb = Math.min(W - PR, X(b));
      if (xb <= xa) continue;
      const flipped = mode === 0 && ((k % 2) + 2) % 2 === 1;
      if (flipped) { ctx.fillStyle = PINK; ctx.globalAlpha = 0.09; ctx.fillRect(xa, yOut, xb - xa, PANEL); ctx.globalAlpha = 1; }
      ctx.strokeStyle = PINK; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      for (const o of [a, b]) if (o > lo && o < hi) { ctx.beginPath(); ctx.moveTo(Math.round(X(o)) + 0.5, yOut); ctx.lineTo(Math.round(X(o)) + 0.5, yOut + PANEL); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (xb - xa > 56) { ctx.fillStyle = PINK; ctx.textAlign = 'center'; ctx.fillText(k === 0 ? 'source' : flipped ? '◂ flipped' : 'copy', (xa + xb) / 2, yOut + PANEL - 14); ctx.textAlign = 'left'; }
    }
    panel(yOut, shown.output, BLUE, ink);
    axis(yOut + PANEL, ink);

    stepper.hidden = mode !== 2; mirrorBtn.classList.toggle('on', mode === 0); repeatBtn.classList.toggle('on', mode === 1); overtoneBtn.classList.toggle('on', mode === 2);
    info.textContent = `band ${hz(band.lo)} – ${hz(band.hi)} (${(Math.round(band.width * 100) / 100)} oct)   ${mode === 2 ? `overtones: ${Math.round(getParam('overtones'))} up, ${Math.round(getParam('under'))} down` : `copies: ${copies === 0 ? 'fill' : copies}`}`;
  }

  // dragging: an end of the band, or the band as a whole (its width stays)
  let drag = null;
  const at = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / (r.width || W)), y: (e.clientY - r.top) * (H / (r.height || H)) }; };
  canvas.addEventListener('pointerdown', e => {
    const { x, y } = at(e);
    if (y > TOP + PANEL + 6) return;
    const band = bandOf(getParam('low'), getParam('high')), x0 = X(band.b0), x1 = X(band.b0 + band.width);
    const part = Math.abs(x - x0) <= 7 ? 'low' : Math.abs(x - x1) <= 7 ? 'high' : x > x0 && x < x1 ? 'move' : null;
    if (!part) return;
    drag = { part, grab: octaveAt(x), b0: band.b0, width: band.width };
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const o = octaveAt(at(e).x), d = o - drag.grab;
    const clampOct = (v, a, b) => Math.max(Math.log2(a), Math.min(Math.log2(b), v));
    let b0 = drag.b0, b1 = drag.b0 + drag.width;
    if (drag.part === 'low') b0 = Math.min(b1 - 0.34, clampOct(drag.b0 + d, LOW_MIN, HIGH_MAX));
    else if (drag.part === 'high') b1 = Math.max(b0 + 0.34, clampOct(b1 + d, LOW_MIN, HIGH_MAX));
    else { const shift = Math.max(Math.log2(LOW_MIN) - b0, Math.min(Math.log2(HIGH_MAX) - b1, d)); b0 += shift; b1 += shift; }
    setParam('low', Math.round(Math.pow(2, b0))); setParam('high', Math.round(Math.pow(2, b1)));
    draw();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  // keep the node reporting while this panel is on the page
  watch();
  const timer = doc.defaultView?.setInterval?.(() => { if (!el.isConnected) { doc.defaultView.clearInterval(timer); return; } watch(); }, 1000);

  draw();
  return { el, refresh: draw, draw, feed };
}
