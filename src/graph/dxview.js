import { ALGORITHMS, VOICES, unpackBank, packVoice, parseSyx, initVoice, blankOp, scaleOL, levelScaling, bankToSyx, voiceToSyx, DEFAULT_BANK } from '../audio/nodes/dx7.js';

// The DVIIloader's panel, in tabs: Voice (name, algorithm, feedback, the operators as boxes: click one to edit it,
// M and S to mute and solo it), Operator (frequency, the four-point envelope you drag, levels and sensitivities),
// Scaling (keyboard level scaling), LFO / Pitch (the LFO and the pitch envelope) and Bank (load, save, search,
// move, compare). Every edit is written into the node's copy of the bank, which is sent to the engine at once.
const W = 360, BW = 52, BH = 34;
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => `${NOTE[n % 12]}${Math.floor(n / 12) - 2}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const WAVES = ['triangle', 'saw down', 'saw up', 'square', 'sine', 'sample & hold'];
const CURVES = ['-lin', '-exp', '+exp', '+lin'];

export function createDxView({ doc = document, bank, getVoice, setVoice, getParam, setParamValue, onBank, say = () => {} }) {
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };
  let bytes = bank && bank.length >= VOICES * 128 ? Uint8Array.from(bank) : DEFAULT_BANK.slice();
  let source = bank ? 'your bank' : 'built-in bank';
  let voices = unpackBank(bytes);
  let op = 0, tab = 'voice', stash = null, clipboard = null, filter = '';
  const refreshers = [];
  const cur = () => clamp(getVoice(), 0, VOICES - 1);
  const voice = () => voices[cur()];
  const ink = canvas => (typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888');

  // an edit: change the voice, write it into the bank, send the bank
  const commit = () => {
    packVoice(voice(), bytes, cur() * 128);
    voices[cur()] = voice();
    if (source === 'built-in bank') source = 'built-in bank, edited';
    onBank(Array.from(bytes));
  };
  const edit = fn => { fn(voice()); commit(); refreshAll(); };
  const reload = () => { voices = unpackBank(bytes); onBank(Array.from(bytes)); refreshAll(); };

  // ---- small controls ----
  const track = (node, fn) => { refreshers.push(fn); return node; };
  const slider = (label, min, max, get, set, fmt = v => String(v)) => {
    const input = el('input', { type: 'range', min, max, step: 1 });
    const out = el('span', { className: 'dx-val' });
    input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(Number(input.value)); });
    const row = el('label', { className: 'dx-slider' }, el('span', { className: 'dx-lab', textContent: label }), input, out);
    return track(row, () => { const v = get(); input.value = String(v); out.textContent = fmt(v); });
  };
  const select = (label, options, get, set) => {
    const s = el('select');
    options.forEach((o, i) => s.append(el('option', { value: String(i), textContent: o })));
    s.addEventListener('change', () => set(Number(s.value)));
    return track(el('label', { className: 'dx-slider' }, el('span', { className: 'dx-lab', textContent: label }), s), () => { s.value = String(get()); });
  };
  const button = (text, fn, title = '') => { const b = el('button', { textContent: text, title }); b.addEventListener('click', fn); return b; };
  const toggle = (text, get, set) => { const b = button(text, () => set(!get())); return track(b, () => b.classList.toggle('on', !!get())); };

  // ---- the voice tab: algorithm picture ----
  const algCanvas = el('canvas', { width: W, height: 200, className: 'dx' });
  const actx = algCanvas.getContext('2d');
  let boxes = [];
  const layout = alg => {
    const layer = new Array(6).fill(0);
    for (let k = 0; k < 6; k++) {   // senders have higher numbers than receivers
      if (alg.carriers.includes(k)) continue;
      layer[k] = 1 + Math.max(0, ...alg.mods.filter(m => m[1] === k).map(m => layer[m[0]]));
    }
    const top = Math.max(...layer), pos = new Array(6);
    const byLayer = l => [...Array(6).keys()].filter(k => layer[k] === l);
    const carriers = byLayer(0);
    carriers.forEach((k, i) => { pos[k] = ((i + 0.5) / carriers.length) * (W - 20) + 10; });
    for (let l = 1; l <= top; l++) {
      const ks = byLayer(l);
      for (const k of ks) { const t = alg.mods.filter(m => m[1] === k).map(m => pos[m[0]]); pos[k] = t.reduce((a, b) => a + b, 0) / t.length; }
      ks.sort((a, b) => pos[a] - pos[b]);
      for (let i = 1; i < ks.length; i++) if (pos[ks[i]] - pos[ks[i - 1]] < BW + 10) pos[ks[i]] = pos[ks[i - 1]] + BW + 10;
      for (const k of ks) pos[k] = clamp(pos[k], BW / 2 + 4, W - BW / 2 - 4);
    }
    const gap = top ? (200 - 30 - BH) / top : 0;
    return Array.from({ length: 6 }, (_, k) => ({ x: pos[k], y: 8 + (top - layer[k]) * gap }));
  };
  const drawAlg = () => {
    const v = voice(), alg = ALGORITHMS[v.alg], c = ink(algCanvas);
    const mute = Math.round(getParam('mute')), solo = Math.round(getParam('solo'));
    actx.clearRect(0, 0, W, 200);
    actx.font = '10px ui-monospace, Consolas, monospace';
    actx.textBaseline = 'top';
    const at = layout(alg);
    boxes = at;
    actx.strokeStyle = c; actx.lineWidth = 1.5; actx.globalAlpha = 0.7;
    for (const [to, from] of alg.mods) { actx.beginPath(); actx.moveTo(at[from].x, at[from].y + BH); actx.lineTo(at[to].x, at[to].y); actx.stroke(); }
    if (v.fb) {
      const [f, t] = alg.fb, a = at[f], b = at[t];
      actx.globalAlpha = 0.95; actx.strokeStyle = 'hsl(35 85% 52%)'; actx.lineWidth = 2;
      actx.beginPath(); actx.moveTo(a.x + BW / 2, a.y + BH / 2);
      actx.bezierCurveTo(a.x + BW / 2 + 22, a.y + BH / 2, b.x + BW / 2 + 22, b.y + 4, b.x + BW / 2, b.y + 4); actx.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const p = v.ops[k], { x, y } = at[k], carrier = alg.carriers.includes(k);
      const silent = ((mute >> k) & 1) || (solo && !((solo >> k) & 1));
      actx.globalAlpha = silent ? 0.4 : 1;
      actx.fillStyle = carrier ? 'hsl(35 75% 52% / 0.35)' : 'rgba(128,128,128,0.2)';
      actx.fillRect(x - BW / 2, y, BW, BH);
      actx.strokeStyle = k === op ? '#d03040' : c; actx.lineWidth = k === op ? 2.5 : 1;
      actx.strokeRect(x - BW / 2 + 0.5, y + 0.5, BW - 1, BH - 1);
      actx.fillStyle = c;
      const ratio = p.mode ? `${Math.round(Math.pow(10, (p.fc & 3) + p.ff / 100))}Hz` : `x${((p.fc === 0 ? 0.5 : p.fc) * (1 + p.ff / 100)).toFixed(2)}`;
      actx.fillText(`${k + 1} ${ratio}`, x - BW / 2 + 4, y + 4);
      actx.fillText(`lv ${p.ol}`, x - BW / 2 + 4, y + 18);
      // M and S, under the box
      actx.globalAlpha = 1;
      actx.fillStyle = (mute >> k) & 1 ? '#d03040' : c; actx.fillText('M', x - 16, y + BH + 2);
      actx.fillStyle = (solo >> k) & 1 ? '#d03040' : c; actx.fillText('S', x + 8, y + BH + 2);
    }
    actx.globalAlpha = 1;
  };
  algCanvas.addEventListener('mousedown', e => {
    const r = algCanvas.getBoundingClientRect(), s = r.width ? W / r.width : 1, x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
    boxes.forEach((b, k) => {
      if (Math.abs(x - b.x) <= BW / 2 && y >= b.y && y <= b.y + BH) { op = k; refreshAll(); }
      else if (y > b.y + BH && y < b.y + BH + 14 && Math.abs(x - (b.x - 12)) < 8) setParamValue('mute', Math.round(getParam('mute')) ^ (1 << k)), refreshAll();
      else if (y > b.y + BH && y < b.y + BH + 14 && Math.abs(x - (b.x + 12)) < 8) setParamValue('solo', Math.round(getParam('solo')) ^ (1 << k)), refreshAll();
    });
  });

  const nameInput = el('input', { className: 'dx-name', maxLength: 10 });
  nameInput.addEventListener('change', () => edit(v => { v.name = nameInput.value.toUpperCase().slice(0, 10); }));
  refreshers.push(() => { if (doc.activeElement !== nameInput) nameInput.value = voice().name; });

  const voiceTab = el('div', {},
    el('div', { className: 'prow' }, button('◀', () => setVoice(clamp(cur() - 1, 0, VOICES - 1))), nameInput, button('▶', () => setVoice(clamp(cur() + 1, 0, VOICES - 1))),
      button('init', () => edit(v => { Object.assign(v, initVoice({ name: v.name })); }), 'reset this voice to the DX7 init voice'),
      button('randomise', () => edit(v => Object.assign(v, randomVoice(v.name))))),
    select('algorithm', ALGORITHMS.map((_, i) => String(i + 1)), () => voice().alg, i => edit(v => { v.alg = i; })),
    slider('feedback', 0, 7, () => voice().fb, n => edit(v => { v.fb = n; })),
    algCanvas,
    el('div', { className: 'tag' }, 'click an operator to edit it · M mute, S solo'));
  refreshers.push(drawAlg);

  // ---- an envelope you drag: four rates and four levels ----
  const envGraph = ({ get, set, yOf, levelAt, seconds, label, W: EW = 340, H: EH = 118 }) => {
    const canvas = el('canvas', { width: EW, height: EH, className: 'dx' });
    const g = canvas.getContext('2d');
    const PAD = 14;
    let dragging = null;
    const geometry = () => {
      const { l, r } = get();
      const from = [l[3], l[0], l[1], l[2]], to = [l[0], l[1], l[2], l[3]];   // the voice starts at level 4
      const w = [0, 1, 2, 3].map(i => Math.log10(1 + seconds(i, from[i], to[i], r[i]) * 30));
      const gap = 0.35 * Math.max(0.6, w.reduce((a, b) => a + b, 0) / 3);
      const span = w.reduce((a, b) => a + b, 0) + gap + 0.4;
      const px = EW - 2 * PAD, scale = px / span;
      const xs = [PAD];
      for (let i = 0; i < 3; i++) xs.push(xs[i] + w[i] * scale);
      const sustainEnd = xs[3] + gap * scale;
      xs.push(clamp(sustainEnd + w[3] * scale, sustainEnd + 6, EW - PAD));
      const ys = lv => PAD + (1 - yOf(lv)) * (EH - 2 * PAD - 10);
      return { l, r, xs, sustainEnd, ys, pts: [[xs[1], ys(l[0])], [xs[2], ys(l[1])], [xs[3], ys(l[2])], [xs[4], ys(l[3])]], start: [xs[0], ys(l[3])] };
    };
    const draw = () => {
      const c = ink(canvas), geo = geometry();
      g.clearRect(0, 0, EW, EH);
      g.fillStyle = 'rgba(128,128,128,0.14)'; g.fillRect(0, 0, EW, EH);
      g.font = '9px ui-monospace, Consolas, monospace'; g.textBaseline = 'top';
      g.fillStyle = c; g.globalAlpha = 0.5; g.fillText(label, 6, 3); g.globalAlpha = 1;
      g.strokeStyle = 'hsl(35 85% 52%)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(...geo.start);
      for (let i = 0; i < 3; i++) g.lineTo(...geo.pts[i]);
      g.lineTo(geo.sustainEnd, geo.pts[2][1]); g.lineTo(...geo.pts[3]); g.stroke();
      geo.pts.forEach(([x, y], i) => {
        g.fillStyle = '#d03040'; g.beginPath(); g.arc(x, y, i === dragging?.i ? 6 : 4.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = c; g.fillText(`R${i + 1} ${geo.r[i]}`, clamp(x - 22, 2, EW - 46), EH - 11);
        g.fillText(`L${i + 1} ${geo.l[i]}`, clamp(x + 6, 2, EW - 40), y + (y > 20 ? -12 : 4));
      });
    };
    const point = e => { const r = canvas.getBoundingClientRect(), s = r.width ? EW / r.width : 1; return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }; };
    canvas.addEventListener('mousedown', e => {
      const { x, y } = point(e), geo = geometry();
      let best = -1, dist = 14;
      geo.pts.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < dist) { dist = d; best = i; } });
      if (best >= 0) dragging = { i: best, x0: x, rate0: geo.r[best] };
      draw();
    });
    canvas.addEventListener('mousemove', e => {
      if (!dragging) return;
      const { x, y } = point(e);
      set('l', dragging.i, levelAt(clamp(1 - (y - PAD) / (EH - 2 * PAD - 10), 0, 1)));
      set('r', dragging.i, clamp(Math.round(dragging.rate0 - (x - dragging.x0) * 0.4), 0, 99));
      draw();
    });
    const stop = () => { dragging = null; draw(); };
    canvas.addEventListener('mouseup', stop);
    canvas.addEventListener('mouseleave', stop);
    refreshers.push(draw);
    return canvas;
  };
  const stepsPerSecond = r => { const q = Math.min(63, (r * 41) >> 6); return ((4 + (q & 3)) * Math.pow(2, q >> 2) / 524288) * 44100; };
  const nearestLevel = y => { let best = 0, d = 1e9; for (let lv = 0; lv <= 99; lv++) { const e = Math.abs(scaleOL(lv) / 127 - y); if (e < d) { d = e; best = lv; } } return best; };
  const opEnv = envGraph({
    label: 'envelope: drag the dots (left/right = rate, up/down = level)',
    get: () => ({ l: voice().ops[op].l, r: voice().ops[op].r }),
    set: (kind, i, value) => { voice().ops[op][kind][i] = value; commit(); drawAlg(); },
    yOf: lv => scaleOL(lv) / 127, levelAt: nearestLevel,
    seconds: (i, a, b, r) => (Math.abs(scaleOL(b) - scaleOL(a)) / stepsPerSecond(r)) / (b > a && i === 0 ? 3 : 1),
  });
  const pitchEnv = envGraph({
    label: 'pitch envelope: 50 is no change, ±4 octaves',
    W: 360, H: 100,
    get: () => ({ l: voice().pl, r: voice().pr }),
    set: (kind, i, value) => { voice()[kind === 'l' ? 'pl' : 'pr'][i] = value; commit(); },
    yOf: lv => lv / 99, levelAt: y => Math.round(y * 99),
    seconds: (i, a, b, r) => (Math.abs(b - a) * 0.08) / (0.04 * Math.pow(2, r / 9)),
  });

  // ---- the operator tab ----
  const opv = () => voice().ops[op];
  const setOp = (key, value) => edit(v => { v.ops[op][key] = value; });
  const freqText = el('div', { className: 'tag' });
  refreshers.push(() => { const p = opv(); freqText.textContent = p.mode ? `fixed ${Math.pow(10, (p.fc & 3) + p.ff / 100).toFixed(1)} Hz` : `ratio ${((p.fc === 0 ? 0.5 : p.fc) * (1 + p.ff / 100)).toFixed(3)}`; });
  const opTitle = el('b');
  refreshers.push(() => { opTitle.textContent = `Operator ${op + 1}`; });
  const opTab = el('div', {},
    el('div', { className: 'prow' }, opTitle, ...[0, 1, 2, 3, 4, 5].map(k => button(String(k + 1), () => { op = k; refreshAll(); })),
      button('copy', () => { clipboard = JSON.parse(JSON.stringify(opv())); say(`Copied operator ${op + 1}.`); }),
      button('paste', () => { if (clipboard) edit(v => { v.ops[op] = JSON.parse(JSON.stringify(clipboard)); }); })),
    toggle('fixed frequency', () => opv().mode === 1, on => setOp('mode', on ? 1 : 0)),
    slider('coarse', 0, 31, () => opv().fc, n => setOp('fc', n)),
    slider('fine', 0, 99, () => opv().ff, n => setOp('ff', n)),
    slider('detune', 0, 14, () => opv().det, n => setOp('det', n), n => (n - 7 > 0 ? `+${n - 7}` : String(n - 7))),
    freqText, opEnv,
    slider('output level', 0, 99, () => opv().ol, n => setOp('ol', n)),
    slider('velocity sens', 0, 7, () => opv().kvs, n => setOp('kvs', n)),
    slider('rate scaling', 0, 7, () => opv().rs, n => setOp('rs', n)),
    slider('amp mod sens', 0, 3, () => opv().ams, n => setOp('ams', n)));

  // ---- keyboard level scaling ----
  const scaleCanvas = el('canvas', { width: W, height: 90, className: 'dx' });
  const sctx = scaleCanvas.getContext('2d');
  const N0 = 21, N1 = 120;
  const drawScale = () => {
    const c = ink(scaleCanvas), p = opv();
    sctx.clearRect(0, 0, W, 90);
    sctx.fillStyle = 'rgba(128,128,128,0.14)'; sctx.fillRect(0, 0, W, 90);
    sctx.font = '9px ui-monospace, Consolas, monospace'; sctx.textBaseline = 'top';
    const xOf = n => 8 + ((n - N0) / (N1 - N0)) * (W - 16), mid = 45;
    sctx.strokeStyle = c; sctx.globalAlpha = 0.3; sctx.beginPath(); sctx.moveTo(0, mid); sctx.lineTo(W, mid); sctx.stroke(); sctx.globalAlpha = 1;
    sctx.strokeStyle = 'hsl(35 85% 52%)'; sctx.lineWidth = 2.5; sctx.beginPath();
    for (let n = N0; n <= N1; n++) { const y = mid - clamp(levelScaling(n, p), -64, 64) * 0.65; if (n === N0) sctx.moveTo(xOf(n), y); else sctx.lineTo(xOf(n), y); }
    sctx.stroke();
    sctx.fillStyle = '#d03040'; sctx.beginPath(); sctx.arc(xOf(N0 + p.bp), mid, 5, 0, Math.PI * 2); sctx.fill();
    sctx.fillStyle = c; sctx.fillText(`break ${noteName(N0 + p.bp)}`, clamp(xOf(N0 + p.bp) - 20, 2, W - 60), 78);
    sctx.fillText(`operator ${op + 1} · louder up, quieter down, in 0.75 dB steps`, 6, 3);
  };
  let dragBp = false;
  const bpFrom = e => { const r = scaleCanvas.getBoundingClientRect(), s = r.width ? W / r.width : 1; const x = (e.clientX - r.left) * s; setOp('bp', clamp(Math.round(((x - 8) / (W - 16)) * (N1 - N0)), 0, 99)); };
  scaleCanvas.addEventListener('mousedown', e => { dragBp = true; bpFrom(e); });
  scaleCanvas.addEventListener('mousemove', e => { if (dragBp) bpFrom(e); });
  scaleCanvas.addEventListener('mouseup', () => { dragBp = false; });
  scaleCanvas.addEventListener('mouseleave', () => { dragBp = false; });
  refreshers.push(drawScale);
  const scaleTab = el('div', {},
    el('div', { className: 'prow' }, el('b', { textContent: 'Scaling of operator' }), ...[0, 1, 2, 3, 4, 5].map(k => button(String(k + 1), () => { op = k; refreshAll(); }))),
    scaleCanvas,
    slider('break point', 0, 99, () => opv().bp, n => setOp('bp', n), n => noteName(N0 + n)),
    slider('left depth', 0, 99, () => opv().ld, n => setOp('ld', n)),
    select('left curve', CURVES, () => opv().lc, n => setOp('lc', n)),
    slider('right depth', 0, 99, () => opv().rd, n => setOp('rd', n)),
    select('right curve', CURVES, () => opv().rc, n => setOp('rc', n)));

  // ---- LFO and pitch envelope ----
  const lfoCanvas = el('canvas', { width: W, height: 70, className: 'dx' });
  const lctx = lfoCanvas.getContext('2d');
  const drawLfo = () => {
    const v = voice(), c = ink(lfoCanvas);
    lctx.clearRect(0, 0, W, 70);
    lctx.fillStyle = 'rgba(128,128,128,0.14)'; lctx.fillRect(0, 0, W, 70);
    lctx.font = '9px ui-monospace, Consolas, monospace'; lctx.textBaseline = 'top';
    const hz = 0.062 * Math.pow(50 / 0.062, v.lfs / 99), delay = Math.pow(v.lfd / 99, 2) * 5, total = Math.max(delay + 2 / hz, 1);
    lctx.strokeStyle = 'hsl(35 85% 52%)'; lctx.lineWidth = 2; lctx.beginPath();
    for (let x = 0; x < W - 12; x++) {
      const t = (x / (W - 12)) * total, ph = (t * hz) % 1;
      const w = v.lfw === 0 ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : v.lfw === 1 ? 1 - 2 * ph : v.lfw === 2 ? 2 * ph - 1 : v.lfw === 3 ? (ph < 0.5 ? 1 : -1) : v.lfw === 4 ? Math.sin(2 * Math.PI * ph) : Math.sin(t * 91.7) * Math.cos(t * 13.1);
      const fade = delay > 0 ? clamp((t - delay * 0.4) / (delay * 0.6), 0, 1) : 1;
      const y = 38 - w * fade * 24;
      if (x === 0) lctx.moveTo(6, y); else lctx.lineTo(6 + x, y);
    }
    lctx.stroke();
    lctx.fillStyle = c; lctx.globalAlpha = 0.6; lctx.fillText(`${hz.toFixed(2)} Hz · delay ${delay.toFixed(1)} s`, 6, 3); lctx.globalAlpha = 1;
  };
  refreshers.push(drawLfo);
  const lfoTab = el('div', {},
    el('b', { textContent: 'LFO' }), lfoCanvas,
    select('wave', WAVES, () => voice().lfw, n => edit(v => { v.lfw = n; })),
    slider('speed', 0, 99, () => voice().lfs, n => edit(v => { v.lfs = n; })),
    slider('delay', 0, 99, () => voice().lfd, n => edit(v => { v.lfd = n; })),
    slider('pitch depth', 0, 99, () => voice().lpmd, n => edit(v => { v.lpmd = n; })),
    slider('pitch sens', 0, 7, () => voice().pms, n => edit(v => { v.pms = n; })),
    slider('amp depth', 0, 99, () => voice().lamd, n => edit(v => { v.lamd = n; })),
    toggle('key sync', () => voice().lks === 1, on => edit(v => { v.lks = on ? 1 : 0; })),
    toggle('osc key sync', () => voice().oks === 1, on => edit(v => { v.oks = on ? 1 : 0; })),
    el('b', { textContent: 'Pitch envelope' }), pitchEnv,
    slider('transpose', 0, 48, () => voice().trnsp, n => edit(v => { v.trnsp = n; }), n => noteName(n + 36)));

  // ---- the bank tab ----
  const grid = el('div', { className: 'dx-grid' });
  const drawGrid = () => {
    grid.replaceChildren(...voices.map((v, i) => [v, i]).filter(([v]) => v.name.toLowerCase().includes(filter)).map(([v, i]) => {
      const b = el('button', { textContent: `${String(i).padStart(2, '0')} ${v.name || '-'}` });
      b.classList.toggle('on', i === cur());
      b.addEventListener('click', () => { stash = null; setVoice(i); });
      return b;
    }));
  };
  refreshers.push(drawGrid);
  const search = el('input', { placeholder: 'search', className: 'dx-search' });
  search.addEventListener('input', () => { filter = search.value.toLowerCase(); drawGrid(); });
  const swap = (a, b) => {
    if (b < 0 || b >= VOICES) return;
    const t = bytes.slice(a * 128, a * 128 + 128);
    bytes.copyWithin(a * 128, b * 128, b * 128 + 128); bytes.set(t, b * 128);
    reload(); setVoice(b);
  };
  const download = (data, name) => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    const a = el('a', { href: url, download: name });
    doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const file = el('input', { type: 'file', accept: '.syx,.bin,application/octet-stream' });
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const parsed = parseSyx(new Uint8Array(await f.arrayBuffer()));
    file.value = '';
    if (!parsed) { say('That does not look like a DX7 bank or voice (.syx).'); return; }
    bytes = parsed; source = f.name; stash = null;
    reload();
    say(`Loaded ${f.name}: ${voices.filter(v => v.name).length} voices.`);
  });
  const abButton = button('A/B', () => {
    const at = cur() * 128, now = bytes.slice(at, at + 128);
    if (!stash) { stash = now; say('B is now a copy of this voice: edit, then press A/B to compare.'); }
    else { bytes.set(stash, at); stash = now; reload(); }
  }, 'press once to keep a copy of the voice; press again to swap between the copy and your edits');
  const bankTab = el('div', {},
    el('div', { className: 'prow' }, button('Load .syx…', () => file.click()), file,
      button('Save bank', () => download(bankToSyx(bytes), 'bank.syx')), button('Save voice', () => download(voiceToSyx(voice()), `${(voice().name || 'voice').trim()}.syx`)),
      search),
    el('div', { className: 'prow' }, button('▲ move', () => swap(cur(), cur() - 1)), button('▼ move', () => swap(cur(), cur() + 1)), abButton),
    grid);

  // ---- assembly ----
  const info = el('div', { className: 'dx-info' });
  refreshers.push(() => { info.textContent = `voice ${cur()} · algorithm ${voice().alg + 1} · feedback ${voice().fb} · ${source}`; });
  const sections = { voice: voiceTab, operator: opTab, scaling: scaleTab, 'lfo / pitch': lfoTab, bank: bankTab };
  const tabs = el('div', { className: 'prow dx-tabs' });
  const showTab = name => {
    tab = name;
    for (const [k, node] of Object.entries(sections)) node.style.display = k === name ? '' : 'none';
    for (const b of tabs.children) b.classList.toggle('on', b.textContent === name);
    refreshAll();
  };
  for (const name of Object.keys(sections)) tabs.append(button(name, () => showTab(name)));
  const refreshAll = () => { for (const f of refreshers) f(); };
  const root = el('div', { className: 'curve-editor dx-view' }, tabs, ...Object.values(sections), info);
  showTab(tab);

  return {
    el: root,
    refresh: refreshAll,
    get bank() { return voices; },
    get bytes() { return bytes; },
    selectOp(k) { op = k; refreshAll(); },
    loadBytes(b) { bytes = Uint8Array.from(b); reload(); },   // test hook
  };
}

function randomVoice(name) {
  const pick = a => a[Math.floor(Math.random() * a.length)], int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const alg = int(0, 31), carriers = ALGORITHMS[alg].carriers;
  const ops = Array.from({ length: 6 }, (_, k) => blankOp({
    fc: pick([0, 1, 1, 1, 2, 2, 3, 4, 5, 7]), ff: Math.random() < 0.2 ? int(0, 60) : 0, det: int(5, 9),
    ol: carriers.includes(k) ? int(80, 99) : int(30, 90), kvs: int(0, 4),
    r: [int(70, 99), int(20, 80), int(15, 60), int(40, 80)], l: [99, int(60, 99), int(0, 90), 0],
  }));
  return { ...initVoice({ name }), alg, fb: int(0, 7), ops };
}
