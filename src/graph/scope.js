// The scopes beside the nodes of the graph view: a small drawing of what one node puts out, in one of three views.
//   wave  the two channels over time, held still by a trigger on a rising zero crossing
//   spec  the spectrum, 20 Hz to 20 kHz on a log scale, 0 dB at the top (full scale) down to -90 dB
//   xy    left against right, turned 45 degrees: a mono sound is a vertical line, a wide one fills the box
//   vu    a level meter for each channel: the bar is the average level (rms) with a slow fall, the line above it the
//         highest peak, held for a moment; -60 dB to +6 dB, 0 dB being full scale
// A granular node has two more, in place of spec's neighbours (its modes are wave, cloud, grain, spec):
//   cloud  the sample it reads, the position and spray band, and a bracket for each grain that is sounding
//   grain  the last grains laid over each other, aligned at their start, inside the window they share
// The patcher keeps each scope's state ({ mode, size }) on its node, and hands in the samples as they arrive.
export const MODES = ['wave', 'spec', 'xy', 'vu'];
const GRAIN_MODES = ['wave', 'cloud', 'grain', 'spec'];
export const modesFor = type => (type === 'granular' ? GRAIN_MODES : MODES);
export const SIZES = [200, 400];
const HEAD = 14, SHOWN = 1024, N = 2048, DB_LOW = -90;

// where a node's scope is drawn: to the right of the node, as high as the node's middle allows
// (the level meter is a slim box of its own: VU_W wide, as tall as the smaller scope)
export const VU_W = 96;
export const scopeBox = (node, w, h, size, mode = 'wave') => {
  const tall = mode === 'vu' ? SIZES[0] : size;
  return { x: node.x + w + 16, y: Math.max(2, node.y + h / 2 - tall / 2), size: tall, w: mode === 'vu' ? VU_W : size };
};

// which header button a point is on: a mode name, 'eye' (hide), 'size', or null (the rest of the header or the picture)
export function headerHit(box, x, y, mode = 'wave', modes = MODES) {
  const W = box.w ?? box.size;
  if (x < box.x || x > box.x + W || y < box.y || y > box.y + HEAD) return null;
  if (mode === 'vu') return x > box.x + W - 26 ? 'eye' : x > box.x + 26 ? 'wave' : null;   // the slim header: vu, wave (back), the eye
  const i = Math.floor((x - box.x - 2) / 34);
  if (x > box.x + box.size - 36) return 'size';
  if (x > box.x + box.size - 58) return 'eye';
  return modes[i] ?? null;
}

// the sample a granular node reads, as the lowest and highest value in each column (kept for each sample and width)
const peaks = new WeakMap();
function peaksOf(a, cols) {
  let m = peaks.get(a);
  if (!m) peaks.set(a, m = new Map());
  let p = m.get(cols);
  if (!p) {
    p = new Float32Array(cols * 2);
    for (let c = 0; c < cols; c++) {
      const i0 = Math.floor(c / cols * a.length), i1 = Math.max(i0 + 1, Math.floor((c + 1) / cols * a.length));
      let lo = 0, hi = 0;
      for (let i = i0; i < i1; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      p[c * 2] = lo; p[c * 2 + 1] = hi;
    }
    m.set(cols, p);
  }
  return p;
}
// what one grain is: 120 points of the sample from its start, read at its step, through the window it was given
function grainPoints(a, g) {
  const out = new Float32Array(120), last = a.length - 1, taper = Math.max(0.02, g.shape);
  for (let k = 0; k < 120; k++) {
    const u = k / 119, pos = Math.max(0, Math.min(last, g.at * last)) + g.step * u * g.len;
    if (pos < 0 || pos >= last) continue;
    const j = pos | 0, f = pos - j;
    out[k] = (a[j] * (1 - f) + a[j + 1] * f) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (u < 0.5 ? u : 1 - u) * 2 / taper)));
  }
  return out;
}

