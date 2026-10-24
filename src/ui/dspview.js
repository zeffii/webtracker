// The DSP view: a read-only look at the code that makes the sound. An instrument's nodes are listed in the order they run (a strip
// across the top); the one picked shows its source file, its parameters (with their live values), its ports and whether it has a
// WASM kernel. The source is the node's own file, fetched from the site, so it is always what is running.

import { buildCircuit, circuitSvg } from './circuit.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The nodes of a graph in running order: a node comes after everything that feeds it; ties go left to right on the graph.
export function runningOrder(graph) {
  const nodes = graph?.nodes ?? [], byId = new Map(nodes.map(n => [n.id, n]));
  const feeds = new Map(nodes.map(n => [n.id, new Set()])), needs = new Map(nodes.map(n => [n.id, 0]));
  for (const [from, to] of graph?.connections ?? []) {
    const a = String(from).split('.')[0], b = String(to).split('.')[0];
    if (byId.has(a) && byId.has(b) && a !== b && !feeds.get(a).has(b)) { feeds.get(a).add(b); needs.set(b, needs.get(b) + 1); }
  }
  const ready = nodes.filter(n => needs.get(n.id) === 0), out = [];
  const byX = (p, q) => (p.x ?? 0) - (q.x ?? 0) || (p.y ?? 0) - (q.y ?? 0);
  while (ready.length) {
    ready.sort(byX);
    const n = ready.shift(); out.push(n);
    for (const b of feeds.get(n.id)) { needs.set(b, needs.get(b) - 1); if (needs.get(b) === 0) ready.push(byId.get(b)); }
  }
  for (const n of nodes) if (!out.includes(n)) out.push(n);   // a loop in the graph: whatever is left
  return out;
}

const TOKEN = /(\/\/.*)|(\/\*.*?(?:\*\/|$))|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b0x[0-9a-f]+\b|\b\d+\.?\d*(?:e[-+]?\d+)?\b|\B\.\d+\b)|(\b(?:const|let|var|export|default|return|for|while|if|else|function|new|of|in|import|from|break|continue|typeof|true|false|null|undefined|this|switch|case|class)\b)|(\b[A-Za-z_$][\w$]*(?=\())|([=+\-*\/%<>!&|^~?:]+)|([(){}\[\];,.])/gi;

// JavaScript as HTML, one string per line (a /* */ comment carries over from line to line).
export function highlightJs(text) {
  let inBlock = false;
  return text.split('\n').map(line => {
    let html = '', at = 0;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return `<span class="c">${esc(line)}</span>`;
      html = `<span class="c">${esc(line.slice(0, end + 2))}</span>`; at = end + 2; inBlock = false;
    }
    TOKEN.lastIndex = at;
    let m;
    while ((m = TOKEN.exec(line))) {
      if (m.index < at) continue;
      html += esc(line.slice(at, m.index));
      const cls = m[1] || m[2] ? 'c' : m[3] ? 's' : m[4] ? 'n' : m[5] ? 'k' : m[6] ? 'f' : m[7] ? 'o' : 'p';   // comment, string, number, keyword, call, operator, punctuation
      html += `<span class="${cls}">${esc(m[0])}</span>`;
      if (m[2] && !m[2].endsWith('*/')) inBlock = true;
      at = m.index + m[0].length;
      TOKEN.lastIndex = at;
    }
    return html + esc(line.slice(at));
  });
}

// The per-sample loops: [first, last] line indexes of each `for (let i = 0; i < n; ...)` and the braces that close it.
export function sampleLoops(text) {
  const lines = text.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*for \(let \w+ = 0; \w+ < (?:n|len|count|frames)\b/.test(lines[i])) continue;
    let depth = 0, seen = false, j = i;
    for (; j < lines.length; j++) {
      const code = lines[j].replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"/g, '');
      for (const ch of code) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
      if (seen && depth <= 0) break;
    }
    out.push([i, Math.min(j, lines.length - 1)]);
    i = Math.min(j, lines.length - 1);
  }
  return out;
}

