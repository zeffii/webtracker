import { makeCanvas, drag, clamp } from './spaceui.js';
import { cutoffs, filterDb, responseDb, overtones, sharedOvertones, F_LOW, F_HIGH } from '../audio/nodes/twinresponse.js';

// The twin filter's panel: the two filters' curves (teal and amber) and the pair together (the ink colour) on one log-frequency axis, a dot on each
// cutoff to drag, and the overtones above each cutoff as vertical lines numbered 2x, 3x and so on. Filter 1's lines hang from the top, filter 2's
// rise from the bottom; where the two filters share an overtone the line runs the full height and is bright. The picture is the filter at rest
// (see twinresponse.js): it moves with every setting, but not with the follower, the LFO or the pitch tracker.
const W = 560, PL = 40, PR = 20, TOP = 22, PLOT = 200, H = TOP + PLOT + 34;
const DB_TOP = 24, DB_BOTTOM = -48;
const TEAL = 'hsl(175 60% 52%)', AMBER = 'hsl(40 95% 62%)';
const LABELS = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const NAMES = ['cutoff1', 'res1', 'low1', 'band1', 'high1', 'cutoff2', 'res2', 'low2', 'band2', 'high2', 'blend', 'lock', 'ratio', 'detune'];
const hz = v => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 2)} kHz` : `${Math.round(v)} Hz`);

export function createTwinView({ doc = document, getParam, setParam, sampleRate = 48000 }) {
  const el = doc.createElement('div'); el.className = 'spacepanel twin-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);

  const lo = Math.log2(F_LOW), hi = Math.log2(F_HIGH), pw = W - PL - PR;
  const X = f => PL + (Math.log2(f) - lo) / (hi - lo) * pw;
  const freqAt = x => Math.pow(2, lo + (x - PL) / pw * (hi - lo));
  const Y = d => TOP + PLOT - (clamp(d, DB_BOTTOM, DB_TOP) - DB_BOTTOM) / (DB_TOP - DB_BOTTOM) * PLOT;
  const settings = () => { const p = {}; for (const n of NAMES) p[n] = getParam(n); return p; };
  const line = (x, y0, y1, colour, alpha) => {
    ctx.strokeStyle = colour; ctx.globalAlpha = alpha; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); ctx.stroke(); ctx.globalAlpha = 1;
  };
  const curve = (fn, colour, width, alpha) => {
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.globalAlpha = alpha; ctx.beginPath();
    for (let i = 0; i <= 300; i++) { const f = F_LOW * Math.pow(F_HIGH / F_LOW, i / 300); if (i) ctx.lineTo(X(f), Y(fn(f))); else ctx.moveTo(X(f), Y(fn(f))); }
    ctx.stroke(); ctx.globalAlpha = 1;
  };

  function draw() {
    if (!ctx) return;
    const c = ink(), p = settings(), [f1, f2] = cutoffs(p), mid = TOP + PLOT / 2;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    ctx.lineWidth = 1; ctx.fillStyle = c; ctx.textAlign = 'center';
    for (const [f, t] of LABELS) { line(X(f), TOP, TOP + PLOT, c, 0.1); ctx.globalAlpha = 0.6; ctx.fillText(t, X(f), TOP + PLOT + 4); ctx.globalAlpha = 1; }
    line(0, 0, 0, c, 0);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(PL, TOP + PLOT + 0.5); ctx.lineTo(W - PR, TOP + PLOT + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.fillStyle = TEAL; ctx.fillText('FILTER 1', PL, 6); ctx.fillStyle = AMBER; ctx.fillText('FILTER 2', PL + 60, 6);
    ctx.fillStyle = c; ctx.globalAlpha = 0.6; ctx.fillText('BOTH', PL + 120, 6); ctx.globalAlpha = 1;

    // the overtones: filter 1's from the top, filter 2's from the bottom, shared ones the full height
    const shared = sharedOvertones(f1, f2), sharedAt = new Set(shared.map(s => `${s.a}:${s.b}`));
    ctx.textAlign = 'center';
    const hang = (f, colour, fromTop, key) => overtones(f).forEach(({ n, f: g }) => {
      if (g < F_LOW) return;
      const isShared = key === 1 ? shared.some(s => s.a === n) : shared.some(s => s.b === n), alpha = Math.max(0.12, 0.6 - n * 0.05);
      if (isShared) { line(X(g), TOP + 12, TOP + PLOT, c, 0.7); }
      else if (fromTop) line(X(g), TOP + 12, mid, colour, alpha); else line(X(g), mid, TOP + PLOT, colour, alpha);
      ctx.fillStyle = isShared ? c : colour; ctx.globalAlpha = isShared ? 0.9 : alpha + 0.2;
      ctx.fillText(`${n}x`, X(g), fromTop ? TOP + 1 : TOP + PLOT - 11); ctx.globalAlpha = 1;
    });
    hang(f1, TEAL, true, 1); hang(f2, AMBER, false, 2);
    void sharedAt;

    // the curves
    ctx.strokeStyle = c; ctx.globalAlpha = 0.3; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(PL, Math.round(Y(0)) + 0.5); ctx.lineTo(W - PR, Math.round(Y(0)) + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = c; ctx.globalAlpha = 0.6; ctx.textAlign = 'right';
    ctx.fillText(`+${DB_TOP}`, PL - 4, Y(DB_TOP) - 1); ctx.fillText('0 dB', PL - 4, Y(0) - 4); ctx.fillText(`${DB_BOTTOM}`, PL - 4, Y(DB_BOTTOM) - 8); ctx.globalAlpha = 1;
    curve(f => filterDb(f, p, 1, sampleRate), TEAL, 1.1, 0.55);
    curve(f => filterDb(f, p, 2, sampleRate), AMBER, 1.1, 0.55);
    curve(f => responseDb(f, p, sampleRate), c, 1.8, 1);

    // the dots and their names
    [[f1, TEAL, 1], [f2, AMBER, 2]].forEach(([f, colour, n]) => {
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(X(f), Y(filterDb(f, p, n, sampleRate)), 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.textAlign = 'left'; ctx.fillStyle = c;
    const lockText = Math.round(p.lock) === 1 ? ` · locked at ${+p.ratio.toFixed(3)}x${p.detune ? ` ${p.detune > 0 ? '+' : ''}${Math.round(p.detune)} ct` : ''}` : '';
    const near = shared.length ? ` · ${shared.length} shared overtone${shared.length > 1 ? 's' : ''}, first at ${hz(shared[0].f)}` : '';
    info.textContent = `filter 1 ${hz(f1)} · filter 2 ${hz(f2)}${lockText}${near}`;
  }

  // drag a dot along the axis for its cutoff and up and down for its resonance; the second dot, while locked, sets the ratio
  let grab = null;
  drag(canvas, W, H, {
    start: (x, y) => {
      if (y < TOP || y > TOP + PLOT + 6) return false;
      const [f1, f2] = cutoffs(settings()), d1 = Math.abs(x - X(f1)), d2 = Math.abs(x - X(f2));
      if (Math.min(d1, d2) > 9) return false;
      const n = d1 <= d2 ? 1 : 2;
      grab = { n, y, res: getParam(`res${n}`) };
      return true;
    },
    move: (x, y) => {
      const f = clamp(freqAt(x), 20, 18000);
      if (grab.n === 1) setParam('cutoff1', Math.round(f));
      else if (Math.round(getParam('lock')) === 1) setParam('ratio', Math.round(clamp(f / cutoffs(settings())[0] / Math.pow(2, getParam('detune') / 1200), 0.25, 4) * 1000) / 1000);
      else setParam('cutoff2', Math.round(f));
      setParam(`res${grab.n}`, Math.round(clamp(grab.res + (grab.y - y) / PLOT, 0, 1) * 100) / 100);
      draw();
    },
    done: () => { grab = null; },
  });

  draw();
  return { el, refresh: draw, draw, feed: () => {} };
}