// the spectrum of 2048 samples: dB per bin, 0 dB for a full-scale sine
const hann = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const re = new Float32Array(N), im = new Float32Array(N), db = new Float32Array(N / 2);
function spectrum(l, r) {
  for (let i = 0; i < N; i++) { re[i] = (l[i] + r[i]) * 0.5 * hann[i]; im[i] = 0; }
  for (let i = 1, j = 0; i < N; i++) {   // bit reversal
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  for (let k = 0; k < N / 2; k++) db[k] = 20 * Math.log10(Math.max(1e-9, Math.hypot(re[k], im[k]) / (N / 4)));
  return db;
}


// the level meter's ballistics, kept for each scope's state: dB per channel, the bar and the held peak
const meters = new WeakMap();
const DB_TOP = 6, DB_BOT = -60, SILENT = -100;
const dbOf = v => (v > 1e-5 ? 20 * Math.log10(v) : SILENT);
function meterOf(state, data, now) {
  let m = meters.get(state);
  if (!m) { m = { seen: null, t: now, at: 0, target: [SILENT, SILENT], bar: [SILENT, SILENT], peak: [SILENT, SILENT], held: [0, 0] }; meters.set(state, m); }
  const dt = Math.min(0.25, (now - m.t) / 1000);
  m.t = now;
  if (data && data !== m.seen) {   // a new block of samples: measure it
    m.seen = data; m.at = now;
    [data.l, data.r].forEach((buf, c) => {
      let sum = 0, top = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > top) top = Math.abs(v); }
      m.target[c] = dbOf(Math.sqrt(sum / buf.length));
      if (dbOf(top) >= m.peak[c]) { m.peak[c] = dbOf(top); m.held[c] = now; }
    });
  }
  const silent = now - m.at > 300;   // no blocks arriving (stopped): fall away
  for (let c = 0; c < 2; c++) {
    const target = silent ? SILENT : m.target[c];
    m.bar[c] += (target - m.bar[c]) * (1 - Math.exp(-dt / (target > m.bar[c] ? 0.06 : 0.3)));
    if (now - m.held[c] > 1200) m.peak[c] = Math.max(SILENT, m.peak[c] - 20 * dt);
  }
  return m;
}