// The places that can be folded: [{ s, e, depth }], a line that opens a bracket the line it is on does not close (s) and the line where it
// is closed (e), with depth counting the regions around it (0 for the outermost). Strings and comments are skipped.
export function foldRegions(text) {
  const lines = text.split('\n'), stack = [], best = new Map();
  let inBlock = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inBlock) { if (ch === '*' && line[i + 1] === '/') { inBlock = false; i++; } continue; }
      if (ch === '/' && line[i + 1] === '/') break;
      if (ch === '/' && line[i + 1] === '*') { inBlock = true; i++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { for (i++; i < line.length && line[i] !== ch; i++) if (line[i] === '\\') i++; continue; }
      if (ch === '{' || ch === '[' || ch === '(') stack.push(li);
      else if (ch === '}' || ch === ']' || ch === ')') {
        const from = stack.pop();
        if (from !== undefined && from < li) best.set(from, Math.max(best.get(from) ?? -1, li));
      }
    }
  }
  const regions = [...best].map(([s, e]) => ({ s, e })).sort((a, b) => a.s - b.s || b.e - a.e);
  for (const r of regions) r.depth = regions.filter(o => o !== r && o.s <= r.s && o.e >= r.e && (o.s < r.s || o.e > r.e)).length;
  return regions;
}

