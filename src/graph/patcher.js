import { addNode, autoLayout, connect, disconnect, pruneDef, removeNode, setBits, setExposed, setParam } from './edit.js';

// The modular view: a canvas of nodes and wires for one instrument's graph, plus a panel
// for the selected node's parameters. Drag a node to move it, drag from an output dot to
// an input dot to wire them, click a wire or node and press Delete to remove it. A change
// to the wiring or the exposed parameters calls onStructure so the instrument is rebuilt
// and swapped in; a parameter change calls onParam and is heard at once.
import { GLYPHS } from './glyphs.js';
import { LOWER, UPPER } from '../seq/piano.js';
import { portKind, resolveKinds } from './kinds.js';
import { createCurveEditor } from './curveeditor.js';
import { createSpectrumEditor } from './spectrumeditor.js';

// Geometry. A node's shape comes from its type: 'box' for processors, 'rounded' for
// sources and 'circle' for mixing and gain. Ports sit on the left (inputs) and right (outputs).
export const ROW = 16, PORT_R = 4;
export const MIN_HEIGHT = 160, MAX_HEIGHT = 1600;   // the graph area, in pixels
const SHAPE_W = { box: 112, rounded: 100, speaker: 100 };
export const nodeBox = def => {
  const rows = Math.max(def.inputs.length, def.outputs.length, 1);
  const h = Math.max(rows * ROW + 10, def.shape === 'circle' ? 44 : 0);
  return { w: def.shape === 'circle' ? h : SHAPE_W[def.shape ?? 'box'], h };
};
export const portPos = (node, def, side, index) => {
  const { w, h } = nodeBox(def);
  const n = side === 'in' ? def.inputs.length : def.outputs.length;
  const y = node.y + (h - n * ROW) / 2 + ROW / 2 + index * ROW;
  let x = side === 'in' ? node.x : node.x + w;
  if (def.shape === 'circle') {   // keep the dot on the circle's edge
    const r = w / 2, dy = y - (node.y + r), dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    x = node.x + r + (side === 'in' ? -dx : dx);
  }
  return { x, y };
};
const inside = (node, def, x, y) => {
  const { w, h } = nodeBox(def);
  if (def.shape === 'circle') return Math.hypot(x - (node.x + w / 2), y - (node.y + h / 2)) <= w / 2 + 2;
  return x >= node.x && x <= node.x + w && y >= node.y && y <= node.y + h;
};

// Wire and port colours by what the signal is: audio, or control (envelopes, lfos, triggers).
export { portKind };
export const KIND_COLOR = { audio: 'hsl(210 50% 58%)', control: 'hsl(35 75% 52%)', stereo: 'hsl(285 40% 62%)' };

const bezier = (a, b, t) => {
  const c1 = { x: a.x + 60, y: a.y }, c2 = { x: b.x - 60, y: b.y }, u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y };
};

const linkEnds = (desc, nodeTypes, link, kindOf) => {
  const [from, to] = link.map(r => r.split('.'));
  const a = desc.nodes.find(n => n.id === from[0]), b = desc.nodes.find(n => n.id === to[0]);
  return {
    a: portPos(a, nodeTypes[a.type], 'out', nodeTypes[a.type].outputs.indexOf(from[1])),
    b: portPos(b, nodeTypes[b.type], 'in', nodeTypes[b.type].inputs.indexOf(to[1])),
    kind: kindOf ? kindOf(a, from[1]) : portKind(nodeTypes[a.type], from[1], a),
  };
};

// What is under the point: a port, a node, a wire, or nothing. Ports win over nodes.
export function hitTest(desc, nodeTypes, x, y) {
  const near = (p, r) => Math.hypot(p.x - x, p.y - y) <= r;
  for (const node of [...desc.nodes].reverse()) {
    const def = nodeTypes[node.type];
    for (const [side, names] of [['in', def.inputs], ['out', def.outputs]]) {
      for (let i = 0; i < names.length; i++) {
        if (near(portPos(node, def, side, i), PORT_R + 4)) return { kind: 'port', side, node: node.id, port: names[i] };
      }
    }
  }
  for (const node of [...desc.nodes].reverse()) {
    if (inside(node, nodeTypes[node.type], x, y)) return { kind: 'node', id: node.id };
  }
  for (let i = 0; i < desc.connections.length; i++) {
    const { a, b } = linkEnds(desc, nodeTypes, desc.connections[i]);
    for (let s = 0; s <= 24; s++) if (near(bezier(a, b, s / 24), 6)) return { kind: 'link', index: i };
  }
  return null;
}