export function drawScope(ctx, box, state, data, ink, modes = MODES) {
  const mode = modes.includes(state.mode) ? state.mode : 'wave';
  const { x, y, size } = box, W = box.w ?? size, top = y + HEAD, area = size - HEAD, mid = top + area / 2, amp = area / 2 * 0.9;
  ctx.save();
  ctx.fillStyle = '#10161b'; ctx.fillRect(x, y, W, size);
  ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  // the header: three view buttons and the size
  ctx.fillStyle = '#1b2630'; ctx.fillRect(x, y, W, HEAD);
  if (mode === 'vu') {
    ctx.fillStyle = '#7fd4ff'; ctx.fillText('vu', x + 5, y + 2);
    ctx.fillStyle = '#789'; ctx.fillText('wave', x + 30, y + 2);
  } else modes.forEach((m, i) => { ctx.fillStyle = m === mode ? '#7fd4ff' : '#789'; ctx.fillText(m, x + 5 + i * 34, y + 2); });
  if (mode !== 'vu') { ctx.fillStyle = '#789'; ctx.textAlign = 'right'; ctx.fillText(String(size), x + size - 5, y + 2); ctx.textAlign = 'left'; }
  {   // the eye that hides the scope
    const cx = mode === 'vu' ? x + W - 14 : x + size - 47, cy = y + HEAD / 2;
    ctx.strokeStyle = ctx.fillStyle = '#7fd4ff'; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.quadraticCurveTo(cx, cy - 7, cx + 6, cy); ctx.quadraticCurveTo(cx, cy + 7, cx - 6, cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.beginPath(); ctx.rect(x, top, W, area); ctx.clip();
  ctx.strokeStyle = '#2b3a46'; ctx.lineWidth = 1;
  const line = (x0, y0, x1, y1) => { ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5); ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5); };
  const sr = data?.sr ?? 44100;
  let moving = false;

  if (mode === 'wave') {
    ctx.beginPath();
    for (const f of [-1, -0.5, 0, 0.5, 1]) line(x, mid - f * amp, x + size, mid - f * amp);
    for (let i = 1; i < 8; i++) line(x + i * size / 8, top, x + i * size / 8, top + area);
    ctx.stroke();
    if (data) {
      const { l, r } = data;
      let start = 0;
      for (let i = 1; i < l.length - SHOWN; i++) { if (l[i - 1] + r[i - 1] < 0 && l[i] + r[i] >= 0) { start = i; break; } }
      let peak = 0;
      for (const [buf, color] of [[l, '#4fd1c5'], [r, '#f6ad55']]) {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.25;
        for (let i = 0; i < size; i++) {
          const v = buf[start + Math.floor(i * SHOWN / size)];
          if (Math.abs(v) > peak) peak = Math.abs(v);
          const py = mid - Math.max(-1.1, Math.min(1.1, v)) * amp;
          if (i === 0) ctx.moveTo(x, py); else ctx.lineTo(x + i, py);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#8aa'; ctx.textAlign = 'right'; ctx.fillText(`peak ${peak > 1e-4 ? (20 * Math.log10(peak)).toFixed(1) : '-inf'} dB`, x + size - 5, top + 3);
    }
  } else if (mode === 'spec') {
    ctx.beginPath();
    for (const d of [-30, -60]) line(x, top + area * (-d / -DB_LOW), x + size, top + area * (-d / -DB_LOW));
    const fx = f => x + size * Math.log(f / 20) / Math.log(1000);
    for (const f of [100, 1000, 10000]) line(fx(f), top, fx(f), top + area);
    ctx.stroke();
    ctx.fillStyle = '#789'; ctx.textAlign = 'left';
    [['100', 100], ['1k', 1000], ['10k', 10000]].forEach(([t, f]) => ctx.fillText(t, fx(f) + 3, top + area - 12));
    if (data) {
      const d = spectrum(data.l, data.r), bin = f => f * N / sr, last = N / 2 - 1;
      ctx.beginPath(); ctx.moveTo(x, top + area);
      let prev = 0;
      for (let i = 0; i < size; i++) {
        const f1 = 20 * Math.pow(1000, (i + 1) / size), b0 = bin(20 * Math.pow(1000, i / size)), b1 = Math.min(last, bin(f1));
        let v = DB_LOW;
        if (b0 >= last) v = DB_LOW;
        else if (b1 - b0 < 1) { const k = Math.floor(b0), t = b0 - k; v = d[k] * (1 - t) + d[Math.min(last, k + 1)] * t; }
        else for (let k = Math.ceil(b0); k <= Math.floor(b1); k++) if (d[k] > v) v = d[k];
        prev = v;
        ctx.lineTo(x + i, top + area * Math.min(1, Math.max(0, -v / -DB_LOW)));
      }
      ctx.lineTo(x + size, top + area); ctx.closePath();
      ctx.fillStyle = 'hsl(190 60% 45% / 0.35)'; ctx.fill();
      ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 1.25; ctx.stroke();
    }
  } else if (mode === 'vu') {
    const m = meterOf(state, data, performance.now());
    const left = 30, gap = 6, bw = (W - left - gap - 8) / 2, y0 = top + 8, hh = area - 30;
    const yOf = d => y0 + hh * (DB_TOP - Math.max(DB_BOT, Math.min(DB_TOP, d))) / (DB_TOP - DB_BOT);
    ctx.beginPath();
    for (const d of [6, 0, -6, -12, -24, -36, -48, -60]) line(x + left - 4, yOf(d), x + W - 4, yOf(d));
    ctx.stroke();
    ctx.fillStyle = '#789'; ctx.textAlign = 'right';
    for (const d of [6, 0, -6, -12, -24, -36, -48, -60]) ctx.fillText(String(d), x + left - 7, yOf(d) - 5);
    for (let c = 0; c < 2; c++) {
      const bx = x + left + c * (bw + gap);
      ctx.fillStyle = '#18222b'; ctx.fillRect(bx, y0, bw, hh);
      for (let d = DB_BOT; d < Math.min(m.bar[c], DB_TOP); d += 2) {   // the bar, in two-decibel segments
        ctx.fillStyle = d >= 0 ? '#e5484d' : d >= -9 ? '#e9c46a' : '#4fd1c5';
        ctx.fillRect(bx, yOf(d + 2) + 1, bw, Math.max(1, yOf(d) - yOf(d + 2) - 1));
      }
      if (m.peak[c] > DB_BOT) { ctx.fillStyle = m.peak[c] >= 0 ? '#e5484d' : '#d6e4ee'; ctx.fillRect(bx, yOf(m.peak[c]) - 1, bw, 2); }
      ctx.fillStyle = m.peak[c] >= 0 ? '#e5484d' : '#8aa'; ctx.textAlign = 'center';
      ctx.fillText(m.peak[c] > DB_BOT ? Math.round(m.peak[c]) : '-inf', bx + bw / 2, y0 + hh + 5);
    }
    moving = m.bar[0] > DB_BOT || m.bar[1] > DB_BOT || m.peak[0] > DB_BOT || m.peak[1] > DB_BOT;
  } else if (mode === 'cloud' || mode === 'grain') {
    const cs = data?.cloud, src = data?.src, pv = data?.param ?? (() => 0), now = performance.now(), srate = cs?.sr ?? 44100;
    ctx.beginPath(); line(x, mid, x + size, mid); ctx.stroke();
    ctx.fillStyle = '#789'; ctx.textAlign = 'left';
    const recent = cs ? cs.grains.slice(-14) : [];
    if (!src) { ctx.fillText('no sample', x + 6, top + 6); }
    else if (mode === 'cloud') {
      const pk = peaksOf(src, size), pos = cs ? cs.head : pv('position'), spray = pv('spray');
      ctx.fillStyle = 'hsl(160 55% 45% / 0.2)';   // the spray band, wrapping round the ends
      const a = pos - spray, b = pos + spray;
      ctx.fillRect(x + size * Math.max(0, a), top, size * (Math.min(1, b) - Math.max(0, a)), area);
      if (a < 0) ctx.fillRect(x + size * (1 + a), top, size * -a, area);
      if (b > 1) ctx.fillRect(x, top, size * (b - 1), area);
      ctx.strokeStyle = '#4a6c80'; ctx.lineWidth = 1; ctx.beginPath();
      for (let c = 0; c < size; c++) { line(x + c, mid - pk[c * 2 + 1] * amp, x + c, mid - pk[c * 2] * amp); }
      ctx.stroke();
      let row = 0;
      ctx.lineWidth = 2;
      for (const g of recent) {
        const u = (now - g.t) / 1000 * srate / g.len;
        if (u >= 1) continue;
        const span = g.step * g.len / (src.length - 1), y0 = top + 6 + (row++ % 6) * 5;
        const A = x + size * Math.max(0, Math.min(1, g.at)), B = x + size * Math.max(0, Math.min(1, g.at + span)), C = x + size * Math.max(0, Math.min(1, g.at + span * u));
        ctx.globalAlpha = 1 - u * 0.6; ctx.strokeStyle = '#4fd1c5'; ctx.beginPath(); ctx.moveTo(A, y0); ctx.lineTo(B, y0); ctx.stroke();
        ctx.fillStyle = '#f6ad55'; ctx.beginPath(); ctx.arc(C, y0, 2.5, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#f6ad55'; ctx.lineWidth = 1.25; ctx.beginPath(); line(x + size * pos, top, x + size * pos, top + area); ctx.stroke();
      moving = !!cs && now - cs.t < 400;
    } else {
      const shape = Math.max(0.02, pv('shape')), win = u => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (u < 0.5 ? u : 1 - u) * 2 / shape));
      let top2 = 0.05;
      for (const g of recent) { g.pts ??= grainPoints(src, g); for (const v of g.pts) if (Math.abs(v) > top2) top2 = Math.abs(v); }
      if (cs) cs.gain += (0.95 / top2 - cs.gain) * 0.2;
      const k = cs ? cs.gain : 1;
      recent.forEach((g, i) => {
        ctx.globalAlpha = 0.15 + 0.6 * (i + 1) / recent.length; ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = i === recent.length - 1 ? 1.5 : 1; ctx.beginPath();
        g.pts.forEach((v, j) => { const px = x + size * j / (g.pts.length - 1), py = mid - v * k * amp; if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.stroke();
      });
      ctx.globalAlpha = 1; ctx.strokeStyle = '#f6ad55'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      for (const sg of [1, -1]) { ctx.beginPath(); for (let c = 0; c <= size; c += 2) { const py = mid - sg * win(c / size) * amp; if (c) ctx.lineTo(x + c, py); else ctx.moveTo(x + c, py); } ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = '#789'; ctx.textAlign = 'left'; ctx.fillText('0', x + 4, top + area - 12); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(pv('size'))} ms`, x + size - 4, top + area - 12);
      moving = !!cs && now - cs.t < 400;
    }
  } else {   // xy
    ctx.beginPath();
    line(x + size / 2, top, x + size / 2, top + area); line(x, mid, x + size, mid);
    ctx.stroke();
    if (data) {
      const { l, r } = data, cx = x + size / 2, k = Math.min(size, area) / 2 * 0.9 * Math.SQRT1_2;
      ctx.beginPath(); ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 1;
      const from = l.length - SHOWN;
      for (let i = from; i < l.length; i++) {
        const px = cx + (l[i] - r[i]) * k, py = mid - (l[i] + r[i]) * k;
        if (i === from) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.strokeRect(x + 0.5, y + 0.5, W - 1, size - 1); ctx.restore();
  return moving;   // the meter is still falling: draw again
}
