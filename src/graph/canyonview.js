import { LINES, repeats, lineCutoff } from '../audio/nodes/canyon.js';

// The Prisma Canyon view: time runs left to right, in ticks (the song's own, drawn as a ruler along the bottom with the beats
// stronger), and each of the four delay lines has a row of its own. A bar is an echo: where it stands is when it is heard, how
// tall and how bright it is says how loud, so the echoes of the far lines and the later repeats fade into the dark. Each line
// has its own hue, a small pan marker (left or right) and the cutoff its darkening leaves it. It only shows; the sliders move it.
const W = 360, PL = 30, PR = 36, PT = 20, ROW = 30, RULER = 24, REPEATS = 8;
const H = PT + ROW * LINES + RULER;
const HUES = [196, 262, 322, 28];   // cyan, violet, magenta, amber: each line its own, and each paler than the one before

export function createCanyonView({ doc = document, getParam, getTiming = () => null }) {
  const canvas = doc.createElement('canvas');
  canvas.width = W; canvas.height = H; canvas.className = 'canyon';
  const ctx = canvas.getContext('2d');
  const pw = W - PL - PR;

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const time = getParam('time'), intensity = getParam('intensity'), cutoff = getParam('cutoff');
    const levels = Array.from({ length: LINES }, (_, k) => getParam(`level${k + 1}`)), pans = Array.from({ length: LINES }, (_, k) => getParam(`pan${k + 1}`)), damps = Array.from({ length: LINES }, (_, k) => getParam(`damp${k + 1}`));
    const r = repeats({ levels, intensity }, REPEATS + LINES), span = (REPEATS + 0.6) * time, xOf = ms => PL + (ms / span) * pw;
    const timing = getTiming(), tickMs = timing?.tickMs;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.lineWidth = 1;
    ctx.fillStyle = ink; ctx.strokeStyle = ink;
    // the ruler: a mark for every tick while they are far enough apart, else for every beat, and a number on the beats
    const base = PT + ROW * LINES;
    if (tickMs) {
      const ticks = span / tickMs, perBeat = timing.perBeat || 4;
      const step = pw / ticks >= 5 ? 1 : pw / (ticks / perBeat) >= 5 ? perBeat : perBeat * 4;
      let lastLabel = -1e9;
      for (let t = 0; t <= ticks; t += step) {
        const x = Math.round(xOf(t * tickMs)) + 0.5, beat = t % perBeat === 0;
        ctx.globalAlpha = beat ? 0.5 : 0.22; ctx.beginPath(); ctx.moveTo(x, beat ? base : base + 3); ctx.lineTo(x, base + (beat ? 10 : 7)); ctx.stroke();
        ctx.globalAlpha = beat ? 0.1 : 0.04; ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, base); ctx.stroke();
        if (beat && x - lastLabel > 22) { ctx.globalAlpha = 0.6; ctx.fillText(String(t), x - 3, base + 12); lastLabel = x; }
      }
      ctx.globalAlpha = 0.6; ctx.fillText('ticks', W - PR + 4, base + 12);
    } else {
      for (let m = 0; m <= REPEATS; m++) { const x = Math.round(xOf(m * time)) + 0.5; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base + 6); ctx.stroke(); ctx.globalAlpha = 0.6; ctx.fillText(`${Math.round(m * time)}`, x - 8, base + 10); }
      ctx.fillText('ms', W - PR + 4, base + 10);
    }
    ctx.globalAlpha = 0.7; ctx.fillText(tickMs ? `${time.toFixed(0)} ms · ${(time / tickMs).toFixed(2)} ticks` : `${time.toFixed(0)} ms`, PL, 3);
    // the dry sound, at the start
    const x0 = Math.round(xOf(0)) + 0.5;
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x0, PT - 2); ctx.lineTo(x0, base); ctx.stroke();
    // a row per line
    for (let k = 1; k <= LINES; k++) {
      const top = PT + (k - 1) * ROW, floor = top + ROW - 4, hue = HUES[k - 1], paler = 1 - 0.14 * (k - 1);
      ctx.globalAlpha = 0.07; ctx.fillRect(PL, floor, pw, 1);
      ctx.globalAlpha = 0.65; ctx.fillStyle = ink;
      ctx.fillText(`${k}`, 8, top + 8);
      for (let m = k; m <= REPEATS + k; m++) {
        const amp = levels[k - 1] * r[m - k];
        if (amp <= 1e-4) continue;
        const db = 20 * Math.log10(amp), v = Math.max(0, Math.min(1, (db + 54) / 54)), x = xOf(m * time * 1);
        if (x > W - PR + 2) break;
        const xx = xOf(m * time);
        ctx.globalAlpha = 1;
        ctx.fillStyle = `hsla(${hue},${70 + 20 * v}%,${38 + 28 * v}%,${(0.1 + 0.9 * v) * paler})`;
        ctx.fillRect(Math.round(xx) - 1, floor - (ROW - 8) * v, 3, (ROW - 8) * v + 1);
        ctx.fillRect(Math.round(xx) - 3, floor - 1, 7, 2);
      }
      // the pan: a short track at the right, the dot left or right of its middle, and the cutoff the line is left with
      const px = W - PR + 14, pc = px + pans[k - 1] * 9;
      ctx.globalAlpha = 0.3; ctx.fillStyle = ink; ctx.fillRect(px - 10, top + 9, 20, 1);
      ctx.globalAlpha = 0.9; ctx.fillStyle = `hsl(${hue},75%,60%)`; ctx.beginPath(); ctx.arc(pc, top + 9.5, 3, 0, Math.PI * 2); ctx.fill();
      const hz = lineCutoff(cutoff, damps[k - 1]);
      ctx.globalAlpha = 0.55; ctx.fillStyle = ink; ctx.fillText(hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`, px - 11, top + 15);
    }
    ctx.globalAlpha = 1;
  };

  draw();
  return { el: canvas, refresh: draw };
}
