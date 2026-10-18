import { MAX_TAPS, DEFAULT_TAPS, normalizeTaps } from '../audio/nodes/shiva.js';

// The Shiva delay's tap view. Top: one stem per tap, time along the bottom (the left part is the range you can
// place taps in, 0 to `length`; the part to its right shows where feedback repeats them, fading), level as height.
// Middle: a dot per tap for its pan (up is left, down is right). Bottom: the frequency response the taps make with
// the dry sound (the comb), as a band between the lowest and highest value inside each pixel.
// Click empty space to add a tap, drag a stem to move it, drag a pan dot up and down, double-click a stem to remove
// it (a pan dot, to centre it). onChange gets the whole flat list [time, level, pan, ...] on every change.
const W = 360, PL = 8, PR = 8, SPAN = 1.5;
const LEVEL = { y: 22, h: 90 }, PAN = { y: 122, h: 34 }, COMB = { y: 170, h: 62 };
const H = COMB.y + COMB.h + 18;
const DB_LO = -24, DB_HI = 18, F_LO = 20, F_HI = 20000;

export function createTapEditor({ doc = document, points, getParam, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  // taps as objects while editing; the flat list is what is stored and sent
  const unpack = flat => { const t = normalizeTaps(flat), out = []; for (let i = 0; i < t.length; i += 3) out.push({ t: t[i], l: t[i + 1], p: t[i + 2] }); return out; };
  let taps = unpack(points);
  let grab = null, hover = -1;

  const canvas = el('canvas', { width: W, height: H, className: 'taps' });
  const ctx = canvas.getContext('2d');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pw = W - PL - PR;
  const xOf = t => PL + (t / SPAN) * pw;
  const yLevel = l => LEVEL.y + LEVEL.h - l * LEVEL.h;
  const yPan = p => PAN.y + (p + 1) / 2 * PAN.h;
  const flat = () => taps.flatMap(k => [Math.round(k.t * 10000) / 10000, Math.round(k.l * 1000) / 1000, Math.round(k.p * 1000) / 1000]);
  const emit = () => onChange(flat());
  const colour = (p, a = 1) => { const f = (p + 1) / 2; return `rgba(${Math.round(60 + 180 * f)}, ${Math.round(150)}, ${Math.round(230 - 180 * f)}, ${a})`; };
  const ms = v => (v >= 100 ? Math.round(v) : v.toFixed(1));

  const latest = () => taps.reduce((m, k) => Math.max(m, k.t), 0);

  const draw = () => {
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const length = getParam('length'), fb = getParam('feedback'), mix = getParam('mix');
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    // grid: quarters of the length, and the end of the range you can edit
    for (let q = 0; q <= 4; q++) {
      ctx.globalAlpha = q === 0 || q === 4 ? 0.4 : 0.15;
      ctx.strokeStyle = ink;
      const x = Math.round(xOf(q / 4)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, LEVEL.y); ctx.lineTo(x, PAN.y + PAN.h); ctx.stroke();
    }
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = ink;
    ctx.fillRect(xOf(1) + 1, LEVEL.y, xOf(SPAN) - xOf(1), LEVEL.h + 10 + PAN.h);   // the feedback area
    ctx.globalAlpha = 0.5;
    ctx.fillText('0', PL, 4);
    ctx.fillText(`${ms(length)} ms`, xOf(1) - 40, 4);
    ctx.fillText('repeats', xOf(1) + 6, 4);
    ctx.globalAlpha = 0.25;
    ctx.fillRect(PL, yLevel(0) + 0.5, pw, 1);
    ctx.fillRect(PL, yPan(0), pw, 1);
    ctx.globalAlpha = 1;
    // the repeats: each pass of the pattern after the latest tap, quieter by the feedback
    const P = latest();
    if (fb > 0.01 && P > 0.01) {
      for (let pass = 1; pass < 40; pass++) {
        const g = Math.pow(fb, pass);
        if (g < 0.02 || pass * P >= SPAN) break;
        for (const k of taps) {
          const t = k.t + pass * P;
          if (t > SPAN) continue;
          ctx.strokeStyle = colour(k.p, 0.55);
          ctx.beginPath(); ctx.moveTo(Math.round(xOf(t)) + 0.5, yLevel(0)); ctx.lineTo(Math.round(xOf(t)) + 0.5, yLevel(k.l * g)); ctx.stroke();
        }
      }
    }
    taps.forEach((k, i) => {
      const x = Math.round(xOf(k.t)) + 0.5, hot = i === hover || grab?.i === i;
      ctx.strokeStyle = colour(k.p);
      ctx.lineWidth = hot ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x, yLevel(0)); ctx.lineTo(x, yLevel(k.l)); ctx.stroke();
      ctx.fillStyle = colour(k.p);
      ctx.beginPath(); ctx.arc(x, yLevel(k.l), hot ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = colour(k.p, 0.4);
      ctx.beginPath(); ctx.moveTo(x, yPan(0)); ctx.lineTo(x, yPan(k.p)); ctx.stroke();
      ctx.fillStyle = colour(k.p);
      ctx.beginPath(); ctx.arc(x, yPan(k.p), hot ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.fillText('L', 1, PAN.y - 1); ctx.fillText('R', 1, PAN.y + PAN.h - 9);
    const k = taps[hover >= 0 ? hover : grab?.i ?? -1];
    ctx.globalAlpha = 0.9;
    ctx.fillText(k ? `tap ${taps.indexOf(k) + 1}   ${ms(k.t * length)} ms   level ${k.l.toFixed(2)}   pan ${k.p < -0.005 ? `L${Math.round(-k.p * 100)}` : k.p > 0.005 ? `R${Math.round(k.p * 100)}` : 'C'}` : `${taps.length} taps`, PL + 26, LEVEL.y + 2);
    // the comb: dry + mix * (taps / (1 - feedback * loop)), level only, as a min-max band per pixel
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink;
    ctx.fillStyle = 'rgba(128, 128, 128, 0.16)';
    ctx.fillRect(PL, COMB.y, pw, COMB.h);
    ctx.globalAlpha = 0.18;
    for (const db of [-12, 0, 12]) { const y = Math.round(COMB.y + COMB.h - ((db - DB_LO) / (DB_HI - DB_LO)) * COMB.h) + 0.5; ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); ctx.stroke(); }
    for (const f of [100, 1000, 10000]) { const x = Math.round(PL + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * pw) + 0.5; ctx.beginPath(); ctx.moveTo(x, COMB.y); ctx.lineTo(x, COMB.y + COMB.h); ctx.stroke(); }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ink;
    for (const [f, name] of [[100, '100'], [1000, '1k'], [10000, '10k']]) ctx.fillText(name, PL + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * pw - 6, COMB.y + COMB.h + 3);
    ctx.fillText('comb (dB)', PL + 2, COMB.y + 2);
    ctx.globalAlpha = 1;
    const sec = taps.map(t => ({ tau: t.t * length * 0.001, l: t.l }));
    const loop = P * length * 0.001;
    const db = f => {
      const w = 2 * Math.PI * f;
      let re = 0, im = 0;
      for (const s of sec) { re += s.l * Math.cos(w * s.tau); im -= s.l * Math.sin(w * s.tau); }
      const dr = 1 - fb * Math.cos(w * loop), di = fb * Math.sin(w * loop), dd = dr * dr + di * di;   // 1 / (1 - fb e^{-jwT})
      const hr = (re * dr + im * di) / dd, hi = (im * dr - re * di) / dd;
      const m = Math.hypot(1 + mix * hr, mix * hi);
      return 20 * Math.log10(Math.max(m, 1e-4));
    };
    ctx.fillStyle = 'hsl(35 75% 52%)';
    const yDb = v => COMB.y + COMB.h - ((clamp(v, DB_LO, DB_HI) - DB_LO) / (DB_HI - DB_LO)) * COMB.h;
    for (let x = 0; x < pw; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let s = 0; s < 6; s++) {
        const v = db(F_LO * Math.pow(F_HI / F_LO, (x + s / 6) / pw));
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      const y0 = yDb(hi), y1 = yDb(lo);
      ctx.fillRect(PL + x, y0, 1, Math.max(1.5, y1 - y0));
    }
  };

  const point = e => { const r = canvas.getBoundingClientRect(), s = r.width ? W / r.width : 1; return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }; };
  const nearest = (x, y) => {
    let best = -1, dist = 10, lane = null;
    taps.forEach((k, i) => {
      const dx = Math.abs(xOf(k.t) - x);
      if (y >= LEVEL.y - 6 && y <= LEVEL.y + LEVEL.h + 6) { const d = Math.hypot(dx, Math.max(0, y - yLevel(k.l)) * 0 + Math.abs(y - yLevel(k.l)) * 0.35); if (d < dist && (y <= yLevel(0) + 6)) { dist = d; best = i; lane = 'level'; } }
      else if (y >= PAN.y - 6 && y <= PAN.y + PAN.h + 6) { const d = Math.hypot(dx, y - yPan(k.p)); if (d < dist) { dist = d; best = i; lane = 'pan'; } }
    });
    return { i: best, lane };
  };
  const move = (k, lane, x, y) => {
    if (lane === 'level') { k.t = clamp(((x - PL) / pw) * SPAN, 0.001, 1); k.l = clamp((LEVEL.y + LEVEL.h - y) / LEVEL.h, 0, 1); }
    else k.p = clamp(((y - PAN.y) / PAN.h) * 2 - 1, -1, 1);
  };

  canvas.addEventListener('mousedown', e => {
    const { x, y } = point(e);
    let { i, lane } = nearest(x, y);
    if (i < 0 && y >= LEVEL.y && y <= LEVEL.y + LEVEL.h && taps.length < MAX_TAPS) {   // empty space in the level lane: a new tap
      taps.push({ t: 0.5, l: 0.5, p: 0 });
      i = taps.length - 1; lane = 'level';
      move(taps[i], 'level', x, y);
      emit();
    }
    if (i >= 0) grab = { i, lane };
    draw();
  });
  canvas.addEventListener('dblclick', e => {
    const { x, y } = point(e);
    const { i, lane } = nearest(x, y);
    if (i < 0) return;
    if (lane === 'pan') taps[i].p = 0;
    else if (taps.length > 1) taps.splice(i, 1);
    grab = null; hover = -1;
    emit(); draw();
  });
  canvas.addEventListener('mousemove', e => {
    const { x, y } = point(e);
    if (grab) { move(taps[grab.i], grab.lane, x, y); emit(); draw(); return; }
    const h = nearest(x, y).i;
    if (h !== hover) { hover = h; draw(); }
  });
  const stop = () => { grab = null; };
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', () => { grab = null; if (hover >= 0) { hover = -1; draw(); } });

  const make = fn => () => { taps = fn(); emit(); draw(); };
  const presets = {
    even: make(() => unpack(Array.from({ length: 8 }, (_, i) => [(i + 1) / 8, Math.pow(0.75, i), i % 2 ? 0.7 : -0.7]).flat())),
    'ping-pong': make(() => unpack(Array.from({ length: 6 }, (_, i) => [(i + 1) / 6, Math.pow(0.8, i), i % 2 ? 1 : -1]).flat())),
    accel: make(() => unpack(Array.from({ length: 10 }, (_, i) => [Math.pow((i + 1) / 10, 1.8), Math.pow(0.85, i) * 0.9, Math.sin(i * 1.9) * 0.8]).flat())),
    random: make(() => unpack(Array.from({ length: 5 + Math.floor(Math.random() * 8) }, () => [0.05 + Math.random() * 0.95, 0.2 + Math.random() * 0.8, Math.random() * 2 - 1]).flat())),
    default: make(() => unpack(DEFAULT_TAPS)),
  };
  const buttons = el('div', { className: 'curve-presets' }, ...Object.entries(presets).map(([name, fn]) => {
    const b = el('button', { textContent: name });
    b.addEventListener('click', fn);
    return b;
  }));

  draw();
  return {
    el: el('div', { className: 'curve-editor tap-editor' }, canvas, buttons),
    draw,
    refresh: draw,
    get points() { return flat(); },
  };
}
