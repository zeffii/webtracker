import * as config from '../ui/config.js';
import { factoryPresets, userPresets, saveUserPreset, deleteUserPreset, capture, valuesOf, DATA_KEYS } from './nodepresets.js';
import { MODES, SIZES, scopeBox, headerHit, drawScope, modesFor } from './scope.js';
import { addNode, replaceNode, autoLayout, connect, disconnect, duplicateNodes, insertOnWire, pruneDef, pullOut, removeNode, removeAndJoin, setBits, setExposed, setParam, setPort, nudgeClear } from './edit.js';

// The modular view: a canvas of nodes and wires for one instrument's graph, plus a panel
// for the selected node's parameters. Drag a node to move it, drag from an output dot to
// an input dot to wire them, click a wire or node and press Delete to remove it. A change
// to the wiring or the exposed parameters calls onStructure so the instrument is rebuilt
// and swapped in; a parameter change calls onParam and is heard at once.
import { GLYPHS, drawFace } from './glyphs.js';
import { LOWER, UPPER } from '../seq/piano.js';
import { inputsOf, portKind, resolveKinds } from './kinds.js';
import { eligibleSources } from './sidechain.js';
import { factsFor, hintFor } from './hints.js';
import { choices, display, unitOf } from './units.js';
import { timeKind, toTicks, fromTicks, tickMarks, snapTo, tickText } from './ticks.js';
import { createParamView } from './paramview.js';
import { createSpecPanView } from './specpaneditor.js';
import { createCanyonView } from './canyonview.js';
import { createDrumView } from './drumview.js';
import { rangeTargetOf } from './rangetarget.js';
import { createIntView } from './intview.js';
import { createRangeView } from './rangeview.js';
import { createCurveEditor } from './curveeditor.js';
import { createTapEditor } from './tapeditor.js';
import { createDxView } from './dxview.js';
import { createGateEditor } from './gateeditor.js';
import { createSpectrumEditor } from './spectrumeditor.js';
import { createWaveEditor } from './waveeditor.js';
import { createWavetableEditor } from './wavetableeditor.js';
import { createGenexprEditor } from './genexpreditor.js';

// The help box beside a parameter: one floating note, shown beside the "?" while the mouse (or keyboard focus) is on it.
let tipEl = null;
const hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };
const showTip = (anchor, { title, text, facts }) => {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'hint-pop'; document.body.append(tipEl); }
  tipEl.replaceChildren();
  const h = document.createElement('b'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = text || 'No description yet.';
  const f = document.createElement('small'); f.textContent = facts;
  tipEl.append(h, p, f);
  tipEl.style.display = 'block';
  const box = anchor.getBoundingClientRect(), pop = tipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.right + 8, innerWidth - pop.width - 8));
  const top = Math.max(8, Math.min(box.top - 4, innerHeight - pop.height - 8));
  tipEl.style.left = `${left}px`; tipEl.style.top = `${top}px`;
};

// Geometry. A node's shape comes from its type: 'box' for processors, 'rounded' for
// sources and 'circle' for mixing and gain. Ports sit on the left (inputs) and right (outputs).
export const ROW = 16, PORT_R = 4;
// The value a pattern cell holds for a parameter's value: what an exposed parameter's column would show, in hex.
// A whole-number parameter's cell is the number itself (counted from its minimum); the others run across the range.
export const hexOf = (spec, entry, value) => {
  const digits = entry.bits === 16 ? 4 : entry.bits === 4 ? 1 : 2, denom = 16 ** digits - 1;
  let n;
  if (spec.int) n = value - spec.min;
  else {
    const x = entry.scale === 'log' && spec.min > 0 ? Math.log(value / spec.min) / Math.log(spec.max / spec.min) : (value - spec.min) / (spec.max - spec.min);
    n = x * denom;
  }
  return Math.min(denom, Math.max(0, Math.round(n))).toString(16).toUpperCase().padStart(digits, '0');
};

export const MIN_HEIGHT = 160, MAX_HEIGHT = 1600;   // the graph area, in pixels
const SHAPE_W = { box: 112, rounded: 100, speaker: 100 };
export const nodeBox = (def, node) => {
  if (def.size) return { ...def.size };   // a node that draws its own face (the arp's step mask)
  const rows = Math.max(inputsOf(node, def).length, def.outputs.length, 1);
  const h = Math.max(rows * ROW + 10, def.shape === 'circle' ? 44 : 0);
  return { w: def.shape === 'circle' ? h : SHAPE_W[def.shape ?? 'box'], h };
};
export const portPos = (node, def, side, index) => {
  const { w, h } = nodeBox(def, node);
  const n = side === 'in' ? inputsOf(node, def).length : def.outputs.length;
  const y = node.y + (h - n * ROW) / 2 + ROW / 2 + index * ROW;
  let x = side === 'in' ? node.x : node.x + w;
  if (def.shape === 'circle') {   // keep the dot on the circle's edge
    const r = w / 2, dy = y - (node.y + r), dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    x = node.x + r + (side === 'in' ? -dx : dx);
  }
  return { x, y };
};
const inside = (node, def, x, y) => {
  const { w, h } = nodeBox(def, node);
  if (def.shape === 'circle' || def.shape === 'dot') return Math.hypot(x - (node.x + w / 2), y - (node.y + h / 2)) <= w / 2 + 2;
  return x >= node.x && x <= node.x + w && y >= node.y && y <= node.y + h;
};

// Wire and port colours by what the signal is: audio, or control (envelopes, lfos, triggers).
export { portKind };
export const KIND_COLOR = { audio: '#5e94c9', control: '#e09429', stereo: '#b177c5', param: '#f4857b' };   // the defaults; Config's Graph group changes them
const kindColour = kind => config.get(`wire${kind[0].toUpperCase()}${kind.slice(1)}`) ?? KIND_COLOR[kind];
const KIND_TEXT = {
  audio: 'audio: a mono signal',
  control: 'control: an envelope, lfo or trigger signal',
  stereo: 'stereo audio: left and right travel on this one wire',
  param: 'parameter control: a 0 to 1 signal mapped onto a parameter',
};

// How far the wire leaves a port before it bends: 50 px normally, shrinking to nothing as the two ends come within
// Config's wireStraight distance of each other (fully straight at that distance, full arms at twice it).
const arm = (a, b) => {
  const s = config.get('wireStraight');
  return s > 0 ? 50 * Math.max(0, Math.min(1, (Math.hypot(b.x - a.x, b.y - a.y) - s) / s)) : 50;
};

const bezier = (a, b, t) => {
  const k = arm(a, b), c1 = { x: a.x + k, y: a.y }, c2 = { x: b.x - k, y: b.y }, u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y };
};

const linkEnds = (desc, nodeTypes, link, kindOf) => {
  const [from, to] = link.map(r => r.split('.'));
  const a = desc.nodes.find(n => n.id === from[0]), b = desc.nodes.find(n => n.id === to[0]);
  return {
    a: portPos(a, nodeTypes[a.type], 'out', nodeTypes[a.type].outputs.indexOf(from[1])),
    b: portPos(b, nodeTypes[b.type], 'in', inputsOf(b, nodeTypes[b.type]).indexOf(to[1])),
    kind: kindOf ? kindOf(a, from[1]) : portKind(nodeTypes[a.type], from[1], a),
  };
};

// What is under the point: a port, a node, a wire, or nothing. Ports win over nodes.
export function hitTest(desc, nodeTypes, x, y) {
  const near = (p, r) => Math.hypot(p.x - x, p.y - y) <= r;
  for (const node of [...desc.nodes].reverse()) {
    const def = nodeTypes[node.type];
    for (const [side, names] of [['in', inputsOf(node, def)], ['out', def.outputs]]) {
      for (let i = 0; i < names.length; i++) {
        if (near(portPos(node, def, side, i), def.shape === 'dot' ? PORT_R - 0.5 : PORT_R + 4)) return { kind: 'port', side, node: node.id, port: names[i] };
      }
    }
  }
  for (const node of [...desc.nodes].reverse()) {
    if (inside(node, nodeTypes[node.type], x, y)) return { kind: 'node', id: node.id };
  }
  for (let i = 0; i < desc.connections.length; i++) {
    const { a, b } = linkEnds(desc, nodeTypes, desc.connections[i]);
    let prev = bezier(a, b, 0);   // the distance to each short stretch of the wire, so a long wire has no gaps between sample points
    for (let s = 1; s <= 40; s++) {
      const q = bezier(a, b, s / 40), dx = q.x - prev.x, dy = q.y - prev.y, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / len2)) : 0;
      if (Math.hypot(prev.x + t * dx - x, prev.y + t * dy - y) <= 7) return { kind: 'link', index: i };
      prev = q;
    }
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

