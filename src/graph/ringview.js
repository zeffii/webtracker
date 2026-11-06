import { sidebands } from '../audio/spacecore.js';
import { ORANGE, BLUE, PINK, makeCanvas, drag, heartbeat, button, clamp } from './spaceui.js';

// The ring modulator panel: the partials of the sound (grey, taken as a harmonic series on the pitch it hears), the carrier (orange), and
// the sidebands the ring modulator makes of them: carrier minus partial (pink) and carrier plus partial (blue). The pitch and carrier are
// live while the panel is open. Drag on the plot to move the carrier: tracked it sets the ratio to the pitch, fixed it sets the frequency.
const W = 560, H = 210, PL = 14, PR = 14, FMIN = 30, FMAX = 12000, HARM = 6;

export function createRingView({ doc = document, getParam, setParam, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const row = doc.createElement('div'); row.className = 'sp-row';
  const trackBtn = button(doc, 'follow pitch', 'The carrier follows the pitch of the sound', () => { setParam('track', getParam('track') >= 0.5 ? 0 : 1); draw(); });
  const waves = ['sine', 'triangle', 'square', 'saw'].map((n, i) => button(doc, n, `Carrier wave: ${n}`, () => { setParam('wave', i); draw(); }));
  const info = doc.createElement('span'); info.className = 'sp-info';
  row.append(trackBtn, ...waves, info);
  el.append(canvas, row);
  const live = { f0: 0, fc: 0 };
  const lo = Math.log2(FMIN), hi = Math.log2(FMAX);
  const X = f => PL + (Math.log2(clamp(f, FMIN, FMAX)) - lo) / (hi - lo) * (W - PL - PR);
  const freqAt = x => Math.pow(2, lo + (x - PL) / (W - PL - PR) * (hi - lo));

  function draw() {
    if (!ctx) return;
    const c = ink(), tracked = getParam('track') >= 0.5, f0 = live.f0 > 0 ? live.f0 : 220;
    const fc = live.fc > 0 ? live.fc : tracked ? f0 * getParam('ratio') + getParam('offset') : getParam('freq');
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.moveTo(X(f) + 0.5, 10); ctx.lineTo(X(f) + 0.5, H - 24); ctx.stroke(); ctx.globalAlpha = 0.55; ctx.fillStyle = c; ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), X(f) - 8, H - 18); }
    const base = H - 28, top = 24, stick = (f, level, colour, w = 2) => { if (f < FMIN || f > FMAX) return; ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X(f), base); ctx.lineTo(X(f), base - level * (base - top)); ctx.stroke(); };
    // the sound's partials, falling with 1/n
    ctx.globalAlpha = 0.7; for (let n = 1; n <= HARM; n++) stick(n * f0, 1 / n, c, 3);
    // the sidebands of each
    ctx.globalAlpha = 1;
    for (const s of sidebands(f0, fc, HARM)) stick(s.hz, 0.9 / s.partial * 0.8, s.kind === 'sum' ? BLUE : PINK, 2);
    // the carrier
    ctx.globalAlpha = 0.9; ctx.setLineDash([4, 3]); stick(fc, 1, ORANGE, 1.5); ctx.setLineDash([]);
    ctx.fillStyle = ORANGE; ctx.globalAlpha = 1; ctx.fillText(`carrier ${Math.round(fc)} Hz`, clamp(X(fc) + 4, 4, W - 110), 6);
    ctx.fillStyle = c; ctx.globalAlpha = 0.6; ctx.fillText(`pitch ${live.f0 > 0 ? `${Math.round(f0)} Hz` : 'not heard (showing 220)'}`, W - 170, 6);
    ctx.globalAlpha = 1;
    trackBtn.classList.toggle('on', tracked);
    waves.forEach((b, i) => b.classList.toggle('on', Math.round(getParam('wave')) === i));
    info.textContent = tracked ? `ratio ${getParam('ratio').toFixed(2)}` : 'fixed';
  }

  drag(canvas, W, H, {
    start: (x, y) => y < H - 22,
    move(x) {
      const f = freqAt(x);
      if (getParam('track') >= 0.5) { const f0 = live.f0 > 0 ? live.f0 : 220; setParam('ratio', Math.round(clamp((f - getParam('offset')) / f0, 0.25, 8) * 100) / 100); }
      else setParam('freq', Math.round(clamp(f, 0.1, 5000) * 10) / 10);
      draw();
    },
  });
  const feed = msg => { live.f0 = msg.f0; live.fc = msg.fc; draw(); };
  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
