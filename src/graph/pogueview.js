import { makeCanvas, drag, heartbeat, clamp } from './spaceui.js';

// The Pogue panel, in four pictures that sit side by side in a row (the node's strip scrolls sideways when they do not fit; see
// .subui-strip in index.html). The big one shows the voices themselves: where each one reads the delay line, over the last few seconds
// (the node reports them while the panel asks, every second), inside the band between the shortest and the longest delay. The two
// edges of the band can be dragged. A wide setting draws the right side's voices thinner and dashed. The three small ones are the wet
// path: the high-pass and low-pass it goes through (their two cut-offs can be dragged), what saturation and the bit reduction do to a
// sound (the curve from what goes in to what comes out), and how much of the wet sound is fed back to its own side and to the other
// one (the thicker the arrow, the more; a dashed one is inverted).
// With onset above 0 the voices picture also shows the detector, drawn over the voices on the same time line: the ratio of the fast
// level to the slow one (faint, on its own log scale), the sensitivity line (drag it: it is the onset slider) and a line through the
// picture each time a hit or a step in pitch fired. Pattern steps that fired show too. A small fifth picture holds the pattern's
// steps, which can be clicked on and off.
const VW = 560, PL = 40, PR = 14, TOP = 22, TRACE = 150, VH = TOP + TRACE + 22;   // the voices picture
const SW = 190, STOP = 22, STRIP = 92, SH = STOP + STRIP + 22;   // each of the three small ones: title, picture, labels
const TW = 330, TTOP = 22, TSTEPS = 22, TH = TTOP + TSTEPS + 24;   // the pattern picture
const SECONDS = 6, KEPT = 180;   // the history shown, and how many reports it holds (about 35 ms apart)
const AMBER = 'hsl(40 95% 62%)', GREEN = 'hsl(165 55% 52%)', ORANGE = 'hsl(30 90% 58%)', RED = 'hsl(8 80% 62%)';
const voiceColour = (v, count) => `hsl(${28 + (count > 1 ? v / (count - 1) : 0) * 170} 78% 58%)`;   // orange to cyan, so no purples
const STEREO = ['mono', 'wide', 'spread'];
const CYAN = 'hsl(190 75% 58%)';
const RATIO_MAX = 12;   // the top of the detector's (log) axis
const ratioThreshold = sensitivity => 1.2 + 8 * (1 - sensitivity) ** 2;   // the same as the node's
const sensitivityOf = ratio => clamp(1 - Math.sqrt(Math.max(0, ratio - 1.2) / 8), 0.02, 1);
const FONT = '9px ui-monospace, Consolas, monospace';

const hz = v => (v >= 1000 ? `${+(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`);

// gain of a 2nd-order high or low pass at f (the same maths as the filters in the node, 1 at the pass band)
const passGain = (f, cut, q, high, sampleRate) => {
  const w = Math.tan(Math.PI * Math.min(f, sampleRate * 0.499) / sampleRate) / Math.tan(Math.PI * Math.min(cut, sampleRate * 0.45) / sampleRate), k = 1 / q;
  return (high ? w * w : 1) / Math.sqrt((1 - w * w) ** 2 + (k * w) ** 2);
};

