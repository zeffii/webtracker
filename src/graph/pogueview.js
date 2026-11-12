import { makeCanvas, drag, heartbeat, clamp } from './spaceui.js';

// The Pogue panel. Above, the voices themselves: where each one reads the delay line, over the last few seconds (the node
// reports them while the panel asks, every second), inside the band between the shortest and the longest delay. The two edges
// of the band can be dragged. A wide setting draws the right side's voices thinner and dashed. Below, the wet path in three
// small pictures: the high-pass and low-pass it goes through (their two cut-offs can be dragged), what saturation and the bit
// reduction do to a sound (the curve from what goes in to what comes out), and how much of the wet sound is fed back to its own
// side and to the other one (the thicker the arrow, the more; a dashed one is inverted).
const W = 560, PL = 40, PR = 14, TOP = 22, TRACE = 150, GAP = 40, STRIP = 92, H = TOP + TRACE + GAP + STRIP + 24;
const SECONDS = 6, KEPT = 180;   // the history shown, and how many reports it holds (about 35 ms apart)
const AMBER = 'hsl(40 95% 62%)', GREEN = 'hsl(165 55% 52%)', ORANGE = 'hsl(30 90% 58%)', RED = 'hsl(8 80% 62%)';
const voiceColour = (v, count) => `hsl(${28 + (count > 1 ? v / (count - 1) : 0) * 170} 78% 58%)`;   // orange to cyan, so no purples
const STEREO = ['mono', 'wide', 'spread'];