export function createPatcher({ getTiming = () => null, onHelp = () => {}, canvas, panel, toolsEl = null, paramPanel = null, exposedDock = null, floatDock = null, onScope = () => {}, onEscape = () => {}, statusEl, doc = document, nodeTypes, onStructure, onParam, onData = () => {}, onContext = () => {}, onNote = () => {}, getSampleIds = () => [], getSample = () => null, getGrainSource = () => null, readLive = () => undefined }) {
  let gateEditor = null;    // the step pattern of a trance gate, redrawn when its length moves
  let dxView = null;        // the bank loader and algorithm view of a DVIIloader
  let intView = null;
  let rangeView = null;
  let drumView = null;      // the envelopes, the click and the composed root note of a drum synth, redrawn when its parameters move
  let canyonView = null;    // the echoes of a Prisma Canyon against the song's ticks, redrawn when its parameters move
  let specView = null;      // the pan-against-frequency view of a spectral panner, redrawn when its parameters move
  let tapEditor = null;     // the tap view of a Shiva delay, redrawn when its parameters move
  let tableEditor = null;   // the wavetable panel of the selected node, redrawn when position or mix move
  let instruments = {}, instId = null, selected = null, drag = null, dirty = true;
  const gridOff = { x: 0, y: 0 };   // where the grid's dots sit: panning moves the nodes, so the grid moves with them
  const lastSelected = new Map();   // instrument -> the node that was selected when you left it
  // The scopes: an eye on a node shows what it puts out (a scope beside it: wave, spectrum or xy, 200 or 400 pixels).
  // The choice lives on the node as node.scope = { mode, size }; the samples arrive from the audio side.
  const scopeData = new Map();   // node id -> { l, r, sr }
  const cloudData = new Map();   // granular node id -> { head, t, sr, gain, grains: [{ at, step, len, shape, t }] }: its grains, as they started
  const eyeRect = node => { const { w, h } = nodeBox(nodeTypes[node.type], node); return { x: node.x + w / 2 - 10, y: node.y + h + 3, w: 20, h: 14 }; };   // under the node, clear of its name
  const scopeRectOf = node => {
    const { w, h } = nodeBox(nodeTypes[node.type], node), b = scopeBox(node, w, h, node.scope.size, node.scope.mode);
    if (selected?.kind === 'node' && selected.id === node.id && nodeTypes[node.type].adsr?.length) {   // its envelope box is open: the scope sits beside it, level with its middle
      const e = envRect({ x: node.x, y: node.y, w, h });
      b.x = e.x + e.w + 8; b.y = Math.max(2, e.y + e.h / 2 - b.size / 2);
    }
    return b;
  };
  const inside = (r, x, y, w = r.w, h = r.h) => x >= r.x && x <= r.x + w && y >= r.y && y <= r.y + h;
  function setScope(node, on) {
    // a gain node opens as a level meter
    if (on) node.scope = { mode: node.type === 'gain' ? 'vu' : 'wave', size: SIZES[0] }; else delete node.scope;
    scopeData.delete(node.id);
    onScope(instId, node.id, on);
    dirty = true;
  }
  // a click on an eye or on an open scope's header; true when it was used
  function scopeClick(x, y) {
    for (const node of [...desc().nodes].reverse()) {
      if (!nodeTypes[node.type].outputs.length || nodeTypes[node.type].shape === 'dot') continue;
      if (inside(eyeRect(node), x, y)) { setScope(node, !node.scope); return true; }
      if (!node.scope) continue;
      const box = scopeRectOf(node), part = headerHit(box, x, y, node.scope.mode, modesFor(node.type));
      if (part === 'eye') { setScope(node, false); return true; }
      if (part === 'size') node.scope.size = SIZES[(SIZES.indexOf(node.scope.size) + 1) % SIZES.length];
      else if (part) node.scope.mode = part;
      else if (!inside(box, x, y, box.w ?? box.size, box.size)) continue;
      dirty = true;
      return true;
    }
    return false;
  }
  const group = new Set();   // nodes picked together with the lasso (or Shift+click): they move as one
  const ctx = canvas.getContext('2d');
  let W = canvas.width;
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

  // ---- undo: a snapshot of the instrument (graph, exposed columns, commands, samples) after each edit the user finishes ----
  const history = new Map();   // instrument id -> { undo: [json], redo: [json], last: json }
  const snapshot = () => JSON.stringify(def());
  const historyOf = () => { let h = history.get(instId); if (!h) { h = { undo: [], redo: [], last: snapshot() }; history.set(instId, h); } return h; };
  const commit = () => {
    if (!instId || !def()) return;
    const h = historyOf(), now = snapshot();
    if (now === h.last) return;
    h.undo.push(h.last); if (h.undo.length > 100) h.undo.shift();
    h.redo.length = 0; h.last = now;
  };
  const restore = json => {
    const d = def(), obj = JSON.parse(json);
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, obj);
    if (selected?.kind === 'node' && !desc().nodes.some(n => n.id === selected.id)) selected = null;
    else if (selected?.kind === 'link') selected = null;
    for (const id of [...group]) if (!desc().nodes.some(n => n.id === id)) group.delete(id);
    structure(); renderPanel();
  };
  const stepHistory = (from, to, word) => {
    if (!instId || !def()) return false;
    commit();
    const h = historyOf();
    if (!h[from].length) { say(`nothing to ${word}`); return true; }
    h[to].push(h.last);
    h.last = h[from].pop();
    restore(h.last);
    say(`${word} (${h.undo.length} step${h.undo.length === 1 ? '' : 's'} of history left)`);
    return true;
  };

  // an edit is finished when a mouse button or key comes up or a field changes: that is when it becomes an undo step
  for (const t of [canvas, panel, paramPanel, exposedDock, floatDock, toolsEl]) for (const ev of ['mouseup', 'pointerup', 'keyup', 'change']) t?.addEventListener?.(ev, () => setTimeout(commit, 0));

  // ---- the panel for the selected node ----
  const el = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    return e;
  };

  // The docked parameter panel (when the page has one): rows for the selected node, driven by the keys of the graph.
  const paramView = paramPanel ? createParamView({ doc, el: paramPanel, showTip, hideTip, onFocusBack: () => canvas.focus?.() }) : null;
  // The exposed parameters, always shown in a dock of their own on the left of the graph.
  const exposedView = exposedDock ? createParamView({ doc, el: exposedDock, side: 'left', showTip, hideTip, onFocusBack: () => canvas.focus?.() }) : null;
  // The same exposed rows in a floating window (it belongs to the page, which shows and moves it).
  const floatView = floatDock ? createParamView({ doc, el: floatDock, side: 'left', showTip, hideTip, onFocusBack: () => doc.activeElement?.blur?.() }) : null;
  let floatOn = false;
  const pins = new Map();   // instrument id -> the node ids whose parameters are pinned in the panel
  const pinsOf = () => { const s = pins.get(instId) ?? new Set(); for (const id of [...s]) if (!desc().nodes.some(n => n.id === id)) s.delete(id); pins.set(instId, s); return s; };
  const togglePin = id => { const s = pinsOf(); if (s.has(id)) s.delete(id); else s.add(id); renderNodePanel(); };
  const cursorMemo = new Map();   // the row last selected in each node's panel
  let shownNode = null;
  const clamp01 = x => Math.min(1, Math.max(0, x));

  // The panel rows of one node: each reads and writes the node's parameter, and carries the row's menu actions.
  // The rows as shown: with "hide command parameters" on, those that a CC command writes are left out.
  const shownRows = rows => (config.get('pvHideCc') ? rows.filter(r => r.cc === undefined) : rows);
  function rowsFor(node, type) {
    const tgt = type.type === 'range' ? rangeTargetOf(desc(), nodeTypes, node.id) : null;
    return type.params.map(base => {
      const ruled = !!tgt && base.name !== 'at';   // a range node's lo and hi are in the units of the port it feeds
      const spec = ruled ? { ...base, min: tgt.min, max: tgt.max, int: tgt.int, def: base.name === 'lo' ? tgt.min : tgt.max } : base;
      const uType = ruled ? tgt.type : node.type, uName = ruled ? tgt.param : spec.name;
      const get = () => readLive(instId, node.id, spec.name) ?? node.params?.[spec.name] ?? spec.def;
      const entry = () => def().exposed.find(e => e.node === node.id && e.param === spec.name);
      const span = spec.max - spec.min;
      const apply = v => {
        setParam(desc(), node.id, spec.name, v);
        onParam(instId, node.id, spec.name, v);
        dirty = true;   // the envelope drawn beside the node follows
        if (spec.name === 'position' || spec.name === 'mix' || spec.name === 'source') tableEditor?.refresh();
        if (type.editor === 'taps') tapEditor?.refresh();
        if (type.editor === 'gate') gateEditor?.refresh();
        if (type.editor === 'specpan') specView?.refresh();
        if (type.editor === 'canyon') canyonView?.refresh();
        if (type.editor === 'drumsynth') drumView?.refresh();
        if (type.editor === 'int') intView?.refresh();
        if (type.type === 'range') rangeView?.refresh();
        if (type.editor === 'dx' && spec.name === 'voice') dxView?.refresh();
        if (entry()) exposedView?.refresh();   // repaint in place: rebuilding the dock would drop a drag that is under way
      };
      const names = choices(uType, uName);
      return {
        name: spec.name,
        cc: (() => { const c = (def().commands ?? []).find(k => k.node === node.id && k.param === spec.name); return c ? c.id.toString(16).toUpperCase().padStart(2, '0') : undefined; })(),   // the command that writes it from a pattern
        pos: () => clamp01(toPos(spec, get())),
        setPos: p => apply(toValue(spec, p)),
        display: () => display(uType, { ...spec, name: uName }, get()),
        text: () => (unitOf(uType, uName) === '%' ? String(Math.round(get() * 100)) : names ? names[Math.round(get() - spec.min)] ?? fmt(get()) : fmt(get())),
        type: text => {
          const t = String(text).trim().toLowerCase();
          const named = names?.findIndex(n => n.toLowerCase() === t);
          let v = named >= 0 ? spec.min + named : Number.parseFloat(t);
          if (!Number.isFinite(v)) return false;
          if (unitOf(uType, uName) === '%' && named === undefined) v /= 100;
          apply(Math.min(spec.max, Math.max(spec.min, spec.int ? Math.round(v) : v)));
          return true;
        },
        hex: () => { const e = entry(); return e ? hexOf(spec, e, get()) : ''; },
        // Song ticks on a time or rate slider: the value in ticks, the lines, and where a drag snaps to (see ticks.js).
        ticks: (() => {
          const kind = timeKind(node.type, spec.name);
          if (!kind || spec.int) return null;
          const log = isLog(spec);
          return {
            text: () => { const t = getTiming(); return t ? tickText(toTicks(kind, get(), t.tickMs)) : ''; },
            marks: width => { const t = getTiming(); return t && t.lines ? tickMarks({ kind, min: spec.min, max: spec.max, log, toPos: v => toPos(spec, v), tickMs: t.tickMs, perBeat: t.perBeat, width }) : []; },
            tempo: () => { const t = getTiming(); return t ? `${t.tickMs.toFixed(3)}|${t.perBeat}|${t.lines}` : ''; },
            snap: (pos, width) => { const t = getTiming(); if (!t || !t.snap || !t.lines) return pos; const m = snapTo(tickMarks({ kind, min: spec.min, max: spec.max, log, toPos: v => toPos(spec, v), tickMs: t.tickMs, perBeat: t.perBeat, width }), pos, width); return m ? m.pos : pos; },
          };
        })(),
        step: spec.int ? 1 / span : 0.005,
        big: spec.int ? Math.max(1, Math.round(span / 10)) / span : 0.05,
        fine: spec.int ? 1 / span : 0.001,
        wired: desc().connections.some(([, to]) => to === `${node.id}.@${spec.name}`),
        get exposed() { return !!entry(); },
        get bits() { return entry()?.bits ?? 8; },
        get ported() { return (node.ports ?? []).includes(spec.name); },
        hint: () => ({ title: spec.name, text: hintFor(node.type, base) + (ruled ? ` Now in the units of ${tgt.node}.${tgt.param}.` : ''), facts: factsFor(spec) }),
        reset: () => apply(spec.def),
        expose: on => { setExposed(def(), nodeTypes, node.id, spec.name, on); structure(); renderPanel(); },
        setBits: bits => { setBits(def(), node.id, spec.name, bits); structure(); renderPanel(); },
        port: on => { setPort(desc(), nodeTypes, node.id, spec.name, on); structure(); dirty = true; renderPanel(); },
      };
    });
  }

  function duplicateSelected() {
    if (!instId) return;
    const ids = group.size ? [...group] : selected?.kind === 'node' ? [selected.id] : [];
    if (!ids.length) return;
    try {
      const made = duplicateNodes(desc(), nodeTypes, ids);
      if (!made.length) return;
      group.clear();
      if (made.length > 1) { for (const m of made) group.add(m); selected = null; } else selected = { kind: 'node', id: made[0] };
      say(made.length > 1 ? `Duplicated ${made.length} nodes` : `Duplicated as ${made[0]}`);
      renderPanel(); structure();
    } catch (err) { say(err.message); }
  }

  // While one node is dragged: the wire it is over (it would be put into that wire on release), and whether it has
  // been dragged out of its own chain (its neighbours would then be joined up).
  function updateDrop() {
    const id = drag.ids[0], node = desc().nodes.find(n => n.id === id), type = nodeTypes[node.type];
    drag.hover = null; drag.pull = false;
    if (drag.free) { if (drag.msg !== 'free') { drag.msg = 'free'; say(`Moving ${id} only: its wires stay as they are`); } return; }   // Esc was pressed
    const ins = inputsOf(node, type);
    const kindIn = ins.length && !ins[0].startsWith('@') ? portKind(type, ins[0], node) : null, kindOut = type.outputs.length ? portKind(type, type.outputs[0], node) : null;
    if (type.master || !kindIn || !kindOut || kindIn === 'control' || kindOut === 'control') return;
    const { w, h } = nodeBox(type, node), cx = node.x + w / 2, cy = node.y + h / 2;
    const { kindOf } = resolveKinds(desc(), nodeTypes);
    let best = 16;
    desc().connections.forEach((link, i) => {
      if (link[0].split('.')[0] === id || link[1].split('.')[0] === id) return;
      const { a, b, kind } = linkEnds(desc(), nodeTypes, link, kindOf);
      if (kind !== 'audio' && kind !== 'stereo') return;
      for (let s = 0; s <= 24; s++) { const p = bezier(a, b, s / 24), d = Math.hypot(p.x - cx, p.y - cy); if (d < best) { best = d; drag.hover = i; } }
    });
    if (drag.inline && config.get('graphPullOut')) {   // far from the line between its neighbours: pulled out of the chain
      const { a, b } = drag.inline;
      const dx = b.x - a.x, dy = b.y - a.y, t = Math.min(1, Math.max(0, ((cx - a.x) * dx + (cy - a.y) * dy) / (dx * dx + dy * dy || 1)));
      drag.pull = Math.hypot(a.x + t * dx - cx, a.y + t * dy - cy) > 70;
    }
    if (drag.force) drag.pull = !!drag.inline && drag.moved;
    const msg = drag.hover !== null ? `Release to put ${id} into this wire` : drag.pull ? `Release to take ${id} out of its chain` : '';
    if (msg !== drag.msg) { drag.msg = msg; say(msg); }
  }

  function removeSelected(join = false) {
    if (!instId) return;
    const take = id => (join ? removeAndJoin(desc(), nodeTypes, id) : removeNode(desc(), nodeTypes, id));
    if (group.size) {
      try {
        for (const id of group) if (!nodeTypes[desc().nodes.find(n => n.id === id)?.type]?.master) take(id);
        pruneDef(def(), nodeTypes);
        group.clear(); selected = null;
        say(''); renderPanel(); structure();
      } catch (err) { say(err.message); }
      return;
    }
    if (!selected) return;
    try {
      if (selected.kind === 'node') {
        take(selected.id);
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

  // The exposed parameters: the rows of the left dock, each named by its pattern-column label.
  function exposedRows() {
    if (!instId) return [];
    return def().exposed.flatMap(x => {
      const node = desc().nodes.find(n => n.id === x.node);
      const type = node && nodeTypes[node.type];
      const row = type && rowsFor(node, type).find(r => r.name === x.param);
      return row ? [Object.create(row, { name: { value: x.label } })] : [];
    });
  }

  function renderFloat() {
    if (!floatView) return;
    if (!floatOn || !instId) { floatView.hide(); return; }
    floatView.show('', exposedRows(), floatView.cursor, 'Nothing exposed in this machine yet.');
  }

  function renderExposed() {
    renderFloat();
    if (!exposedView) return;
    if (!instId) { exposedView.hide(); return; }
    exposedView.show('exposed', exposedRows(), exposedView.cursor, 'Nothing exposed yet. Select a node, press Enter on a row and choose "Expose".');
  }

  const renderPanel = () => { renderNodePanel(); renderExposed(); };

  function renderNodePanel() {
    const node = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
    const pinnedList = (skip = null) => (instId ? [...pinsOf()] : []).filter(id => id !== skip).flatMap(id => {
      const n = desc().nodes.find(x => x.id === id), t = n && nodeTypes[n.type];
      return t ? [{ title: `${n.id} · ${n.type}`, rows: shownRows(rowsFor(n, t)), unpin: () => togglePin(id) }] : [];
    });
    if (!node) {
      if (paramView) {
        if (shownNode) cursorMemo.set(shownNode, paramView.cursor);
        shownNode = null;
        const list = pinnedList();
        if (list.length) paramView.show('', [], 0, '', null, list); else paramView.hide();
      }
      toolsEl?.replaceChildren();
      panel.replaceChildren(el('p', {}, instId ? 'Click a node to edit its parameters.' : 'No instrument.'));
      return;
    }
    const type = nodeTypes[node.type];
    if (paramView) {
      if (shownNode && shownNode !== node.id) cursorMemo.set(shownNode, paramView.cursor);
      paramView.show(`${node.id} · ${node.type}`, shownRows(rowsFor(node, type)), shownNode === node.id ? paramView.cursor : cursorMemo.get(node.id) ?? 0, '', { on: pinsOf().has(node.id), toggle: () => togglePin(node.id), help: () => onHelp(node.type), cc: def()?.commands?.length ? { hidden: config.get('pvHideCc'), toggle: () => { config.set('pvHideCc', !config.get('pvHideCc')); renderPanel(); } } : null }, pinnedList(node.id));
      shownNode = node.id;
    }
    const items = [];
    if (type.instrumentSource) {   // which instrument this node listens to; the ones that would make a loop are not offered
      const options = eligibleSources(instruments, instId).filter(id => id !== instId);
      const pick = el('select', { ariaLabel: 'Instrument to listen to' }, el('option', { value: '', textContent: '(none)' }), ...options.map(id => el('option', { value: id, textContent: id })));
      pick.value = options.includes(node.source) ? node.source : '';
      pick.addEventListener('change', () => {
        if (pick.value) node.source = pick.value; else delete node.source;
        structure();
        dirty = true;
      });
      items.splice(1, 0, el('div', { className: 'prow' }, el('span', { textContent: 'listens to' }), pick),
        el('p', { className: 'help' }, 'Instruments that already listen to this one are not offered: an instrument cannot hear itself, not even by way of others.'));
    }
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
    if (type.editor === 'wave') {   // one drawable single-cycle waveform per operator, kept on the node and sent live
      const editor = createWaveEditor({
        doc, waves: node.data?.waves,
        onChange: waves => {
          node.data = { ...node.data, waves };
          onData(instId, node.id, { type: 'waves', points: waves });
        },
      });
      items.splice(1, 0, editor.el);
    }
    gateEditor = null;
    if (type.editor === 'gate') {   // the step levels, kept on the node and sent live
      gateEditor = createGateEditor({
        doc, points: node.data?.gate,
        getParam: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0,
        onChange: points => {
          node.data = { ...node.data, gate: points };
          onData(instId, node.id, { type: 'gate', points });
        },
      });
      items.splice(1, 0, gateEditor.el);
    }
    if (type.editor === 'genexpr') {   // the code of a GenExpr node, kept on the node and sent live; its Params move the knobs
      const code = createGenexprEditor({
        doc, code: node.data?.code,
        setKnob: (i, value) => { const name = `p${i + 1}`; setParam(desc(), node.id, name, value); onParam(instId, node.id, name, value); paramView?.refresh(); },
        onChange: text => { node.data = { ...node.data, code: text }; onData(instId, node.id, { type: 'code', text }); },
      });
      items.splice(1, 0, code.el);
    }
    dxView = null;
    if (type.editor === 'dx') {   // a DX7 bank on the node, sent live; the voice parameter picks from it
      const voiceParam = () => Math.round(readLive(instId, node.id, 'voice') ?? node.params?.voice ?? 0);
      dxView = createDxView({
        doc, bank: node.data?.bank, say,
        getVoice: voiceParam,
        setVoice: i => { setParam(desc(), node.id, 'voice', i); onParam(instId, node.id, 'voice', i); paramView?.refresh(); dxView?.refresh(); },
        getParam: name => Math.round(readLive(instId, node.id, name) ?? node.params?.[name] ?? 0),
        setParamValue: (name, value) => { setParam(desc(), node.id, name, value); onParam(instId, node.id, name, value); paramView?.refresh(); },
        onBank: points => { node.data = { ...node.data, bank: points }; onData(instId, node.id, { type: 'bank', points }); },
      });
      items.splice(1, 0, dxView.el);
    }
    specView = null;
    if (type.editor === 'specpan') {   // the pan of each band against frequency, drawn from the parameters
      specView = createSpecPanView({ doc, getParam: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0 });
      items.splice(1, 0, specView.el);
    }
    drumView = null;
    if (type.editor === 'drumsynth') {   // the envelopes, the click and the composed note, drawn from the parameters and the click sample
      const param = name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0;
      drumView = createDrumView({
        doc, getParam: param,
        getClickSample: () => { const cur = def().samples?.[node.id], list = Array.isArray(cur) ? cur : cur === undefined ? [] : [cur]; const id = list[Math.round(param('clickSample'))]; return id === undefined ? null : getSample(id); },
      });
      items.splice(1, 0, drumView.el);
    }
    rangeView = null;
    if (node.type === 'range') {   // the port it feeds and the stretch of its span in use
      rangeView = createRangeView({
        doc, getTarget: () => rangeTargetOf(desc(), nodeTypes, node.id),
        getParam: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(q => q.name === name)?.def ?? 0,
      });
      items.splice(1, 0, rangeView.el);
    }
    intView = null;
    if (type.editor === 'int') {   // a number box with - and + buttons
      const spec = type.params[0];
      intView = createIntView({
        doc, min: spec.min, max: spec.max,
        get: () => readLive(instId, node.id, 'value') ?? node.params?.value ?? spec.def,
        set: v => { setParam(desc(), node.id, 'value', v); onParam(instId, node.id, 'value', v); paramView?.refresh(); exposedView?.refresh(); dirty = true; },
      });
      items.splice(1, 0, intView.el);
    }
    canyonView = null;
    if (type.editor === 'canyon') {   // the four delay lines and their echoes against the ticks, drawn from the parameters
      canyonView = createCanyonView({ doc, getTiming, getParam: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0 });
      items.splice(1, 0, canyonView.el);
    }
    tapEditor = null;
    if (type.editor === 'taps') {   // the taps of a Shiva delay, kept on the node and sent live
      tapEditor = createTapEditor({
        doc, points: node.data?.taps,
        getParam: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0,
        onChange: points => {
          node.data = { ...node.data, taps: points };
          onData(instId, node.id, { type: 'taps', points });
        },
      });
      items.splice(1, 0, tapEditor.el);
    }
    tableEditor = null;
    if (type.editor === 'wavetable') {   // the table and the A / B waves, kept on the node and sent live
      tableEditor = createWavetableEditor({
        doc, data: node.data, getSampleIds, getSample,
        getParam: name => node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0,
        onChange: (kind, points) => {
          node.data = { ...node.data };
          if (points === null) delete node.data[kind]; else node.data[kind] = points;
          if (kind !== 'meta') onData(instId, node.id, { type: kind, points });
          else if (!node.data.meta) delete node.data.meta;
        },
      });
      items.splice(1, 0, tableEditor.el);
    }
    if (nodeTypes[node.type]?.samples) {   // the samples this node plays: a list, picked from a pattern by the Smp column (00 is the first)
      const cur = def().samples?.[node.id];
      const list = Array.isArray(cur) ? [...cur] : cur === undefined ? [] : [cur];
      const save = next => {
        def().samples = { ...def().samples, [node.id]: next.length === 1 ? next[0] : next };
        structure();
        renderNodePanel();   // the list changed length
      };
      const rows = list.map((sampleId, i) => {
        const picker = el('select', {}, ...getSampleIds().map(id => el('option', { value: id, textContent: id })));
        picker.value = sampleId;
        picker.addEventListener('change', () => save(list.map((v, k) => (k === i ? picker.value : v))));
        const parts = [el('span', { textContent: `sample ${i.toString(16).toUpperCase().padStart(2, '0')}` }), picker];
        if (list.length > 1) {
          const remove = el('button', { textContent: '✕', title: 'Remove this sample from the list' });
          remove.addEventListener('click', () => save(list.filter((_, k) => k !== i)));
          parts.push(remove);
        }
        return el('div', { className: 'prow' }, ...parts);
      });
      const add = el('button', { textContent: 'Add sample', title: 'Add another sample to the list, to play with the Smp column' });
      add.addEventListener('click', () => { if (getSampleIds().length) save([...list, getSampleIds()[0]]); });
      items.splice(1, 0, ...rows, add);
    }
    if (!type.master && type.params.length) {   // presets: the ones the node type ships, and the ones you saved for it
      const live = name => readLive(instId, node.id, name);
      const pick = el('select', { ariaLabel: 'Node preset' });
      const fill = chosen => {
        const f = factoryPresets(type), u = userPresets(node.type);
        pick.replaceChildren(el('option', { value: '', textContent: '(preset list)' }),
          ...(f.length ? [el('optgroup', { label: 'factory' }, ...f.map(x => el('option', { value: `f:${x.name}`, textContent: x.name })))] : []),
          ...(u.length ? [el('optgroup', { label: 'yours' }, ...u.map(x => el('option', { value: `u:${x.name}`, textContent: x.name })))] : []));
        pick.value = chosen ?? '';
      };
      fill();
      pick.addEventListener('change', () => {
        const [kind, ...rest] = pick.value.split(':'), name = rest.join(':');
        const preset = kind === 'f' ? factoryPresets(type).find(x => x.name === name) : kind === 'u' ? userPresets(node.type).find(x => x.name === name) : null;
        if (!preset) return;
        for (const [k, v] of valuesOf(preset, type)) { setParam(desc(), node.id, k, v); onParam(instId, node.id, k, v); }
        for (const k of DATA_KEYS) if (preset.data?.[k]) { node.data = { ...node.data, [k]: [...preset.data[k]] }; onData(instId, node.id, { type: k, points: [...preset.data[k]] }); }
        dirty = true; renderPanel();
      });
      const name = el('input', { placeholder: 'save as…', ariaLabel: 'Name for a new preset', size: 12 });
      const save = el('button', { textContent: 'Save', title: 'Keep this node\'s settings as a preset for every node of this type (kept in this browser)' });
      save.addEventListener('click', () => {
        const n = name.value.trim(); if (!n) return;
        if (saveUserPreset(node.type, capture(node, type, n, live))) { name.value = ''; fill(`u:${n}`); say(`Saved the preset "${n}".`); } else say('The browser would not keep the preset.');
      });
      const drop = el('button', { textContent: '✕', title: 'Delete the chosen preset of yours' });
      drop.addEventListener('click', () => { if (pick.value.startsWith('u:')) { deleteUserPreset(node.type, pick.value.slice(2)); fill(); } });
      items.unshift(el('div', { className: 'prow presets' }, el('span', { textContent: 'selected node preset' }), pick, drop, name, save));
    }
    // the preset row and the duplicate and delete buttons live in the bar above the graph, next to Add node
    const tool = x => x.classList?.contains('presets') || x.classList?.contains('tool');
    if (toolsEl) { toolsEl.replaceChildren(...items.filter(tool)); panel.replaceChildren(...items.filter(x => !tool(x))); } else panel.replaceChildren(...items);
  }

  // ---- mouse and keyboard ----
  // For a node that sits in a chain (something into its first input, something out of its first output): where its
  // neighbours' ports are, so that dragging it away from the line between them can be told.
  function inlineOf(node) {
    const type = nodeTypes[node.type], ins = inputsOf(node, type);
    if (type.master || !ins.length || !type.outputs.length) return null;
    const inn = `${node.id}.${ins[0]}`, out = `${node.id}.${type.outputs[0]}`;
    const f = desc().connections.find(([, t]) => t === inn), t = desc().connections.find(([from]) => from === out);
    if (!f || !t) return null;
    return { a: linkEnds(desc(), nodeTypes, [f[0], inn]).a, b: linkEnds(desc(), nodeTypes, [out, t[1]]).b };
  }

  // ---- port hover, and picking a wire up by its end ----
  // The port under the mouse pulses; with several wires on it, Tab chooses which one is lit (the one that a click on the port picks up).
  let hoverPort = null, pickWire = 0;
  const wiresAt = h => (h ? desc().connections.map((c, i) => [c, i]).filter(([c]) => c[h.side === 'in' ? 1 : 0] === `${h.node}.${h.port}`).map(([, i]) => i) : []);
  const litWire = () => { const ws = wiresAt(hoverPort); return ws.length ? ws[pickWire % ws.length] : -1; };
  function setHover(e) {
    const h = hitTest(desc(), nodeTypes, e.offsetX, e.offsetY), p = h?.kind === 'port' ? h : null;
    const same = p && hoverPort && p.node === hoverPort.node && p.port === hoverPort.port && p.side === hoverPort.side;
    if (!same) { hoverPort = p; pickWire = 0; dirty = true; if (p && (!doc.activeElement || doc.activeElement === doc.body)) canvas.focus?.(); }
    return h;
  }
  const portRef = (ref, side) => { const [id, port] = ref.split('.'), node = desc().nodes.find(n => n.id === id), type = nodeTypes[node.type]; return portPos(node, type, side, side === 'out' ? type.outputs.indexOf(port) : inputsOf(node, type).indexOf(port)); };
  function dropWire(d, restore) {   // puts a picked-up wire back (or, restore false, leaves it removed)
    if (d.started && restore) { try { connect(desc(), nodeTypes, d.link[0], d.link[1]); } catch {} }
    if (d.started) structure();
  }

  canvas.addEventListener('mousedown', e => {
    if (!instId) return;
    canvas.focus?.();
    const x = e.offsetX, y = e.offsetY;
    if (e.button === 1) {   // middle button: pan the whole graph
      e.preventDefault?.();
      drag = { kind: 'pan', x, y };
      return;
    }
    if (e.button === 0 && scopeClick(x, y)) return;
    const hit = hitTest(desc(), nodeTypes, x, y);
    say('');
    if (hit?.kind === 'node' && e.altKey && e.button === 0) {   // Alt+drag: a copy of the node (or the group) is made and moved
      try {
        const made = duplicateNodes(desc(), nodeTypes, group.has(hit.id) ? [...group] : [hit.id]);
        if (made.length) {
          group.clear();
          if (made.length > 1) { for (const m of made) group.add(m); selected = null; } else selected = { kind: 'node', id: made[0] };
          drag = { kind: 'move', ids: made, x, y, from: new Map(made.map(id => { const n = desc().nodes.find(k => k.id === id); return [id, { x: n.x, y: n.y }]; })) };
          say(made.length > 1 ? `Moving ${made.length} copies` : `Moving a copy of ${hit.id}`);
          renderPanel(); structure(); dirty = true;
          return;
        }
      } catch (err) { say(err.message); }
    }
    if (hit?.kind === 'node' && e.shiftKey) {   // Shift+click adds a node to the group; Shift+drag moves it out of its chain
      const node = desc().nodes.find(n => n.id === hit.id);
      drag = { kind: 'move', ids: [hit.id], x, y, from: new Map([[hit.id, { x: node.x, y: node.y }]]), inline: inlineOf(node), force: true, moved: false, shiftId: hit.id };
      return;
    }
    if (hit?.kind === 'node' && group.has(hit.id)) {   // a node of the group: drag them all
      drag = { kind: 'move', ids: [...group], x, y, from: new Map([...group].map(id => { const n = desc().nodes.find(k => k.id === id); return [id, { x: n.x, y: n.y }]; })) };
      dirty = true;
      return;
    }
    group.clear();
    if (hit?.kind === 'port' && (hit.side === 'in' || e.shiftKey) && wiresAt(hit).length && e.button === 0) {   // a wire's end: drag it away (Shift for an output)
      const at = litWire() >= 0 && hoverPort && hoverPort.node === hit.node && hoverPort.port === hit.port ? litWire() : wiresAt(hit)[0];
      drag = { kind: 'rewire', link: [...desc().connections[at]], moving: hit.side === 'in' ? 'to' : 'from', node: hit.node, x, y, x0: x, y0: y, started: false };
      selected = { kind: 'node', id: hit.node };
      return;
    }
    if (hit?.kind === 'port' && hit.side === 'out') {
      drag = { kind: 'connect', from: `${hit.node}.${hit.port}`, x, y };
    } else if (hit?.kind === 'port' || hit?.kind === 'node') {
      const id = hit.kind === 'node' ? hit.id : hit.node;
      const node = desc().nodes.find(n => n.id === id);
      selected = { kind: 'node', id };
      drag = { kind: 'move', ids: [id], x, y, from: new Map([[id, { x: node.x, y: node.y }]]), inline: inlineOf(node) };
    } else if (hit?.kind === 'link') {
      selected = { kind: 'link', index: hit.index };
    } else {
      selected = null;
      if (e.button === 0) drag = { kind: 'lasso', x0: x, y0: y, x, y };   // drag on empty space: lasso
    }
    renderPanel();
    dirty = true;
  });

  // Hovering a wire or a port says what it carries in the status line under the graph.
  let hoverText = '';
  canvas.addEventListener('mousemove', e => {
    if (drag) return;
    let text = '';
    const h = setHover(e);
    if (h?.kind === 'link' || h?.kind === 'port') {
      const { kindOf } = resolveKinds(desc(), nodeTypes);
      if (h.kind === 'link') {
        const link = desc().connections[h.index], a = desc().nodes.find(n => n.id === link[0].split('.')[0]);
        text = `Wire ${link[0]} to ${link[1]}, ${KIND_TEXT[kindOf(a, link[0].split('.')[1])]}`;
      } else {
        const node = desc().nodes.find(n => n.id === h.node);
        text = `${h.side === 'in' ? 'Input' : 'Output'} ${h.node}.${h.port}, ${KIND_TEXT[kindOf(node, h.port)]}`;
      }
    }
    if (h?.kind === 'port') { const n = wiresAt(h).length; if (n) text += n > 1 ? ` — ${n} wires: Tab picks one, then drag the port to move it` : ' — drag to move its wire'; }
    if (text) { hoverText = text; say(text); }
    else if (hoverText) { if (statusEl?.textContent === hoverText) say(''); hoverText = ''; }
  });
  config.onChange?.(k => { if (k.startsWith('wire')) dirty = true; });
  canvas.addEventListener('mouseleave', () => { if (hoverText && statusEl?.textContent === hoverText) say(''); hoverText = ''; });

  canvas.addEventListener('mousemove', e => {
    if (!drag) return;
    if (drag.kind === 'move') {
      let dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (config.get('graphSnap') && !e.ctrlKey) {   // the first node lands on a dot, the rest of a group keep their distance from it
        const g = config.get('graphGridSize'), f = drag.from.values().next().value;
        dx = Math.round((f.x + dx - gridOff.x) / g) * g + gridOff.x - f.x; dy = Math.round((f.y + dy - gridOff.y) / g) * g + gridOff.y - f.y;
      }
      for (const { x, y } of drag.from.values()) { dx = Math.max(dx, -x); dy = Math.max(dy, 14 - y); }   // none leaves the top or left edge (room above for the name)
      for (const [id, p] of drag.from) { const node = desc().nodes.find(n => n.id === id); node.x = p.x + dx; node.y = p.y + dy; }
      if (drag.force && !drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.ids.length === 1) updateDrop();
    } else if (drag.kind === 'pan') {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      drag.x = e.offsetX; drag.y = e.offsetY;
      for (const node of desc().nodes) { node.x += dx; node.y += dy; }
      gridOff.x += dx; gridOff.y += dy;
    } else if (drag.kind === 'lasso') {
      drag.x = e.offsetX; drag.y = e.offsetY;
    } else if (drag.kind === 'rewire') {
      drag.x = e.offsetX; drag.y = e.offsetY;
      if (!drag.started && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 4) {
        drag.started = true;
        disconnect(desc(), drag.link[0], drag.link[1]);
        say('Drop it on another port, or anywhere else to leave it unplugged (Esc puts it back)');
      }
      setHover(e);
    } else {
      if (drag.kind === 'connect') setHover(e);
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
    if (d.force && !d.moved) {   // a Shift+click: the node joins the group
      for (const [id, p] of d.from) { const n = desc().nodes.find(k => k.id === id); n.x = p.x; n.y = p.y; }
      if (selected?.kind === 'node') group.add(selected.id);
      group.add(d.shiftId);
      selected = null;
      renderPanel();
      return;
    }
    if (d.kind === 'move' && (d.hover != null || d.pull)) {
      const id = d.ids[0], link = d.hover != null ? [...desc().connections[d.hover]] : null;
      try {
        if (d.pull) pullOut(desc(), nodeTypes, id);
        if (link) insertOnWire(desc(), nodeTypes, id, link);
        say(link ? `${id} is now in that wire` : `${id} taken out of its chain`);
        structure();
      } catch (err) { say(err.message); }
      return;
    }
    if (d.kind === 'lasso') {
      const [x0, x1] = [Math.min(d.x0, d.x), Math.max(d.x0, d.x)], [y0, y1] = [Math.min(d.y0, d.y), Math.max(d.y0, d.y)];
      if (x1 - x0 < 4 && y1 - y0 < 4) return;   // a plain click
      for (const node of desc().nodes) {
        const { w, h } = nodeBox(nodeTypes[node.type], node);
        if (node.x < x1 && node.x + w > x0 && node.y < y1 && node.y + h > y0) group.add(node.id);
      }
      return;
    }
    if (d.kind === 'rewire') {
      if (!d.started) { renderPanel(); return; }   // only a click: the node is selected
      const hit = hitTest(desc(), nodeTypes, e.offsetX, e.offsetY), want = d.moving === 'to' ? 'in' : 'out';
      if (hit?.kind === 'port' && hit.side === want) {
        const ref = `${hit.node}.${hit.port}`;
        try {
          if (d.moving === 'to') connect(desc(), nodeTypes, d.link[0], ref); else connect(desc(), nodeTypes, ref, d.link[1]);
          say(`Wire moved to ${ref}`);
        } catch (err) { say(err.message); try { connect(desc(), nodeTypes, d.link[0], d.link[1]); } catch {} }
      } else say('Wire unplugged');
      structure(); renderPanel();
      return;
    }
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
    if (!instId) return;
    const hit = hitTest(desc(), nodeTypes, e.offsetX, e.offsetY), id = hit?.kind === 'node' ? hit.id : hit?.kind === 'port' ? hit.node : null;
    const node = id && desc().nodes.find(n => n.id === id);
    if (node && !nodeTypes[node.type].master) {   // right-click on a node: the menu replaces it
      selected = { kind: 'node', id }; group.clear(); renderPanel(); dirty = true;
      onContext({ x: e.offsetX, y: e.offsetY, replace: { id, type: node.type } });
    } else if (hit?.kind === 'link') {   // right-click on a wire: the menu puts the node into that wire
      selected = { kind: 'link', index: hit.index }; group.clear(); renderPanel(); dirty = true;
      onContext({ x: e.offsetX, y: e.offsetY, wire: hit.index });
    } else onContext({ x: e.offsetX, y: e.offsetY });
  });
  canvas.addEventListener('dblclick', e => {
    if (instId && !hitTest(desc(), nodeTypes, e.offsetX, e.offsetY)) onContext({ x: e.offsetX, y: e.offsetY });
  });

  canvas.addEventListener('mouseleave', () => { if (drag?.kind === 'rewire') dropWire(drag, true); drag = null; hoverPort = null; dirty = true; });

  // Moves the selection to the nearest node in a direction ('left', 'right', 'up', 'down'), or to the next one
  // ('next', 'prev') in left-to-right order. With nothing selected the leftmost node is chosen.
  function selectNear(way) {
    if (!instId) return false;
    const boxOf = n => { const { w, h } = nodeBox(nodeTypes[n.type], n); return { x: n.x + w / 2, y: n.y + h / 2 }; };
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
    // With a node selected, its parameter panel takes the arrows, Home/End, PageUp/PageDown and Enter (Alt+arrows move between nodes)
    if (paramView && selected?.kind === 'node' && !e.altKey && !e.metaKey && paramView.key(e)) { e.preventDefault?.(); return; }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && hoverPort && !drag) {   // several wires on the port under the mouse: choose one
      const ws = wiresAt(hoverPort);
      if (ws.length > 1) {
        pickWire = (pickWire + (e.shiftKey ? -1 : 1) + ws.length * 8) % ws.length;
        const [f, t] = desc().connections[ws[pickWire]];
        say(`Wire ${pickWire + 1} of ${ws.length}: ${f} to ${t}. Drag the port to move it`);
        dirty = true; e.preventDefault(); return;
      }
    }
    if (e.key === 'Escape' && drag?.kind === 'rewire') { dropWire(drag, true); drag = null; say('Wire put back'); dirty = true; e.preventDefault?.(); return; }
    if (e.key === 'Escape' && drag?.kind === 'move') {   // Esc while dragging a node: just move it, leave the wires alone
      drag.free = true;
      if (drag.ids.length === 1) updateDrop();
      dirty = true; e.preventDefault?.(); return;
    }
    if (e.key === 'Escape') { onEscape(); e.preventDefault?.(); return; }
    if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'd' || e.key === 'D')) { duplicateSelected(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace' || (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'x' || e.key === 'X'))) {   // Ctrl+X removes too
      removeSelected();
      e.preventDefault();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR' && (group.size || selected?.kind === 'node')) {   // Alt+R takes a node out and joins the wires round it (plain R is a keyjazz key)
      removeSelected(true);
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && generatorSelected()) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === '[' || k === ']') { octave = Math.min(8, Math.max(0, octave + (k === ']' ? 1 : -1))); say(`Keyjazz octave ${octave}`); e.preventDefault(); return; }
      if (Object.hasOwn(PIANO, k)) {
        if (!e.repeat && !held.has(k)) { const note = (octave + 1) * 12 + PIANO[k]; /* the pattern's octave numbers: C-4 is MIDI 60 */ held.set(k, note); onNote(instId, note, true); }
        e.preventDefault();
        return;
      }
    }
    const way = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key] ?? (e.key === 'Tab' ? (e.shiftKey ? 'prev' : 'next') : null);
    if (way && !e.ctrlKey && !e.metaKey && selectNear(way)) e.preventDefault();
  });

  canvas.addEventListener('keyup', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (held.has(k)) { onNote(instId, held.get(k), false); held.delete(k); }
  });
  canvas.addEventListener('blur', releaseKeys);

  // ---- drawing ----
  // The envelope of the selected node, drawn big in a box beside it: every ADSR the node type lists (a synth with
  // a filter envelope, or an FM synth with one per operator, shows them overlaid). Attack is a straight rise;
  // decay and release fall exponentially, and the node's times are to fall by 60 dB, so the drawing shows the
  // part that matters (down to 1%) and a sustain stage of a quarter of the whole length.
  const GROUP_COLOUR = ['hsl(35 85% 52%)', 'hsl(200 70% 50%)', 'hsl(145 55% 42%)', 'hsl(300 50% 55%)'];
  const ENV_W = 204, ENV_H = 86;
  // below the node, where the row of the graph leaves room (above it when the node is low in the graph)
  function envRect(box) {
    const x = Math.min(Math.max(4, box.x + box.w / 2 - ENV_W / 2), Math.max(4, W - ENV_W - 4));
    const below = box.y + box.h + 16;
    return { x, y: below + ENV_H <= H - 4 ? below : Math.max(4, box.y - ENV_H - 22), w: ENV_W, h: ENV_H };
  }
  function drawEnvelopes(node, type, box, ink) {
    const value = name => node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0;
    const groups = type.adsr.map(g => ({ a: value(g.atk), d: value(g.dec), s: value(g.sus), r: value(g.rel) }));
    const widest = Math.max(...groups.map(g => g.a + g.d * 0.67 + g.r * 0.67));
    const total = widest * 1.33, hold = total * 0.25;   // the sustain stage is drawn a quarter as long as the rest
    const { x: x0, y: y0 } = envRect(box);
    const px = x0 + 7, pw = ENV_W - 14, py = y0 + 17, ph = 50;
    ctx.save();
    // no box: four corner ticks close around the drawing, so whatever lies under it stays visible
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.7)';
    ctx.lineWidth = 1;
    const L = 8, r = x0 + ENV_W - 0.5, b = y0 + ENV_H - 0.5, l = x0 + 0.5, tp = y0 + 0.5;
    ctx.beginPath();
    ctx.moveTo(l, tp + L); ctx.lineTo(l, tp); ctx.lineTo(l + L, tp);
    ctx.moveTo(r - L, tp); ctx.lineTo(r, tp); ctx.lineTo(r, tp + L);
    ctx.moveTo(l, b - L); ctx.lineTo(l, b); ctx.lineTo(l + L, b);
    ctx.moveTo(r - L, b); ctx.lineTo(r, b); ctx.lineTo(r, b - L);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${node.id} envelope`, x0 + 8, y0 + 4);
    ctx.globalAlpha = 0.25;   // the baseline and the top
    ctx.fillRect(px, py + ph, pw, 1);
    ctx.fillRect(px, py, pw, 1);
    ctx.globalAlpha = 1;
    const xt = ms => px + (ms / (total + hold)) * pw, yv = v => py + ph - v * ph;
    groups.forEach((g, gi) => {
      const aEnd = g.a, dEnd = g.a + g.d * 0.67, sEnd = dEnd + hold, rEnd = sEnd + g.r * 0.67;
      ctx.beginPath();
      ctx.strokeStyle = GROUP_COLOUR[gi % GROUP_COLOUR.length];
      ctx.lineWidth = groups.length > 1 ? 1.75 : 2.5;
      ctx.moveTo(xt(0), yv(0));
      ctx.lineTo(xt(aEnd), yv(1));
      for (let k = 1; k <= 24; k++) { const t = (g.d * 0.67 * k) / 24; ctx.lineTo(xt(aEnd + t), yv(g.s + (1 - g.s) * Math.pow(0.001, t / g.d))); }
      ctx.lineTo(xt(sEnd), yv(g.s));
      for (let k = 1; k <= 24; k++) { const t = (g.r * 0.67 * k) / 24; ctx.lineTo(xt(sEnd + t), yv(g.s * Math.pow(0.001, t / g.r))); }
      ctx.stroke();
      ctx.lineTo(xt(rEnd), yv(0)); ctx.lineTo(xt(0), yv(0));   // a faint fill under the curve
      ctx.globalAlpha = 0.14; ctx.fillStyle = GROUP_COLOUR[gi % GROUP_COLOUR.length]; ctx.fill(); ctx.globalAlpha = 1;
      if (gi === 0) {   // the stage boundaries
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        for (const e of [aEnd, dEnd, sEnd]) { ctx.beginPath(); ctx.moveTo(xt(e), py); ctx.lineTo(xt(e), py + ph); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    });
    ctx.fillStyle = ink;
    const g = groups[0], ms = v => (v >= 100 ? Math.round(v) : v.toFixed(1));
    ctx.fillText(`A ${ms(g.a)}  D ${ms(g.d)}  S ${g.s.toFixed(2)}  R ${ms(g.r)}`, px, py + ph + 6);
    ctx.restore();
  }

  // The frequency response of an equaliser-like node: the sum of its bands as a filled curve, each band's own curve
  // thin in its colour, a dot per band (numbered), a 20 Hz to 20 kHz log axis and a +-18 dB scale.
  const RESP_W = 320, RESP_H = 190, RESP_DB = 18, F_LO = 20, F_HI = 20000;
  function drawResponse(node, type, box, ink) {
    const value = name => node.params?.[name] ?? type.params.find(p => p.name === name)?.def ?? 0;
    const bands = type.curves(value, 48000);
    const x0 = Math.min(Math.max(4, box.x + box.w / 2 - RESP_W / 2), Math.max(4, W - RESP_W - 4));
    const below = box.y + box.h + 16;
    const y0 = below + RESP_H <= H - 4 ? below : Math.max(4, box.y - RESP_H - 22);
    const px = x0 + 30, pw = RESP_W - 42, py = y0 + 20, ph = RESP_H - 44;
    const xf = f => px + (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * pw;
    const yd = db => py + ph / 2 - (Math.max(-RESP_DB, Math.min(RESP_DB, db)) / RESP_DB) * (ph / 2);
    ctx.save();
    ctx.fillStyle = (typeof getComputedStyle === 'function' && getComputedStyle(canvas).backgroundColor) || '#d9dae0';
    ctx.fillRect(x0, y0, RESP_W, RESP_H);
    ctx.fillStyle = 'rgba(128, 128, 128, 0.16)';
    ctx.fillRect(x0, y0, RESP_W, RESP_H);
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, RESP_W - 1, RESP_H - 1);
    ctx.fillStyle = ink;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${node.id} response`, x0 + 8, y0 + 4);
    // the grid: decades and octave-ish marks across, 6 dB steps down
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      ctx.globalAlpha = f === 100 || f === 1000 || f === 10000 ? 0.28 : 0.12;
      ctx.beginPath(); ctx.moveTo(Math.round(xf(f)) + 0.5, py); ctx.lineTo(Math.round(xf(f)) + 0.5, py + ph); ctx.stroke();
    }
    for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
      ctx.globalAlpha = db === 0 ? 0.45 : 0.12;
      ctx.beginPath(); ctx.moveTo(px, Math.round(yd(db)) + 0.5); ctx.lineTo(px + pw, Math.round(yd(db)) + 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 0.75;
    ctx.textBaseline = 'middle';
    for (const db of [-12, 0, 12]) ctx.fillText(`${db > 0 ? '+' : ''}${db}`, x0 + 5, yd(db));
    ctx.textBaseline = 'top';
    for (const [f, name] of [[100, '100'], [1000, '1k'], [10000, '10k']]) ctx.fillText(name, xf(f) - 6, py + ph + 4);
    ctx.globalAlpha = 1;
    const steps = Math.floor(pw), freq = i => F_LO * Math.pow(F_HI / F_LO, i / steps);
    bands.forEach((b, bi) => {
      if (b.off) return;
      ctx.beginPath();
      ctx.strokeStyle = GROUP_COLOUR[bi % GROUP_COLOUR.length];
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      for (let i = 0; i <= steps; i += 2) { const x = px + (i / steps) * pw, y = yd(b.db(freq(i))); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    const total = i => bands.reduce((t, b) => (b.off ? t : t + b.db(freq(i))), 0);
    ctx.beginPath();   // the combined response: filled down to the 0 dB line, then the line itself
    ctx.moveTo(px, yd(0));
    for (let i = 0; i <= steps; i++) ctx.lineTo(px + (i / steps) * pw, yd(total(i)));
    ctx.lineTo(px + pw, yd(0));
    ctx.closePath();
    ctx.globalAlpha = 0.18; ctx.fillStyle = ink; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const x = px + (i / steps) * pw, y = yd(total(i)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = ink; ctx.lineWidth = 2.25; ctx.stroke();
    bands.forEach((b, bi) => {   // a dot for each band, at its frequency and its gain on the combined curve
      if (b.cut) return;
      const x = xf(b.f), y = yd(bands.reduce((t, c) => (c.off ? t : t + c.db(b.f)), 0));   // on the combined curve
      ctx.fillStyle = GROUP_COLOUR[bi % GROUP_COLOUR.length];
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillText(String(b.band), x - 3, y - 17);
    });
    ctx.fillStyle = ink;
    ctx.fillText('dB', x0 + 5, y0 + RESP_H - 18);
    ctx.restore();
  }

  // Values written by the pattern editor live in the shared block, not the graph description: repaint the panels when they move.
  let liveSig = '';
  function followLive() {
    if (!instId || !def()) return;
    const parts = [];
    const sel = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
    if (sel && paramView?.open) for (const sp of nodeTypes[sel.type]?.params ?? []) parts.push(readLive(instId, sel.id, sp.name));
    if (exposedView?.open || floatView?.open) for (const e of def().exposed) parts.push(readLive(instId, e.node, e.param));
    const sig = parts.join(',');
    if (sig === liveSig) return;
    liveSig = sig;
    paramView?.refresh(); exposedView?.refresh(); floatView?.refresh(); tapEditor?.refresh(); gateEditor?.refresh(); specView?.refresh(); canyonView?.refresh(); drumView?.refresh(); intView?.refresh(); rangeView?.refresh(); dxView?.refresh();
  }

  // A graph is moved clear of the exposed-parameters dock once when its instrument is first shown after a load (the file
  // loaded, a new project, a new instrument): the nodes, their names and eyes and any scopes must not sit under it.
  // It waits for the first frame in which the canvas and the dock can be measured; after that the graph is the user's.
  const tidied = new WeakSet();   // by graph: a reloaded file makes new graphs, adding an instrument leaves the others alone
  let tidyPending = false;
  function tidy() {
    if (!tidyPending || !instId || !def()) return;
    const cv = canvas.getBoundingClientRect?.(), dk = exposedDock?.getBoundingClientRect?.();
    if (!cv || !cv.width) return;   // not on screen yet: try again next frame
    tidyPending = false;
    tidied.add(desc());
    if (!dk || !dk.width || exposedDock.style?.display === 'none') return;   // nothing exposed: no dock
    const boxes = [];
    for (const node of desc().nodes) {
      const { w, h } = nodeBox(nodeTypes[node.type], node);
      boxes.push({ x: node.x, y: node.y - 14, w, h: h + 14 + (nodeTypes[node.type].outputs.length ? 20 : 0) });   // the name above, the eye below
      if (node.scope) { const b = scopeBox(node, w, h, node.scope.size, node.scope.mode); boxes.push({ x: b.x, y: b.y, w: b.w ?? b.size, h: b.size }); }
    }
    const { dx, dy } = nudgeClear(boxes, { x: dk.left - cv.left, y: dk.top - cv.top, w: dk.width, h: dk.height }, { w: canvas.width, h: canvas.height });
    if (!dx && !dy) return;
    for (const node of desc().nodes) { node.x += dx; node.y += dy; }
    dirty = true;
  }

  function draw() {
    tidy();
    followLive();
    if (hoverPort) dirty = true;   // the hovered port pulses
    if (!dirty) return;
    dirty = false;
    ctx.clearRect(0, 0, W, H);
    if (!instId) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    if (config.get('graphGrid')) {   // a very faint grid of dots, a brighter one every few
      const g = config.get('graphGridSize'), major = config.get('graphGridMajor'), mod = (a, m) => ((a % m) + m) % m;
      const ox = mod(gridOff.x, g), oy = mod(gridOff.y, g), i0 = Math.round((ox - gridOff.x) / g), j0 = Math.round((oy - gridOff.y) / g);
      ctx.fillStyle = ink;
      for (let j = 0, y = oy; y < H; j++, y += g) for (let i = 0, x = ox; x < W; i++, x += g) {
        const big = major > 0 && mod(i + i0, major) === 0 && mod(j + j0, major) === 0;
        ctx.globalAlpha = big ? 0.3 : 0.11;
        ctx.fillRect(Math.round(x) - (big ? 1 : 0.5), Math.round(y) - (big ? 1 : 0.5), big ? 2 : 1.5, big ? 2 : 1.5);
      }
      ctx.globalAlpha = 1;
    }
    const accent = (typeof getComputedStyle === 'function' && getComputedStyle(canvas).getPropertyValue('--accent').trim()) || 'hsl(210 70% 55%)';
    const backdrop = (() => {   // what is behind the graph, so a node can be filled with it and hide the wires that pass under it
      if (typeof getComputedStyle !== 'function') return null;
      for (let e = canvas; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c; }
      return null;
    })();
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.lineWidth = 1.5;

    const { kindOf } = resolveKinds(desc(), nodeTypes);
    desc().connections.forEach((link, i) => {
      const { a, b, kind } = linkEnds(desc(), nodeTypes, link, kindOf);
      const hot = drag?.kind === 'move' && drag.hover === i;
      const lit = hoverPort && litWire() === i && !drag;
      const chosen = hot || lit || (selected?.kind === 'link' && selected.index === i);
      ctx.beginPath();
      ctx.strokeStyle = chosen ? accent : kindColour(kind);
      ctx.lineWidth = hot ? 5 : lit ? 4.5 : chosen ? 3.5 : kind === 'stereo' ? 3 : 1.75;   // a stereo pair is drawn heavier
      ctx.setLineDash((kind === 'control' || kind === 'param') && config.get('wireDashed') ? [7, 5] : []);   // control wires dashed
      ctx.moveTo(a.x, a.y);
      { const k = arm(a, b); ctx.bezierCurveTo(a.x + k, a.y, b.x - k, b.y, b.x, b.y); }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    if (drag?.kind === 'move' && drag.pull && drag.inline) {   // where the neighbours would be joined
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(drag.inline.a.x, drag.inline.a.y);
      { const k = arm(drag.inline.a, drag.inline.b); ctx.bezierCurveTo(drag.inline.a.x + k, drag.inline.a.y, drag.inline.b.x - k, drag.inline.b.y, drag.inline.b.x, drag.inline.b.y); }
      ctx.stroke();
      ctx.restore();
    }
    if (drag?.kind === 'rewire' && drag.started) {   // the picked-up wire, still held by its other end
      const fixed = drag.moving === 'to' ? portRef(drag.link[0], 'out') : portRef(drag.link[1], 'in');
      ctx.beginPath(); ctx.strokeStyle = accent; ctx.lineWidth = 2.25; ctx.setLineDash([6, 4]);
      ctx.moveTo(fixed.x, fixed.y); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.setLineDash([]);
    }
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
      const type = nodeTypes[node.type], { w, h } = nodeBox(type, node);
      const chosen = (selected?.kind === 'node' && selected.id === node.id) || group.has(node.id);
      ctx.beginPath();
      if (type.shape === 'circle' || type.shape === 'dot') ctx.arc(node.x + w / 2, node.y + h / 2, w / 2, 0, 2 * Math.PI);
      else if (type.shape === 'rounded') ctx.roundRect(node.x, node.y, w, h, 10);
      else if (type.shape === 'speaker') {   // a small back and a cone that opens to the right
        ctx.moveTo(node.x, node.y + 0.3 * h); ctx.lineTo(node.x + 0.38 * w, node.y + 0.3 * h);
        ctx.lineTo(node.x + w, node.y); ctx.lineTo(node.x + w, node.y + h);
        ctx.lineTo(node.x + 0.38 * w, node.y + 0.7 * h); ctx.lineTo(node.x, node.y + 0.7 * h);
        ctx.closePath();
      }
      else ctx.rect(node.x, node.y, w, h);
      if (backdrop && type.shape !== 'dot') { ctx.fillStyle = backdrop; ctx.fill(); }   // wires run behind a node, not through it
      ctx.fillStyle = type.shape === 'dot' ? kindColour(kindOf(node, 'out')) : 'rgba(128, 128, 128, 0.18)';   // a route point is a solid dot in its wire's colour
      ctx.fill();
      ctx.strokeStyle = chosen ? accent : type.shape === 'dot' ? ink : 'rgba(128, 128, 128, 0.55)';   // a quiet grey until selected
      ctx.lineWidth = chosen ? 2.5 : type.shape === 'dot' ? 1 : 1.5;
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      if (type.shape !== 'dot' || chosen) ctx.fillText(node.id, node.x + w / 2, node.y - 5);   // the name sits above the shape (a route dot shows it only when chosen)
      if (node.type === 'tap') { const slot = Math.round(node.params?.smp ?? type.params.find(q => q.name === 'smp').def), copy = Math.round(node.params?.copy ?? 0); ctx.fillText(slot >= 1 && slot <= 16 ? `\u2192 tap${String(slot).padStart(2, '0')}${copy ? `, copy ${copy}` : ''}` : '\u2192 (off)', node.x + w / 2, node.y + h + 12); }   // where it writes
      if (node.type === 'sidechain') { ctx.fillText(node.source ? `\u2190 ${node.source}` : '\u2190 (none)', node.x + w / 2, node.y + h + 12); }   // where it listens to

      if (type.face) {   // the node shows its own state on its face, selected or not
        const live = name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(q => q.name === name)?.def ?? 0;
        drawFace(ctx, type.face, node.x, node.y, w, h, { node, live, ink });
      }
      const glyph = type.face ? null : GLYPHS[type.glyph];
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
      for (const [side, names] of type.shape === 'dot' ? [] : [['in', inputsOf(node, type)], ['out', type.outputs]]) {   // a route dot is its own port
        names.forEach((name, i) => {
          const p = portPos(node, type, side, i);
          ctx.beginPath();
          const hov = hoverPort && hoverPort.node === node.id && hoverPort.port === name && hoverPort.side === side;
          ctx.arc(p.x, p.y, PORT_R + (hov ? 1 + 2.5 * (0.5 + 0.5 * Math.sin(Date.now() / 260)) : 0), 0, 2 * Math.PI);
          ctx.fillStyle = kindColour(kindOf(node, name));
          ctx.fill();
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.stroke();
          if (type.shape !== 'circle') {   // the shape has no room for names inside a circle
            ctx.fillStyle = ink;
            ctx.globalAlpha = 0.75;
            ctx.textAlign = side === 'in' ? 'left' : 'right';
            ctx.fillText(name.startsWith('@') ? name.slice(1) : name, p.x + (side === 'in' ? 8 : -8), p.y);
            ctx.globalAlpha = 1;
          }
        });
      }
    }
    for (const node of desc().nodes) {
      if (!nodeTypes[node.type].outputs.length || nodeTypes[node.type].shape === 'dot') continue;
      const r = eyeRect(node), on = !!node.scope, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      ctx.save();
      ctx.strokeStyle = on ? accent : ink; ctx.fillStyle = on ? accent : ink; ctx.globalAlpha = on ? 1 : 0.3; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.quadraticCurveTo(cx, cy - 8, cx + 7, cy); ctx.quadraticCurveTo(cx, cy + 8, cx - 7, cy); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
    }
    let moving = false;
    for (const node of desc().nodes) {
      if (!node.scope) continue;
      let data = scopeData.get(node.id);
      if (node.type === 'granular' && (node.scope.mode === 'cloud' || node.scope.mode === 'grain')) {   // what the grain scopes draw from
        const type = nodeTypes.granular;
        data = { cloud: cloudData.get(node.id), src: getGrainSource(instId, node.id), param: name => readLive(instId, node.id, name) ?? node.params?.[name] ?? type.params.find(q => q.name === name)?.def ?? 0 };
      }
      moving = drawScope(ctx, scopeRectOf(node), node.scope, data, ink, modesFor(node.type)) || moving;
    }
    if (moving) dirty = true;   // a level meter still falling
    if (drag?.kind === 'move' && drag.hover != null) {   // the wire the node would go into, over the nodes so it shows
      const { a, b } = linkEnds(desc(), nodeTypes, desc().connections[drag.hover]);
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      { const k = arm(a, b); ctx.bezierCurveTo(a.x + k, a.y, b.x - k, b.y, b.x, b.y); }
      ctx.stroke();
      ctx.restore();
    }
    if (drag?.kind === 'lasso') {
      ctx.save();
      ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = accent; ctx.fillStyle = 'hsl(210 70% 55% / 0.12)';
      ctx.fillRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      ctx.strokeRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      ctx.restore();
    }
    const chosenNode = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
    const chosenType = chosenNode && nodeTypes[chosenNode.type];
    if (chosenType?.curves) drawResponse(chosenNode, chosenType, { x: chosenNode.x, y: chosenNode.y, ...nodeBox(chosenType, chosenNode) }, ink);
    if (chosenType?.adsr?.length) drawEnvelopes(chosenNode, chosenType, { x: chosenNode.x, y: chosenNode.y, ...nodeBox(chosenType, chosenNode) }, ink);
  }

  return {
    // Ctrl+D, Ctrl+X and Delete from anywhere on the instrument screen that is not a text field: the same as on the canvas. Returns whether it was used.
    nodeKey(e) {
      if (!instId || e.altKey || e.metaKey || selected?.kind !== 'node') return false;
      if (e.ctrlKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { duplicateSelected(); return true; }
      if ((e.ctrlKey && !e.shiftKey && (e.key === 'x' || e.key === 'X')) || (!e.ctrlKey && e.key === 'Delete')) { removeSelected(); return true; }
      return false;
    },
    // F1 with a node selected: asks the page to show that node's help. Returns whether there was a node.
    helpSelected() {
      const node = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null;
      if (node) onHelp(node.type);
      return !!node;
    },
    // instruments: { id: { graph, exposed, commands?, samples? } }.
    load({ instruments: next }) {
      instruments = next;
      this.show(instId in instruments && instId !== 'master' ? instId : Object.keys(instruments).find(k => k !== 'master') ?? null);   // (the master lane's instrument has no graph to edit)
    },
    // the audio side's latest samples for the watched instrument
    repaint() { dirty = true; if (instId && def()) renderPanel(); },   // the colours changed: the editors in the panel draw themselves again
    // a granular node's new grains (and where it is reading), when one of its scopes is open
    feedCloud(id, node, msg, sr) {
      if (id !== instId) return;
      const now = performance.now();
      let c = cloudData.get(node);
      if (!c) cloudData.set(node, c = { head: 0, t: now, sr, gain: 1, grains: [] });
      c.head = msg.head; c.t = now; c.sr = sr;
      for (const [at, step, len, shape] of msg.grains) c.grains.push({ at, step, len, shape, t: now });
      if (c.grains.length > 40) c.grains.splice(0, c.grains.length - 40);
      dirty = true;
    },
    feedScope(id, node, l, r, sr) { if (id === instId) { scopeData.set(node, { l, r, sr }); dirty = true; } },
    undo: () => stepHistory('undo', 'redo', 'undone'),
    redo: () => stepHistory('redo', 'undo', 'redone'),
    show(id) {
      if (instId && instId !== id && def()) for (const n of desc().nodes) if (n.scope) onScope(instId, n.id, false);   // (the old instrument may be gone from a newly loaded project)
      if (instId && selected?.kind === 'node') lastSelected.set(instId, selected.id);   // coming back to an instrument finds the node you left selected
      const same = id === instId, kept = same && selected?.kind === 'node' ? selected.id : null;
      instId = id;
      if (id && def()) { const h = history.get(id); if (h && h.last !== snapshot()) history.delete(id); historyOf(); }   // a history from before the project was reloaded is dropped
      scopeData.clear(); cloudData.clear();
      if (id) for (const n of desc().nodes) if (n.scope) onScope(id, n.id, true);
      // The node that should take the keyjazz: the one selected last time here, else the first generator (an oscillator, a
      // sampler, a synth), so the piano keys play the instrument at once.
      const has = nid => !!nid && !!desc()?.nodes.some(n => n.id === nid);
      const pick = id ? [kept, lastSelected.get(id)].find(has) ?? desc().nodes.find(n => nodeTypes[n.type]?.generator)?.id : null;
      selected = pick ? { kind: 'node', id: pick } : null;
      group.clear();
      drag = null;
      if (id) autoLayout(desc(), nodeTypes);
      tidyPending = !!id && !tidied.has(desc());
      renderPanel();
      dirty = true;
    },
    add(type, at) {
      if (!instId) return;
      try {
        const n = desc().nodes.length;
        const pos = at ? { x: Math.max(0, at.x), y: Math.max(14, at.y) } : { x: 20 + (n % 5) * 150, y: 30 + Math.floor(n / 5) * 80 };
        const id = addNode(desc(), nodeTypes, type, pos);
        if (nodeTypes[type]?.samples && getSampleIds().length) def().samples = { ...def().samples, [id]: getSampleIds()[0] };
        selected = { kind: 'node', id };
        say('');
        renderPanel();
        structure();
      } catch (err) {
        say(err.message);
      }
    },
    // Puts a new node into the middle of a wire (the right-click menu on a wire): it is wired to both ends, and the nodes to
    // the right of its place move over so it has room and nothing overlaps.
    insertIntoWire(type, index) {
      if (!instId) return;
      const before = structuredClone(def().graph ?? null);
      try {
        const link = [...desc().connections[index]];
        const d = desc(), byId = id => d.nodes.find(n => n.id === id);
        const A = byId(link[0].split('.')[0]), B = byId(link[1].split('.')[0]);
        const tdef = nodeTypes[type], size = nodeBox(tdef, { type, x: 0, y: 0 });
        const pa = portPos(A, nodeTypes[A.type], 'out', nodeTypes[A.type].outputs.indexOf(link[0].split('.')[1]));
        const pb = portPos(B, nodeTypes[B.type], 'in', inputsOf(B, nodeTypes[B.type]).indexOf(link[1].split('.')[1]));
        const GAP = 36, need = size.w + 2 * GAP, room = pb.x - pa.x, dx = Math.max(0, need - room);
        const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
        const moved = d.nodes.filter(n => n.x !== undefined && n.x + nodeBox(nodeTypes[n.type], n).w / 2 > midX);
        const id = addNode(d, nodeTypes, type, { x: Math.max(0, midX - size.w / 2), y: Math.max(14, midY - size.h / 2) });
        for (const n of moved) if (n.id !== id) n.x += dx;
        const node = byId(id);
        node.x = Math.max(0, (pa.x + pb.x + dx) / 2 - size.w / 2);
        if (nodeTypes[type]?.samples && getSampleIds().length) def().samples = { ...def().samples, [id]: getSampleIds()[0] };
        insertOnWire(d, nodeTypes, id, link);
        selected = { kind: 'node', id };
        group.clear();
        say(`${id} is now in that wire`);
        renderPanel();
        structure();
        dirty = true;
      } catch (err) {
        if (before) def().graph = before;
        say(err.message);
        renderPanel();
        dirty = true;
      }
    },
    // Swaps a node for one of another type (the right-click menu on a node), keeping its place, wires and shared parameters.
    replace(id, type) {
      if (!instId) return;
      try {
        const { id: now, renamed } = replaceNode(desc(), nodeTypes, id, type);
        if (renamed) {   // what pointed at the old id follows it
          const d = def();
          d.exposed = (d.exposed ?? []).map(e => (e.node === renamed ? { ...e, node: now } : e));
          if (d.commands) d.commands = d.commands.map(c => (c.node === renamed ? { ...c, node: now } : c));
          if (d.samples && renamed in d.samples) { const { [renamed]: smp, ...rest } = d.samples; d.samples = nodeTypes[type]?.samples ? { ...rest, [now]: smp } : rest; }
        } else if (def().samples?.[now] && !nodeTypes[type]?.samples) { const { [now]: _gone, ...rest } = def().samples; def().samples = rest; }
        if (nodeTypes[type]?.samples && !def().samples?.[now] && getSampleIds().length) def().samples = { ...def().samples, [now]: getSampleIds()[0] };
        selected = { kind: 'node', id: now };
        group.clear();
        say(`${id} is now a ${type}${renamed ? ` (${now})` : ''}.`);
        renderPanel();
        structure();
      } catch (err) {
        say(err.message);
      }
    },
    // Draws the panel again, for when parameters were changed from outside (a preset).
    refreshPanel() { renderPanel(); dirty = true; },
    // The rows behind the two parameter panels (what they draw), for the tests and for anything that wants the values.
    paramRows() { const node = selected?.kind === 'node' ? desc().nodes.find(n => n.id === selected.id) : null; return node ? shownRows(rowsFor(node, nodeTypes[node.type])) : []; },
    exposedRows,
    // Changes the width of the graph area in CSS pixels; the graph is drawn again at once.
    fit(width) {
      const w = Math.round(Math.max(400, width));
      if (w === W) return W;
      W = w;
      canvas.style.width = `${W}px`;
      canvas.width = W * dpr;
      if (dpr !== 1) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      draw();   // at once: the observer runs after the frame's callbacks, so waiting for the next frame shows a cleared canvas
      return W;
    },
    get width() { return W; },
    // Changes the height of the graph area in CSS pixels (the width stays); the graph is drawn again at once.
    resize(height) {
      H = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
      canvas.style.height = `${H}px`;
      if (paramPanel) (paramPanel.parentElement ?? paramPanel).style.maxHeight = `${H - 2}px`;
      canvas.height = H * dpr;   // a new size clears the canvas and its transform
      if (dpr !== 1) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
      draw();
      return H;
    },
    get height() { return H; },
    get selectedNode() { return selected?.kind === 'node' ? selected.id : null; },
    draw,
    // the floating exposed-parameters window: on or off, and kept current while another screen is showing
    float(on) { floatOn = !!on; renderFloat(); },
    live() { followLive(); },
    get floating() { return !!floatView?.open; },
    get instrument() { return instId; },
    get octave() { return octave; },
    releaseKeys,
  };
}