// Slider position 0..1 <-> parameter value. Wide positive ranges are logarithmic.
const isLog = spec => spec.min > 0 && spec.max / spec.min >= 50;
const toValue = (spec, pos) => {
  const v = isLog(spec) ? spec.min * Math.pow(spec.max / spec.min, pos) : spec.min + pos * (spec.max - spec.min);
  return spec.int ? Math.round(v) : v;
};
const toPos = (spec, v) => (isLog(spec) ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min));
const fmt = v => String(Number(v.toPrecision(4)));

export function createPatcher({ canvas, panel, exposedPanel = null, onEscape = () => {}, statusEl, doc = document, nodeTypes, onStructure, onParam, onData = () => {}, onContext = () => {}, onNote = () => {}, getSampleIds = () => [] }) {
  let instruments = {}, instId = null, selected = null, drag = null, dirty = true;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  let H = canvas.height;
  const dpr = globalThis.devicePixelRatio || 1;
  if (dpr !== 1) {
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
  }

  const def = () => instruments[instId];
  const desc = () => def().graph;
  // Keyjazz: with a generator node (an oscillator, a sampler, a synth) selected, the piano keys play the whole
  // instrument while held, as in the pattern view; [ and ] change the octave.
  const PIANO = { ...LOWER, ...UPPER };
  const held = new Map();   // key -> the note it started, so a key released after an octave change stops the right one
  let octave = 3;
  const generatorSelected = () => {
    const node = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
    return !!node && !!nodeTypes[node.type]?.generator;
  };
  const releaseKeys = () => { for (const note of held.values()) onNote(instId, note, false); held.clear(); };
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const structure = () => { dirty = true; onStructure(instId); };

  // ---- the panel for the selected node ----
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };

  function removeSelected() {
    if (!selected || !instId) return;
    try {
      if (selected.kind === 'node') {
        removeNode(desc(), nodeTypes, selected.id);
        pruneDef(def(), nodeTypes);
      } else {
        const [from, to] = desc().connections[selected.index];
        disconnect(desc(), from, to);
      }
      selected = null;
      say('');
      renderPanel();
      structure();
    } catch (err) {
      say(err.message);
    }
  }

  // A slider that reads as a small rect: filled to its value (--p), and moved by Left/Right (Shift for more),
  // - and = as well. onMove runs after every change, by mouse or key.
  function rectSlider(slider, onMove) {
    const paint = () => slider.style.setProperty?.('--p', `${Number(slider.value) / 10}%`);
    slider.className = 'rect';
    slider.addEventListener('input', () => { paint(); onMove(); });
    slider.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowLeft: -1, '=': 1, '+': 1, '-': -1, _: -1 }[e.key];
      if (!dir) return;
      const step = e.shiftKey ? 50 : 5;
      slider.value = Math.min(1000, Math.max(0, Number(slider.value) + dir * step));
      paint();
      onMove();
      e.preventDefault();
    });
    paint();
    return slider;
  }

  // The exposed parameters as sliders of their own, so a sound can be played with without finding the node.
  function renderExposed() {
    if (!exposedPanel) return;
    if (!instId) { exposedPanel.replaceChildren(); return; }
    const rows = def().exposed.flatMap(x => {
      const node = desc().nodes.find(n => n.id === x.node);
      const spec = node && nodeTypes[node.type]?.params.find(p => p.name === x.param);
      if (!spec) return [];
      const value = node.params?.[spec.name] ?? spec.def;
      const out = el('output', { textContent: fmt(value) });
      const slider = el('input', { type: 'range', min: 0, max: 1000, step: 1, value: Math.round(toPos(spec, value) * 1000), ariaLabel: `${x.label} (${x.node}.${x.param})` });
      rectSlider(slider, () => {
        const v = toValue(spec, Number(slider.value) / 1000);
        setParam(desc(), node.id, spec.name, v);
        out.textContent = fmt(v);
        onParam(instId, node.id, spec.name, v);
        if (selected?.kind === 'node' && selected.id === node.id) renderNodePanel();   // the node's own slider follows
      });
      return [el('div', { className: 'prow xrow' }, el('span', { textContent: x.label, title: `${x.node}.${x.param}` }), slider, out, el('span', { className: 'help', textContent: `${x.node}.${x.param}` }))];
    });
    exposedPanel.replaceChildren(...(rows.length ? rows : [el('p', { className: 'help' }, 'Nothing exposed yet: tick "expose" on a node parameter to make it a pattern column.')]));
  }

  const renderPanel = () => { renderNodePanel(); renderExposed(); };

  function renderNodePanel() {
    const node = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
    if (!node) {
      panel.replaceChildren(el('p', {}, instId ? 'Click a node to edit its parameters.' : 'No instrument.'));
      return;
    }
    const type = nodeTypes[node.type];
    const rows = type.params.map(spec => {
      const value = node.params?.[spec.name] ?? spec.def;
      const out = el('output', { textContent: fmt(value) });
      const slider = el('input', { type: 'range', min: 0, max: 1000, step: spec.int ? 1000 / (spec.max - spec.min) : 1, value: Math.round(toPos(spec, value) * 1000) });
      rectSlider(slider, () => {
        const v = toValue(spec, Number(slider.value) / 1000);
        setParam(desc(), node.id, spec.name, v);
        out.textContent = fmt(v);
        onParam(instId, node.id, spec.name, v);
        if (def().exposed.some(x => x.node === node.id && x.param === spec.name)) renderExposed();   // the exposed copy follows
      });
      const current = def().exposed.find(e => e.node === node.id && e.param === spec.name);
      const exposed = el('input', { type: 'checkbox', checked: !!current });
      // The column width of an exposed parameter: 1hex (16 steps), 2hex (256) or 4hex (65536).
      const width = el('select', { disabled: !current, value: String(current?.bits ?? 8) },
        ...[['4', '1hex'], ['8', '2hex'], ['16', '4hex']].map(([bits, label]) => el('option', { value: bits, textContent: label })));
      width.value = String(current?.bits ?? 8);
      exposed.addEventListener('change', () => {
        setExposed(def(), nodeTypes, node.id, spec.name, exposed.checked);
        width.disabled = !exposed.checked;
        width.value = String(def().exposed.find(e => e.node === node.id && e.param === spec.name)?.bits ?? 8);
        structure();
      });
      width.addEventListener('change', () => {
        setBits(def(), node.id, spec.name, Number(width.value));
        structure();
      });
      return el('div', { className: 'prow' }, el('span', { textContent: spec.name }), slider, out, el('span', {}, el('label', {}, exposed, ' expose '), width));
    });
    const items = [el('h3', {}, `${node.id} (${node.type})`), ...rows];
    if (type.editor === 'curve') {   // a drawable transfer curve, kept on the node and sent live
      const editor = createCurveEditor({
        doc, points: node.data?.curve,
        onChange: points => {
          node.data = { ...node.data, curve: points };
          onData(instId, node.id, { type: 'curve', points });
        },
      });
      items.splice(1, 0, editor.el);
    }
    if (type.editor === 'spectrum') {   // drawable harmonic levels, kept on the node and sent live
      const editor = createSpectrumEditor({
        doc, points: node.data?.spectrum,
        onChange: points => {
          node.data = { ...node.data, spectrum: points };
          onData(instId, node.id, { type: 'spectrum', points });
        },
      });
      items.splice(1, 0, editor.el);
    }
    if (node.type === 'sampler') {   // which sample this node plays
      const picker = el('select', {}, ...getSampleIds().map(id => el('option', { value: id, textContent: id })));
      picker.value = def().samples?.[node.id] ?? '';
      picker.addEventListener('change', () => {
        def().samples = { ...def().samples, [node.id]: picker.value };
        structure();
      });
      items.splice(1, 0, el('div', { className: 'prow' }, el('span', { textContent: 'sample' }), picker));
    }
    if (!type.master) {
      const del = el('button', { textContent: 'Delete node' });
      del.addEventListener('click', removeSelected);
      items.push(del);
    }
    panel.replaceChildren(...items);
  }

  // ---- mouse and keyboard ----
  canvas.addEventListener('mousedown', e => {
    if (!instId) return;
    canvas.focus?.();
    const x = e.offsetX, y = e.offsetY, hit = hitTest(desc(), nodeTypes, x, y);
    say('');
    if (hit?.kind === 'port' && hit.side === 'out') {
      drag = { kind: 'connect', from: `${hit.node}.${hit.port}`, x, y };
    } else if (hit?.kind === 'port' || hit?.kind === 'node') {
      const id = hit.kind === 'node' ? hit.id : hit.node;
      const node = desc().nodes.find(n => n.id === id);
      selected = { kind: 'node', id };
      drag = { kind: 'move', id, dx: x - node.x, dy: y - node.y };
    } else if (hit?.kind === 'link') {
      selected = { kind: 'link', index: hit.index };
    } else {
      selected = null;
    }
    renderPanel();
    dirty = true;
  });

  canvas.addEventListener('mousemove', e => {
    if (!drag) return;
    if (drag.kind === 'move') {
      const node = desc().nodes.find(n => n.id === drag.id);
      node.x = Math.max(0, e.offsetX - drag.dx);
      node.y = Math.max(14, e.offsetY - drag.dy);   // room above for the name
    } else {
      drag.x = e.offsetX;
      drag.y = e.offsetY;
    }
    dirty = true;
  });

  canvas.addEventListener('mouseup', e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    dirty = true;
    if (d.kind !== 'connect') return;
    const hit = hitTest(desc(), nodeTypes, e.offsetX, e.offsetY);
    if (hit?.kind !== 'port' || hit.side !== 'in') return;
    try {
      connect(desc(), nodeTypes, d.from, `${hit.node}.${hit.port}`);
      say('');
      structure();
    } catch (err) {
      say(err.message);
    }
  });

  // Right-click, or double-click on empty space, asks for the insert menu at that point.
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (instId) onContext({ x: e.offsetX, y: e.offsetY });
  });
  canvas.addEventListener('dblclick', e => {
    if (instId && !hitTest(desc(), nodeTypes, e.offsetX, e.offsetY)) onContext({ x: e.offsetX, y: e.offsetY });
  });

  canvas.addEventListener('mouseleave', () => { drag = null; dirty = true; });

  // Moves the selection to the nearest node in a direction ('left', 'right', 'up', 'down'), or to the next one
  // ('next', 'prev') in left-to-right order. With nothing selected the leftmost node is chosen.
  function selectNear(way) {
    if (!instId) return false;
    const boxOf = n => { const { w, h } = nodeBox(nodeTypes[n.type]); return { x: n.x + w / 2, y: n.y + h / 2 }; };
    const nodes = desc().nodes.filter(n => n.x !== undefined);
    if (!nodes.length) return false;
    const order = [...nodes].sort((a, b) => boxOf(a).x - boxOf(b).x || boxOf(a).y - boxOf(b).y);
    const here = selected?.kind === 'node' ? nodes.find(n => n.id === selected.id) : null;
    let next = null;
    if (!here) next = order[0];
    else if (way === 'next' || way === 'prev') next = order[(order.indexOf(here) + (way === 'next' ? 1 : order.length - 1)) % order.length];
    else {
      const c = boxOf(here);
      let best = Infinity;
      for (const n of nodes) {
        if (n === here) continue;
        const p = boxOf(n), dx = p.x - c.x, dy = p.y - c.y;
        const along = way === 'right' ? dx : way === 'left' ? -dx : way === 'down' ? dy : -dy;
        const across = way === 'left' || way === 'right' ? Math.abs(dy) : Math.abs(dx);
        if (along <= 0) continue;
        const score = along + 2 * across;
        if (score < best) { best = score; next = n; }
      }
    }
    if (!next) return true;
    selected = { kind: 'node', id: next.id };
    renderPanel();
    dirty = true;
    return true;
  }

  canvas.addEventListener('keydown', e => {
    if (e.key === 'Escape') { onEscape(); e.preventDefault?.(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      removeSelected();
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && generatorSelected()) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === '[' || k === ']') { octave = Math.min(8, Math.max(0, octave + (k === ']' ? 1 : -1))); say(`Keyjazz octave ${octave}`); e.preventDefault(); return; }
      if (Object.hasOwn(PIANO, k)) {
        if (!e.repeat && !held.has(k)) { const note = octave * 12 + PIANO[k]; held.set(k, note); onNote(instId, note, true); }
        e.preventDefault();
        return;
      }
    }
    const way = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key] ?? (e.key === 'Tab' ? (e.shiftKey ? 'prev' : 'next') : null);
    if (way && !e.ctrlKey && !e.altKey && !e.metaKey && selectNear(way)) e.preventDefault();
  });

  canvas.addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (held.has(k)) { onNote(instId, held.get(k), false); held.delete(k); }
  });
  canvas.addEventListener('blur', releaseKeys);

  // ---- drawing ----
  function draw() {
    if (!dirty) return;
    dirty = false;
    ctx.clearRect(0, 0, W, H);
    if (!instId) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const accent = 'hsl(210 70% 55%)';
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.lineWidth = 1.5;

    const { kindOf } = resolveKinds(desc(), nodeTypes);
    desc().connections.forEach((link, i) => {
      const { a, b, kind } = linkEnds(desc(), nodeTypes, link, kindOf);
      const chosen = selected?.kind === 'link' && selected.index === i;
      ctx.beginPath();
      ctx.strokeStyle = chosen ? accent : KIND_COLOR[kind];
      ctx.lineWidth = chosen ? 3.5 : kind === 'stereo' ? 3 : 1.75;   // a stereo pair is drawn heavier
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(a.x + 50, a.y, b.x - 50, b.y, b.x, b.y);
      ctx.stroke();
    });
    if (drag?.kind === 'connect') {
      const [id, port] = drag.from.split('.');
      const node = desc().nodes.find(n => n.id === id), type = nodeTypes[node.type];
      const a = portPos(node, type, 'out', type.outputs.indexOf(port));
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.75;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
    }

    for (const node of desc().nodes) {
      const type = nodeTypes[node.type], { w, h } = nodeBox(type);
      const chosen = selected?.kind === 'node' && selected.id === node.id;
      ctx.beginPath();
      if (type.shape === 'circle') ctx.arc(node.x + w / 2, node.y + h / 2, w / 2, 0, 2 * Math.PI);
      else if (type.shape === 'rounded') ctx.roundRect(node.x, node.y, w, h, 10);
      else if (type.shape === 'speaker') {   // a small back and a cone that opens to the right
        ctx.moveTo(node.x, node.y + 0.3 * h); ctx.lineTo(node.x + 0.38 * w, node.y + 0.3 * h);
        ctx.lineTo(node.x + w, node.y); ctx.lineTo(node.x + w, node.y + h);
        ctx.lineTo(node.x + 0.38 * w, node.y + 0.7 * h); ctx.lineTo(node.x, node.y + 0.7 * h);
        ctx.closePath();
      }
      else ctx.rect(node.x, node.y, w, h);
      ctx.fillStyle = 'rgba(128, 128, 128, 0.18)';
      ctx.fill();
      ctx.strokeStyle = chosen ? accent : ink;
      ctx.lineWidth = chosen ? 2.5 : 1.5;
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      ctx.fillText(node.id, node.x + w / 2, node.y - 5);   // the name sits above the shape

      const glyph = GLYPHS[type.glyph];
      if (glyph) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.25;
        const circle = type.shape === 'circle';
        glyph(ctx, node.x + w / 2, node.y + h / 2, circle ? w * 0.55 : w - 64, circle ? w * 0.55 : Math.min(h - 12, 24));
        ctx.globalAlpha = 1;
      }

      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'middle';
      for (const [side, names] of [['in', type.inputs], ['out', type.outputs]]) {
        names.forEach((name, i) => {
          const p = portPos(node, type, side, i);
          ctx.beginPath();
          ctx.arc(p.x, p.y, PORT_R, 0, 2 * Math.PI);
          ctx.fillStyle = KIND_COLOR[kindOf(node, name)];
          ctx.fill();
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.stroke();
          if (type.shape !== 'circle') {   // the shape has no room for names inside a circle
            ctx.fillStyle = ink;
            ctx.globalAlpha = 0.75;
            ctx.textAlign = side === 'in' ? 'left' : 'right';
            ctx.fillText(name, p.x + (side === 'in' ? 8 : -8), p.y);
            ctx.globalAlpha = 1;
          }
        });
      }
    }
  }

  return {
    // instruments: { id: { graph, exposed, commands?, samples? } }.
    load({ instruments: next }) {
      instruments = next;
      this.show(instId in instruments ? instId : Object.keys(instruments)[0] ?? null);
    },
    show(id) {
      instId = id;
      selected = null;
      drag = null;
      if (id) autoLayout(desc(), nodeTypes);
      renderPanel();
      dirty = true;
    },
    add(type, at) {
      if (!instId) return;
      try {
        const n = desc().nodes.length;
        const pos = at ? { x: Math.max(0, at.x), y: Math.max(14, at.y) } : { x: 20 + (n % 5) * 150, y: 30 + Math.floor(n / 5) * 80 };
        const id = addNode(desc(), nodeTypes, type, pos);
        if (type === 'sampler' && getSampleIds().length) def().samples = { ...def().samples, [id]: getSampleIds()[0] };
        selected = { kind: 'node', id };
        say('');
        renderPanel();
        structure();
      } catch (err) {
        say(err.message);
      }
    },
    // Draws the panel again, for when parameters were changed from outside (a preset).
    refreshPanel() { renderPanel(); dirty = true; },
    // Changes the height of the graph area in CSS pixels (the width stays); the graph is drawn again at once.
    resize(height) {
      H = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
      canvas.style.height = `${H}px`;
      canvas.height = H * dpr;   // a new size clears the canvas and its transform
      if (dpr !== 1) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      return H;
    },
    get height() { return H; },
    get selectedNode() { return selected?.kind === 'node' ? selected.id : null; },
    draw,
    get instrument() { return instId; },
    get octave() { return octave; },
    releaseKeys,
  };
}