// parts: { inst (select), chain, gut, src, prm, ports, kern, foot, empty }; getProject(); nodeTypes: the registry of node types;
// value(instrument, node, param): the live value of a parameter, or undefined.
export function createDspView({ parts, getProject, nodeTypes, value = () => undefined }) {
  const cache = new Map();   // node type -> source text, or null when there is none
  let current = null, nodeId = null, rows = [], token = 0;
  const folds = new Map();   // node type -> the lines folded in it (kept while the page is open)
  let shown = null;          // the file on show: { type, text, lines, loops, regions, closed }

  const load = async type => {
    if (cache.has(type)) return cache.get(type);
    let text = null;
    if (/^[a-z0-9_-]+$/i.test(type)) {
      try { const r = await fetch(new URL(`../audio/nodes/${type}.js`, import.meta.url)); if (r.ok) text = await r.text(); } catch { /* offline */ }
    }
    cache.set(type, text);
    return text;
  };

  const project = () => getProject();
  const fillInstruments = () => {
    const ids = Object.keys(project()?.instruments ?? {});
    parts.inst.textContent = '';
    for (const id of ids) parts.inst.append(Object.assign(document.createElement('option'), { value: id, textContent: id }));
    if (!ids.includes(current)) current = ids.find(i => i !== 'master') ?? ids[0] ?? null;
    if (current) parts.inst.value = current;
  };

  const buildChain = () => {
    parts.chain.textContent = '';
    const graph = project()?.instruments?.[current]?.graph;
    const order = runningOrder(graph);
    if (!order.length) { parts.chain.textContent = 'No nodes.'; return order; }
    order.forEach((n, i) => {
      if (i) parts.chain.append(Object.assign(document.createElement('span'), { className: 'arr', textContent: '→' }));
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: n.id === n.type ? n.id : `${n.id} (${n.type})`, title: `${n.type}${n.id !== n.type ? ` node "${n.id}"` : ''}` });
      b.dataset.id = n.id;
      b.addEventListener('click', () => select(n.id));
      parts.chain.append(b);
    });
    return order;
  };

  async function select(id) {
    nodeId = id;
    for (const b of parts.chain.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
    const graph = project()?.instruments?.[current]?.graph, node = graph?.nodes.find(n => n.id === id);
    if (!node) return;
    const def = nodeTypes[node.type], mine = ++token;
    // parameters, ports: from the node's definition
    rows = [];
    parts.prm.textContent = '';
    for (const p of def?.params ?? []) {
      const row = document.createElement('div'); row.className = 'prm';
      const bar = document.createElement('i'), val = document.createElement('span');
      row.append(Object.assign(document.createElement('span'), { textContent: p.name, title: `${p.min} to ${p.max}, default ${p.def}` }), Object.assign(document.createElement('span'), { className: 'bar2' }), val);
      row.children[1].append(bar);
      parts.prm.append(row);
      rows.push({ p, bar, val, node: node.id });
    }
    if (!rows.length) parts.prm.textContent = 'none';
    parts.ports.textContent = '';
    for (const n of def?.inputs ?? []) parts.ports.append(Object.assign(document.createElement('span'), { textContent: `${n}${def.kinds?.[n] ? ` · ${def.kinds[n]}` : ''}` }));
    for (const n of def?.outputs ?? []) parts.ports.append(Object.assign(document.createElement('span'), { className: 'out', textContent: `→ ${n}${def.kinds?.[n] ? ` · ${def.kinds[n]}` : ''}` }));
    parts.src.textContent = 'Loading…'; parts.gut.textContent = ''; shown = null;
    live();
    const text = await load(node.type);
    if (mine !== token) return;   // another node was picked meanwhile
    if (text === null) {
      parts.src.textContent = `No separate source file for "${node.type}" (or the site could not be reached).`;
      parts.kern.textContent = ''; parts.foot.textContent = '';
      return;
    }
    const lines = highlightJs(text), loops = sampleLoops(text), regions = foldRegions(text);
    if (!folds.has(node.type)) folds.set(node.type, new Set());
    shown = { type: node.type, lines, loops, regions, closed: folds.get(node.type), plain: text.split('\n'), lit: -1, circuits: null, pick: 0 };
    render();
    drawCircuit();
    const wasm = /instantiateDsp/.test(text);
    parts.kern.innerHTML = wasm ? '<b>WASM</b> kernel, with the JavaScript here as its reference and fallback' : 'JavaScript only';
    parts.foot.innerHTML = `<span>src/audio/nodes/${esc(node.type)}.js</span><span>${lines.length} lines</span><span>${loops.length} per-sample loop${loops.length === 1 ? '' : 's'} (marked)</span><span>${wasm ? '<b>WASM kernel</b>' : 'JS'}</span><span>read only</span>`;
    parts.src.scrollTop = 0;
  }


  // The file as lines, a folded region shown as its first line, a note and its closing bracket.
  function render() {
    if (!shown) return;
    const { lines, loops, regions, closed } = shown;
    const inLoop = i => loops.some(([a, b]) => i >= a && i <= b);
    const starts = new Map(regions.map(r => [r.s, r]));
    const src = [], gut = [];
    for (let i = 0; i < lines.length; i++) {
      const r = starts.get(i), folded = r && closed.has(i);
      const mark = r ? `<a class="fo" data-l="${i}" title="${folded ? 'Unfold' : 'Fold'} (${r.e - r.s} lines)">${folded ? '▸' : '▾'}</a>` : '<a class="fo"> </a>';
      gut.push(`${mark}${inLoop(i) ? `<b>${i + 1}</b>` : i + 1}`);
      let h = lines[i] || ' ';
      if (folded) {
        const hasLoop = loops.some(([a, b]) => a > r.s && b <= r.e);
        h += `<span class="fold" data-l="${i}" title="Unfold">… ${r.e - r.s - 1} lines${hasLoop ? ', per-sample loop' : ''} …</span>${lines[r.e].replace(/^\s+/, '')}`;
      }
      if (i === shown.lit) h = `<span class="lit">${h}</span>`;
      src.push(inLoop(i) ? `<span class="loop">${h}</span>` : h);
      if (folded) i = r.e;
    }
    parts.src.innerHTML = src.join('\n');
    parts.gut.innerHTML = gut.join('\n');
  }

  // The circuit beside the code: the per-sample loops that read as a signal flow, one tab each when there are several.
  function drawCircuit() {
    const box = parts.diag?.querySelector('#dsp-circuit');
    if (!box) return;
    box.textContent = '';
    if (!shown) return;
    shown.circuits ??= shown.loops.map(l => { try { return { loop: l, g: buildCircuit(shown.plain, l) }; } catch { return { loop: l, g: null }; } }).filter(c => c.g);
    const list = shown.circuits;
    if (!list.length) { box.append(Object.assign(document.createElement('div'), { className: 'note', textContent: 'No circuit: this node has no per-sample loop that reads as plain arithmetic.' })); return; }
    const c = list[Math.min(shown.pick, list.length - 1)];
    const tabs = document.createElement('div'); tabs.className = 'tabs';
    const x = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Hide the circuit' }); x.addEventListener('click', () => setCirc(false)); tabs.append(x);
    tabs.append(Object.assign(document.createElement('span'), { textContent: `Loop on lines ${c.loop[0] + 1}–${c.loop[1] + 1}` }));
    if (list.length > 1) list.forEach((o, i) => { const b = Object.assign(document.createElement('button'), { type: 'button', textContent: String(i + 1) }); b.setAttribute('aria-pressed', String(o === c)); b.addEventListener('click', () => { shown.pick = i; drawCircuit(); }); tabs.append(b); });
    box.append(tabs);
    const holder = document.createElement('div'); holder.innerHTML = circuitSvg(c.g); box.append(holder);
    box.append(Object.assign(document.createElement('div'), { className: 'note', textContent: `${c.g.nodes.length} symbols. Dashed: a value kept for the next sample (z⁻¹). Orange: set before the loop.${c.g.skipped ? ` ${c.g.skipped} statement${c.g.skipped === 1 ? '' : 's'} not drawn (an if, a call or something else not plain arithmetic).` : ''}` }));
    holder.addEventListener('mouseover', e => { const s = e.target.closest?.('[data-line]'); if (s && shown) { const l = Number(s.dataset.line); if (shown.lit !== l) { shown.lit = l; render(); } } });
    holder.addEventListener('mouseleave', () => { if (shown && shown.lit >= 0) { shown.lit = -1; render(); } });
  }
  function setCirc(on) { parts.circ?.setAttribute('aria-pressed', String(on)); parts.code?.classList.toggle('nocirc', !on); }
  parts.circ?.addEventListener('click', () => setCirc(parts.circ.getAttribute('aria-pressed') !== 'true'));
  parts.open?.addEventListener('click', () => setCirc(true));
  try { const w = Number(localStorage.getItem('wax.dspDiagW')); if (w >= 200) parts.code?.style.setProperty('--diag-w', `${w}px`); } catch {}
  const split = parts.diag?.querySelector('#dsp-split');
  split?.addEventListener('pointerdown', e => {
    e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('drag'); parts.code.classList.add('dragging');
    const move = ev => { const r = parts.code.getBoundingClientRect(); const w = Math.max(200, Math.min(r.width - 220, r.right - ev.clientX)); parts.code.style.setProperty('--diag-w', `${Math.round(w)}px`); };
    const up = () => { split.classList.remove('drag'); parts.code.classList.remove('dragging'); split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); try { localStorage.setItem('wax.dspDiagW', String(parseInt(parts.code.style.getPropertyValue('--diag-w'), 10))); } catch {} };
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
  });
  const toggle = l => {
    if (!shown || !shown.regions.some(r => r.s === l)) return;
    if (shown.closed.has(l)) shown.closed.delete(l); else shown.closed.add(l);
    render();
  };
  parts.gut.addEventListener('click', e => { const a = e.target.closest?.('[data-l]'); if (a) toggle(Number(a.dataset.l)); });
  parts.src.addEventListener('click', e => { const a = e.target.closest?.('.fold'); if (a) toggle(Number(a.dataset.l)); });
  // Fold all: the regions one step inside the outermost one (the parameter list, each method); Unfold all: everything open
  parts.foldAll?.addEventListener('click', () => {
    if (!shown) return;
    const top = shown.regions.some(r => r.depth === 1) ? 1 : 0;
    for (const r of shown.regions) if (r.depth === top) shown.closed.add(r.s);
    render();
  });
  parts.unfoldAll?.addEventListener('click', () => { if (shown) { shown.closed.clear(); render(); } });

  // the parameters' live values, from the engine (the strip of bars on the right)
  function live() {
    for (const r of rows) {
      const raw = value(current, r.node, r.p.name);
      const v = raw === undefined ? (project()?.instruments?.[current]?.graph.nodes.find(n => n.id === r.node)?.params?.[r.p.name] ?? r.p.def) : raw;
      const span = r.p.max - r.p.min || 1;
      r.bar.style.width = `${Math.max(0, Math.min(1, (v - r.p.min) / span)) * 100}%`;
      r.val.textContent = Number.isInteger(v) ? String(v) : Number(v).toPrecision(3).replace(/\.?0+$/, '');
    }
  }

  parts.inst.addEventListener('change', () => { current = parts.inst.value; const order = buildChain(); if (order.length) select(order[0].id); });
  return {
    // shows an instrument (the one the Instruments screen is on, when given)
    open(instrument) {
      fillInstruments();
      if (instrument && project()?.instruments?.[instrument]) { current = instrument; parts.inst.value = instrument; }
      const order = buildChain();
      const keep = order.find(n => n.id === nodeId);
      if (order.length) select(keep ? keep.id : order[0].id);
    },
    live,
    get instrument() { return current; },
  };
}
