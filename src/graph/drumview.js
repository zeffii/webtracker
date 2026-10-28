import { renderPreview, envCurve, NOISE_TYPES } from '../audio/nodes/drumsynth.js';

// The drum synth's pictures, drawn from its parameters (the sliders move them). Three panels on one canvas:
//   Envelopes  the volume envelope (amber), the pitch envelope as the pitch it makes in Hz (blue) and the noise envelope (green), over time
//   Click      the click alone: what the transient is made of, with the stretch that the tail smoothing fades shaded
//   Root note  the whole hit as it sounds at the root note, and below it the first 25 ms enlarged, where the click and the first cycles meet
// The sound pictures are the node's own code run offline, so they show exactly what is heard.
const W = 360, PL = 34, PR = 8, SR = 44100;
const ENV_Y = 0, ENV_H = 104, CLK_Y = ENV_H, CLK_H = 78, NOTE_Y = CLK_Y + CLK_H, NOTE_H = 96, ZOOM_Y = NOTE_Y + NOTE_H, ZOOM_H = 60, H = ZOOM_Y + ZOOM_H + 4;
const COL = { amp: 'hsl(35 85% 52%)', pit: 'hsl(200 70% 50%)', noi: 'hsl(145 55% 42%)', clk: 'hsl(300 50% 55%)' };

