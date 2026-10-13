import { addNode, autoLayout, connect, disconnect, pruneDef, removeNode, setBits, setExposed, setParam } from './edit.js';

// The modular view: a canvas of nodes and wires for one instrument's graph, plus a panel
// for the selected node's parameters. Drag a node to move it, drag from an output dot to
// an input dot to wire them, click a wire or node and press Delete to remove it. A change
// to the wiring or the exposed parameters calls onStructure so the instrument is rebuilt
// and swapped in; a parameter change calls onParam and is heard at once.
export const NODE_W = 150, HEAD = 22, ROW = 18, PORT_R = 5;

export const nodeHeight = def => HEAD + Math.max(def.inputs.length, def.outputs.length, 1) * ROW + 6;
export const portPos = (node, side, index) => ({
  x: side === 'in' ? node.x : node.x + NODE_W,
  y: node.y + HEAD + ROW / 2 + index * ROW,
});

const bezier = (a, b, t) => {
  const c1 = { x: a.x + 60, y: a.y }, c2 = { x: b.x - 60, y: b.y }, u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y };
};

const linkEnds = (desc, nodeTypes, link) => {
  const [from, to] = link.map(r => r.split('.'));
  const a = desc.nodes.find(n => n.id === from[0]), b = desc.nodes.find(n => n.id === to[0]);
  return {
    a: portPos(a, 'out', nodeTypes[a.type].outputs.indexOf(from[1])),
    b: portPos(b, 'in', nodeTypes[b.type].inputs.indexOf(to[1])),
  };
};

// What is under the point: a port, a node, a wire, or nothing. Ports win over nodes.
export function hitTest(desc, nodeTypes, x, y) {
  const near = (p, r) => Math.hypot(p.x - x, p.y - y) <= r;
  for (const node of [...desc.nodes].reverse()) {
    const def = nodeTypes[node.type];
    for (const [side, names] of [['in', def.inputs], ['out', def.outputs]]) {
      for (let i = 0; i < names.length; i++) {
        if (near(portPos(node, side, i), PORT_R + 4)) return { kind: 'port', side, node: node.id, port: names[i] };
      }
    }
  }
  for (const node of [...desc.nodes].reverse()) {
    if (x >= node.x && x <= node.x + NODE_W && y >= node.y && y <= node.y + nodeHeight(nodeTypes[node.type])) {
      return { kind: 'node', id: node.id };
    }
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

export function createPatcher({ canvas, panel, statusEl, doc = document, nodeTypes, onStructure, onParam, getSampleIds = () => [] }) {
  let instruments = {}, instId = null, selected = null, drag = null, dirty = true;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
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

  function renderPanel() {
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
      slider.addEventListener('input', () => {
        const v = toValue(spec, Number(slider.value) / 1000);
        setParam(desc(), node.id, spec.name, v);
        out.textContent = fmt(v);
        onParam(instId, node.id, spec.name, v);
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
      node.y = Math.max(0, e.offsetY - drag.dy);
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

  canvas.addEventListener('mouseleave', () => { drag = null; dirty = true; });

  canvas.addEventListener('keydown', e => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      removeSelected();
      e.preventDefault();
    }
  });

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

    desc().connections.forEach((link, i) => {
      const { a, b } = linkEnds(desc(), nodeTypes, link);
      ctx.beginPath();
      ctx.strokeStyle = selected?.kind === 'link' && selected.index === i ? accent : ink;
      ctx.lineWidth = selected?.kind === 'link' && selected.index === i ? 3 : 1.5;
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(a.x + 60, a.y, b.x - 60, b.y, b.x, b.y);
      ctx.stroke();
    });
    if (drag?.kind === 'connect') {
      const [id, port] = drag.from.split('.');
      const node = desc().nodes.find(n => n.id === id);
      const a = portPos(node, 'out', nodeTypes[node.type].outputs.indexOf(port));
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
    }

    ctx.lineWidth = 1.5;
    for (const node of desc().nodes) {
      const type = nodeTypes[node.type], h = nodeHeight(type);
      const chosen = selected?.kind === 'node' && selected.id === node.id;
      ctx.fillStyle = 'rgba(128, 128, 128, 0.18)';
      ctx.fillRect(node.x, node.y, NODE_W, h);
      ctx.strokeStyle = chosen ? accent : ink;
      ctx.lineWidth = chosen ? 2.5 : 1.5;
      ctx.strokeRect(node.x, node.y, NODE_W, h);
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`${node.id}`, node.x + 8, node.y + HEAD / 2);
      for (const [side, names] of [['in', type.inputs], ['out', type.outputs]]) {
        names.forEach((name, i) => {
          const p = portPos(node, side, i);
          ctx.beginPath();
          ctx.arc(p.x, p.y, PORT_R, 0, 2 * Math.PI);
          ctx.fillStyle = ink;
          ctx.fill();
          ctx.textAlign = side === 'in' ? 'left' : 'right';
          ctx.fillText(name, p.x + (side === 'in' ? 10 : -10), p.y);
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
    add(type) {
      if (!instId) return;
      try {
        const n = desc().nodes.length;
        const id = addNode(desc(), nodeTypes, type, { x: 20 + (n % 4) * 190, y: 20 + Math.floor(n / 4) * 110 });
        if (type === 'sampler' && getSampleIds().length) def().samples = { ...def().samples, [id]: getSampleIds()[0] };
        selected = { kind: 'node', id };
        say('');
        renderPanel();
        structure();
      } catch (err) {
        say(err.message);
      }
    },
    draw,
    get instrument() { return instId; },
  };
}
