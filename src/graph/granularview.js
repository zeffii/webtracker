import { grainWindow } from '../audio/nodes/granular.js';
import { sharpCanvas } from './sharp.js';

// The picture of the granular synth, drawn from its parameters (the sliders move it). Three parts on one canvas:
//   sample   the sample the grains are cut from, with `position` marked, the band `spray` scatters the grains over, and an arrow for
//            where `scan` takes the position in one second
//   grains   a stretch of time with the grains that start in it: the shape of each (its `size`, and how much of it fades in and out),
//            how often they start (`density`), and how many are sounding at once
//   cloud    each line is one thing the grains are given: pitch (tune and the random cents), the chance of playing backwards, and how
//            wide they are spread over the stereo field
const W = 360, H = 252, PL = 8, PR = 8, SAMPLE_Y = 18, SAMPLE_H = 64, GRAIN_Y = 122, GRAIN_H = 62, CLOUD_Y = 208;
const ACCENT = 'hsl(205 70% 52%)', WARM = 'hsl(35 85% 52%)';

export function createGranularView({ doc = document, getParam, getSample = () => null }) {
  const canvas = sharpCanvas(doc, W, H, 'drumview');
  const ctx = canvas.getContext('2d');
  const pw = W - PL - PR;
  const v = name => getParam(name);

  const label = (ink, text, x, y, right = false) => { ctx.fillStyle = ink; ctx.globalAlpha = 0.75; ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(text, x, y); ctx.globalAlpha = 1; ctx.textAlign = 'left'; };

  function drawSample(ink, sample) {
    const x0 = PL, y0 = SAMPLE_Y, h = SAMPLE_H, mid = y0 + h / 2;
    const pos = v('position'), spray = v('spray'), scan = v('scan');
    label(ink, 'sample', PL, 3);
    label(ink, `position ${Math.round(pos * 100)}% ± ${Math.round(spray * 100)}%${scan ? ` · scan ${scan > 0 ? '+' : ''}${scan.toFixed(2)}/s` : ''}`, W - PR, 3, true);
    // the band the grains start in (it wraps round the ends of the sample)
    ctx.fillStyle = ACCENT; ctx.globalAlpha = 0.16;
    const lo = pos - spray, hi = pos + spray;
    const band = (a, b) => ctx.fillRect(x0 + Math.max(0, a) * pw, y0, Math.max(1, (Math.min(1, b) - Math.max(0, a)) * pw), h);
    band(lo, hi); if (lo < 0) band(1 + lo, 1); if (hi > 1) band(0, hi - 1);
    ctx.globalAlpha = 0.25; ctx.fillStyle = ink; ctx.fillRect(x0, Math.round(mid), pw, 1);
    // the waveform
    ctx.globalAlpha = 0.8;
    if (sample?.data?.length) {
      const d = sample.data, amp = h / 2 - 2;
      for (let px = 0; px < pw; px++) {
        const a = Math.floor(px * d.length / pw), b = Math.max(a + 1, Math.floor((px + 1) * d.length / pw));
        let mn = 0, mx = 0;
        for (let i = a; i < b; i += Math.max(1, ((b - a) / 24) | 0)) { const s = d[i]; if (s < mn) mn = s; if (s > mx) mx = s; }
        ctx.fillRect(x0 + px, mid - Math.min(1, mx) * amp, 1, Math.max(1, (Math.min(1, mx) - Math.max(-1, mn)) * amp));
      }
    } else label(ink, 'no sample: add one to the node', W / 2, mid - 5);
    ctx.globalAlpha = 1;
    // the position, and where scan takes it in a second
    const px = x0 + pos * pw;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px + 0.5, y0); ctx.lineTo(px + 0.5, y0 + h); ctx.stroke();
    if (Math.abs(scan) > 0.005) {
      const to = x0 + Math.max(0, Math.min(1, pos + scan)) * pw, dir = Math.sign(to - px) || 1, ay = y0 + h + 7;
      ctx.strokeStyle = WARM; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, ay); ctx.lineTo(to, ay); ctx.moveTo(to - dir * 4, ay - 3); ctx.lineTo(to, ay); ctx.lineTo(to - dir * 4, ay + 3); ctx.stroke();
    }
  }

  function drawGrains(ink) {
    const size = v('size'), density = v('density'), shape = v('shape');
    const overlap = density * size / 1000;
    label(ink, 'grains', PL, GRAIN_Y - 14);
    label(ink, `${Math.round(size)} ms · ${Math.round(density)}/s · about ${overlap < 10 ? overlap.toFixed(1) : Math.round(overlap)} at once`, W - PR, GRAIN_Y - 14, true);
    const span = Math.max(Math.min(1000, size * 3), 200), msPx = pw / span;   // the stretch of time drawn, in ms
    const base = GRAIN_Y + GRAIN_H, top = GRAIN_Y + 2;
    ctx.fillStyle = ink; ctx.globalAlpha = 0.2; ctx.fillRect(PL, base, pw, 1);
    // grains start every 1/density s, each a little early or late (a fixed jitter, so the picture holds still)
    const every = 1000 / density;
    let seed = 7;
    const jitter = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5; };
    const startsAt = [];
    for (let t = 0; t < span && startsAt.length < 400; t += every) startsAt.push(t + jitter() * every * 0.6);
    for (const [i, t0] of startsAt.entries()) {
      const rowH = (GRAIN_H - 6) * (0.55 + 0.45 * ((i * 0.618) % 1));   // a little different in height, so overlapping grains can be told apart
      const x0 = PL + t0 * msPx, w = size * msPx;
      if (x0 + w < PL || x0 > PL + pw) continue;
      ctx.beginPath();
      for (let k = 0; k <= 32; k++) {
        const x = x0 + (k / 32) * w, y = base - grainWindow(k / 32, shape) * rowH;
        k ? ctx.lineTo(Math.min(PL + pw, Math.max(PL, x)), y) : ctx.moveTo(Math.max(PL, x), y);
      }
      ctx.strokeStyle = i % 2 ? ACCENT : WARM; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.globalAlpha = 0.5; ctx.fillStyle = ink;
    for (const ms of [0, Math.round(span / 2), Math.round(span)]) ctx.fillText(`${ms}`, PL + Math.min(pw - 14, ms * msPx), base + 3);
    ctx.globalAlpha = 1;
  }

  // one line of the cloud: a name, a thin track and a dot (or a stretch) on it
  function track(ink, name, y, text, from, to) {
    ctx.fillStyle = ink; ctx.globalAlpha = 0.75; ctx.fillText(name, PL, y);
    const x0 = PL + 54, w = 150;
    ctx.globalAlpha = 0.25; ctx.fillRect(x0, y + 5, w, 1);
    ctx.globalAlpha = 1; ctx.fillStyle = ACCENT; ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    if (to - from > 0.01) { ctx.beginPath(); ctx.moveTo(x0 + from * w, y + 5.5); ctx.lineTo(x0 + to * w, y + 5.5); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x0 + ((from + to) / 2) * w, y + 5.5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.globalAlpha = 0.75; ctx.fillText(text, x0 + w + 10, y);
    ctx.globalAlpha = 1;
  }

  function drawCloud(ink) {
    const tune = v('tune'), rand = v('pitchRand') / 100, rev = v('reverse'), spread = v('spread');
    const semi = s => (Math.max(-24, Math.min(24, s)) + 24) / 48;   // a track from -24 to +24 semitones
    track(ink, 'pitch', CLOUD_Y, `${tune > 0 ? '+' : ''}${tune.toFixed(1)} st${rand ? ` ± ${v('pitchRand').toFixed(0)} ct` : ''}`, semi(tune - rand), semi(tune + rand));
    track(ink, 'reverse', CLOUD_Y + 14, `${Math.round(rev * 100)}% backwards`, 0, rev);
    track(ink, 'spread', CLOUD_Y + 28, spread < 0.01 ? 'centre' : `${Math.round(spread * 100)}% of the width`, 0.5 - spread / 2, 0.5 + spread / 2);
  }

  function draw() {
    const ink = (typeof getComputedStyle === 'function' && getComputedStyle(canvas).color) || '#888';   // (empty until the canvas is on the page)
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.lineWidth = 1; ctx.fillStyle = ink; ctx.strokeStyle = ink;
    drawSample(ink, getSample());
    drawGrains(ink);
    drawCloud(ink);
  }

  draw();
  Promise.resolve().then(draw);   // again once it has been put on the page, where its colour is known
  return { el: canvas, refresh: draw };
}