export function createDrumView({ doc = document, getParam, getClickSample = () => null }) {
  const canvas = doc.createElement('canvas');
  canvas.width = W; canvas.height = H; canvas.className = 'drumview';
  const ctx = canvas.getContext('2d');
  const pw = W - PL - PR;

  const values = () => ({ ...Object.fromEntries(['startPitch', 'endPitch', 'pitchMul', 'keytrack', 'root', 'patk', 'pdec', 'psus', 'prel', 'body', 'attack', 'decay', 'sustain', 'release', 'drive', 'noise', 'noiseType', 'noiseTone', 'natk', 'ndec', 'nsus', 'nrel', 'click', 'clickMode', 'clickLen', 'clickTone', 'clickSample', 'clickTail', 'vel', 'level'].map(k => [k, getParam(k)])) });
  const hz = v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  const frame = (ink, x, y, w, h, title, right = '') => {
    ctx.globalAlpha = 0.1; ctx.fillStyle = ink; ctx.fillRect(x, y + h - 1, w, 1);
    ctx.globalAlpha = 0.75; ctx.fillStyle = ink; ctx.fillText(title, 6, y + 4);
    if (right) { ctx.textAlign = 'right'; ctx.fillText(right, W - PR, y + 4); ctx.textAlign = 'left'; }
    ctx.globalAlpha = 1;
  };
  // a waveform as a min and max for each pixel column, about the middle of its box
  const wave = (data, x, y, w, h, colour, scale = 1, from = 0, to = data.length) => {
    const mid = y + h / 2, amp = h / 2 - 2;
    ctx.globalAlpha = 0.25; ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x, Math.round(mid), w, 1); ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    for (let px = 0; px < w; px++) {
      const a = from + Math.floor(px * (to - from) / w), b = Math.max(a + 1, from + Math.floor((px + 1) * (to - from) / w));
      let lo = 0, hi = 0;
      for (let i = a; i < b && i < data.length; i++) { const v = data[i] * scale; if (v < lo) lo = v; if (v > hi) hi = v; }
      const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
      ctx.fillRect(x + px, y0, 1, Math.max(1, y1 - y0));
    }
  };
  const axis = (ink, x, y, w, ms, base) => {   // millisecond marks along the bottom of a panel
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], step = nice.find(s => ms / s <= 6) ?? 1000;
    ctx.globalAlpha = 0.5; ctx.fillStyle = ink;
    for (let t = 0; t <= ms; t += step) { const px = Math.round(x + (t / ms) * w) + 0.5; ctx.fillRect(px, base - 3, 1, 3); ctx.fillText(`${t}`, px - 4, base - 12); }
    ctx.globalAlpha = 1;
  };

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const v = values(), sample = getClickSample();
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineWidth = 1; ctx.fillStyle = ink; ctx.strokeStyle = ink;

    // ---- the envelopes: one time axis for the three, long enough for the slowest to fade
    const holdSome = v.sustain > 0.02 || v.psus > 0.02 || v.nsus > 0.02;
    const span = Math.min(2500, Math.max(60, Math.max(v.attack + v.decay * 0.9 + (holdSome ? 0 : 0), v.patk + v.pdec * 0.9, v.natk + v.ndec * 0.9, 1) * 1.15 + (holdSome ? 80 : 0) + (holdSome ? Math.max(v.release, v.prel, v.nrel) * 0.6 : 0)));
    const hold = holdSome ? Math.round(span * 0.55) : 100000, total = Math.round(span);
    const amp = envCurve(v.attack, v.decay, v.sustain, v.release, hold, total), pit = envCurve(v.patk, v.pdec, v.psus, v.prel, hold, total), noi = envCurve(v.natk, v.ndec, v.nsus, v.nrel, hold, total);
    frame(ink, 0, ENV_Y, W, ENV_H, 'envelopes', `${hz(v.startPitch * v.pitchMul)} → ${hz(v.endPitch * v.pitchMul)} Hz`);
    const ex = PL, ey = ENV_Y + 18, eh = ENV_H - 36;
    const line = (arr, colour, f = x => x, w = 1.6, dash = false) => {
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.setLineDash(dash ? [3, 3] : []);
      for (let i = 0; i < arr.length; i++) { const X = ex + (i / (arr.length - 1)) * pw, Y = ey + eh - f(arr[i]) * eh; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.globalAlpha = 0.18; ctx.fillStyle = ink; ctx.fillRect(ex, ey, pw, 1); ctx.fillRect(ex, ey + eh, pw, 1); ctx.globalAlpha = 1;
    line(amp, COL.amp, x => x * v.body, 2); line(noi, COL.noi, x => x * v.noise, 1.6);
    // the pitch envelope is drawn as the pitch it makes, on a log axis between the lowest and highest pitch it reaches
    const lo = Math.min(v.startPitch, v.endPitch), hi = Math.max(v.startPitch, v.endPitch), lg = Math.log(Math.max(hi / lo, 1.01));
    line(pit, COL.pit, x => { const f = v.endPitch + (v.startPitch - v.endPitch) * x; return Math.log(f / lo) / lg; }, 1.8, true);
    axis(ink, ex, ey, pw, span, ENV_Y + ENV_H);
    ctx.globalAlpha = 0.9; let lx = 82; const legend = [['volume', COL.amp], ['pitch', COL.pit], ['noise', COL.noi]];
    for (const [t, c] of legend) { ctx.fillStyle = c; ctx.fillRect(lx, ENV_Y + 5, 8, 3); ctx.fillStyle = ink; ctx.fillText(t, lx + 11, ENV_Y + 2); lx += 11 + t.length * 6 + 8; }
    ctx.globalAlpha = 1;

    // ---- the click on its own
    const cms = Math.min(150, Math.max(2, v.clickLen * 1.4));
    const click = renderPreview({ ...v, body: 0, noise: 0, drive: 0, level: 1, vel: 0, click: 1 }, { sample, ms: cms, sr: SR });
    const sampleMode = v.clickMode >= 1;
    frame(ink, 0, CLK_Y, W, CLK_H, 'click', sampleMode ? (sample ? `sample · ${v.clickLen.toFixed(1)} ms · tail ${v.clickTail.toFixed(1)} ms` : 'sample: none picked') : `synthesized · ${hz(v.clickTone)} Hz · ${v.clickLen.toFixed(1)} ms`);
    const cx0 = PL, cy0 = CLK_Y + 16, ch = CLK_H - 30;
    if (sampleMode && sample) {   // the faded stretch at the end of the click
      const len = Math.min(v.clickLen, sample.data.length / sample.rate * 1000), tail = Math.min(v.clickTail, len);
      if (tail > 0) { ctx.globalAlpha = 0.13; ctx.fillStyle = COL.clk; ctx.fillRect(cx0 + ((len - tail) / cms) * pw, cy0, (tail / cms) * pw, ch); ctx.globalAlpha = 1; }
    }
    ctx.strokeStyle = ink; wave(click, cx0, cy0, pw, ch, COL.clk, v.click > 0 ? 1 : 1);
    if (!(v.click > 0)) { ctx.globalAlpha = 0.6; ctx.fillStyle = ink; ctx.fillText('click amount is 0', cx0 + 6, cy0 + 4); ctx.globalAlpha = 1; }
    axis(ink, cx0, cy0, pw, cms, CLK_Y + CLK_H);

    // ---- the root note, whole and the first 25 ms
    const noteMs = Math.min(1600, Math.max(80, Math.max(v.attack + v.decay * 0.85, v.natk + v.ndec * 0.85 * (v.noise > 0.02 ? 1 : 0), v.release * (holdSome ? 0.5 : 0)) * 1.1 + (holdSome ? 120 : 0)));
    const hit = renderPreview(v, { sample, ms: noteMs, sr: SR, note: v.root, offAt: holdSome ? noteMs * 0.6 : null });
    let pk = 0; for (const x of hit) pk = Math.max(pk, Math.abs(x));
    frame(ink, 0, NOTE_Y, W, NOTE_H, 'root note, composed', `peak ${pk.toFixed(2)} · ${NOISE_TYPES[Math.round(v.noiseType)] ?? ''} noise`);
    const ny = NOTE_Y + 16, nh = NOTE_H - 30;
    ctx.strokeStyle = ink; wave(hit, PL, ny, pw, nh, ink);
    axis(ink, PL, ny, pw, noteMs, NOTE_Y + NOTE_H);
    const zoomMs = Math.min(25, noteMs), zi = Math.floor(SR * zoomMs / 1000);
    frame(ink, 0, ZOOM_Y, W, ZOOM_H, `first ${Math.round(zoomMs)} ms`);
    ctx.strokeStyle = ink; wave(hit, PL, ZOOM_Y + 14, pw, ZOOM_H - 16, ink, 1, 0, zi);
    if (v.click > 0 && click.length) {   // where the click is within the enlarged start
      const ce = Math.min(v.clickLen, zoomMs); ctx.globalAlpha = 0.12; ctx.fillStyle = COL.clk; ctx.fillRect(PL, ZOOM_Y + 14, (ce / zoomMs) * pw, ZOOM_H - 16); ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  };

  draw();
  return { el: canvas, refresh: draw };
}