const hz = v => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`);

// gain of a 2nd-order high or low pass at f (the same maths as the filters in the node, 1 at the pass band)
const passGain = (f, cut, q, high, sampleRate) => {
  const w = Math.tan(Math.PI * Math.min(f, sampleRate * 0.499) / sampleRate) / Math.tan(Math.PI * Math.min(cut, sampleRate * 0.45) / sampleRate), k = 1 / q;
  return (high ? w * w : 1) / Math.sqrt((1 - w * w) ** 2 + (k * w) ** 2);
};

export function createPogueView({ doc = document, getParam, setParam, watch = () => {}, sampleRate = 48000 }) {
  const el = doc.createElement('div'); el.className = 'spacepanel pogue-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'sp-pad');
  const info = doc.createElement('div'); info.className = 'sp-info';
  el.append(canvas, info);

  const history = [];   // each report: { l: [...ms], r: [...ms] }
  let live = false, queued = false;
  const pw = W - PL - PR, trackY = TOP + TRACE + GAP;
  const stripW = (W - 3 * 18 - PL + 18) / 3;   // three pictures side by side
  const stripX = i => PL - 18 + 18 + i * (stripW + 18);

  const feed = msg => {
    history.push({ l: Array.from(msg.l), r: Array.from(msg.r) });
    if (history.length > KEPT) history.shift();
    live = true;
    if (!queued) { queued = true; (doc.defaultView?.requestAnimationFrame ?? (f => f()))(() => { queued = false; draw(); }); }
  };

  // the delay axis: 0 to a little over the longest the voices can reach
  const axisMax = () => Math.max(8, Math.ceil(Math.max(getParam('mindelay'), getParam('maxdelay')) * 1.25 / 2) * 2);
  const DY = ms => TOP + TRACE - clamp(ms / axisMax(), 0, 1) * TRACE;
  const msAt = y => clamp((TOP + TRACE - y) / TRACE * axisMax(), 0.5, 50);

  // the filters' picture: log frequency 20 Hz to 20 kHz, -36 to +12 dB
  const fx = (f, x0, w) => x0 + (Math.log2(f) - Math.log2(20)) / (Math.log2(20000) - Math.log2(20)) * w;
  const freqAtX = (x, x0, w) => Math.pow(2, Math.log2(20) + (x - x0) / w * (Math.log2(20000) - Math.log2(20)));
  const FY = d => trackY + STRIP - (clamp(d, -36, 12) + 36) / 48 * STRIP;

  function draw() {
    if (!ctx) return;
    const c = ink(), count = Math.round(getParam('voices')), stereo = Math.round(getParam('stereo'));
    const lo = Math.min(getParam('mindelay'), getParam('maxdelay')), hi = Math.max(getParam('mindelay'), getParam('maxdelay'));
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    const label = (text, x, y, colour = c, alpha = 0.6) => { ctx.globalAlpha = alpha; ctx.fillStyle = colour; ctx.fillText(text, x, y); ctx.globalAlpha = 1; };

    // ---- the voices over time ----
    label('VOICES · where each one reads the delay line (ms)', PL, 6);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    const top = axisMax(), step = top <= 16 ? 2 : top <= 30 ? 5 : 10;
    ctx.textAlign = 'right';
    for (let ms = 0; ms <= top; ms += step) {
      ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(PL, Math.round(DY(ms)) + 0.5); ctx.lineTo(W - PR, Math.round(DY(ms)) + 0.5); ctx.stroke();
      label(String(ms), PL - 5, DY(ms) - 4);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = AMBER; ctx.globalAlpha = 0.1; ctx.fillRect(PL, DY(hi), pw, DY(lo) - DY(hi)); ctx.globalAlpha = 1;
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 3]);
    for (const ms of [lo, hi]) { ctx.beginPath(); ctx.moveTo(PL, Math.round(DY(ms)) + 0.5); ctx.lineTo(W - PR, Math.round(DY(ms)) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    label(`longest ${+hi.toFixed(1)} ms`, W - PR - 84, DY(hi) - 11, AMBER, 0.95); label(`shortest ${+lo.toFixed(1)} ms`, W - PR - 90, DY(lo) + 3, AMBER, 0.95);
    for (let s = 0; s <= SECONDS; s++) label(s === SECONDS ? 'now' : `-${SECONDS - s}s`, PL + s / SECONDS * pw - (s === SECONDS ? 8 : 6), TOP + TRACE + 3, c, 0.45);
    // the traces: the right side (wide mode) first, thin and dashed, so the left side's lines lie over them
    const x = k => PL + pw - (history.length - 1 - k) / KEPT * pw;
    const trace = (side, width, dash, alpha) => {
      ctx.lineWidth = width; ctx.setLineDash(dash); ctx.globalAlpha = alpha;
      for (let v = 0; v < count; v++) {
        ctx.strokeStyle = voiceColour(v, count); ctx.beginPath();
        history.forEach((h, k) => { const ms = h[side][v]; if (ms === undefined) return; if (k) ctx.lineTo(x(k), DY(ms)); else ctx.moveTo(x(k), DY(ms)); });
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    if (stereo === 1) trace('r', 1, [3, 3], 0.6);
    trace('l', 1.8, [], 1);
    if (history.length) {   // a dot on each voice's latest position
      const last = history.at(-1);
      for (let v = 0; v < count; v++) if (last.l[v] !== undefined) { ctx.fillStyle = voiceColour(v, count); ctx.beginPath(); ctx.arc(x(history.length - 1), DY(last.l[v]), 3.2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (!live) label('play something through it to watch the voices', PL + pw / 2 - 118, TOP + TRACE / 2 - 4, c, 0.5);

    // ---- the wet path ----
    // 1. the filters
    const x1 = stripX(0), w1 = stripW, hpCut = getParam('hpcut'), lpCut = getParam('lpcut'), hpQ = getParam('hpq'), lpQ = getParam('lpq');
    label('FILTERS', x1, trackY - 14);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.13; ctx.lineWidth = 1;
    for (const f of [100, 1000, 10000]) { ctx.beginPath(); ctx.moveTo(Math.round(fx(f, x1, w1)) + 0.5, trackY); ctx.lineTo(Math.round(fx(f, x1, w1)) + 0.5, trackY + STRIP); ctx.stroke(); label(f >= 1000 ? `${f / 1000}k` : String(f), fx(f, x1, w1) - 6, trackY + STRIP + 3, c, 0.45); ctx.globalAlpha = 0.13; }
    ctx.beginPath(); ctx.moveTo(x1, Math.round(FY(0)) + 0.5); ctx.lineTo(x1 + w1, Math.round(FY(0)) + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = GREEN; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const f = 20 * Math.pow(1000, i / 120), g = 20 * Math.log10(Math.max(1e-4, passGain(f, hpCut, hpQ, true, sampleRate) * passGain(f, lpCut, lpQ, false, sampleRate)));
      if (i) ctx.lineTo(fx(f, x1, w1), FY(g)); else ctx.moveTo(fx(f, x1, w1), FY(g));
    }
    ctx.stroke();
    for (const [cut, text, a] of [[hpCut, 'hp', 'right'], [lpCut, 'lp', 'left']]) {
      ctx.strokeStyle = AMBER; ctx.fillStyle = AMBER; ctx.globalAlpha = 0.8; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(fx(cut, x1, w1)) + 0.5, trackY); ctx.lineTo(Math.round(fx(cut, x1, w1)) + 0.5, trackY + STRIP); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(fx(cut, x1, w1), FY(-3 + (text === 'hp' ? 0 : 0)), 3, 0, Math.PI * 2); ctx.fill();
      const side = a === 'left' && fx(cut, x1, w1) + 62 > x1 + w1 ? 'right' : a;   // keep the label inside its picture
      ctx.globalAlpha = 1; ctx.textAlign = side; ctx.fillText(`${text} ${hz(cut)}`, fx(cut, x1, w1) + (side === 'right' ? -4 : 4), trackY + 2); ctx.textAlign = 'left';
    }

    // 2. saturation then bit reduction: what comes out for what goes in
    const x2 = stripX(1), w2 = stripW, sat = getParam('saturation'), degrade = getParam('degrade');
    const levels = degrade > 0 ? Math.pow(2, 16 - 14 * degrade - 1) : 0, drive = 1 + 9 * sat;
    label(`SATURATE + BITS${degrade > 0 ? ` · ${(16 - 14 * degrade).toFixed(1)} bits` : ''}`, x2, trackY - 14);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.strokeRect(x2 + 0.5, trackY + 0.5, w2, STRIP);
    ctx.beginPath(); ctx.moveTo(x2, trackY + STRIP / 2 + 0.5); ctx.lineTo(x2 + w2, trackY + STRIP / 2 + 0.5); ctx.moveTo(x2 + w2 / 2 + 0.5, trackY); ctx.lineTo(x2 + w2 / 2 + 0.5, trackY + STRIP); ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(x2, trackY + STRIP); ctx.lineTo(x2 + w2, trackY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const xin = -1 + 2 * i / 160;
      let y = sat > 0 ? Math.tanh(xin * drive) / Math.tanh(drive) : xin;
      if (levels > 0) y = Math.round(y * levels) / levels;
      const px = x2 + (xin + 1) / 2 * w2, py = trackY + STRIP / 2 - clamp(y, -1, 1) * STRIP / 2;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
    label(`sat ${Math.round(sat * 100)}%`, x2 + 4, trackY + 3, ORANGE, 0.9);

    // 3. the feedback: self and across, between the two sides
    const x3 = stripX(2), w3 = stripW, fb = getParam('feedback'), xfb = getParam('xfeedback');
    label('FEEDBACK', x3, trackY - 14);
    const cy = trackY + STRIP * 0.58, lx = x3 + w3 * 0.22, rx = x3 + w3 * 0.78, rad = 12;
    const arrow = (x0, y0, x1b, y1b, amount) => {
      const a = Math.abs(amount); if (a < 0.005) return;
      ctx.strokeStyle = amount < 0 ? RED : GREEN; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1 + a * 5; ctx.globalAlpha = 0.9; ctx.setLineDash(amount < 0 ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1b, y1b); ctx.stroke(); ctx.setLineDash([]);
      const ang = Math.atan2(y1b - y0, x1b - x0); ctx.beginPath(); ctx.moveTo(x1b, y1b); ctx.lineTo(x1b - 7 * Math.cos(ang - 0.45), y1b - 7 * Math.sin(ang - 0.45)); ctx.lineTo(x1b - 7 * Math.cos(ang + 0.45), y1b - 7 * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    };
    const loop = (cx, amount) => {
      const a = Math.abs(amount); if (a < 0.005) return;
      ctx.strokeStyle = amount < 0 ? RED : GREEN; ctx.lineWidth = 1 + a * 5; ctx.globalAlpha = 0.9; ctx.setLineDash(amount < 0 ? [4, 3] : []);
      ctx.beginPath(); ctx.arc(cx, cy - rad - 9, 10, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    loop(lx, fb); loop(rx, fb);
    arrow(lx + rad + 2, cy - 5, rx - rad - 6, cy - 5, xfb); arrow(rx - rad - 2, cy + 6, lx + rad + 6, cy + 6, xfb);
    for (const [cx, name] of [[lx, 'L'], [rx, 'R']]) {
      ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      label(name, cx - 3, cy - 4, c, 0.9);
    }
    const pct = v => `${v < 0 ? '-' : ''}${Math.round(Math.abs(v) * 100)}%`;
    label(`own ${pct(fb)}`, x3 + 2, trackY + STRIP - 4, fb < 0 ? RED : GREEN, 0.9); ctx.textAlign = 'right'; label(`across ${pct(xfb)}`, x3 + w3, trackY + STRIP - 4, xfb < 0 ? RED : GREEN, 0.9); ctx.textAlign = 'left';

    info.textContent = `${count} voice${count === 1 ? '' : 's'} · ${STEREO[stereo] ?? ''} · ${+lo.toFixed(1)} to ${+hi.toFixed(1)} ms · fastest ${+getParam('rate').toFixed(2)} Hz · ${Math.round(getParam('change') * 100)}% random · mix ${Math.round(getParam('mix') * 100)}%`;
  }

  // dragging: an edge of the delay band (up and down), or a filter cut-off (along)
  let grab = null;
  drag(canvas, W, H, {
    start: (px, py) => {
      if (py >= TOP - 4 && py <= TOP + TRACE + 4 && px >= PL - 4) {
        const lo = getParam('mindelay'), hi = getParam('maxdelay');
        const near = [['mindelay', lo], ['maxdelay', hi]].filter(([, ms]) => Math.abs(py - DY(ms)) <= 7).sort((a, b) => Math.abs(py - DY(a[1])) - Math.abs(py - DY(b[1])))[0];
        if (near) { grab = { kind: 'delay', name: near[0] }; return true; }
        return false;
      }
      if (py >= trackY - 4 && py <= trackY + STRIP + 4) {
        const x1 = stripX(0);
        const near = [['hpcut', getParam('hpcut')], ['lpcut', getParam('lpcut')]].filter(([, f]) => Math.abs(px - fx(f, x1, stripW)) <= 8).sort((a, b) => Math.abs(px - fx(a[1], x1, stripW)) - Math.abs(px - fx(b[1], x1, stripW)))[0];
        if (near) { grab = { kind: 'cut', name: near[0] }; return true; }
      }
      return false;
    },
    move: (px, py) => {
      if (grab.kind === 'delay') setParam(grab.name, Math.round(msAt(py) * 10) / 10);
      else setParam(grab.name, Math.round(grab.name === 'hpcut' ? clamp(freqAtX(px, stripX(0), stripW), 10, 2000) : clamp(freqAtX(px, stripX(0), stripW), 200, 20000)));
      draw();
    },
    done: () => { grab = null; },
  });

  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