export function createPogueView({ doc = document, getParam, setParam, watch = () => {}, sampleRate = 48000 }) {
  const el = doc.createElement('div'); el.className = 'spacepanel pogue-panel';
  const row = doc.createElement('div'); row.className = 'subui-row';
  const info = doc.createElement('div'); info.className = 'sp-info';
  const voices = makeCanvas(doc, VW, VH, 'sp-pad'), filters = makeCanvas(doc, SW, SH, 'sp-pad'), shaper = makeCanvas(doc, SW, SH, 'sp-pad'), feedback = makeCanvas(doc, SW, SH, 'sp-pad'), trig = makeCanvas(doc, TW, TH, 'sp-pad');
  row.append(voices.canvas, trig.canvas, filters.canvas, shaper.canvas, feedback.canvas);
  el.append(row, info);

  const history = [];   // each report: { l: [...ms], r: [...ms] }
  let live = false, queued = false;
  const pw = VW - PL - PR;

  const feed = msg => {
    history.push({ l: Array.from(msg.l), r: Array.from(msg.r), level: msg.level ?? 0, ratio: msg.ratio ?? 1, fired: msg.fired ?? 0 });
    if (history.length > KEPT) history.shift();
    live = true;
    if (!queued) { queued = true; (doc.defaultView?.requestAnimationFrame ?? (f => f()))(() => { queued = false; draw(); }); }
  };

  // a canvas ready to draw on: cleared, in the panel's small monospace, with a label helper
  const begin = ({ canvas, ctx, ink }, w, h) => {
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.textAlign = 'left';
    const c = ink();
    const label = (text, x, y, colour = c, alpha = 0.6, align = 'left') => { ctx.globalAlpha = alpha; ctx.fillStyle = colour; ctx.textAlign = align; ctx.fillText(text, x, y); ctx.textAlign = 'left'; ctx.globalAlpha = 1; };
    return { ctx, c, label };
  };

  // ---- the voices over time ----
  // the delay axis: 0 to a little over the longest the voices can reach
  const axisMax = () => Math.max(8, Math.ceil(Math.max(getParam('mindelay'), getParam('maxdelay')) * 1.25 / 2) * 2);
  const DY = ms => TOP + TRACE - clamp(ms / axisMax(), 0, 1) * TRACE;
  const msAt = y => clamp((TOP + TRACE - y) / TRACE * axisMax(), 0.5, 50);

  function drawVoices(count, stereo, lo, hi) {
    if (!voices.ctx) return;
    const { ctx, c, label } = begin(voices, VW, VH);
    label('VOICES · where each one reads the delay line (ms)', PL, 6);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    const top = axisMax(), step = top <= 16 ? 2 : top <= 30 ? 5 : 10;
    for (let ms = 0; ms <= top; ms += step) {
      ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(PL, Math.round(DY(ms)) + 0.5); ctx.lineTo(VW - PR, Math.round(DY(ms)) + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
      label(String(ms), PL - 5, DY(ms) - 4, c, 0.6, 'right');
    }
    ctx.fillStyle = AMBER; ctx.globalAlpha = 0.1; ctx.fillRect(PL, DY(hi), pw, DY(lo) - DY(hi)); ctx.globalAlpha = 1;
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 3]);
    for (const ms of [lo, hi]) { ctx.beginPath(); ctx.moveTo(PL, Math.round(DY(ms)) + 0.5); ctx.lineTo(VW - PR, Math.round(DY(ms)) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    label(`longest ${+hi.toFixed(1)} ms`, VW - PR - 84, DY(hi) - 11, AMBER, 0.95); label(`shortest ${+lo.toFixed(1)} ms`, VW - PR - 90, DY(lo) + 3, AMBER, 0.95);
    for (let s = 0; s <= SECONDS; s++) label(s === SECONDS ? 'now' : `-${SECONDS - s}s`, PL + s / SECONDS * pw - (s === SECONDS ? 8 : 6), TOP + TRACE + 3, c, 0.45);
    // the detector (onset above 0): the fast/slow level ratio on a log scale of its own, the sensitivity line, and a line through the
    // picture for each trigger: the voices move there
    const onset = getParam('onset'), patternOn = Math.round(getParam('pattern')) > 0;
    const hx = k => PL + pw - (history.length - 1 - k) / KEPT * pw;
    if (onset > 0) {
      const RY = ratio => TOP + TRACE - clamp(Math.log(Math.max(1, ratio)) / Math.log(RATIO_MAX), 0, 1) * TRACE;
      ctx.strokeStyle = AMBER; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45; ctx.beginPath();
      history.forEach((h, k) => { if (k) ctx.lineTo(hx(k), RY(h.ratio)); else ctx.moveTo(hx(k), RY(h.ratio)); }); ctx.stroke();
      const line = RY(ratioThreshold(onset));
      ctx.strokeStyle = GREEN; ctx.globalAlpha = 0.9; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(PL, Math.round(line) + 0.5); ctx.lineTo(VW - PR, Math.round(line) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      label(`onset ${onset.toFixed(2)}`, PL + 4, line - 11, GREEN, 0.95);
    }
    history.forEach((h, k) => {
      for (const [bit, colour, show] of [[1, GREEN, onset > 0], [2, CYAN, onset > 0], [4, ORANGE, patternOn]]) {
        if (!(h.fired & bit) || !show) continue;
        ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(Math.round(hx(k)) + 0.5, TOP); ctx.lineTo(Math.round(hx(k)) + 0.5, TOP + TRACE); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
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
  }

  // ---- the pattern: its steps (the first is the highest bit, so the row reads as the binary number) ----
  const stepBox = (k, len) => { const w = (TW - 16) / len; return { x: 8 + k * w, w }; };
  function drawPattern() {
    if (!trig.ctx) return;
    const { ctx, label } = begin(trig, TW, TH);
    const onset = getParam('onset'), steps = Math.round(getParam('pattern')), len = Math.round(getParam('patlen')), moves = Math.round(getParam('moves'));
    label(`PATTERN · ${onset > 0 || steps > 0 ? ['new targets', 'phase jump', 'targets + phase'][moves] ?? '' : 'off: random timer'}`, 8, 4);
    for (let k = 0; k < len; k++) {
      const b = stepBox(k, len), on = (steps >> (len - 1 - k)) & 1;
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.strokeRect(b.x + 1.5, TTOP + 0.5, b.w - 3, TSTEPS - 4);
      if (on) { ctx.fillStyle = ORANGE; ctx.globalAlpha = 0.85; ctx.fillRect(b.x + 3, TTOP + 2, b.w - 6, TSTEPS - 7); }
      ctx.globalAlpha = 1;
    }
    label(`${steps > 0 ? steps.toString(2).padStart(len, '0') : 'off'} · click the steps`, 8, TTOP + TSTEPS + 1, ORANGE, 0.8);
  }

  // ---- the filters: log frequency 20 Hz to 20 kHz, -36 to +12 dB ----
  const fx = f => 8 + (Math.log2(f) - Math.log2(20)) / (Math.log2(20000) - Math.log2(20)) * (SW - 16);
  const freqAtX = x => Math.pow(2, Math.log2(20) + (x - 8) / (SW - 16) * (Math.log2(20000) - Math.log2(20)));
  const FY = d => STOP + STRIP - (clamp(d, -36, 12) + 36) / 48 * STRIP;

  function drawFilters() {
    if (!filters.ctx) return;
    const { ctx, c, label } = begin(filters, SW, SH);
    const hpCut = getParam('hpcut'), lpCut = getParam('lpcut'), hpQ = getParam('hpq'), lpQ = getParam('lpq');
    label('FILTERS', 8, 4);
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    for (const f of [100, 1000, 10000]) { ctx.globalAlpha = 0.13; ctx.beginPath(); ctx.moveTo(Math.round(fx(f)) + 0.5, STOP); ctx.lineTo(Math.round(fx(f)) + 0.5, STOP + STRIP); ctx.stroke(); ctx.globalAlpha = 1; label(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 6, STOP + STRIP + 3, c, 0.45); }
    ctx.globalAlpha = 0.13; ctx.beginPath(); ctx.moveTo(8, Math.round(FY(0)) + 0.5); ctx.lineTo(SW - 8, Math.round(FY(0)) + 0.5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = GREEN; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const f = 20 * Math.pow(1000, i / 120), g = 20 * Math.log10(Math.max(1e-4, passGain(f, hpCut, hpQ, true, sampleRate) * passGain(f, lpCut, lpQ, false, sampleRate)));
      if (i) ctx.lineTo(fx(f), FY(g)); else ctx.moveTo(fx(f), FY(g));
    }
    ctx.stroke();
    for (const [cut, text, align] of [[hpCut, 'hp', 'right'], [lpCut, 'lp', 'left']]) {
      ctx.strokeStyle = AMBER; ctx.fillStyle = AMBER; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(fx(cut)) + 0.5, STOP); ctx.lineTo(Math.round(fx(cut)) + 0.5, STOP + STRIP); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(fx(cut), FY(-3), 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      const side = align === 'left' && fx(cut) + 62 > SW ? 'right' : align;   // keep the label inside the picture
      label(`${text} ${hz(cut)}`, fx(cut) + (side === 'right' ? -4 : 4), STOP + 2, AMBER, 1, side);
    }
  }

  // ---- saturation then bit reduction: what comes out for what goes in ----
  function drawShaper() {
    if (!shaper.ctx) return;
    const { ctx, c, label } = begin(shaper, SW, SH);
    const sat = getParam('saturation'), degrade = getParam('degrade'), levels = degrade > 0 ? Math.pow(2, 16 - 14 * degrade - 1) : 0, drive = 1 + 9 * sat;
    const x0 = 8, w = SW - 16;
    label(`SATURATE + BITS${degrade > 0 ? ` · ${(16 - 14 * degrade).toFixed(1)} bits` : ''}`, 8, 4);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, STOP + 0.5, w, STRIP);
    ctx.beginPath(); ctx.moveTo(x0, STOP + STRIP / 2 + 0.5); ctx.lineTo(x0 + w, STOP + STRIP / 2 + 0.5); ctx.moveTo(x0 + w / 2 + 0.5, STOP); ctx.lineTo(x0 + w / 2 + 0.5, STOP + STRIP); ctx.stroke();
    ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(x0, STOP + STRIP); ctx.lineTo(x0 + w, STOP); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const xin = -1 + 2 * i / 160;
      let y = sat > 0 ? Math.tanh(xin * drive) / Math.tanh(drive) : xin;
      if (levels > 0) y = Math.round(y * levels) / levels;
      const px = x0 + (xin + 1) / 2 * w, py = STOP + STRIP / 2 - clamp(y, -1, 1) * STRIP / 2;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
    label(`sat ${Math.round(sat * 100)}%`, x0 + 4, STOP + 3, ORANGE, 0.9);
  }

  // ---- the feedback: to its own side and across, between the two sides ----
  function drawFeedback() {
    if (!feedback.ctx) return;
    const { ctx, c, label } = begin(feedback, SW, SH);
    const fb = getParam('feedback'), xfb = getParam('xfeedback');
    label('FEEDBACK', 8, 4);
    const cy = STOP + STRIP * 0.58, lx = SW * 0.22, rx = SW * 0.78, rad = 12;
    const arrow = (x0, y0, x1, y1, amount) => {
      const a = Math.abs(amount); if (a < 0.005) return;
      ctx.strokeStyle = amount < 0 ? RED : GREEN; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1 + a * 5; ctx.globalAlpha = 0.9; ctx.setLineDash(amount < 0 ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
      const ang = Math.atan2(y1 - y0, x1 - x0); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 7 * Math.cos(ang - 0.45), y1 - 7 * Math.sin(ang - 0.45)); ctx.lineTo(x1 - 7 * Math.cos(ang + 0.45), y1 - 7 * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
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
    label(`own ${pct(fb)}`, 8, STOP + STRIP + 3, fb < 0 ? RED : GREEN, 0.9); label(`across ${pct(xfb)}`, SW - 8, STOP + STRIP + 3, xfb < 0 ? RED : GREEN, 0.9, 'right');
  }

  function draw() {
    const count = Math.round(getParam('voices')), stereo = Math.round(getParam('stereo'));
    const lo = Math.min(getParam('mindelay'), getParam('maxdelay')), hi = Math.max(getParam('mindelay'), getParam('maxdelay'));
    drawVoices(count, stereo, lo, hi); drawPattern(); drawFilters(); drawShaper(); drawFeedback();
    info.textContent = `${count} voice${count === 1 ? '' : 's'} · ${STEREO[stereo] ?? ''} · ${+lo.toFixed(1)} to ${+hi.toFixed(1)} ms · fastest ${+getParam('rate').toFixed(2)} Hz · ${Math.round(getParam('change') * 100)}% random · mix ${Math.round(getParam('mix') * 100)}%`;
  }

  // dragging: an edge of the delay band (up and down), or a filter cut-off (along)
  let edge = null;
  drag(voices.canvas, VW, VH, {
    start: (px, py) => {
      if (py < TOP - 4 || py > TOP + TRACE + 4 || px < PL - 4) return false;
      const onsetY = getParam('onset') > 0 ? TOP + TRACE - clamp(Math.log(Math.max(1, ratioThreshold(getParam('onset')))) / Math.log(RATIO_MAX), 0, 1) * TRACE : null;
      if (onsetY !== null && Math.abs(py - onsetY) <= 7 && [getParam('mindelay'), getParam('maxdelay')].every(ms => Math.abs(py - DY(ms)) > Math.abs(py - onsetY))) { edge = 'onset'; return true; }
      const near = [['mindelay', getParam('mindelay')], ['maxdelay', getParam('maxdelay')]].filter(([, ms]) => Math.abs(py - DY(ms)) <= 7).sort((a, b) => Math.abs(py - DY(a[1])) - Math.abs(py - DY(b[1])))[0];
      if (!near) return false;
      edge = near[0]; return true;
    },
    move: (px, py) => {
      if (edge === 'onset') setParam('onset', Math.round(sensitivityOf(Math.exp(clamp((TOP + TRACE - py) / TRACE, 0, 1) * Math.log(RATIO_MAX))) * 100) / 100);
      else setParam(edge, Math.round(msAt(py) * 10) / 10);
      draw();
    },
    done: () => { edge = null; },
  });
  trig.canvas.addEventListener('click', e => {   // a step on or off
    const r = trig.canvas.getBoundingClientRect(), px = (e.clientX - r.left) * TW / r.width, py = (e.clientY - r.top) * TH / r.height;
    const len = Math.round(getParam('patlen')), sy = TTOP;
    if (py < sy || py > sy + TSTEPS || px < 8 || px > TW - 8) return;
    const k = clamp(Math.floor((px - 8) / ((TW - 16) / len)), 0, len - 1);
    setParam('pattern', (Math.round(getParam('pattern')) ^ (1 << (len - 1 - k))) & 0xffff); draw();
  });
  let cut = null;
  drag(filters.canvas, SW, SH, {
    start: px => {
      const near = [['hpcut', getParam('hpcut')], ['lpcut', getParam('lpcut')]].filter(([, f]) => Math.abs(px - fx(f)) <= 8).sort((a, b) => Math.abs(px - fx(a[1])) - Math.abs(px - fx(b[1])))[0];
      if (!near) return false;
      cut = near[0]; return true;
    },
    move: px => { setParam(cut, Math.round(cut === 'hpcut' ? clamp(freqAtX(px), 10, 2000) : clamp(freqAtX(px), 200, 20000))); draw(); },
    done: () => { cut = null; },
  });

  heartbeat(doc, el, watch);
  draw();
  return { el, refresh: draw, draw, feed };
}
