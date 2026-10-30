// The Node Sequencer's editor: a canvas of nodes and wires, a bar above it (the palette, the subticks, the groups) and a panel beside it for
// the selected node. Events run along amber square ports, controls along cyan round ones; wires are drawn behind the nodes, and a little
// light runs along a wire each time an event goes down it. The data is the song's `nodeseq` (see graphops.js); the audio thread runs it
// (audio/nodeseq.js) and sends back what it did, which is drawn here.
import { NS_TYPES, DOT_TYPES, insOf, parseList, parseChordList, compileScript, DEFAULT_SCRIPT } from './nodes.js';
import { ensureGraph, newGraph, addNode, connect, disconnect, removeNodes, duplicateNodes, cleanGraph, canConnect, GROUP_NAMES } from './graphops.js';
import { chordView } from './chordtext.js';
import { tileSize, tileLabel, drawGlyph, isDot, DOT } from './tiles.js';
import { noteName } from '../seq/chordname.js';
import { showContextMenu } from '../ui/ctxmenu.js';

const FONT = '7px ui-monospace, Consolas, monospace', CATS = ['time', 'rhythm', 'values', 'chords', 'control', 'output', 'code', 'groups', 'routing'];
export const GROUP_COLORS = ['#e0a84a', '#4fc3d9', '#c792ea', '#5fbf6a', '#ee7d5c', '#8a96f2', '#e5669c', '#a3b34c'];
const METER = new Set(['lfo', 'ad', 'scale', 'hold', 'Pwhite', 'set']);   // nodes that show a level

