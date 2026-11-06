import { combResponse } from '../audio/spacecore.js';
import { ORANGE, BLUE, PINK, makeCanvas, drag, clamp } from './spaceui.js';

// The Haas panel: two lanes, the early side and the late side, with the late pulse to drag (across for the time, up and down for its level),
// and under them what the two sides make when they are added together in mono: a comb whose first notch is at 1 / (2 x time).
const W = 560, TOP = 108, H = 280, PL = 34, PR = 12, MAXMS = 45;

export function createHaasView({ doc = document, getParam, setParam }) {
  const el = doc.createElement('div'); el.className = 'spacepanel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);
  const X = ms => PL + ms / MAXMS * (W - PL - PR);

  function draw() {
    if (!ctx) return;
    const c = ink(), ms = getParam('time'), gain = getParam('gain'), right = getParam('side') >= 0.5;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    // the Haas zone: where the ear takes it for one sound
    ctx.fillStyle = ORANGE; ctx.globalAlpha = 0.08; ctx.fillRect(X(1), 4, X(35) - X(1), TOP - 10);
    ctx.fillStyle = c; ctx.globalAlpha = 0.55; ctx.fillText('one sound, from the early side', X(4), 6); ctx.fillText('echo', X(37), 6);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = c; ctx.lineWidth = 1;
    for (const y of [38, 78]) { ctx.beginPath(); ctx.moveTo(PL, y + 0.5); ctx.lineTo(W - PR, y + 0.5); ctx.stroke(); }
    for (let t = 0; t <= MAXMS; t += 5) ctx.fillText(String(t), X(t) - 4, TOP - 12 + 8);
    const pulse = (x, y, level, colour) => { ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 26 * clamp(level, 0, 1.2)); ctx.stroke(); ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y - 26 * clamp(level, 0, 1.2), 4, 0, 7); ctx.fill(); };
    const [yEarly, yLate] = right ? [38, 78] : [78, 38];   // left lane on top
    ctx.fillStyle = BLUE; ctx.globalAlpha = 0.9; ctx.fillText('L', 12, 20); ctx.fillStyle = PINK; ctx.fillText('R', 12, 60);
    pulse(X(0), right ? 38 : 78, 1, right ? BLUE : PINK);
    pulse(X(ms), right ? 78 : 38, gain, right ? PINK : BLUE);
    void yEarly; void yLate;
    // the mono comb
    const y0 = TOP + 18, ph = H - y0 - 28, lo = Math.log10(20), hi = Math.log10(20000);
    const fx = f => PL + (Math.log10(f) - lo) / (hi - lo) * (W - PL - PR);
    const db = v => 20 * Math.log10(Math.max(1e-3, v));
    const Y = d => y0 + ph / 2 - clamp(d, -18, 8) / 26 * ph * 0.9 - (-5 / 26) * ph * 0.9;
    ctx.globalAlpha = 0.2; ctx.strokeStyle = c;
    for (const f of [100, 1000, 10000]) { ctx.beginPath(); ctx.moveTo(fx(f), y0); ctx.lineTo(fx(f), y0 + ph); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(PL, Y(0)); ctx.lineTo(W - PR, Y(0)); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.fillStyle = c; ctx.fillText('mono sum (what a mono speaker plays)', PL, y0 - 14);
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) ctx.fillText(t, fx(f) - 6, y0 + ph + 5);
    ctx.fillText('0 dB', 4, Y(0) - 4);
    const wet = getParam('mix'), mono = f => { const g = gain * wet; return db(combResponse(f, ms, g) / (1 + 0)); };
    ctx.globalAlpha = 1; ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i <= 300; i++) { const f = Math.pow(10, lo + (hi - lo) * i / 300), v = mono(f) - db(1 + 0); const y = Y(v - 0); i ? ctx.lineTo(fx(f), y) : ctx.moveTo(fx(f), y); }
    ctx.stroke();
    info.textContent = `${right ? 'right' : 'left'} side ${ms.toFixed(1)} ms late at ${Math.round(gain * 100)}%   first mono notch ${ms > 0.05 ? `${Math.round(500 / ms)} Hz` : 'none'}   ${ms > 35 ? '(past 35 ms it is heard as an echo)' : ''}`;
  }

  drag(canvas, W, H, {
    start: (x, y) => y < TOP && Math.hypot(x - X(getParam('time')), 0) < 40 ? true : y < TOP && x > PL,
    move(x, y) {
      setParam('time', Math.round(clamp((x - PL) / (W - PL - PR) * MAXMS, 0, MAXMS) * 10) / 10);
      const lane = getParam('side') >= 0.5 ? 78 : 38;
      setParam('gain', Math.round(clamp((lane - y) / 26, 0, 1.2) * 100) / 100);
      draw();
    },
  });
  draw();
  return { el, refresh: draw, draw };
}
