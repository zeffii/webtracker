// The meter band: a strip along the bottom of the window with a spectrum, level and loudness meters, a correlation bar, the
// stereo width of the spectral panner's ten bands and a spectrogram. It reads the ring of output samples once per frame and
// does nothing while hidden. Which panels show, and how tall the band is, come from `options()`.
import { RING, ringReader } from '../audio/vring.js';
import { BANDS, SPEC_N, WIDTH_BANDS, createAnalyser, createCorrelation, createLoudness } from './meterdsp.js';

const TXT = '#6d7480', GRID = 'rgba(255,255,255,.07)', BRIGHT = '#cfd3da';
const FONT = (px, w = 400) => `${w} ${px}px ui-monospace, Consolas, monospace`;

export function createMeters({ box, sab, sampleRate, options }) {
  const reader = ringReader(sab, 1), buf = new Float32Array(RING * 2);
  const mono = { l: new Float32Array(SPEC_N), r: new Float32Array(SPEC_N) };   // the newest SPEC_N frames
  const lBlock = new Float32Array(RING), rBlock = new Float32Array(RING);
  let raf = 0, open = false, fs = 44100, panels = [], signature = '', analyser, loud, corr;
  const state = { l: 0, r: 0, pl: 0, pr: 0, hl: 0, hr: 0, spec: new Float32Array(BANDS).fill(-120), peak: new Float32Array(BANDS).fill(-120), width: new Float32Array(WIDTH_BANDS), hist: [], last: 0 };

  const KINDS = {
    spectrum: ['SPECTRUM', 3], level: ['LEVEL', 1.35], corr: ['CORRELATION', 0.9], width: ['STEREO WIDTH BY BAND', 1.5], sgram: ['SPECTROGRAM', 2.4],
  };
  function build() {
    const o = options(), kinds = ['sgram', 'spectrum', 'width', 'level', 'corr'].filter(k => o[k]);
    const sig = kinds.join();
    if (sig === signature) return;
    signature = sig; box.textContent = ''; panels = [];
    for (const k of kinds) {
      const d = document.createElement('div'), h = document.createElement('h6'), c = document.createElement('canvas');
      d.className = 'meter-pan'; d.style.flex = `${KINDS[k][1]} 1 0`; h.textContent = KINDS[k][0]; d.append(h, c); box.append(d);
      panels.push({ kind: k, canvas: c });
    }
  }
  function ctxOf(c) {
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return [g, w, h];
  }

  const draw = {
    spectrum(c) {
      const [g, w, h] = ctxOf(c), T = 18, B = 16, H = h - T - B, X0 = 26;
      g.font = FONT(9); g.fillStyle = TXT; g.strokeStyle = GRID; g.lineWidth = 1;
      const Y = v => T + H * (1 - Math.max(0, Math.min(1, (v + 80) / 80)));
      for (const d of [-60, -40, -20, 0]) { g.beginPath(); g.moveTo(X0, Y(d)); g.lineTo(w - 4, Y(d)); g.stroke(); g.fillText(d, 2, Y(d) + 3); }
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = X0 + Math.log(f / 20) / Math.log(1000) * (w - X0 - 4); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + H); g.stroke(); g.fillText(f >= 1000 ? `${f / 1000}k` : f, x - 8, h - 4); }
      const X = i => X0 + i / (BANDS - 1) * (w - X0 - 4), gr = g.createLinearGradient(0, T, 0, T + H);
      gr.addColorStop(0, 'rgba(120,255,170,.55)'); gr.addColorStop(1, 'rgba(120,255,170,.02)');
      g.beginPath(); g.moveTo(X(0), T + H); for (let i = 0; i < BANDS; i++) g.lineTo(X(i), Y(state.spec[i])); g.lineTo(X(BANDS - 1), T + H); g.fillStyle = gr; g.fill();
      g.beginPath(); for (let i = 0; i < BANDS; i++) i ? g.lineTo(X(i), Y(state.spec[i])) : g.moveTo(X(i), Y(state.spec[i])); g.strokeStyle = '#78ffaa'; g.lineWidth = 1.4; g.stroke();
      g.beginPath(); for (let i = 0; i < BANDS; i++) i ? g.lineTo(X(i), Y(state.peak[i])) : g.moveTo(X(i), Y(state.peak[i])); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.stroke();
    },
    level(c) {
      const [g, w, h] = ctxOf(c), T = 18, B = 16, H = h - T - B, bw = Math.min(26, w * .16), x0 = Math.max(8, w * .08), x1 = x0 + bw + 8;
      const pos = d => Math.max(0, Math.min(1, (d + 60) / 60)), dbOf = v => 20 * Math.log10(Math.max(1e-4, v));
      g.font = FONT(9);
      const gr = g.createLinearGradient(0, T, 0, T + H); gr.addColorStop(0, '#ff5a4d'); gr.addColorStop(.15, '#ffb347'); gr.addColorStop(.5, '#78ffaa'); gr.addColorStop(1, '#2f9e68');
      [[state.l, state.pl, x0, 'L'], [state.r, state.pr, x1, 'R']].forEach(([v, pk, x, n]) => {
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, T, bw, H);
        g.fillStyle = gr; const top = T + H * (1 - pos(dbOf(v))); g.fillRect(x, top, bw, T + H - top);
        g.fillStyle = '#fff'; g.fillRect(x, T + H * (1 - pos(dbOf(pk))), bw, 2);
        g.fillStyle = TXT; g.fillText(n, x + bw / 2 - 3, h - 4);
      });
      g.fillStyle = TXT; for (const d of [-48, -24, -12, -6, 0]) g.fillText(d, x1 + bw + 6, T + H * (1 - pos(d)) + 3);
      const x = Math.max(w * .62, x1 + bw + 34), fmt = v => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
      const row = (v, label, y, big) => { g.fillStyle = BRIGHT; g.font = FONT(big ? 15 : 12, 600); g.fillText(fmt(v), x, y); g.font = FONT(9); g.fillStyle = TXT; g.fillText(label, x, y + 11); };
      row(loud.short(), 'LUFS short', T + 14, true); row(loud.momentary(), 'LUFS momentary', T + 46); row(dbOf(Math.max(state.hl, state.hr)), 'peak dB', T + 78);
    },
    corr(c) {
      const [g, w, h] = ctxOf(c), y = h * .5, x0 = 14, x1 = w - 14, mid = (x0 + x1) / 2, v = corr.value(), cx = x0 + (v + 1) / 2 * (x1 - x0);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x0, y - 7, x1 - x0, 14);
      const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, '#ff5a4d'); gr.addColorStop(.5, '#ffb347'); gr.addColorStop(1, '#78ffaa');
      g.fillStyle = gr; g.globalAlpha = .85; g.fillRect(Math.min(mid, cx), y - 7, Math.abs(cx - mid), 14); g.globalAlpha = 1;
      g.fillStyle = '#fff'; g.fillRect(cx - 1, y - 10, 2, 20);
      g.fillStyle = TXT; g.font = FONT(9); g.fillText('-1', x0 - 2, y + 22); g.fillText('0', mid - 3, y + 22); g.fillText('+1', x1 - 10, y + 22);
      g.fillStyle = BRIGHT; g.font = FONT(13, 600); g.fillText(v.toFixed(2), mid - 14, y - 16);
    },
    width(c) {
      const [g, w, h] = ctxOf(c), T = 18, B = 16, H = h - T - B, bw = (w - 20) / WIDTH_BANDS;
      for (let b = 0; b < WIDTH_BANDS; b++) {
        const x = 10 + b * bw, v = Math.min(1, state.width[b] * 2);   // side share 0.5 (all side) reads full
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 3, T, bw - 6, H);
        g.fillStyle = `hsl(${200 + v * 120},80%,${55 + v * 10}%)`; g.fillRect(x + 3, T + H - v * H, bw - 6, v * H);
      }
      g.fillStyle = TXT; g.font = FONT(9); g.fillText('mono', 10, h - 4); g.fillText('wide', w - 30, h - 4); g.fillText('low → high', w / 2 - 26, h - 4);
    },
    sgram(c) {
      const [g, w, h] = ctxOf(c), n = state.hist.length, cw = Math.max(1, w / 400);
      for (let k = 0; k < n; k++) {
        const s = state.hist[k], x = w - (n - k) * cw;
        for (let i = 0; i < BANDS; i++) {
          const v = Math.max(0, Math.min(1, (s[i] + 75) / 65));
          g.fillStyle = `hsl(${260 - v * 230},${60 + v * 40}%,${6 + v * 58}%)`; g.fillRect(x, h - i / (BANDS - 1) * (h - 6) - 3, cw + .6, (h - 6) / BANDS + 1);
        }
      }
    },
  };

  function frame(now) {
    if (!open) return;
    build();
    const n = reader.read(buf), dt = Math.min(.1, (now - (state.last || now)) / 1000); state.last = now;
    if (n > 0) {
      for (let i = 0; i < n; i++) { lBlock[i] = buf[i * 2]; rBlock[i] = buf[i * 2 + 1]; }
      loud.push(lBlock, rBlock, n); corr.push(lBlock, rBlock, n);
      let pl = 0, pr = 0;
      for (let i = 0; i < n; i++) { pl = Math.max(pl, Math.abs(lBlock[i])); pr = Math.max(pr, Math.abs(rBlock[i])); }
      const fall = Math.pow(10, -dt * 24 / 20), hold = Math.pow(10, -dt * 8 / 20);   // 24 dB/s on the bars, slower on the peak marks
      state.l = Math.max(pl, state.l * fall); state.r = Math.max(pr, state.r * fall);
      state.pl = Math.max(pl, state.pl * hold); state.pr = Math.max(pr, state.pr * hold);
      state.hl = Math.max(pl, state.hl * hold * .995); state.hr = Math.max(pr, state.hr * hold * .995);
      // keep the newest SPEC_N frames
      const keep = Math.min(n, SPEC_N);
      mono.l.copyWithin(0, keep); mono.r.copyWithin(0, keep);
      mono.l.set(lBlock.subarray(n - keep, n), SPEC_N - keep); mono.r.set(rBlock.subarray(n - keep, n), SPEC_N - keep);
    }
    if (panels.some(p => p.kind === 'spectrum' || p.kind === 'width' || p.kind === 'sgram')) {
      analyser.run(mono.l, mono.r);
      for (let i = 0; i < BANDS; i++) {
        const v = analyser.db[i];
        state.spec[i] += (v - state.spec[i]) * (v > state.spec[i] ? .6 : .14);
        state.peak[i] = Math.max(state.peak[i] - dt * 14, state.spec[i]);
      }
      for (let b = 0; b < WIDTH_BANDS; b++) state.width[b] += (analyser.width[b] - state.width[b]) * .15;
      if (panels.some(p => p.kind === 'sgram')) { state.hist.push(Float32Array.from(state.spec)); if (state.hist.length > 400) state.hist.shift(); }
    }
    for (const p of panels) draw[p.kind](p.canvas);
    raf = requestAnimationFrame(frame);
  }

  return {
    get open() { return open; },
    show() {
      if (open) return;
      fs = sampleRate(); analyser = createAnalyser(fs); loud = createLoudness(fs); corr = createCorrelation(fs);
      mono.l.fill(0); mono.r.fill(0); state.hist.length = 0; state.last = 0; signature = '';
      open = true; box.hidden = false; reader.enable(true); raf = requestAnimationFrame(frame);
    },
    hide() { open = false; box.hidden = true; reader.enable(false); cancelAnimationFrame(raf); },
    rebuild() { signature = ''; },
  };
}
