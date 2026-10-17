import { FRAME, MAX_FRAMES, braidsFrames, decodeFrames, defaultPair, encodeFrames, framesFromSample, windowFrom } from '../audio/nodes/wtutil.js';

// The wavetable synth's panel. The table (Braids' 256 waves until you cut another from a sample) is drawn as a
// stack of waves with the frame the position slider points at picked out; below it, the A and B waves of the
// pair, each cut as a 512 point window from any loaded sample (pick the sample, then where: type a frame number,
// click the strip showing the sample, or snap to the next rising zero crossing). A third picture shows the blend
// at the current mix. Everything is kept on the node (table and pair as base64 text, `meta` remembering where each
// came from), and sent to the running synth on every change.
const W = 150, TABLE_H = 150, STRIP_H = 34, WIN_H = 64;
const SIZES = [['whole sample', 0], ['256', 256], ['512', 512], ['1024', 1024], ['2048', 2048]];
const CLR = ['hsl(35 85% 52%)', 'hsl(200 70% 50%)'];

export function createWavetableEditor({ doc = document, data, getSampleIds = () => [], getSample = () => null, getParam = () => 0, onChange }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  const meta = structuredClone(data?.meta ?? {});
  meta.pair ??= { a: { sample: null, start: 0 }, b: { sample: null, start: 0 } };
  let table = data?.table ? decodeFrames(data.table) : braidsFrames();
  if (!table.length) table = braidsFrames();
  const stored = data?.pair ? decodeFrames(data.pair) : defaultPair();
  const pair = [stored.slice(0, FRAME), stored.slice(FRAME, 2 * FRAME)];
  if (pair[1].length < FRAME) pair[1] = defaultPair().slice(FRAME);

  const ink = c => (typeof getComputedStyle === 'function' ? getComputedStyle(c).color : '#888');
  const canvas = (w, h, cls = 'curve') => el('canvas', { width: w, height: h, className: cls });
  const trace = (ctx, a, x0, y0, w, h, colour, width = 1.5, n = a.length, step = 1) => {
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const x = x0 + (i / (n - 1)) * w, y = y0 + (1 - a[i]) * 0.5 * h;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  };
  const frame = (flat, k) => flat.subarray(k * FRAME, (k + 1) * FRAME);

  // ---- the table ----
  const tableCanvas = canvas(W, TABLE_H);
  const tableNote = el('div', { className: 'help' });
  const drawTable = () => {
    const ctx = tableCanvas.getContext('2d'), c = ink(tableCanvas), count = table.length / FRAME;
    ctx.clearRect(0, 0, W, TABLE_H);
    const rows = Math.min(count, 14), lift = (TABLE_H - 34) / Math.max(1, rows - 1), amp = 24;
    for (let r = 0; r < rows; r++) {   // back to front: the first frame at the back (top)
      const k = rows === 1 ? 0 : Math.round((r * (count - 1)) / (rows - 1)), y = r * lift;
      ctx.globalAlpha = 0.45;
      trace(ctx, frame(table, k), 0, y - 4, W, amp, c, 1, FRAME, 4);
    }
    ctx.globalAlpha = 1;
    const p = getParam('source') >= 0.5 ? -1 : getParam('position');   // the frame the position slider points at
    if (p >= 0) {
      const fp = Math.min(count - 1, Math.max(0, p * (count - 1))), k = Math.min(count - 1, Math.floor(fp)), f = fp - k, k1 = Math.min(count - 1, k + 1);
      const cur = Float32Array.from({ length: FRAME }, (_, i) => table[k * FRAME + i] * (1 - f) + table[k1 * FRAME + i] * f);
      const y = rows === 1 ? 0 : (fp / (count - 1)) * (rows - 1) * lift;
      trace(ctx, cur, 0, y - 4, W, amp, CLR[0], 2.5, FRAME, 1);
    }
  };
  const tableSample = el('select', { title: 'The sample to cut a table from' });
  const tableSize = el('select', { title: 'How many points each frame of the table has in the sample (frames follow one another)' },
    ...SIZES.map(([label, v]) => el('option', { value: String(v), textContent: v ? `${label} per frame` : label })));
  tableSize.value = String(meta.table?.size ?? 512);
  const describeTable = () => {
    const count = table.length / FRAME;
    tableNote.textContent = meta.table?.sample ? `table: ${meta.table.sample}, ${count} frame${count === 1 ? '' : 's'}` : `table: Braids set, ${count} waves`;
  };
  const useBraids = el('button', { textContent: 'Braids set', title: 'Go back to the 256 waves of the Braids oscillator' });
  useBraids.addEventListener('click', () => {
    table = braidsFrames(); delete meta.table;
    onChange('table', null); onChange('meta', structuredClone(meta));
    drawTable(); describeTable();
  });
  const cutTable = el('button', { textContent: 'Cut table', title: `Make the table from the chosen sample (at most ${MAX_FRAMES} frames)` });
  cutTable.addEventListener('click', () => {
    const s = getSample(tableSample.value);
    if (!s) return;
    const size = Number(tableSize.value);
    table = framesFromSample(s.data, size);
    meta.table = { sample: tableSample.value, size };
    onChange('table', encodeFrames(table)); onChange('meta', structuredClone(meta));
    drawTable(); describeTable();
  });

  // ---- the A / B pair ----
  const morph = canvas(W, WIN_H);
  const drawMorph = () => {
    const ctx = morph.getContext('2d'), c = ink(morph), mix = getParam('mix');
    ctx.clearRect(0, 0, W, WIN_H);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(0, WIN_H / 2); ctx.lineTo(W, WIN_H / 2); ctx.stroke();
    ctx.globalAlpha = 0.4; trace(ctx, pair[0], 0, 0, W, WIN_H, CLR[0], 1, FRAME, 2); trace(ctx, pair[1], 0, 0, W, WIN_H, CLR[1], 1, FRAME, 2);
    ctx.globalAlpha = 1;
    trace(ctx, Float32Array.from({ length: FRAME }, (_, i) => pair[0][i] * (1 - mix) + pair[1][i] * mix), 0, 0, W, WIN_H, c, 2, FRAME, 1);
  };
  const sides = [0, 1].map(side => {
    const key = side ? 'b' : 'a', name = side ? 'B' : 'A';
    const st = meta.pair[key];
    const picker = el('select', { title: `The sample wave ${name} is cut from` });
    const start = el('input', { type: 'number', min: 0, step: 1, value: String(st.start ?? 0), title: 'First frame of the 512 point window', className: 'num' });
    const strip = canvas(W, STRIP_H);
    const win = canvas(W, WIN_H);
    const info = el('span', { className: 'help' });
    const sample = () => (st.sample ? getSample(st.sample) : null);
    const draw = () => {
      const c = ink(strip), sctx = strip.getContext('2d'), wctx = win.getContext('2d'), s = sample();
      sctx.clearRect(0, 0, W, STRIP_H); wctx.clearRect(0, 0, W, WIN_H);
      wctx.globalAlpha = 0.25; wctx.strokeStyle = c; wctx.beginPath(); wctx.moveTo(0, WIN_H / 2); wctx.lineTo(W, WIN_H / 2); wctx.stroke(); wctx.globalAlpha = 1;
      trace(wctx, pair[side], 0, 0, W, WIN_H, CLR[side], 2, FRAME, 1);
      if (!s) { info.textContent = 'a default wave; pick a sample to cut one'; return; }
      sctx.globalAlpha = 0.3; sctx.strokeStyle = c;   // the sample's outline, one column of pixels per stretch of frames
      const len = s.data.length, per = Math.max(1, len / W);
      for (let x = 0; x < W; x++) {
        let lo = 1, hi = -1;
        for (let i = Math.floor(x * per), e = Math.min(len, Math.floor((x + 1) * per)), q = Math.max(1, Math.floor((e - i) / 16)); i < e; i += q) { lo = Math.min(lo, s.data[i]); hi = Math.max(hi, s.data[i]); }
        if (hi >= lo) { sctx.beginPath(); sctx.moveTo(x + 0.5, STRIP_H / 2 - hi * STRIP_H / 2); sctx.lineTo(x + 0.5, STRIP_H / 2 - lo * STRIP_H / 2); sctx.stroke(); }
      }
      sctx.globalAlpha = 1; sctx.fillStyle = CLR[side]; sctx.globalAlpha = 0.45;
      sctx.fillRect((st.start / len) * W, 0, Math.max(2, (FRAME / len) * W), STRIP_H);
      sctx.globalAlpha = 1;
      info.textContent = `frames ${st.start} to ${st.start + FRAME} of ${len}`;
    };
    const cut = () => {
      const s = sample();
      if (!s) return;
      st.start = Math.max(0, Math.min(Math.floor(st.start), Math.max(0, s.data.length - FRAME)));
      start.value = String(st.start);
      pair[side] = windowFrom(s.data, st.start);
      const flat = new Float32Array(2 * FRAME); flat.set(pair[0]); flat.set(pair[1], FRAME);
      onChange('pair', encodeFrames(flat)); onChange('meta', structuredClone(meta));
      draw(); drawMorph();
    };
    picker.addEventListener('change', () => { st.sample = picker.value || null; if (st.sample) cut(); else draw(); });
    start.addEventListener('change', () => { st.start = Number(start.value) || 0; cut(); });
    strip.addEventListener('mousedown', e => { const s = sample(); if (!s) return; st.start = Math.round((e.offsetX / W) * s.data.length - FRAME / 2); cut(); });
    const snap = el('button', { textContent: 'snap', title: 'Move the window to the next rising zero crossing, so the wave starts at zero' });
    snap.addEventListener('click', () => {
      const s = sample();
      if (!s) return;
      for (let i = Math.max(1, st.start); i < s.data.length - FRAME; i++) if (s.data[i - 1] < 0 && s.data[i] >= 0) { st.start = i; break; }
      cut();
    });
    const nudge = (label, d) => { const b = el('button', { textContent: label }); b.addEventListener('click', () => { st.start += d; cut(); }); return b; };
    const fill = () => {
      const ids = getSampleIds();
      picker.replaceChildren(el('option', { value: '', textContent: '(default wave)' }), ...ids.map(id => el('option', { value: id, textContent: id })));
      picker.value = st.sample && ids.includes(st.sample) ? st.sample : '';
    };
    fill();
    const box = el('div', { className: 'wt-block wt-side' }, el('div', { className: 'curve-presets' }, el('b', { textContent: name }), picker, start, nudge('-16', -16), nudge('+16', 16), snap), strip, win, info);
    return { box, draw, fill };
  });
  const fillTable = () => {
    const ids = getSampleIds();
    tableSample.replaceChildren(...ids.map(id => el('option', { value: id, textContent: id })));
    if (meta.table?.sample && ids.includes(meta.table.sample)) tableSample.value = meta.table.sample;
  };
  fillTable();

  const refresh = () => { drawTable(); drawMorph(); };
  const redraw = () => { refresh(); sides.forEach(s => s.draw()); describeTable(); };
  redraw();
  return {
    // four blocks side by side (they wrap on a narrow panel): the table, wave A, wave B and the blend of the two
    el: el('div', { className: 'curve-editor wt-editor' },
      el('div', { className: 'wt-block' }, el('b', { textContent: 'Table (source 0)' }), el('div', { className: 'curve-presets' }, useBraids, tableSample, tableSize, cutTable), tableCanvas, tableNote),
      ...sides.map(s => s.box),
      el('div', { className: 'wt-block' }, el('b', { textContent: 'Blend (source 1)' }), el('div', { className: 'help', textContent: 'A to B by mix' }), morph)),
    draw: redraw,
    refresh,   // the position or mix moved: draw the picked frame and the blend again
    get table() { return table; },
    get pair() { return pair.map(w => w.slice()); },
  };
}