const fmt = v => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function createNodeSeqEditor({ root, getSong, noteTargets = () => [], paramTargets = () => [], onStructure = () => {}, onParam = () => {}, onData = () => {}, onGroupLane = () => {}, isRecording = () => false, say = () => {}, doc = document }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
  const song = () => getSong();
  const graph = () => song()?.nodeseq;

  // ---- the page
  const bar = el('div', { id: 'ns-bar' }), stage = el('div', { id: 'ns-stage' }), side = el('aside', { id: 'ns-side' }), foot = el('div', { id: 'ns-foot', className: 'statusbar' });
  const canvas = el('canvas', { id: 'ns-canvas', tabIndex: 0 });
  canvas.setAttribute('aria-label', 'Node Sequencer graph');
  const palette = el('div', { id: 'ns-palette', hidden: true });
  stage.append(canvas, palette);
  root.append(bar, el('div', { id: 'ns-layout' }, stage, side), foot);
  const ctx = canvas.getContext('2d');

  // ---- state
  let view = { x: -20, y: -20, zoom: 1 }, sel = new Set(), selWire = null, drag = null, hover = null, stretch = null, hoverNode = null, lastHoverNode = null, mouse = [0, 0], dirty = true;
  const WIRE_DASH = { e: [], c: [3, 3], h: [7, 2.5], w: [1, 3] };
  const kindColor = (C, k) => (k === 'e' ? C.ev : k === 'h' ? C.hc : k === 'w' ? C.wc : C.ct);
  let active = new Set(), activeTo = new Set();   // the chord nodes a Phrase node is playing, and the wires they play along
  let live = null, pulses = [], flash = new Map(), errors = new Map(), mon = [];   // what the audio thread has told us
  const curves = new WeakMap();   // each wire's last drawn curve, for hit testing and the lights (kept off the wire itself, which is saved)
  let W = 600, H = 400, dpr = 1, boxes = new Map(), lastDraw = 0;
  const undoStack = [], redoStack = [];
  const dark = () => { const m = (typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '').match(/\d+/g) ?? [20, 20, 20]; return (m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11) > 140; };   // light ink means a dark page
  // Each kind of port and wire is a deep tint, close to the ink.
  const colours = () => {
    const d = dark(), cs = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
    // A drawing in ink on paper: every kind of port and wire is the ink colour, told apart by shape and dash. Only a selection (blue) and an error (red) have a colour.
    const ink = cs?.color || '#ccc';
    return { ink, bg: cs?.backgroundColor || '#222', paper: d ? '#25282e' : '#eceef1', ...(d ? { ev: '#e8b866', ct: '#7ad2e0', hc: '#bda4ea', wc: '#a6d27c' } : { ev: '#7a4d0a', ct: '#14606d', hc: '#52398c', wc: '#3d6020' }), hi: cs?.getPropertyValue('--hi').trim() || '#3b6ea8', bad: '#e5484d', dark: d };
  };

  // ---- the bar
  const palBtn = el('button', { type: 'button', textContent: '+ Node', title: 'Add a node (A, or right-click the graph)' });
  const subIn = el('input', { type: 'number', min: 1, max: 16, step: 1, value: 4, title: 'Subticks in a tick: events can fall on any of them', ariaLabel: 'Subticks' }); subIn.style.width = '3.2em';
  const groupsEl = el('span', { className: 'ns-groups', title: 'Groups of nodes. A lit one starts when the song does; a pattern lane can start and stop them (G1 to G8 columns).' });
  const laneBtn = el('button', { type: 'button', textContent: 'Pattern lane', title: 'Add the lane whose G1 to G8 columns start and stop the groups from a pattern' });
  const recNote = el('span', { className: 'ns-rec', textContent: '', title: 'Notes the graph plays are written into the pattern lanes of the same instrument while the song plays and Rec is on' });
  bar.append(palBtn, el('label', { textContent: 'subticks ' }, subIn), groupsEl, laneBtn, recNote);

  const groupPills = [];
  for (let g = 0; g < 8; g++) {
    const b = el('button', { type: 'button', textContent: GROUP_NAMES[g], className: 'ns-g' });
    b.style.setProperty('--gc', GROUP_COLORS[g]);
    b.addEventListener('click', () => { checkpoint(); const gr = ensureGraph(song()); gr.groups[g].on = !gr.groups[g].on; structure(); });
    groupPills.push(b); groupsEl.append(b);
  }
  const syncBar = () => {
    const g = graph();
    subIn.value = g?.sub ?? 4;
    groupPills.forEach((b, i) => {
      const used = !!g?.nodes.some(n => (n.group ?? 0) === i), on = g?.groups?.[i]?.on ?? true;
      b.classList.toggle('on', on); b.classList.toggle('used', used);
      b.title = `Group ${GROUP_NAMES[i]}: ${on ? 'starts with the song' : 'waits for a pattern or a run node'}${used ? '' : ' (no nodes in it)'}${live ? (live.on[i] ? ', running now' : ', stopped now') : ''}`;
      b.classList.toggle('live', !!live && live.on[i] && used);
    });
    recNote.textContent = isRecording() ? '● recording notes into patterns' : '';
  };
  subIn.addEventListener('change', () => { checkpoint(); const g = ensureGraph(song()); g.sub = clamp(Math.round(Number(subIn.value)) || 4, 1, 16); subIn.value = g.sub; structure(); });
  subIn.addEventListener('keydown', e => e.stopPropagation());
  laneBtn.addEventListener('click', () => onGroupLane());

  // ---- history
  const snap = () => JSON.stringify(graph() ?? null);
  function checkpoint() { const s = snap(); if (undoStack.at(-1) !== s) { undoStack.push(s); if (undoStack.length > 200) undoStack.shift(); } redoStack.length = 0; }
  const restore = s => { const sg = song(); if (!sg) return; const v = JSON.parse(s); if (v) sg.nodeseq = cleanGraph(v); else delete sg.nodeseq; sel = new Set([...sel].filter(id => graph()?.nodes.some(n => n.id === id))); selWire = null; structure(true); };
  const undo = () => { if (!undoStack.length) return say('Nothing to undo.'); redoStack.push(snap()); restore(undoStack.pop()); };
  const redo = () => { if (!redoStack.length) return say('Nothing to redo.'); undoStack.push(snap()); restore(redoStack.pop()); };

  // Something about the structure of the graph changed: the engine takes the whole graph again (nodes that stay keep their state).
  function structure(quiet = false) { dirty = true; syncBar(); renderSide(); if (!quiet || true) onStructure(); }

  // ---- geometry
  const nodeOf = id => graph()?.nodes.find(n => n.id === id);
  // A tile: its ports are spread along its left (in) and right (out) edges.
  function layout(n) {
    const T = NS_TYPES[n.type], ins = insOf(n.type, graph()?.wires ?? [], n.id), { w, h } = tileSize(n.type, ins.length, T.outs.length, n.data, n.params);
    const b = { x: n.x, y: n.y, w, h, ins: [], outs: [] };
    const wired = new Set((graph()?.wires ?? []).filter(x => x.to.startsWith(`${n.id}.`)).map(x => x.to));
    const at = (i, count) => n.y + h * (i + 1) / (count + 1);
    if (isDot(n.type)) { const c = { x: n.x + DOT / 2, y: n.y + DOT / 2 }; b.ins.push({ ...ins[0], ...c }); b.outs.push({ ...T.outs[0], ...c }); return b; }
    ins.forEach((p, i) => b.ins.push({ ...p, free: p.dyn && !wired.has(`${n.id}.${p.n}`), x: n.x, y: at(i, ins.length) }));
    T.outs.forEach((p, i) => b.outs.push({ ...p, x: n.x + w, y: at(i, T.outs.length) }));
    return b;
  }
  const portPos = (ref, side) => {
    const [id, name] = ref.split('.'), b = boxes.get(id);
    return b?.[side === 'out' ? 'outs' : 'ins'].find(p => p.n === name) ?? null;
  };
  const toScreen = (x, y) => [(x - view.x) * view.zoom, (y - view.y) * view.zoom];
  const toWorld = (sx, sy) => [sx / view.zoom + view.x, sy / view.zoom + view.y];
  // A wire is a line of right angles from the output to the input. A wire that runs backwards loops round the two nodes. Wires from one output share
  // their upright, so they join like a bus.
  const bendOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 7; return (h - 3) * 2.5; };
  // A wire may carry a bend {bx} or {sx, by, tx}: where the user dragged its straight stretches to. The line has a list `keys` saying which bend each
  // stretch answers to (null for the two end stretches, which stay put).
  function route(a, b, id = '', bd = {}) {
    const pad = 8;
    if (b.x - a.x >= 2 * pad + 4) {
      const xm = clamp(bd.bx ?? (a.x + b.x) / 2 + bendOf(id), a.x + pad, b.x - pad), line = [[a.x, a.y], [xm, a.y], [xm, b.y], [b.x, b.y]];
      line.keys = [null, 'bx', null]; return line;
    }
    const ym = bd.by ?? (a.y + b.y) / 2 + (Math.abs(a.y - b.y) < 24 ? 26 : 0), sx = Math.max(bd.sx ?? 0, a.x + pad), tx = Math.min(bd.tx ?? 1e9, b.x - pad);
    const line = [[a.x, a.y], [sx, a.y], [sx, ym], [tx, ym], [tx, b.y], [b.x, b.y]];
    line.keys = [null, 'sx', 'by', 'tx', null]; return line;
  }
  // The stretch of a wire nearest to a point that can be dragged: the end stretches hand over to the next one in.
  function nearStretch(wx, wy) {
    const g = graph(); if (!g) return null;
    let best = null;
    for (const wr of g.wires) {
      const c = curves.get(wr); if (!c) continue;
      for (let i = 1; i < c.length; i++) {
        const [x0, y0] = c[i - 1], [x1, y1] = c[i], dx = x1 - x0, dy = y1 - y0, t = clamp(((wx - x0) * dx + (wy - y0) * dy) / Math.max(1e-6, dx * dx + dy * dy), 0, 1);
        const d = Math.hypot(x0 + dx * t - wx, y0 + dy * t - wy);
        if (d < 6 / view.zoom + 2 && (!best || d < best.d)) best = { d, wr, k: clamp(i - 1, 1, c.length - 3) };
      }
    }
    if (!best) return null;
    const c = curves.get(best.wr), [x0, y0] = c[best.k], [x1, y1] = c[best.k + 1];
    return { wr: best.wr, k: best.k, key: c.keys[best.k], vertical: x0 === x1, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
  }
  const overArrows = (st, wx, wy) => st && Math.hypot(wx - st.mx, wy - st.my) < 14 / view.zoom + 4;
  function drawArrows(C, st) {   // a pair of arrows in the middle of a stretch, pointing the way it can be moved
    const { mx, my, vertical } = st, r = 4.5, l = 9, [ux, uy] = vertical ? [1, 0] : [0, 1], [vx, vy] = [-uy, ux];
    ctx.fillStyle = C.hi;
    for (const s of [-1, 1]) {
      const tx = mx + ux * s * (l + r), ty = my + uy * s * (l + r);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(mx + ux * s * l + vx * r, my + uy * s * l + vy * r); ctx.lineTo(mx + ux * s * l - vx * r, my + uy * s * l - vy * r); ctx.closePath(); ctx.fill();
    }
  }
  function tracePath(pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) ctx.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3);
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }
  function along(pts, t) {   // the point a fraction of the way along a line
    const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let at = t * len[len.length - 1], i = 1; while (i < pts.length - 1 && len[i] < at) i++;
    const f = (at - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  }
  const nearLine = (pts, x, y, r) => { for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], dx = x1 - x0, dy = y1 - y0, t = clamp(((x - x0) * dx + (y - y0) * dy) / Math.max(1e-6, dx * dx + dy * dy), 0, 1); if (Math.hypot(x0 + dx * t - x, y0 + dy * t - y) < r) return true; } return false; };

  // ---- drawing
  function draw(force = false) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    pulses = pulses.filter(p => now - p.t < 320);
    const busy = pulses.length > 0 || flash.size > 0 || live !== null;
    if (!dirty && !force && !busy) return;
    dirty = false;
    const rect = canvas.parentElement?.getBoundingClientRect?.();
    const w = Math.max(200, Math.floor(rect?.width || W)), h = Math.max(160, Math.floor(rect?.height || H));
    dpr = globalThis.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
    W = w; H = h;
    const C = colours(), g = graph();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT;
    // the dotted grid
    const step = 24 * view.zoom;
    if (step > 7) { ctx.fillStyle = C.dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.14)'; const ox = -((view.x * view.zoom) % step), oy = -((view.y * view.zoom) % step); for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) ctx.fillRect(x, y, 1, 1); }
    if (!g || !g.nodes.length) {
      ctx.fillStyle = C.ink; ctx.globalAlpha = 0.55; ctx.textAlign = 'center';
      ctx.fillText('An empty graph. Press A, or right-click, to add a node: start with a clock.', W / 2, H / 2 - 8);
      ctx.fillText('Events run on square ports, controls on round ones, chords on diamonds, weights on triangles. Drag from an output to an input.', W / 2, H / 2 + 12);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      return;
    }
    ctx.save();
    ctx.scale(view.zoom, view.zoom); ctx.translate(-view.x, -view.y);
    boxes = new Map(g.nodes.map(n => [n.id, layout(n)]));
    active = new Set(); activeTo = new Set();
    for (const n of g.nodes) { const v = n.type === 'Phrase' ? live?.nodes?.[n.id] : null; if (v?.src) { active.add(v.src); activeTo.add(`${n.id}.${v.port}`); } }
    // wires first: they go behind the nodes
    g.wires.forEach((wr, i) => {
      const a = portPos(wr.from, 'out'), b = portPos(wr.to, 'in');
      if (!a || !b) return;
      const c = route(a, b, wr.from, wr.bend), picked = selWire === wr, lit = !wr.off && activeTo.has(wr.to);
      tracePath(c);
      ctx.strokeStyle = picked ? C.hi : kindColor(C, a.k); ctx.lineWidth = picked ? 2.6 : lit ? 2.6 : 1.1; ctx.globalAlpha = picked || lit ? 1 : 0.85;
      ctx.setLineDash(wr.off ? [2, 5] : WIRE_DASH[a.k]);   // the kind of wire: solid events, dashed controls, long dashes chords, dots weights
      if (wr.off) { ctx.globalAlpha = picked ? 0.8 : 0.4; }   // switched off: faint
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      curves.set(wr, c);
    });
    for (const p of pulses) {   // a light along a wire that carried an event
      const wr = liveWires()[p.w];
      const c = wr && curves.get(wr); if (!c) continue;
      const t = clamp((now - p.t) / 300, 0, 1), [x, y] = along(c, t);
      ctx.globalAlpha = 1 - t * 0.6; ctx.fillStyle = C.bg; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const n of g.nodes) drawNode(n, boxes.get(n.id), C);
    if (drag?.kind === 'wire') {   // the wire being made
      const a = drag.from.side === 'out' ? portPos(`${drag.from.id}.${drag.from.name}`, 'out') : portPos(`${drag.from.id}.${drag.from.name}`, 'in');
      if (a) {
        const [mx, my] = toWorld(drag.x, drag.y), b = { x: mx, y: my }, c = drag.from.side === 'out' ? route(a, b) : route(b, a);
        tracePath(c); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.8; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    if (drag?.kind === 'marquee') { ctx.strokeStyle = C.hi; ctx.fillStyle = C.hi; ctx.globalAlpha = 0.15; const [x0, y0] = toWorld(drag.x0, drag.y0), [x1, y1] = toWorld(drag.x, drag.y); ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.globalAlpha = 1; ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
    if (!drag && stretch) drawArrows(C, stretch);
    ctx.restore();
    drawHint(C);
    for (const [id, t] of flash) if (now - t > 260) flash.delete(id);
  }

  // The name of the port (or the node) under the pointer: the tiles carry no names of their own.
  const KIND_WORDS = { e: 'event', c: 'control', h: 'chord', w: 'weights' };
  function drawHint(C) {
    let text = '';
    if (hover) text = /^c\d+$/.test(hover.name) && NS_TYPES[nodeOf(hover.id)?.type]?.dynIn ? `chord ${hover.name.slice(1)}${hover.free ? ' (free)' : ''}` : `${hover.name}  ·  ${KIND_WORDS[hover.k]}`;
    else if (hoverNode) { const n = nodeOf(hoverNode); if (n) text = `${NS_TYPES[n.type].title}  ·  ${n.id}`; }
    if (!text || drag) return;
    ctx.save(); ctx.font = '11px ui-monospace, Consolas, monospace';
    const w = ctx.measureText(text).width + 12, [mx, my] = mouse, x = Math.min(mx + 12, W - w - 4), y = my + 16;
    ctx.fillStyle = '#23262b'; ctx.globalAlpha = 0.95; roundRect(x, y, w, 19, 3); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#f1efe8'; ctx.fillText(text, x + 6, y + 13);
    ctx.restore();
  }
  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  function drawNode(n, b, C) {
    const T = NS_TYPES[n.type], picked = sel.has(n.id), now = typeof performance !== 'undefined' ? performance.now() : 0, off = live && !live.on[n.group ?? 0];
    ctx.save();
    if (off) ctx.globalAlpha = 0.5;
    if (isDot(n.type)) {   // a route point: a solid dot in its wire's colour
      ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, 7); ctx.fillStyle = kindColor(C, T.outs[0].k); ctx.fill();
      ctx.strokeStyle = picked ? C.hi : C.ink; ctx.lineWidth = picked ? 2.5 : 1; ctx.stroke();
      ctx.restore(); return;
    }
    ctx.fillStyle = C.bg; ctx.fillRect(b.x, b.y, b.w, b.h);   // the page's own colour, so a wire behind the tile does not show through
    const f = flash.get(n.id);
    ctx.strokeStyle = picked ? C.hi : C.ink; ctx.lineWidth = picked || active.has(n.id) || (f && now - f < 260) ? 2 : 1;   // the playing chord and a node that just got an event are drawn heavier
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    if ((n.group ?? 0) > 0) { ctx.font = '6px ui-monospace, Consolas, monospace'; ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.fillText(GROUP_NAMES[n.group], b.x + b.w - 3, b.y + 8); ctx.textAlign = 'left'; }   // the group, when it is not A
    if (errors.has(n.id)) { ctx.fillStyle = C.bad; ctx.beginPath(); ctx.arc(b.x + b.w - 5, b.y + 5, 2.5, 0, 7); ctx.fill(); }
    drawBody(n, b, C, T);
    if (METER.has(n.type)) { const v = clamp(live?.nodes?.[n.id]?.v ?? 0, 0, 1); ctx.fillStyle = C.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)'; ctx.fillRect(b.x + 6, b.y + b.h - 5, b.w - 12, 2); ctx.fillStyle = C.ct; ctx.fillRect(b.x + 6, b.y + b.h - 5, (b.w - 12) * v, 2); }
    for (const p of b.ins) port(p, C, 'in');
    for (const p of b.outs) port(p, C, 'out');
    ctx.restore();
  }

  function port(p, C, side) {
    const col = kindColor(C, p.k);
    ctx.beginPath();
    if (p.k === 'e') ctx.rect(p.x - 3, p.y - 3, 6, 6);
    else if (p.k === 'h') { ctx.moveTo(p.x, p.y - 4.2); ctx.lineTo(p.x + 4.2, p.y); ctx.lineTo(p.x, p.y + 4.2); ctx.lineTo(p.x - 4.2, p.y); ctx.closePath(); }
    else if (p.k === 'w') { ctx.moveTo(p.x - 3.6, p.y + 3); ctx.lineTo(p.x + 3.6, p.y + 3); ctx.lineTo(p.x, p.y - 3.6); ctx.closePath(); }
    else ctx.arc(p.x, p.y, 3.2, 0, 7);
    if (p.free) { ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([1.5, 1.5]); ctx.stroke(); ctx.setLineDash([]); }   // the spare chord port of a Phrase node
    else { ctx.fillStyle = C.paper; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }   // a port is ringed in the colour of its kind
    if (drag?.kind === 'wire' && drag.ok?.(p, side)) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); if (p.k === 'e') ctx.rect(p.x - 5.5, p.y - 5.5, 11, 11); else ctx.arc(p.x, p.y, 6, 0, 7); ctx.stroke(); }
  }

  const WHITE_PC = [0, 2, 4, 5, 7, 9, 11], BLACK_AT = { 1: 0.7, 3: 1.7, 6: 3.7, 8: 4.7, 10: 5.7 };
  // Two octaves of keyboard under a Chord node: the chord's notes lit, and under each lit key a bar for that note's volume.
  function drawKeyboard(n, b, C) {
    const cv = chordView(n.data, n.params), on = active.has(n.id), kw = 4.2, x = b.x + b.w / 2 - kw * 7, ky = b.y + 15;
    const lo = cv.notes.length ? Math.floor(Math.min(...cv.notes) / 12) * 12 : 48;
    const index = new Map(cv.notes.map((m, i) => [m, i])), liveVels = live?.nodes?.[n.id]?.vels;   // while playing, the volumes the controls give now
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = keep * (on ? 1 : 0.65);
    for (let i = 0; i < 14; i++) {
      const m = lo + WHITE_PC[i % 7] + 12 * Math.floor(i / 7);
      const lit = index.has(m); ctx.fillStyle = lit ? C.ink : C.bg; ctx.fillRect(x + i * kw, ky, kw - 0.5, 14);
      if (!lit) { ctx.strokeStyle = C.ink; ctx.lineWidth = 0.5; ctx.strokeRect(x + i * kw + 0.25, ky + 0.25, kw - 1, 13.5); }
    }
    for (let o = 0; o < 2; o++) for (const k in BLACK_AT) {
      const m = lo + Number(k) + 12 * o, bx = x + (BLACK_AT[k] + 7 * o) * kw + kw * 0.62;
      ctx.globalAlpha = keep * (on ? 1 : 0.65);
      if (index.has(m)) { ctx.fillStyle = C.bg; ctx.fillRect(bx, ky, kw * 0.62, 8.5); ctx.strokeStyle = C.ink; ctx.lineWidth = 0.8; ctx.strokeRect(bx + 0.4, ky + 0.4, kw * 0.62 - 0.8, 7.7); }   // a pressed black key is drawn hollow
      else { ctx.fillStyle = C.ink; ctx.fillRect(bx, ky, kw * 0.62, 8.5); }
    }
    ctx.globalAlpha = keep * (on ? 1 : 0.65);
    for (const [m, i] of index) {   // the volume bars
      const pc = m - lo, oct = Math.floor(pc / 12);
      if (pc < 0 || pc >= 24) continue;
      const wi = WHITE_PC.indexOf(pc % 12), cx = wi >= 0 ? x + (wi + 7 * oct) * kw + kw / 2 : x + (BLACK_AT[pc % 12] + 7 * oct) * kw + kw * 0.93;
      const h = 11 * (liveVels?.length === cv.notes.length ? liveVels[i] : cv.vels[i]); ctx.fillStyle = C.ev; ctx.fillRect(cx - 1.5, ky + 17 + (11 - h), 3, Math.max(1, h));
    }
    ctx.globalAlpha = keep;
  }

  function drawBody(n, b, C, T) {
    const v = live?.nodes?.[n.id], cx = b.x + b.w / 2, x0 = b.x + 6, w = b.w - 12;
    void T;
    if (n.type === 'steps') {
      const cells = n.data?.cells ?? [], cnt = Math.round(n.params?.n ?? 16), cw = w / cnt, top = b.y + 8, hh = b.h - 16;
      for (let i = 0; i < cnt; i++) {
        const lv = Number(cells[i]) || 0, x = x0 + i * cw;
        ctx.fillStyle = C.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.09)'; ctx.fillRect(x + 0.5, top, cw - 1, hh);
        if (lv > 0) { ctx.fillStyle = C.ev; ctx.fillRect(x + 0.5, top + hh * (1 - lv), cw - 1, hh * lv); }
        if (v?.i === i) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.strokeRect(x + 0.5, top - 0.5, cw - 1, hh + 1); }
        if (i % 4 === 0) { ctx.fillStyle = C.ink; ctx.globalAlpha *= 0.4; ctx.fillRect(x + 0.5, top + hh + 2, 1, 2); ctx.globalAlpha /= 0.4; }
      }
      return;
    }
    if (n.type === 'euclid') {
      const s = Math.max(1, Math.round(n.params?.steps ?? 8)), cw = Math.min(9, w / s), x1 = cx - cw * s / 2;
      for (let i = 0; i < s; i++) {
        ctx.fillStyle = euclid(i, n.params) ? C.ev : C.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.13)'; ctx.fillRect(x1 + i * cw + 0.5, b.y + b.h / 2 - 6, cw - 1, 12);
        if (v?.i === i) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.strokeRect(x1 + i * cw + 0.5, b.y + b.h / 2 - 6.5, cw - 1, 13); }
      }
      return;
    }
    if (n.type === 'Voicing') {
      const cnt = Math.round(n.params?.notes ?? 4), cw = w / cnt, hh = b.h - 14;
      for (let i = 0; i < cnt; i++) { const lv = clamp((n.data?.weights?.[i] ?? 100) / 100, 0, 1); ctx.fillStyle = C.wc; ctx.fillRect(x0 + i * cw + 1, b.y + 7 + hh * (1 - lv), cw - 2, Math.max(1, hh * lv)); }
      return;
    }
    if (n.type === 'lfo') {   // the wave it makes, in the tile
      ctx.strokeStyle = C.ct; ctx.lineWidth = 1.2; ctx.beginPath();
      const shape = Math.round(n.params?.shape ?? 0), depth = n.params?.depth ?? 1, centre = n.params?.center ?? 0.5, yc = b.y + b.h / 2 - 1;
      for (let i = 0; i <= 40; i++) { const p = i / 40; const wv = shape === 1 ? (p < 0.5 ? p * 4 - 1 : 3 - p * 4) : shape === 2 ? p * 2 - 1 : shape === 3 ? (p < 0.5 ? 1 : -1) : shape === 4 ? Math.sin(p * 40) * Math.cos(p * 7) : Math.sin(p * 2 * Math.PI); const yy = yc - (clamp(centre + wv * 0.5 * depth, 0, 1) - 0.5) * 18; if (i) ctx.lineTo(x0 + p * w, yy); else ctx.moveTo(x0, yy); }
      ctx.stroke();
      return;
    }
    if (n.type === 'Chord') {   // the chord's name, and the keyboard with a volume bar under each note: the keyboard says it is a chord, so no glyph
      const bad = chordView(n.data, n.params).error;
      ctx.font = FONT; ctx.fillStyle = bad ? C.bad : C.ink; ctx.globalAlpha *= 0.85; ctx.textAlign = 'center'; ctx.fillText(tileLabel(n, v, 0) || '?', cx, b.y + 10); ctx.textAlign = 'left'; ctx.globalAlpha /= 0.85;
      drawKeyboard(n, b, C);
      return;
    }
    // the rest: a glyph, and a few characters under it
    const chords = n.type === 'Phrase' ? (graph()?.wires ?? []).filter(wr => wr.to.startsWith(`${n.id}.c`)).length : 0;
    const label = tileLabel(n, v, chords);
    const bad = (n.type === 'Chord' && chordView(n.data, n.params).error) || ((n.type === 'Pseq' || n.type === 'Prand') && parseList(n.data?.text).bad.length) || (n.type === 'Pchord' && parseChordList(n.data?.text).bad.length) || errors.has(n.id) || ((n.type === 'note' || n.type === 'set') && !n.data?.target);
    drawGlyph(ctx, n.type, cx - 7, b.y + (label ? 5 : (b.h - 14) / 2), 14, C.ink);
    if (label) { ctx.font = FONT; ctx.fillStyle = bad ? C.bad : C.ink; ctx.globalAlpha *= bad ? 1 : 0.7; ctx.textAlign = 'center'; ctx.fillText(label, cx, b.y + b.h - 5); ctx.textAlign = 'left'; ctx.globalAlpha /= bad ? 1 : 0.7; }
    if (n.type === 'note' && v?.on) { ctx.fillStyle = C.ev; ctx.fillRect(b.x + b.w - 8, b.y + 3, 5, 5); }
  }

  const euclid = (i, p) => { const s = Math.max(1, Math.round(p?.steps ?? 8)), pl = Math.max(0, Math.round(p?.pulses ?? 5)), r = Math.round(p?.rot ?? 0), k = (((i + r) % s) + s) % s; return (k * pl) % s < pl; };

  // ---- hit testing (world units)
  function hitPort(wx, wy, want = null) {
    const g = graph(); if (!g) return null;
    let best = null, bd = 7;   // the nearest port within a few units
    for (const n of g.nodes) {
      const b = boxes.get(n.id); if (!b) continue;
      for (const [list, side] of [[b.outs, 'out'], [b.ins, 'in']]) for (const p of list) { if (want && side !== want) continue; const d = Math.hypot(wx - p.x, wy - p.y); if (d < (isDot(n.type) ? 4.5 : bd) && d < bd) { bd = d; best = { id: n.id, name: p.n, k: p.k, side, x: p.x, y: p.y, free: p.free }; } }
    }
    return best;
  }
  const hitNode = (wx, wy) => { const g = graph(); if (!g) return null; for (const n of [...g.nodes].reverse()) { const b = boxes.get(n.id); if (b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return n; } return null; };
  function hitWire(wx, wy) {
    const g = graph(); if (!g) return null;
    for (const wr of [...g.wires].reverse()) {
      const c = curves.get(wr); if (!c) continue;
      if (nearLine(c, wx, wy, 6 / view.zoom + 2)) return wr;
    }
    return null;
  }
  function hitStep(n, wx, wy) {
    const b = boxes.get(n.id); if (!b || n.type !== 'steps') return -1;
    const cnt = Math.round(n.params?.n ?? 16), w = b.w - 12, cw = w / cnt, x = wx - (b.x + 6), y = wy - (b.y + 8);
    if (x < 0 || x >= w || y < 0 || y > b.h - 16) return -1;
    return Math.floor(x / cw);
  }

  // ---- mouse
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('mousedown', e => {
    canvas.focus(); hidePalette();
    const [sx, sy] = pos(e), [wx, wy] = toWorld(sx, sy);
    if (e.button === 1) { e.preventDefault(); drag = { kind: 'pan', sx, sy, vx: view.x, vy: view.y }; return; }
    if (e.button !== 0) return;
    const p = hitPort(wx, wy);
    if (p) {   // from a port: a wire. A dragged-from input finds the output that goes to it, like pulling a plug.
      const g = graph();
      const ok = (q, side) => { if (side === p.side || q.k !== p.k) return false; const a = p.side === 'out' ? p : q, bb = p.side === 'out' ? q : p; return a.id !== bb.id && (a.name !== undefined); };
      void g;
      drag = { kind: 'wire', from: p, x: sx, y: sy, ok: (q, side) => (side !== p.side && q.k === p.k && q.id !== p.id) };
      void ok;
      sel.clear(); selWire = null; renderSide(); dirty = true; return;
    }
    const n = hitNode(wx, wy);
    if (n) {
      const step = hitStep(n, wx, wy);
      if (step >= 0) {   // a step cell: click flips it, and dragging across cells paints the same way
        checkpoint();
        const cells = (n.data ??= { cells: [] }).cells ??= [];
        const on = !(Number(cells[step]) > 0);
        cells[step] = on ? 1 : 0;
        drag = { kind: 'steps', n, on, last: step };
        sel = new Set([n.id]); selWire = null; changedData(n); renderSide(); return;
      }
      if (e.shiftKey) { sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id); }
      else if (!sel.has(n.id)) sel = new Set([n.id]);
      selWire = null;
      checkpoint();
      drag = { kind: 'move', sx, sy, starts: [...sel].map(id => { const m = nodeOf(id); return [m, m.x, m.y]; }), moved: false };
      renderSide(); dirty = true; return;
    }
    if (e.button === 0 && !e.altKey && overArrows(stretch, wx, wy)) {   // near the arrows: drag the stretch sideways
      checkpoint(); selWire = stretch.wr; sel.clear();
      drag = { kind: 'bend', ...stretch }; renderSide(); dirty = true; return;
    }
    const wr = hitWire(wx, wy);
    if (wr && e.altKey) { toggleWire(wr); return; }   // Alt+click switches a wire off or on
    if (wr) { selWire = wr; sel.clear(); renderSide(); dirty = true; return; }
    selWire = null;
    if (e.shiftKey) drag = { kind: 'marquee', x0: sx, y0: sy, x: sx, y: sy, add: false };
    else { sel.clear(); drag = { kind: 'pan', sx, sy, vx: view.x, vy: view.y }; }
    renderSide(); dirty = true;
  });
  addEventListener('mousemove', e => {
    if (!drag) return;
    const [sx, sy] = pos(e);
    if (drag.kind === 'pan') { view.x = drag.vx - (sx - drag.sx) / view.zoom; view.y = drag.vy - (sy - drag.sy) / view.zoom; }
    else if (drag.kind === 'move') {
      const dx = (sx - drag.sx) / view.zoom, dy = (sy - drag.sy) / view.zoom;
      for (const [m, x0, y0] of drag.starts) { m.x = Math.round((x0 + dx) / 8) * 8; m.y = Math.round((y0 + dy) / 8) * 8; }
      drag.moved = true;
    } else if (drag.kind === 'bend') {
      const [wx, wy] = toWorld(sx, sy); drag.wr.bend = { ...drag.wr.bend, [drag.key]: Math.round((drag.vertical ? wx : wy) / 8) * 8 };
    } else if (drag.kind === 'wire' || drag.kind === 'marquee') { drag.x = sx; drag.y = sy; }
    else if (drag.kind === 'steps') {
      const [wx, wy] = toWorld(sx, sy), i = hitStep(drag.n, wx, wy);
      if (i >= 0 && i !== drag.last) { drag.n.data.cells[i] = drag.on ? 1 : 0; drag.last = i; changedData(drag.n); }
    }
    dirty = true;
  });
  addEventListener('mouseup', e => {
    if (!drag) return;
    const d = drag; drag = null; dirty = true;
    if (d.kind === 'bend') { structure(); return; }
    const g = graph(), [sx, sy] = pos(e), [wx, wy] = toWorld(sx, sy);
    if (d.kind === 'wire') {
      const q = hitPort(wx, wy, d.from.side === 'out' ? 'in' : 'out');
      if (q && g) {
        const [a, b] = d.from.side === 'out' ? [d.from, q] : [q, d.from];
        if (a.side === 'out' && b.side === 'in' && canConnect(g, `${a.id}.${a.name}`, `${b.id}.${b.name}`)) {
          checkpoint();
          if (connect(g, `${a.id}.${a.name}`, `${b.id}.${b.name}`)) structure(); else say('Those two are already wired.');
        } else if (q.side === d.from.side || q.k !== d.from.k) say(q.k !== d.from.k ? 'Those do not mix: squares go to squares, dots to dots, diamonds to diamonds, triangles to triangles.' : 'Wire an output to an input.');
      } else if (!q && g && Math.hypot(sx - d.x, sy - d.y) > 0 && d.from.side === 'out') {
        // dropped on empty space: the palette, showing the nodes that can take this wire; the new node is wired up
        openPalette(sx, sy, { wire: d.from });
      }
    } else if (d.kind === 'move' && d.moved) { onStructureQuiet(); }
    else if (d.kind === 'marquee' && g) {
      const [x0, y0] = toWorld(d.x0, d.y0), [x1, y1] = toWorld(d.x, d.y), lo = [Math.min(x0, x1), Math.min(y0, y1)], hi = [Math.max(x0, x1), Math.max(y0, y1)];
      sel = new Set(g.nodes.filter(n => { const b = boxes.get(n.id); return b && b.x < hi[0] && b.x + b.w > lo[0] && b.y < hi[1] && b.y + b.h > lo[1]; }).map(n => n.id));
      renderSide();
    }
  });
  const onStructureQuiet = () => { onStructure(); };   // positions are not in the engine's graph, but saving needs the project marked changed
  canvas.addEventListener('mousemove', e => { if (drag) return; const [sx, sy] = pos(e), [wx, wy] = toWorld(sx, sy), p = hitPort(wx, wy); const was = hover?.id + hover?.name, hn = p ? null : hitNode(wx, wy); mouse = [sx, sy]; hover = p; hoverNode = hn?.id ?? null; const st = p || hn ? null : nearStretch(wx, wy); if (st?.wr !== stretch?.wr || st?.k !== stretch?.k) dirty = true; stretch = st; if (was !== p?.id + p?.name || hoverNode !== lastHoverNode) { lastHoverNode = hoverNode; dirty = true; } canvas.style.cursor = p ? 'crosshair' : overArrows(stretch, wx, wy) ? (stretch.vertical ? 'ew-resize' : 'ns-resize') : hitStep(hitNode(wx, wy) ?? { type: '' }, wx, wy) >= 0 ? 'pointer' : 'default'; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = pos(e);
    if (e.ctrlKey || e.metaKey) {   // zoom about the pointer
      const [wx, wy] = toWorld(sx, sy), z = clamp(view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.4, 2.2);
      view.zoom = z; view.x = wx - sx / z; view.y = wy - sy / z;
    } else { view.x += (e.shiftKey ? e.deltaY : e.deltaX) / view.zoom; view.y += (e.shiftKey ? 0 : e.deltaY) / view.zoom; }
    dirty = true;
  }, { passive: false });
  // The wires the engine runs, in its order: the ones that are on and join ports that are there. Its numbers for a pulse index this list.
  const liveWires = () => (graph()?.wires ?? []).filter(x => { if (x.off) return false; const a = portPos(x.from, 'out'), b = portPos(x.to, 'in'); return !!a && !!b && a.k === b.k; });
  // Switch a wire off without deleting it (or back on).
  function toggleWire(wr) { checkpoint(); if (wr.off) delete wr.off; else wr.off = true; selWire = wr; structure(); }
  // A route point put on a wire, where it was double-clicked: the wire now goes through the dot.
  function insertDot(wr, wx, wy) {
    const g = graph(), a = portOf(wr.from);
    if (!g || !a) return;
    checkpoint();
    const dot = addNode(g, DOT_TYPES[a.k], Math.round((wx - DOT / 2) / 4) * 4, Math.round((wy - DOT / 2) / 4) * 4, { group: nodeOf(wr.from.split('.')[0])?.group ?? 0 });
    const from = wr.from, to = wr.to;
    disconnect(g, wr); selWire = null;
    connect(g, from, `${dot.id}.in`); connect(g, `${dot.id}.out`, to);
    sel = new Set([dot.id]); structure();
  }
  canvas.addEventListener('dblclick', e => {
    const [sx, sy] = pos(e), [wx, wy] = toWorld(sx, sy), n = hitNode(wx, wy), wr = !n && hitWire(wx, wy);
    if (overArrows(stretch, wx, wy)) { checkpoint(); delete stretch.wr.bend; structure(); return; }   // double-click the arrows: the wire finds its own way again
    if (wr) insertDot(wr, wx, wy); else if (!n) openPalette(sx, sy);
  });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const [sx, sy] = pos(e), [wx, wy] = toWorld(sx, sy), n = hitNode(wx, wy), wr = !n && hitWire(wx, wy);
    if (n) {
      if (!sel.has(n.id)) { sel = new Set([n.id]); renderSide(); dirty = true; }
      showContextMenu(e, [
        ...GROUP_NAMES.map((gn, i) => ({ label: `Group ${gn}`, hint: (n.group ?? 0) === i ? '●' : '', run: () => setGroupOf([...sel], i) })),
        { separator: true },
        { label: 'Duplicate', hint: 'Ctrl+D', run: () => duplicate() },
        { label: 'Delete', hint: 'Del', run: () => removeSelected() },
      ]);
    } else if (wr) {
      selWire = wr; dirty = true;
      showContextMenu(e, [{ label: wr.off ? 'Switch the wire on' : 'Switch the wire off', hint: 'M', run: () => toggleWire(wr) }, { label: 'Delete the wire', hint: 'Del', run: () => removeSelected() }]);
    } else openPalette(sx, sy);
  });

  // ---- editing
  function changedData(n) { dirty = true; onData(n.id, n.data); }
  function setGroupOf(ids, g) { checkpoint(); for (const id of ids) { const n = nodeOf(id); if (n) n.group = g; } structure(); }
  function removeSelected() {
    const g = graph(); if (!g) return;
    if (selWire) { checkpoint(); disconnect(g, selWire); selWire = null; structure(); return; }
    if (!sel.size) return;
    checkpoint(); removeNodes(g, [...sel]); sel.clear(); structure();
  }
  function duplicate() {
    const g = graph(); if (!g || !sel.size) return;
    checkpoint();
    try { sel = new Set(duplicateNodes(g, [...sel]).map(n => n.id)); structure(); } catch (err) { say(err.message); }
  }
  function addAt(type, sx, sy, wire) {
    const g = ensureGraph(song()), [wx, wy] = toWorld(sx, sy);
    checkpoint();
    try {
      const n = addNode(g, type, Math.round((wx - 20) / 8) * 8, Math.round((wy - 10) / 8) * 8);
      if (type === 'note' || type === 'set') {   // a note starts with the first instrument that can play it
        const first = type === 'note' ? noteTargets()[0]?.value : paramTargets()[0]?.value;
        if (first) n.data = { target: first };
      }
      if (wire) {   // the wire the palette was opened from goes to the first port of the same kind
        const T = NS_TYPES[type], port = T.ins.find(p => p.k === wire.k) ?? (T.dynIn?.k === wire.k ? { n: `${T.dynIn.prefix}1` } : null);
        if (port) connect(g, `${wire.id}.${wire.name}`, `${n.id}.${port.n}`);
      }
      sel = new Set([n.id]); selWire = null; structure();
    } catch (err) { say(err.message); }
  }

  // ---- the palette: type to narrow the list, Enter adds the node where the pointer was
  let palState = null;
  function openPalette(sx, sy, { wire = null } = {}) {
    palState = { sx, sy, wire, at: 0, items: [] };
    palette.hidden = false;
    palette.style.left = `${clamp(sx, 4, Math.max(4, W - 280))}px`; palette.style.top = `${clamp(sy, 4, Math.max(4, H - 330))}px`;
    palette.replaceChildren();
    const input = el('input', { type: 'text', placeholder: wire ? `a node for the ${{ e: 'event', c: 'control', h: 'chord', w: 'weights' }[wire.k]} output "${wire.name}" ...` : 'add a node (type to narrow) ...', ariaLabel: 'Add a node' });
    const list = el('div', { className: 'ns-pal-list' });
    palette.append(input, list);
    const types = Object.entries(NS_TYPES).filter(([, T]) => !wire || T.ins.some(p => p.k === wire.k) || T.dynIn?.k === wire.k);
    const show = () => {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren(); palState.items = [];
      const rank = ([k, T]) => (k.toLowerCase() === q || T.title.toLowerCase() === q ? 0 : k.toLowerCase().startsWith(q) || T.title.toLowerCase().startsWith(q) ? 1 : k.toLowerCase().includes(q) || T.title.toLowerCase().includes(q) ? 2 : T.hint.toLowerCase().includes(q) || T.cat.includes(q) ? 3 : 9);
      const add = ([k, T]) => {
        const row = el('div', { className: 'ns-pal-row' }, el('b', { textContent: T.title }), el('span', { textContent: T.hint }));
        row.addEventListener('mousedown', ev => { ev.preventDefault(); pick(k); });
        palState.items.push({ k, row }); list.append(row);
      };
      if (q) types.filter(t => rank(t) < 9).sort((a, b) => rank(a) - rank(b)).forEach(add);
      else for (const cat of CATS) {
        const rows = types.filter(([, T]) => T.cat === cat);
        if (!rows.length) continue;
        list.append(el('div', { className: 'ns-pal-cat', textContent: cat }));
        rows.forEach(add);
      }
      palState.at = Math.min(palState.at, Math.max(0, palState.items.length - 1));
      palState.items.forEach((it, i) => it.row.classList.toggle('on', i === palState.at));
    };
    const pick = k => { const s = palState; hidePalette(); addAt(k, s.sx, s.sy, s.wire); canvas.focus(); };
    input.addEventListener('input', () => { palState.at = 0; show(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { hidePalette(); canvas.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = palState.items.length; if (n) { palState.at = (palState.at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; palState.items.forEach((it, i) => it.row.classList.toggle('on', i === palState.at)); palState.items[palState.at].row.scrollIntoView?.({ block: 'nearest' }); } }
      else if (e.key === 'Enter') { e.preventDefault(); const it = palState.items[palState.at]; if (it) pick(it.k); }
    });
    const mine = palState;
    input.addEventListener('blur', () => setTimeout(() => { if (palState === mine && doc.activeElement !== input) hidePalette(); }, 120));
    show(); input.focus();
  }
  function hidePalette() { palette.hidden = true; palState = null; }
  palBtn.addEventListener('click', () => { const r = canvas.getBoundingClientRect(); openPalette(40, 20); void r; });

  // ---- keys
  function key(e) {
    if (e.target?.matches?.('input, textarea, select')) return false;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) { e.preventDefault(); (e.code === 'KeyY' || e.shiftKey ? redo : undo)(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); duplicate(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); sel = new Set(graph()?.nodes.map(n => n.id) ?? []); renderSide(); dirty = true; return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSelected(); return true; }
    if (k === 'a' || k === 'A') { e.preventDefault(); const [mx, my] = hover ? toScreen(hover.x, hover.y) : [60, 40]; openPalette(mx, my); return true; }
    if ((k === 'm' || k === 'M') && selWire) { toggleWire(selWire); return true; }
    if (k === 'Home') { fit(); return true; }
    if (k === 'Escape') { if (palState) hidePalette(); else { sel.clear(); selWire = null; renderSide(); dirty = true; } return true; }
    if (k >= '1' && k <= '8' && sel.size) { setGroupOf([...sel], Number(k) - 1); return true; }
    return false;
  }
  canvas.addEventListener('keydown', e => { if (key(e)) e.stopPropagation(); });

  function fit() {
    const g = graph();
    if (!g?.nodes.length) { view = { x: -20, y: -20, zoom: 1 }; dirty = true; return; }
    boxes = new Map(g.nodes.map(n => [n.id, layout(n)]));
    const bs = [...boxes.values()], x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    const z = clamp(Math.min((W - 60) / (x1 - x0), (H - 60) / (y1 - y0)), 0.4, 2.5);
    view = { zoom: z, x: x0 - (W / z - (x1 - x0)) / 2, y: y0 - (H / z - (y1 - y0)) / 2 }; dirty = true;
  }

  // ---- the panel beside the graph: the selected node's parameters and data
  function renderSide() {
    side.replaceChildren();
    const g = graph(), n = sel.size === 1 ? nodeOf([...sel][0]) : null;
    if (!n) {
      side.append(el('h3', { textContent: 'Node Sequencer' }));
      const help = [
        'Nodes send events (squares) on ticks and subticks, and controls (dots) at signal rate; chords (diamonds) and note volumes (triangles) are pulled by the node they go into.',
        'Drag from an output to an input. Drop a wire on empty space to add a node for it.',
        'A, or a right-click, adds a node. Ctrl+D copies, Delete removes, 1 to 8 puts the selection in a group.',
        'It plays beside the pattern lanes, on the same clock. The pattern lane (G1 to G8) can start and stop groups.',
      ];
      for (const t of help) side.append(el('p', { textContent: t }));
      if (g?.nodes.length) side.append(el('p', { className: 'ns-dim', textContent: `${g.nodes.length} nodes, ${g.wires.length} wires, ${g.sub} subticks a tick.` }));
      return;
    }
    const T = NS_TYPES[n.type];
    side.append(el('h3', { textContent: `${T.title}  ` }, el('small', { textContent: n.id })), el('p', { className: 'ns-dim', textContent: T.hint }));
    const gsel = el('select', { ariaLabel: 'Group' });
    GROUP_NAMES.forEach((gn, i) => gsel.append(el('option', { value: i, textContent: `Group ${gn}`, selected: (n.group ?? 0) === i })));
    gsel.addEventListener('change', () => setGroupOf([n.id], Number(gsel.value)));
    side.append(row('group', gsel));
    for (const p of T.params) side.append(paramRow(n, p));
    if (T.body === 'steps') side.append(stepsEditor(n));
    if (T.body === 'list') side.append(listEditor(n));
    if (T.body === 'chords') side.append(chordsEditor(n));
    if (T.body === 'chord') side.append(chordEditor(n));
    if (T.body === 'bars') side.append(voicingEditor(n));
    if (T.body === 'script') side.append(scriptEditor(n));
    if (T.data === 'instrument') side.append(targetSelect(n, noteTargets(), 'instrument', 'the instrument this plays'));
    if (T.data === 'parameter') side.append(targetSelect(n, paramTargets(), 'parameter', 'the parameter this moves'));
    if (n.type === 'monitor') { const log = el('pre', { className: 'ns-mon' }); log.textContent = mon.filter(m => m.id === n.id).slice(-12).map(m => `${String(m.tick).padStart(4, '0')}.${m.sub}  ${fmt(m.v)}${m.vel > 0 ? `  vel ${fmt(m.vel)}` : ''}`).join('\n') || 'Events show here while the song plays.'; side.append(log); }
    if (errors.has(n.id)) side.append(el('p', { className: 'ns-err', textContent: errors.get(n.id) }));
    side.append(el('div', { className: 'ns-btns' }, button('Duplicate', () => duplicate()), button('Delete', () => removeSelected())));
  }
  const row = (label, input) => el('label', { className: 'ns-row' }, el('span', { textContent: label }), input);
  const button = (text, run) => { const b = el('button', { type: 'button', textContent: text }); b.addEventListener('click', run); return b; };
  function paramRow(n, p) {
    const v = n.params?.[p.name] ?? p.def;
    let input;
    if (p.labels) {
      input = el('select', { ariaLabel: p.name });
      p.labels.forEach((l, i) => input.append(el('option', { value: i, textContent: l, selected: Math.round(v) === i })));
      input.addEventListener('change', () => setParamValue(n, p, Number(input.value)));
      return row(p.name, input);
    }
    const slider = el('input', { type: 'range', min: 0, max: 1000, step: 1, ariaLabel: p.name }), num = el('input', { type: 'number', value: fmt(v), step: p.int ? 1 : 'any', ariaLabel: `${p.name} value` });
    const toPos = x => Math.round((p.log && p.min > 0 ? Math.log(x / p.min) / Math.log(p.max / p.min) : (x - p.min) / (p.max - p.min)) * 1000);
    const fromPos = t => { const x = p.log && p.min > 0 ? p.min * Math.pow(p.max / p.min, t / 1000) : p.min + (p.max - p.min) * t / 1000; return p.int ? Math.round(x) : Math.round(x * 1000) / 1000; };
    slider.value = toPos(clamp(v, p.min, p.max));
    slider.addEventListener('pointerdown', () => checkpoint());
    slider.addEventListener('input', () => { const x = fromPos(Number(slider.value)); num.value = fmt(x); setParamValue(n, p, x, true); });
    num.addEventListener('focus', () => checkpoint());
    num.addEventListener('change', () => { const x = clamp(Number(num.value), p.min, p.max); if (Number.isFinite(x)) { const y = p.int ? Math.round(x) : x; slider.value = toPos(y); num.value = fmt(y); setParamValue(n, p, y); } });
    num.addEventListener('keydown', e => e.stopPropagation());
    const wrap = el('span', { className: 'ns-ctl' }, slider, num);
    return row(p.name, wrap);
  }
  function setParamValue(n, p, value, quiet = false) {
    (n.params ??= {})[p.name] = value; dirty = true;
    onParam(n.id, p.name, value);
    if (p.name === 'n' || p.name === 'steps' || p.name === 'pulses' || p.name === 'rot') renderSideSoon();
    void quiet;
  }
  let soon = 0;
  const renderSideSoon = () => { if (soon) return; soon = setTimeout(() => { soon = 0; }, 0); };
  function targetSelect(n, options, what, title) {
    const sel1 = el('select', { ariaLabel: what, title });
    sel1.append(el('option', { value: '', textContent: `(pick ${what === 'instrument' ? 'an instrument' : 'a parameter'})` }));
    let group = null;
    for (const o of options) {
      if (o.group && o.group !== group) { group = o.group; sel1.append(el('optgroup', { label: group })); }
      const opt = el('option', { value: o.value, textContent: o.label ?? o.value, selected: n.data?.target === o.value });
      (o.group ? sel1.lastChild : sel1).append(opt);
    }
    sel1.addEventListener('change', () => { checkpoint(); n.data = { ...(n.data ?? {}), target: sel1.value }; changedData(n); structure(); });
    return row(what, sel1);
  }
  function stepsEditor(n) {
    const cells = (n.data ??= { cells: [] }).cells ??= [];
    const cnt = Math.round(n.params?.n ?? 16), box = el('div', { className: 'ns-steps', title: 'Click a step to turn it on or off; drag up and down to set its level' });
    const cellEls = [];
    for (let i = 0; i < cnt; i++) {
      const c = el('button', { type: 'button', className: 'ns-step' }), fill = el('i');
      c.append(fill); cellEls.push([c, fill]); box.append(c);
      const paint = () => { const lv = Number(cells[i]) || 0; fill.style.height = `${lv * 100}%`; c.classList.toggle('on', lv > 0); };
      paint();
      c.addEventListener('pointerdown', e => {
        e.preventDefault(); checkpoint();
        const r = c.getBoundingClientRect(), lv0 = Number(cells[i]) || 0, startY = e.clientY;
        let moved = false;
        const mv = ev => { if (Math.abs(ev.clientY - startY) < 3 && !moved) return; moved = true; cells[i] = Math.round(clamp((r.bottom - ev.clientY) / r.height, 0.1, 1) * 10) / 10; paint(); changedData(n); };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!moved) { cells[i] = lv0 > 0 ? 0 : 1; paint(); changedData(n); } };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      });
    }
    return row('steps', box);
  }
  function listEditor(n) {
    const ta = el('textarea', { rows: 3, spellcheck: false, value: n.data?.text ?? '', ariaLabel: 'list' }), note = el('small', { className: 'ns-dim' });
    const check = () => { const { items, bad } = parseList(ta.value); note.textContent = bad.length ? `Not understood: ${bad.slice(0, 6).join(' ')}` : `${items.length} values (numbers, notes like C-5 or D#4, and . for a rest)`; note.classList.toggle('ns-err', bad.length > 0); };
    ta.addEventListener('focus', () => checkpoint());
    ta.addEventListener('input', () => { n.data = { ...(n.data ?? {}), text: ta.value }; check(); changedData(n); });
    ta.addEventListener('keydown', e => e.stopPropagation());
    check();
    return el('div', { className: 'ns-block' }, el('span', { textContent: 'list' }), ta, note);
  }
  function chordsEditor(n) {
    const ta = el('textarea', { rows: 6, spellcheck: false, value: n.data?.text ?? '', ariaLabel: 'chords' }), note = el('small', { className: 'ns-dim' });
    const check = () => {
      const { items, bad } = parseChordList(ta.value);
      note.textContent = bad.length ? `Not understood: ${bad.slice(0, 4).join(', ')}` : `${items.length} chords, one a line (C maj7, F# 13sus, E min9(11)); a dot is a rest. Use a note node set to poly.`;
      note.classList.toggle('ns-err', bad.length > 0);
    };
    ta.addEventListener('focus', () => checkpoint());
    ta.addEventListener('input', () => { n.data = { ...(n.data ?? {}), text: ta.value }; check(); changedData(n); });
    ta.addEventListener('keydown', e => e.stopPropagation());
    check();
    return el('div', { className: 'ns-block' }, el('span', { textContent: 'chords' }), ta, note);
  }
  // Bars you drag up and down: one for each place in a chord, lowest note first. `get(i)` is the volume in percent, `set(i, percent)` changes it.
  function weightBars(count, get, set) {
    const wrap = el('div', { className: 'ns-bars', ariaLabel: 'note volumes, lowest note first' }), fills = [];
    for (let i = 0; i < count; i++) { const f = el('i'); fills.push(f); wrap.append(el('div', { className: 'ns-bar' }, f)); }
    const show = () => fills.forEach((f, i) => { f.style.height = `${get(i)}%`; });
    const at = e => { const r = wrap.getBoundingClientRect(), i = clamp(Math.floor((e.clientX - r.left) / r.width * count), 0, count - 1); set(i, clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 20) * 5, 0, 100)); show(); };
    wrap.addEventListener('pointerdown', e => { checkpoint(); wrap.setPointerCapture?.(e.pointerId); at(e); wrap.onpointermove = at; });
    wrap.addEventListener('pointerup', () => { wrap.onpointermove = null; });
    show();
    return wrap;
  }
  function chordEditor(n) {
    const input = el('input', { type: 'text', value: n.data?.text ?? '', spellcheck: false, ariaLabel: 'chord' }), note = el('small', { className: 'ns-dim' }), bars = el('div');
    const cview = () => chordView(n.data, n.params);
    const refresh = () => {
      const cv = cview();
      note.textContent = cv.error ?? (cv.notes.length ? cv.notes.map(noteName).join(' ') : 'a name like A min7 or F# 13sus, or notes like A2 C3 E3 G3 (each can have a volume: A2@100 C3@60)');
      note.classList.toggle('ns-err', !!cv.error);
      bars.replaceChildren();
      if (cv.notes.length) bars.append(weightBars(cv.notes.length, i => cview().base[i], (i, v) => {
        const base = cview().base; base[i] = v;
        input.value = input.value.replace(/@\d+(\.\d+)?/g, '');   // a volume typed after a note would win over the bars
        n.data = { ...(n.data ?? {}), text: input.value, weights: base }; changedData(n); dirty = true;
      }));
    };
    input.addEventListener('focus', () => checkpoint());
    input.addEventListener('input', () => { n.data = { ...(n.data ?? {}), text: input.value }; refresh(); changedData(n); });
    input.addEventListener('keydown', e => e.stopPropagation());
    refresh();
    return el('div', { className: 'ns-block' }, el('span', { textContent: 'chord' }), input, note, el('span', { textContent: 'note volumes' }), bars, el('small', { className: 'ns-dim', textContent: 'A Voicing node wired into weights replaces these bars. Variation and tilt apply on top.' }));
  }
  function voicingEditor(n) {
    const bars = el('div'), draw = () => { bars.replaceChildren(weightBars(Math.round(n.params?.notes ?? 4), i => n.data?.weights?.[i] ?? 100, (i, v) => { const w = [...(n.data?.weights ?? [])]; while (w.length < 8) w.push(100); w[i] = v; n.data = { ...(n.data ?? {}), weights: w }; changedData(n); dirty = true; })); };
    draw();
    return el('div', { className: 'ns-block' }, el('span', { textContent: 'volume of each note, lowest first' }), bars);
  }
  function scriptEditor(n) {
    const ta = el('textarea', { className: 'ns-script', rows: 11, spellcheck: false, wrap: 'off', value: n.data?.code ?? DEFAULT_SCRIPT, ariaLabel: 'script' }), status = el('small', { className: 'ns-dim' });
    const check = () => { const r = compileScript(ta.value); const err = r.error ?? errors.get(n.id); status.textContent = err ?? 'compiles; it runs for each event at "in"'; status.classList.toggle('ns-err', !!err); };
    let t = 0;
    ta.addEventListener('focus', () => checkpoint());
    ta.addEventListener('input', () => { n.data = { ...(n.data ?? {}), code: ta.value }; check(); clearTimeout(t); t = setTimeout(() => { changedData(n); dirty = true; }, 200); });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    check();
    return el('div', { className: 'ns-block' }, el('span', { textContent: 'script' }), ta, status, button('Back to the example', () => { checkpoint(); n.data = { ...(n.data ?? {}), code: DEFAULT_SCRIPT }; changedData(n); renderSide(); }));
  }

  // ---- what the audio thread tells us
  function activity(m) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (m.type === 'nspulse') {
      const g = graph();
      for (const w of m.w) { pulses.push({ w, t: now }); }
      void g;
      // which nodes the wires lead to light up
      const evWires = liveWires();
      for (const w of m.w) { const wr = evWires[w]; if (wr) flash.set(wr.to.split('.')[0], now); }
    } else if (m.type === 'nsstate') { live = m; syncBarSoon(); }
    else if (m.type === 'nserr') { if (m.message) errors.set(m.id, m.message); else errors.delete(m.id); dirty = true; if (sel.has(m.id)) renderSide(); }
    else if (m.type === 'nsmon') { mon.push(m); if (mon.length > 200) mon.shift(); }
    dirty = true;
  }
  const portOf = ref => { const [id, name] = ref.split('.'), n = nodeOf(id); return n ? NS_TYPES[n.type].outs.find(p => p.n === name) : null; };
  let barSoon = 0;
  const syncBarSoon = () => { if (barSoon) return; barSoon = setTimeout(() => { barSoon = 0; syncBar(); }, 250); };

  return {
    el: root,
    draw,
    activity,
    key,
    undo, redo, fit,
    // Called when the project changes or the tab is shown: the graph in the project is what to draw.
    load() { sel.clear(); selWire = null; undoStack.length = 0; redoStack.length = 0; errors.clear(); live = null; pulses = []; mon = []; syncBar(); renderSide(); fit(); dirty = true; },
    refresh() { syncBar(); renderSide(); dirty = true; },
    stopped() { live = null; pulses = []; flash.clear(); dirty = true; syncBar(); },
    focus: () => canvas.focus(),
    canvas,
    // Where a port is on the canvas, in pixels from its corner (for tests and for pointing at things).
    portScreen(ref, side) { draw(true); const p = portPos(ref, side); return p ? toScreen(p.x, p.y) : null; },
    get selection() { return [...sel]; },
    newGraph,
  };
}
