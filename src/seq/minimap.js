// Pattern minimaps for the arrangement: each cell of the arrangement shows a small picture of the 16 ticks it stands for.
// Notes are ticks, placed across the cell by pitch and as bright as their velocity; a note's length is a thin line down to
// the next note, note off (===, cyan cap) or note cut (^^^, magenta cap); the parameter columns are grey cells at the
// right edge, darker (brighter in a dark theme) the higher the value, and empty ones left out.
// The picture is drawn on one canvas laid over the arrangement. A row of cells is read once (rows are never edited in
// place, so a row array is a safe cache key) and the canvas is redrawn only when something it shows has changed.
import { noteSemitones } from './cells.js';

const LO = 24, HI = 96;   // the pitch range across a cell: C-1 to C-7, as MIDI numbers
const OFFC = '#17b8d4', CUTC = '#ff3fa4';
const HEX = { '1hex': 15, '2hex': 255, '4hex': 65535 };

const plans = new WeakMap();   // columns -> which are notes (with their velocity column) and which are parameters
function planOf(columns) {
  let p = plans.get(columns);
  if (p) return p;
  const notes = [], pars = [], vel = new Set();
  columns.forEach((c, i) => {
    if (c.token !== 'note' && !c.rel) return;   // (a meta machine's relative notes are notes too, 80 being their root)
    const v = columns[i + 1], hasVel = v && v.token === '2hex' && (v.kind === 'vel' || /^v/i.test(`${v.label ?? ''}`));
    notes.push({ i, v: hasVel ? i + 1 : -1, ...(c.rel ? { root: c.root } : {}) }); if (hasVel) vel.add(i + 1);
  });
  columns.forEach((c, i) => { if (c.token !== 'note' && !c.rel && c.kind !== 'spacer' && !vel.has(i)) pars.push(i); });
  plans.set(columns, p = { notes, pars });
  return p;
}

const infos = new WeakMap(), ids = new WeakMap();
let nextId = 1;
const idOf = row => { let i = ids.get(row); if (i === undefined) ids.set(row, i = nextId++); return i; };
const BLANK = Object.freeze({ notes: [], par: [] });

// What one row (an array of tokens) holds: [{ col, kind: 'note' | 'off' | 'cut', pitch, vel }] and the parameter values (0..1, -1 empty)
export function infoOf(row, columns) {
  if (!row) return BLANK;
  let info = infos.get(row);
  if (info) return info;
  const plan = planOf(columns), notes = [], par = [];
  for (const n of plan.notes) {
    const tok = row[n.i];
    if (n.root !== undefined) {   // a relative note: 00 is a note off, otherwise the root and the steps above or below it
      if (tok === '00') notes.push({ col: n.i, kind: 'off' });
      else if (/^[0-9a-f]{2}$/i.test(tok)) {
        const vt = n.v >= 0 ? row[n.v] : null, vel = vt && /^[0-9a-f]+$/i.test(vt) ? parseInt(vt, 16) / 255 : 0.8;
        notes.push({ col: n.i, kind: 'note', pitch: Math.max(0, Math.min(127, n.root + parseInt(tok, 16) - 0x80)), vel });
      }
    } else if (tok === '===') notes.push({ col: n.i, kind: 'off' });
    else if (tok === '^^^') notes.push({ col: n.i, kind: 'cut' });
    else {
      const s = noteSemitones(tok);
      if (s !== null) {
        const vt = n.v >= 0 ? row[n.v] : null, vel = vt && /^[0-9a-f]+$/i.test(vt) ? parseInt(vt, 16) / 255 : 0.8;
        notes.push({ col: n.i, kind: 'note', pitch: s + 12, vel });
      }
    }
  }
  for (const i of plan.pars) {
    const tok = row[i], max = HEX[columns[i].token];
    if (max) par.push(/^[0-9a-f]+$/i.test(tok) ? parseInt(tok, 16) / max : -1);
    else par.push(typeof tok === 'string' && tok !== '......' && /^[0-9a-f]{2}/i.test(tok) ? Math.min(1, parseInt(tok.slice(2) || '0', 16) / 65535 + 0.15) : -1);   // a command: present, shown by its value
  }
  info = notes.length || par.some(v => v >= 0) ? { notes, par } : BLANK;
  infos.set(row, info);
  return info;
}

