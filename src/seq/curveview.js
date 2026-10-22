// Lane curves drawn over the arrangement: a hairline down each lane that has one, with its anchors. Time runs down the
// page like the grid, the value runs across the lane. The SVG sits inside the grid element (put back after every redraw).
//   hover a segment  -> a small box "bezier" with a tick (ticked: bezier, unticked: straight)
//   drag an anchor   -> snaps to pattern edges and rows (Alt: free); landing on an edge pins it
//   press on the line -> a new anchor there
//   right-click an anchor -> pin, unpin, delete
import { pathOf, midOf, snapTick, addPoint, removePoint, movePoint, edgesOf, targetsOf } from './automation.js';

const PAD = 5;     // pixels between a lane column's edge and the value 0 or 1
const SNAP = 5;    // ticks: how near an anchor must come to a pattern edge to be pulled onto it
const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The curve a lane shows: lane.shown picks one of its curves.
export const shownCurve = lane => (lane.curves?.length ? lane.curves[Math.min(lane.shown ?? 0, lane.curves.length - 1)] : null);

const sub = (curve, i) => ({ pts: [curve.pts[i], curve.pts[i + 1]], kinds: [curve.kinds[i] ?? 'c'] });

// The markup for every lane's curve. geo = { hb, rowH, cols: [{ x, w }] }; state = { hover, drag, badge }.
export function curveMarkup({ lanes, geo, top, CELL, state = {} }) {
  const y = t => geo.hb + (t / CELL - top) * geo.rowH;
  let out = '';
  lanes.forEach((lane, li) => {
    const c = shownCurve(lane), col = geo.cols[li];
    if (!c || !col || !c.pts.length) return;
    const x = v => col.x + PAD + (col.w - 2 * PAD) * v;
    const on = c.on !== false, ci = lane.curves.indexOf(c);
    if (!on) { out += `<path class="ln off" d="${pathOf(c, x, y)}"/>`; return; }
    const d = pathOf(c, x, y);
    out += `<path class="veil" d="${d} L${x(0)} ${y(c.pts[c.pts.length - 1].t)} L${x(0)} ${y(c.pts[0].t)}Z"/>`;
    if (state.hover && state.hover.li === li && state.hover.seg < c.pts.length - 1) out += `<path class="hov" d="${pathOf(sub(c, state.hover.seg), x, y)}"/>`;
    out += `<path class="ln" d="${d}"/>`;
    for (let i = 0; i < c.pts.length - 1; i++) out += `<path class="hit" data-li="${li}" data-ci="${ci}" data-seg="${i}" d="${pathOf(sub(c, i), x, y)}"/>`;
    if (state.drag?.li === li && state.drag.guide !== undefined) out += `<path class="guide" d="M${col.x} ${y(state.drag.guide)}H${col.x + col.w}"/>`;
    c.pts.forEach((p, i) => {
      const px = x(p.v), py = y(p.t), corner = (i > 0 && c.kinds[i - 1] === 'l') || (i < c.pts.length - 1 && c.kinds[i] === 'l') || i === 0 || i === c.pts.length - 1;
      const attrs = `class="pt${p.pin ? ' pin' : ''}${state.drag?.li === li && state.drag.i === i ? ' sel' : ''}" data-li="${li}" data-ci="${ci}" data-i="${i}"`;
      out += p.pin ? `<path ${attrs} d="M${px} ${py - 5.5}l5.5 5.5l-5.5 5.5l-5.5 -5.5z"/>`
        : corner ? `<rect ${attrs} x="${px - 3.6}" y="${py - 3.6}" width="7.2" height="7.2"/>`
          : `<circle ${attrs} cx="${px}" cy="${py}" r="3.6"/>`;
    });
    if (state.badge?.li === li) out += `<g class="badge"><rect x="${x(c.pts.find(p => p.t === state.badge.t)?.v ?? 0.5) + 10}" y="${y(state.badge.t) - 9}" width="${state.badge.text.length * 6.4 + 10}" height="16"/><text x="${x(c.pts.find(p => p.t === state.badge.t)?.v ?? 0.5) + 15}" y="${y(state.badge.t) + 3}">${esc(state.badge.text)}</text></g>`;
    if (state.hover && state.hover.li === li && state.hover.seg < c.pts.length - 1) {
      const m = midOf(c, state.hover.seg), bx = Math.min(x(m.v) + 12, col.x + col.w - 60), by = y(m.t) - 8;
      const bez = (c.kinds[state.hover.seg] ?? 'c') === 'c';
      out += `<g class="tb" data-li="${li}" data-ci="${ci}" data-seg="${state.hover.seg}"><rect class="box" x="${bx}" y="${by}" width="56" height="16"/><rect class="chk" x="${bx + 3}" y="${by + 3}" width="10" height="10"/>${bez ? `<path class="tick" d="M${bx + 5} ${by + 8}l2.4 2.6l4 -5.4"/>` : ''}<text x="${bx + 17}" y="${by + 12}">bezier</text></g>`;
    }
  });
  return out;
}

