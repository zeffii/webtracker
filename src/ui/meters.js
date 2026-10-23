// The meter band: a strip along the bottom of the window with a spectrum, level and loudness meters, a correlation bar, the
// stereo width of the spectral panner's ten bands, a spectrogram and a vectorscope (a square the height of the band). It reads the ring of output samples once per frame and
// does nothing while hidden. Which panels show, and how tall the band is, come from `options()`.
import { RING, ringReader, laneReader, LANE_SLOTS } from '../audio/vring.js';
import { BANDS, SPEC_N, WIDTH_BANDS, createAnalyser, createCorrelation, createLoudness } from './meterdsp.js';

const TXT = '#6d7480', GRID = 'rgba(255,255,255,.07)', BRIGHT = '#cfd3da';
const FONT = (px, w = 400) => `${w} ${px}px ui-monospace, Consolas, monospace`;

export function createMeters({ box, transport, sab, lsab, sampleRate, options, lanes = () => [], setTaps = () => {} }) {
  const reader = ringReader(sab, 1), buf = new Float32Array(RING * 2);
  const mono = { l: new Float32Array(SPEC_N), r: new Float32Array(SPEC_N) };   // the newest SPEC_N frames
  const lBlock = new Float32Array(RING), rBlock = new Float32Array(RING);
  const lreader = laneReader(lsab), LKEY = 'webtracker.layers.off';
  let layers = [], layerSig = '', off = new Set(), lbox = null;   // layers: [{ idx, instrument, slot, hue, l (newest SPEC_N frames), spec }]
  try { off = new Set(JSON.parse(localStorage.getItem(LKEY)) ?? []); } catch { /* none kept */ }
  const saveOff = () => { try { localStorage.setItem(LKEY, JSON.stringify([...off])); } catch { /* not kept */ } };
  const lbuf = new Float32Array(RING);
  const layersOn = () => options().layers && options().spectrum;
  const pushMask = () => { let m = 0; if (open && layersOn()) for (const L of layers) if (!off.has(L.idx)) m |= 1 << L.slot; lreader.mask(m); };
  // The layer for each instrument that makes sound in a lane (not the master lane), numbered as the lanes are.
  function syncLayers() {
    const list = lanes(), seen = new Set(), next = [];
    list.forEach((lane, idx) => { if (idx === 0 || seen.has(lane.instrument) || next.length >= LANE_SLOTS) return; seen.add(lane.instrument); next.push({ idx, instrument: lane.instrument }); });
    const sig = next.map(x => `${x.idx}:${x.instrument}`).join();
    if (sig === layerSig) return false;
    layerSig = sig;
    layers = next.map((x, slot) => ({ ...x, slot, hue: (x.idx * 137.508 + 20) % 360, l: new Float32Array(SPEC_N), spec: new Float32Array(BANDS).fill(-120) }));
    setTaps(layers.map(x => x.instrument));
    return true;
  }
  function buildButtons(host) {
    lbox?.remove(); lbox = null;
    if (!layersOn()) return;
    lbox = document.createElement('div'); lbox.className = 'layer-btns';
    const refresh = () => { for (const c of lbox.children) if (!c.classList.contains('all')) c.setAttribute('aria-pressed', String(!off.has(+c.textContent))); };
    const all = document.createElement('button'); all.type = 'button'; all.className = 'all'; all.textContent = 'all'; all.title = 'Show every layer; when every layer is shown, hide them all';
    all.addEventListener('click', () => { off = off.size ? new Set() : new Set(layers.map(x => x.idx)); saveOff(); refresh(); pushMask(); });
    lbox.append(all);
    for (const L of layers) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = L.idx; b.title = `Lane ${L.idx}: ${L.instrument} (click to show or hide; Shift+click to hear only this one)`;
      b.style.setProperty('--h', L.hue); b.setAttribute('aria-pressed', String(!off.has(L.idx)));
      b.addEventListener('click', e => {
        if (e.shiftKey) { const only = layers.every(x => x === L || off.has(x.idx)) && !off.has(L.idx); off = new Set(only ? [] : layers.filter(x => x !== L).map(x => x.idx)); }
        else if (off.has(L.idx)) off.delete(L.idx); else off.add(L.idx);
        saveOff(); refresh(); pushMask();
      });
      lbox.append(b);
    }
    host.append(lbox);
  }
  let raf = 0, open = false, fs = 44100, panels = [], signature = '', analyser, loud, corr;
  const lim = { peak: [], red: [], now: 0, max: 0, maxAt: 0, ceil: -0.3 };   // the limiter panel: per frame, the loudest input (dB) and the most it held back (dB)
  const state = { l: 0, r: 0, pl: 0, pr: 0, hl: 0, hr: 0, spec: new Float32Array(BANDS).fill(-120), peak: new Float32Array(BANDS).fill(-120), width: new Float32Array(WIDTH_BANDS), hist: [], last: 0, n: 0 };

  const KINDS = {
    spectrum: ['SPECTRUM', 3], level: ['LEVEL', 1.35], limiter: ['LIMITER', 2], corr: ['CORRELATION', 0.9], width: ['STEREO WIDTH BY BAND', 1.5], sgram: ['SPECTROGRAM', 2.4], vscope: ['XY MASTER', 0],
  };
  function build() {
    const o = options(), kinds = ['sgram', 'spectrum', 'width', 'level', 'limiter', 'corr', 'vscope'].filter(k => o[k]);
    const sig = `${kinds.join()}|${layersOn()}`, changed = syncLayers();
    if (sig === signature && !changed) return;
    signature = sig; box.textContent = ''; panels = []; lbox = null;
    for (const k of kinds) {
      const d = document.createElement('div'), h = document.createElement('h6'), c = document.createElement('canvas');
      d.className = 'meter-pan'; if (k === 'vscope') d.classList.add('square'); else d.style.flex = `${KINDS[k][1]} 1 0`; h.textContent = KINDS[k][0]; d.append(h, c); box.append(d);
      panels.push({ kind: k, canvas: c });
      if (k === 'spectrum') buildButtons(d);
    }
    pushMask();
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
      const X = i => X0 + i / (BANDS - 1) * (w - X0 - 4), stacked = layersOn(), rainbow = !stacked && options().colour !== 'green';
      if (stacked) {   // one translucent layer per instrument, added together where they overlap; the whole mix is a faint outline
        g.globalCompositeOperation = 'lighter';
        for (const L of layers) {
          if (off.has(L.idx)) continue;
          g.beginPath(); g.moveTo(X(0), T + H); for (let i = 0; i < BANDS; i++) g.lineTo(X(i), Y(L.spec[i])); g.lineTo(X(BANDS - 1), T + H);
          g.fillStyle = `hsla(${L.hue},85%,55%,.2)`; g.fill();
          g.beginPath(); for (let i = 0; i < BANDS; i++) i ? g.lineTo(X(i), Y(L.spec[i])) : g.moveTo(X(i), Y(L.spec[i]));
          g.strokeStyle = `hsla(${L.hue},90%,65%,.75)`; g.lineWidth = 1; g.stroke();
        }
        g.globalCompositeOperation = 'source-over';
        g.beginPath(); for (let i = 0; i < BANDS; i++) i ? g.lineTo(X(i), Y(state.spec[i])) : g.moveTo(X(i), Y(state.spec[i])); g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.stroke();
        return;
      }
      let gr;
      if (rainbow) {   // colour by frequency, left to right, like a light spectrum: dark, violet, blue, cyan, green, yellow, orange, red, dark red
        gr = g.createLinearGradient(X0, 0, w - 4, 0);
        [[0, '#14001f'], [.07, '#6a00c8'], [.2, '#1c2cff'], [.34, '#00d5ff'], [.5, '#27e82f'], [.64, '#f2f21a'], [.76, '#ff9a00'], [.88, '#ff2a00'], [1, '#5a0000']].forEach(([o, c]) => gr.addColorStop(o, c));
      } else { gr = g.createLinearGradient(0, T, 0, T + H); gr.addColorStop(0, 'rgba(120,255,170,.55)'); gr.addColorStop(1, 'rgba(120,255,170,.02)'); }
      g.beginPath(); g.moveTo(X(0), T + H); for (let i = 0; i < BANDS; i++) g.lineTo(X(i), Y(state.spec[i])); g.lineTo(X(BANDS - 1), T + H); g.globalAlpha = rainbow ? 0.92 : 1; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
      g.beginPath(); for (let i = 0; i < BANDS; i++) i ? g.lineTo(X(i), Y(state.spec[i])) : g.moveTo(X(i), Y(state.spec[i])); g.strokeStyle = rainbow ? 'rgba(255,255,255,.85)' : '#78ffaa'; g.lineWidth = rainbow ? 1 : 1.4; g.stroke();
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
    limiter(c) {   // the level going in (grey), the level going out (green), the ceiling (dashed), and the reduction hanging from the top
      const [g, w, h] = ctxOf(c), X0 = 28, T = 14, redH = Math.max(18, h * .26), plotT = T + redH + 6, B = 14, H = h - plotT - B, n = lim.peak.length, step = (w - X0 - 6) / 400;
      const lo = -30, hi = 6, Y = d => plotT + H * (1 - Math.max(0, Math.min(1, (d - lo) / (hi - lo))));
      g.font = FONT(9); g.lineWidth = 1;
      for (const d of [-24, -18, -12, -6, 0]) { g.strokeStyle = GRID; g.beginPath(); g.moveTo(X0, Y(d)); g.lineTo(w - 4, Y(d)); g.stroke(); g.fillStyle = TXT; g.fillText(d, 2, Y(d) + 3); }
      const ceil = lim.ceil;
      g.strokeStyle = 'rgba(255,120,100,.8)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X0, Y(ceil)); g.lineTo(w - 4, Y(ceil)); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(X0, T, w - X0 - 4, redH);
      g.fillStyle = TXT; g.fillText('held back', X0 + 4, T + redH - 3);
      const x0 = w - 6 - n * step;
      g.beginPath(); g.moveTo(x0, plotT + H);
      for (let i = 0; i < n; i++) g.lineTo(x0 + i * step, Y(lim.peak[i]));
      g.lineTo(x0 + (n - 1) * step, plotT + H); g.fillStyle = 'rgba(190,200,215,.28)'; g.fill();
      g.beginPath();
      for (let i = 0; i < n; i++) { const y = Y(Math.min(ceil, lim.peak[i] - lim.red[i])); i ? g.lineTo(x0 + i * step, y) : g.moveTo(x0 + i * step, y); }
      g.strokeStyle = '#78ffaa'; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = 'rgba(255,140,90,.85)';
      for (let i = 0; i < n; i++) { const r = Math.min(1, lim.red[i] / 12); if (r > 0.004) g.fillRect(x0 + i * step, T, Math.max(1, step), Math.max(1, r * redH)); }
      g.fillStyle = BRIGHT; g.font = FONT(11, 600);
      g.fillText(`${lim.now > 0.05 ? '-' : ''}${lim.now.toFixed(1)} dB`, w - 120, T + 11);
      g.font = FONT(9); g.fillStyle = TXT; g.fillText(`max ${lim.max.toFixed(1)}`, w - 52, T + 11);
      g.fillText('input', X0 + 4, h - 3); g.fillStyle = '#78ffaa'; g.fillText('output', X0 + 40, h - 3); g.fillStyle = 'rgba(255,120,100,.9)'; g.fillText(`ceiling ${ceil.toFixed(1)}`, X0 + 84, h - 3);
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
    vscope(c) {   // left against right, turned 45 degrees: a mono sound is a vertical line, a wide one spreads sideways; a glowing line that fades
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d'), S = Math.min(w, h), ox = (w - S) / 2, oy = (h - S) / 2, { linger = 12, glow = 55 } = options(), glowK = glow / 100;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(11,12,15,${Math.max(.04, .5 - linger / 100 * 1.5)})`; g.fillRect(0, 0, w, h);
      g.save(); g.translate(ox, oy);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.beginPath();
      g.moveTo(S / 2, S * .06); g.lineTo(S / 2, S * .94); g.moveTo(S * .06, S / 2); g.lineTo(S * .94, S / 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath();
      g.moveTo(S * .14, S * .14); g.lineTo(S * .86, S * .86); g.moveTo(S * .86, S * .14); g.lineTo(S * .14, S * .86); g.stroke();
      g.beginPath(); g.arc(S / 2, S / 2, S * .38, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.3)'; g.font = FONT(9);
      g.fillText('M', S / 2 + 4, S * .06 + 8); g.fillText('L', S * .1, S * .1 + 4); g.fillText('R', S * .9 - 8, S * .1 + 4);
      const n = state.n;
      if (n > 0) {
        g.globalCompositeOperation = 'lighter'; g.lineWidth = 1.2; g.strokeStyle = `rgba(120,255,170,${.35 + .4 * glowK})`;
        g.shadowColor = 'rgba(80,255,150,.9)'; g.shadowBlur = (2 + 10 * glowK) * dpr;
        g.beginPath();
        const step = n > 1500 ? 2 : 1, R = S * .38;   // a long gap (a slow frame) is thinned rather than drawn in full
        for (let i = 0; i < n; i += step) {
          const l = lBlock[i], r = rBlock[i];
          const x = S / 2 + Math.max(-1.2, Math.min(1.2, (l - r) * .7071)) * R, y = S / 2 - Math.max(-1.2, Math.min(1.2, (l + r) * .7071)) * R;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke(); g.shadowBlur = 0;
      }
      g.restore();
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
    const n = reader.read(buf), dt = Math.min(.1, (now - (state.last || now)) / 1000); state.last = now; state.n = n;
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
    if (layersOn() && panels.some(p => p.kind === 'spectrum')) {
      for (const L of layers) {
        if (off.has(L.idx)) continue;
        const got = lreader.read(L.slot, lbuf);
        if (got > 0) { const keep = Math.min(got, SPEC_N); L.l.copyWithin(0, keep); L.l.set(lbuf.subarray(got - keep, got), SPEC_N - keep); }
        analyser.run(L.l, L.l);
        for (let i = 0; i < BANDS; i++) { const v = analyser.db[i]; L.spec[i] += (v - L.spec[i]) * (v > L.spec[i] ? .6 : .14); }
      }
    }
    if (transport && transport.length > 5 && panels.some(p => p.kind === 'limiter')) {   // what the limiter did since the last frame
      const red = Atomics.exchange(transport, 4, 0) / 100, raw = Atomics.exchange(transport, 5, 0), peak = raw > 0 ? raw / 100 - 200 : -60;
      lim.peak.push(peak); lim.red.push(red); if (lim.peak.length > 400) { lim.peak.shift(); lim.red.shift(); }
      lim.now = Math.max(red, lim.now * .9);
      if (red >= lim.max || now - lim.maxAt > 4000) { lim.max = red; lim.maxAt = now; }
      lim.ceil = options().ceiling ?? -0.3;
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
      open = true; box.hidden = false; reader.enable(true); for (const L of layers) L.l.fill(0); raf = requestAnimationFrame(frame);
    },
    hide() { open = false; box.hidden = true; reader.enable(false); pushMask(); cancelAnimationFrame(raf); },
    rebuild() { signature = ''; },
  };
}