export function createMinimap(el) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) canvas.className = 'minimap';
  let key = '', attached = false;

  const hide = () => { canvas?.remove(); key = ''; };

  // lanes: the arrangement's lanes (each with columns and rows, one row of tokens per tick); first, last: the rows (of CELL
  // ticks) on screen; CELL: ticks per row; opts: { lengths, caps, params }
  function paint({ lanes, first, last, CELL, opts, html }) {
    if (!canvas || !el.children) return;
    const rowEls = [...el.children].slice(1);
    // a stamp of everything the picture shows, so it is only redrawn when that changes
    let stamp = 0;
    for (const l of lanes) for (let r = first; r < last; r++) for (let k = 0; k < CELL; k++) stamp = (stamp * 31 + idOf(l.rows[r * CELL + k] ?? BLANK_ROW)) | 0;
    const dpr = devicePixelRatio || 1, fg = getComputedStyle(el).color, w = Math.max(el.scrollWidth, el.clientWidth), h = Math.max(el.scrollHeight, el.clientHeight);
    const next = `${html.length}:${stamp}:${w}x${h}:${opts.lengths}${opts.caps}${opts.params}:${fg}:${dpr}`;
    const fresh = canvas.parentNode !== el;
    if (fresh) el.appendChild(canvas);
    if (next === key && !fresh) return;
    key = next;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const [r0, g0, b0] = (fg.match(/[\d.]+/g) ?? [30, 30, 40]).map(Number);
    const ink = a => `rgba(${r0},${g0},${b0},${a})`;
    for (let r = first; r < last; r++) {
      const rowEl = rowEls[r - first];
      if (!rowEl) continue;
      const cells = [...rowEl.children].filter(c => c.classList?.contains('cell'));
      cells.forEach((cell, li) => {
        const lane = lanes[li];
        if (!lane) return;
        drawCell(g, lane, r * CELL, CELL, cell.offsetLeft, rowEl.offsetTop, cell.offsetWidth, rowEl.offsetHeight, opts, ink);
      });
    }
  }

  function drawCell(g, lane, t0, CELL, x0, y0, w, h, opts, ink) {
    const plan = planOf(lane.columns), step = h / CELL, pad = 3;
    const parW = opts.params && plan.pars.length ? Math.min(w * 0.38, plan.pars.length * 5 + 3) : 0, nw = w - parW - pad * 2, px = p => x0 + pad + Math.max(0, Math.min(1, (p - LO) / (HI - LO))) * (nw - 4);
    // notes that are still sounding when the row begins: look back for the last event in each note column
    const live = new Map();
    if (opts.lengths) {
      for (const n of plan.notes) {
        for (let t = t0 - 1, left = 96; t >= 0 && left > 0; t--, left--) {
          const ev = infoOf(lane.rows[t], lane.columns).notes.find(e => e.col === n.i);
          if (!ev) continue;
          if (ev.kind === 'note') live.set(n.i, { x: px(ev.pitch), from: y0 - 1, vel: ev.vel });
          break;
        }
      }
    }
    for (let k = 0; k < CELL; k++) {
      const info = infoOf(lane.rows[t0 + k], lane.columns), y = y0 + k * step;
      for (const e of info.notes) {
        const open = live.get(e.col);
        if (open && opts.lengths) { g.fillStyle = ink(0.28 * (0.4 + open.vel)); g.fillRect(open.x - 0.5, Math.max(open.from, y0), 1, y - Math.max(open.from, y0)); live.delete(e.col); }
        if (e.kind === 'note') {
          const x = px(e.pitch);
          g.fillStyle = ink(0.3 + 0.7 * e.vel); g.fillRect(x - 2.5, y, 5, Math.max(1.4, step * 0.8));
          if (opts.lengths) live.set(e.col, { x, from: y, vel: e.vel });
        } else if (opts.caps) {
          const x = open ? open.x : x0 + pad + nw / 2;
          g.fillStyle = e.kind === 'cut' ? CUTC : OFFC; g.fillRect(x - 3.5, y, 7, Math.max(1.5, step * 0.7));
        }
      }
    }
    if (opts.lengths) for (const o of live.values()) { g.fillStyle = ink(0.28 * (0.4 + o.vel)); g.fillRect(o.x - 0.5, Math.max(o.from, y0), 1, y0 + h - Math.max(o.from, y0)); }
    // parameters: a narrow column each at the right edge, one cell per tick that sets a value
    if (parW) {
      const each = (parW - 3) / plan.pars.length, cw = Math.max(0.6, Math.min(4, each - 1)), left = x0 + w - parW + 2;   // (every parameter fits in the strip, however many there are)
      for (let k = 0; k < CELL; k++) {
        const par = infoOf(lane.rows[t0 + k], lane.columns).par, y = y0 + k * step;
        for (let c = 0; c < par.length; c++) if (par[c] >= 0) { g.fillStyle = ink(0.14 + 0.72 * par[c]); g.fillRect(left + c * Math.min(cw + 1, each), y, cw, Math.max(1.4, step)); }
      }
    }
  }

  return { paint, hide };
}
const BLANK_ROW = Object.freeze([]);