// What a lane's curve looks like on the lane header: ∿ when it runs, ○ when it is off.
export const headMark = lane => { const c = shownCurve(lane); return c ? (c.on === false ? '○' : '∿') : ' '; };

// The wiring to the arrangement. host = { el, lanes(), top(), CELL(), len(), editor, say(msg), redraw(), shape(li), menu(e, items) }.
export function createCurveView(host) {
  if (typeof document === 'undefined') return { paint() {} };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cv');
  const state = { hover: null, drag: null, badge: null };
  let hideTimer = 0, dragId = 0;

  const geometry = () => {
    const el = host.el, head = el.firstElementChild, first = el.children[1];
    if (!head || !first) return null;
    const cells = [...first.querySelectorAll('.cell')];
    return { hb: head.offsetTop + head.offsetHeight, rowH: head.offsetHeight, cols: cells.map(c => ({ x: first.offsetLeft + c.offsetLeft, w: c.offsetWidth })), width: Math.max(el.scrollWidth, el.clientWidth), height: el.scrollHeight };
  };
  const paint = () => {
    const lanes = host.lanes(), geo = lanes && geometry();
    if (!lanes || !geo || !lanes.some(l => l.curves?.length)) { svg.remove(); return; }
    svg.setAttribute('width', geo.width);
    svg.setAttribute('height', geo.height);
    svg.style.clipPath = `inset(${geo.hb}px 0 0 0)`;
    svg.innerHTML = curveMarkup({ lanes, geo, top: host.top(), CELL: host.CELL(), state });
    if (svg.parentNode !== host.el) host.el.appendChild(svg);
  };

  // pointer -> tick and value in lane li
  const at = (e, li) => {
    const geo = geometry(), box = host.el.getBoundingClientRect(), col = geo.cols[li];
    const py = e.clientY - box.top + host.el.scrollTop, px = e.clientX - box.left + host.el.scrollLeft;
    return { t: ((py - geo.hb) / geo.rowH + host.top()) * host.CELL(), v: Math.min(1, Math.max(0, (px - col.x - PAD) / (col.w - 2 * PAD))) };
  };
  const target = (lane, c) => (lane.targets ?? []).find(t => t.id === c.target);
  const label = (lane, c) => target(lane, c)?.label ?? c.target;
  const edit = (li, ci, text, key, fn) => {
    const shape = host.editor.curve(li, text, key, lane => fn(lane.curves[ci], lane));
    if (shape === true) host.shape(li);
    paint();
    return shape;
  };

  const begin = (e, li, ci, i) => {
    const id = ++dragId, lane = host.lanes()[li];
    state.drag = { li, ci, i, guide: undefined };
    const move = m => {
      const p = at(m, li), snap = snapTick(lane, p.t, { edges: !m.altKey, rows: m.altKey ? 0 : host.CELL(), reach: SNAP, length: host.len() });
      const t = Math.max(0, Math.min(host.len(), snap.t));
      state.drag.guide = snap.pin ? t : undefined;
      let after = null;
      edit(li, ci, 'move curve anchor', `cv:${id}`, c => {
        const pt = movePoint(c, i, t, p.v);
        if (snap.pin) pt.pin = snap.pin;
        after = c.pts.indexOf(pt);
        return true;
      });
      if (after !== null && after >= 0) state.drag.i = after;
      const c = host.lanes()[li].curves[ci];
      const pl = snap.pin && lane.placements.find(q => (snap.pin === 'start' ? q.start : q.start + Math.min(q.length, lane.patterns[q.puid]?.length ?? q.length)) === t);
      state.badge = pl ? { li, t, text: `${snap.pin} of ${String(lane.patterns[pl.puid].index).padStart(2, '0')} ${lane.patterns[pl.puid].name} · ${String(t).padStart(4, '0')}` } : null;
      host.say(c ? `${label(lane, c)} ${Math.round(c.pts[state.drag.i].v * 100)}% at tick ${t}${snap.pin ? ` (${snap.pin} of a pattern)` : ''}` : '');
      paint();
    };
    const up = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true); state.drag = null; state.badge = null; paint(); };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
  };

  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const pt = e.target.closest?.('.pt'), hit = e.target.closest?.('.hit'), tb = e.target.closest?.('.tb');
    if (!pt && !hit && !tb) return;
    e.preventDefault(); e.stopPropagation();
    if (tb) {
      const { li, ci, seg } = tb.dataset;
      edit(+li, +ci, 'curve segment', null, c => { c.kinds[+seg] = (c.kinds[+seg] ?? 'c') === 'c' ? 'l' : 'c'; return true; });
      host.say(`That part of the curve is now ${host.lanes()[+li].curves[+ci].kinds[+seg] === 'c' ? 'a bezier' : 'a straight line'}.`);
      return;
    }
    if (pt) { begin(e, +pt.dataset.li, +pt.dataset.ci, +pt.dataset.i); return; }
    // on the line: a new anchor there, which is then dragged
    const li = +hit.dataset.li, ci = +hit.dataset.ci, p = at(e, li);
    let made = -1;
    edit(li, ci, 'add curve anchor', null, c => { made = addPoint(c, Math.round(Math.max(0, Math.min(host.len(), p.t))), p.v); return true; });
    begin(e, li, ci, made);
  });

  svg.addEventListener('mouseover', e => {
    const hit = e.target.closest?.('.hit'), tb = e.target.closest?.('.tb');
    const el = hit ?? tb;
    if (!el) return;
    clearTimeout(hideTimer);
    const next = { li: +el.dataset.li, seg: +el.dataset.seg };
    if (state.hover?.li !== next.li || state.hover?.seg !== next.seg) { state.hover = next; paint(); }
  });
  svg.addEventListener('mouseout', e => {
    if (!state.hover || state.drag) return;
    if (e.relatedTarget?.closest?.('.hit, .tb')) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { state.hover = null; paint(); }, 250);
  });

  svg.addEventListener('contextmenu', e => {
    const pt = e.target.closest?.('.pt');
    if (!pt) return;
    e.preventDefault(); e.stopPropagation();
    const li = +pt.dataset.li, ci = +pt.dataset.ci, i = +pt.dataset.i, lane = host.lanes()[li], c = lane.curves[ci], p = c.pts[i];
    const near = edgesOf(lane).filter(x => Math.abs(x.t - p.t) <= 16).sort((a, b) => Math.abs(a.t - p.t) - Math.abs(b.t - p.t))[0];
    const items = [];
    if (near && !(p.pin === near.edge && p.t === near.t)) {
      const pat = lane.patterns[near.puid];
      items.push({ label: `Pin to ${near.edge} of ${String(pat.index).padStart(2, '0')} ${pat.name}`, run: () => { edit(li, ci, 'pin curve anchor', null, k => { k.pts[i].t = near.t; k.pts[i].pin = near.edge; return true; }); host.say('Pinned: it follows the pattern.'); } });
    }
    if (p.pin) items.push({ label: 'Unpin', run: () => { edit(li, ci, 'unpin curve anchor', null, k => { delete k.pts[i].pin; return true; }); host.say('Not pinned: it stays where it is.'); } });
    items.push({ separator: true }, { label: 'Delete anchor', run: () => { edit(li, ci, 'delete curve anchor', null, k => (k.pts.length > 1 ? removePoint(k, i) : false)); } });
    host.menu(e, items);
  });
  return { paint, targetsOf };
}
