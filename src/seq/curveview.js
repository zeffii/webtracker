// Lane curves drawn over the arrangement: a hairline down each lane that has one, with its anchors. Time runs down the
// page like the grid, the value runs across the lane. The SVG sits inside the grid element (put back after every redraw).
//   hover a segment  -> a small box with an icon of what it is (curve, straight, gap); a click goes to the next
//   drag an anchor   -> snaps to pattern edges and rows (Alt: free); landing on an edge pins it
//   click the line   -> the segment is on: C curve, L straight line, G gap (Esc lets go); double-click the line: a new anchor there
//   right-click an anchor -> pin, unpin, break, delete
//   a selected anchor (click it): E extends over the next pattern, Shift+E skips one and starts a new section after it,
//   B breaks or joins the segment after it, [ and ] move between anchors, Left/Right change its value, Delete removes it, Esc lets go
import { pathOf, midOf, snapTick, addPoint, removePoint, movePoint, edgesOf, targetsOf, sections, extend, skip, toggleGap, normalise } from './automation.js';

const PAD = 5;     // pixels between a lane column's edge and the value 0 or 1
const SNAP = 5;    // ticks: how near an anchor must come to a pattern edge to be pulled onto it
const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The curve a lane shows: lane.shown picks one of its curves.
export const shownCurve = lane => (lane.curves?.length ? lane.curves[Math.min(lane.shown ?? 0, lane.curves.length - 1)] : null);

const sub = (curve, i) => ({ pts: [curve.pts[i], curve.pts[i + 1]], kinds: [curve.kinds[i] === 'g' ? 'l' : curve.kinds[i] ?? 'c'] });

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
    for (const [a, b] of sections(c)) {
      if (b === a) continue;
      const part = { pts: c.pts.slice(a, b + 1), kinds: c.kinds.slice(a, b) };
      out += `<path class="veil" d="${pathOf(part, x, y)} L${x(0)} ${y(c.pts[b].t)} L${x(0)} ${y(c.pts[a].t)}Z"/>`;
    }
    for (let i = 0; i < c.pts.length - 1; i++) if (c.kinds[i] === 'g') out += `<path class="gap" d="${pathOf(sub(c, i), x, y)}"/>`;
    const act = state.seg ?? state.hover;
    if (act && act.li === li && act.seg < c.pts.length - 1) out += `<path class="hov${state.seg ? ' on' : ''}" d="${pathOf(sub(c, act.seg), x, y)}"/>`;
    out += `<path class="ln" d="${d}"/>`;
    for (let i = 0; i < c.pts.length - 1; i++) out += `<path class="hit" data-li="${li}" data-ci="${ci}" data-seg="${i}" d="${pathOf(sub(c, i), x, y)}"/>`;
    if (state.drag?.li === li && state.drag.guide !== undefined) out += `<path class="guide" d="M${col.x} ${y(state.drag.guide)}H${col.x + col.w}"/>`;
    c.pts.forEach((p, i) => {
      const px = x(p.v), py = y(p.t), corner = (i > 0 && c.kinds[i - 1] === 'l') || (i < c.pts.length - 1 && c.kinds[i] === 'l') || i === 0 || i === c.pts.length - 1;
      const attrs = `class="pt${p.pin ? ' pin' : ''}${(state.drag?.li === li && state.drag.i === i) || (state.sel?.li === li && state.sel.ci === ci && state.sel.i === i) ? ' sel' : ''}" data-li="${li}" data-ci="${ci}" data-i="${i}"`;
      out += p.pin ? `<path ${attrs} d="M${px} ${py - 5.5}l5.5 5.5l-5.5 5.5l-5.5 -5.5z"/>`
        : corner ? `<rect ${attrs} x="${px - 3.6}" y="${py - 3.6}" width="7.2" height="7.2"/>`
          : `<circle ${attrs} cx="${px}" cy="${py}" r="3.6"/>`;
    });
    if (state.badge?.li === li) out += `<g class="badge"><rect x="${x(c.pts.find(p => p.t === state.badge.t)?.v ?? 0.5) + 10}" y="${y(state.badge.t) - 9}" width="${state.badge.text.length * 6.4 + 10}" height="16"/><text x="${x(c.pts.find(p => p.t === state.badge.t)?.v ?? 0.5) + 15}" y="${y(state.badge.t) + 3}">${esc(state.badge.text)}</text></g>`;
    if (act && act.li === li && act.seg < c.pts.length - 1) {
      const m = midOf(c, act.seg), kind = c.kinds[act.seg] ?? 'c', bx = Math.min(x(m.v) + 12, col.x + col.w - 24), by = y(m.t) - 8, ox = bx + 2;
      // the box shows what the segment is: a curve, a straight line, or a gap (dots); a click goes to the next
      const glyph = kind === 'c' ? `M${ox + 3} ${by + 2}C${ox + 3} ${by + 8} ${ox + 11} ${by + 6} ${ox + 11} ${by + 12}`
        : kind === 'l' ? `M${ox + 3} ${by + 2}L${ox + 11} ${by + 12}`
          : `M${ox + 7} ${by + 2.5}h.01M${ox + 7} ${by + 6}h.01M${ox + 7} ${by + 9.5}h.01M${ox + 7} ${by + 13}h.01`;
      out += `<g class="tb" data-li="${li}" data-ci="${ci}" data-seg="${act.seg}"><title>${kind === 'c' ? 'curve: click for a straight line' : kind === 'l' ? 'straight: click for a gap' : 'gap: click to join with a curve'}</title><rect class="box" x="${bx}" y="${by}" width="18" height="16"/><path class="glyph" d="${glyph}"/></g>`;
    }
  });
  return out;
}

// What a lane's curve looks like on the lane header: ∿ when it runs, ○ when it is off.
export const headMark = lane => { const c = shownCurve(lane); return c ? (c.on === false ? '○' : '∿') : ' '; };

// The wiring to the arrangement. host = { el, lanes(), top(), CELL(), len(), editor, say(msg), redraw(), shape(li), menu(e, items) }.
export function createCurveView(host) {
  if (typeof document === 'undefined') return { paint() {}, key: () => false, select() {} };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cv');
  const state = { hover: null, drag: null, badge: null, sel: null, seg: null };   // seg: the segment that is on (clicked)
  let hideTimer = 0, dragId = 0, last = null;

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
      if (after !== null && after >= 0) { state.drag.i = after; if (state.sel) state.sel.i = after; }
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
      edit(+li, +ci, 'curve segment', null, c => { const k = c.kinds[+seg] ?? 'c'; c.kinds[+seg] = k === 'c' ? 'l' : k === 'l' ? 'g' : 'c'; return true; });
      host.say({ c: 'That part of the curve is a bezier.', l: 'That part of the curve is a straight line.', g: 'A gap: the curve is not there.' }[host.lanes()[+li].curves[+ci].kinds[+seg]]);
      return;
    }
    if (pt) { state.sel = { li: +pt.dataset.li, ci: +pt.dataset.ci, i: +pt.dataset.i }; begin(e, +pt.dataset.li, +pt.dataset.ci, +pt.dataset.i); return; }
    // on the line: the segment is on. C, L or G (or the icon) change what it is; a double-click adds an anchor.
    const li = +hit.dataset.li, ci = +hit.dataset.ci, seg = +hit.dataset.seg, now = Date.now();
    // a second press in the same place at once adds an anchor there (the first press redrew the line, so the browser's own
    // double-click would not see one element pressed twice)
    if (last && now - last.at < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6 && last.li === li) {
      last = null;
      const p = at(e, li);
      let made = -1;
      edit(li, ci, 'add curve anchor', null, c => { made = addPoint(c, Math.round(Math.max(0, Math.min(host.len(), p.t))), p.v); return true; });
      state.seg = null; state.sel = { li, ci, i: made };
      host.say('Anchor added: drag it, or use the keys (E, B, [ ], Left/Right, Delete).');
      paint();
      return;
    }
    last = { at: now, x: e.clientX, y: e.clientY, li };
    if (state.seg?.li === li && state.seg.ci === ci && state.seg.seg === seg) return;
    state.seg = { li, ci, seg }; state.sel = null;
    host.say('Segment on: C curve, L straight line, G gap (or click the icon); double-click the line to add an anchor.');
    paint();
  });

  svg.addEventListener('mouseover', e => {
    const hit = e.target.closest?.('.hit'), tb = e.target.closest?.('.tb');
    const el = hit ?? tb;
    if (!el || state.seg) return;
    clearTimeout(hideTimer);
    const next = { li: +el.dataset.li, seg: +el.dataset.seg };
    if (state.hover?.li !== next.li || state.hover?.seg !== next.seg) { state.hover = next; paint(); }
  });
  svg.addEventListener('mouseout', e => {
    if (!state.hover || state.drag || state.seg) return;
    if (e.relatedTarget?.closest?.('.hit, .tb')) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { state.hover = null; paint(); }, 250);
  });

  // A click anywhere else, or the pointer leaving the grid, puts the tick box away.
  const away = e => {
    if (state.drag || e.target.closest?.('.cv .hit, .cv .tb, .cv .pt')) return;
    if (state.hover || state.sel || state.seg) { clearTimeout(hideTimer); state.hover = null; state.sel = null; state.seg = null; paint(); }
  };
  document.addEventListener('mousedown', away, true);
  host.el.addEventListener('mouseleave', away);

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
    if (i < c.pts.length - 1) items.push({ label: c.kinds[i] === 'g' ? 'Join to the next anchor' : 'Break after this anchor (a gap)', run: () => edit(li, ci, 'curve gap', null, k => toggleGap(k, i)) });
    const tg = target(lane, c);
    if (tg) items.push({ label: 'Rest value: this anchor\'s', run: () => { const shape = host.editor.curve(li, 'curve rest value', null, l => { l.curves[ci].rest = l.curves[ci].pts[i].v; return true; }); if (shape === true) host.shape(li); host.say('Between sections the parameter glides back to this value.'); } });
    items.push({ separator: true }, { label: 'Delete anchor', run: () => { edit(li, ci, 'delete curve anchor', null, k => (k.pts.length > 1 ? removePoint(k, i) : false)); } });
    host.menu(e, items);
  });

  // Keys for the selected anchor. Returns true when it used the key.
  const key = e => {
    const sel = state.sel, lanes = host.lanes();
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const kind = { c: 'c', l: 'l', g: 'g' }[e.key.toLowerCase()];
    // a segment that is on: C, L, G (what it is); Esc lets go
    if (!sel && state.seg) {
      const { li, ci, seg } = state.seg, c0 = lanes?.[li]?.curves?.[ci];
      if (!c0 || seg >= c0.pts.length - 1) { state.seg = null; return false; }
      if (kind) { edit(li, ci, 'curve segment', null, c => { c.kinds[seg] = kind; return true; }); host.say({ c: 'That part of the curve is a bezier.', l: 'That part of the curve is a straight line.', g: 'A gap: the curve is not there.' }[kind]); return true; }
      if (e.key === 'Escape') { state.seg = null; paint(); return true; }
      return false;
    }
    if (!sel) return false;
    const lane = lanes?.[sel.li], c = lane?.curves?.[sel.ci];
    if (!c || !c.pts[sel.i]) { state.sel = null; return false; }
    const k = e.key, last = c.pts.length - 1;
    const pick = i => { state.sel = { ...sel, i }; host.say(`${label(lane, c)} anchor ${i + 1}/${c.pts.length}: ${Math.round(c.pts[i].v * 100)}% at tick ${c.pts[i].t}${c.pts[i].pin ? ` (${c.pts[i].pin} of a pattern)` : ''}`); paint(); };
    if (k === 'e' || k === 'E') {
      let made = -1;
      const fn = e.shiftKey ? skip : extend;
      edit(sel.li, sel.ci, e.shiftKey ? 'curve skip a pattern' : 'extend curve', null, kc => { made = fn(lane, kc, sel.i, host.len()); return made >= 0; });
      if (made < 0) host.say(sel.i !== last ? 'E works on the last anchor of the curve: ] gets there.' : e.shiftKey ? 'No pattern further on to start a new section on.' : 'No pattern end further on.');
      else { pick(made); host.say(e.shiftKey ? 'Skipped a pattern: a gap, then a new section over the next one.' : 'Extended to the end of the next pattern.'); }
      return true;
    }
    if (kind && sel.i < last) { edit(sel.li, sel.ci, 'curve segment', null, kc => { kc.pts.length && (kc.kinds[sel.i] = kind); return true; }); host.say({ c: 'The segment after this anchor is a bezier.', l: 'The segment after this anchor is a straight line.', g: 'A gap after this anchor: the curve is not there.' }[kind]); return true; }
    if (k === 'b' || k === 'B') { const ok = edit(sel.li, sel.ci, 'curve gap', null, kc => toggleGap(kc, sel.i)); host.say(ok === null ? 'Nothing after this anchor to break.' : c.kinds[sel.i] === 'g' ? 'A gap after this anchor: the curve is not there.' : 'Joined to the next anchor.'); return true; }
    if (k === ']') { if (sel.i < last) pick(sel.i + 1); return true; }
    if (k === '[') { if (sel.i > 0) pick(sel.i - 1); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02), i = sel.i;
      edit(sel.li, sel.ci, 'nudge curve anchor', `nudge:${sel.li}:${sel.ci}:${i}`, kc => { kc.pts[i].v = Math.min(1, Math.max(0, kc.pts[i].v + d)); return true; });
      pick(i);
      return true;
    }
    if (k === 'Delete' || k === 'Backspace') { if (c.pts.length > 1) { edit(sel.li, sel.ci, 'delete curve anchor', null, kc => removePoint(kc, sel.i)); state.sel = { ...sel, i: Math.min(sel.i, c.pts.length - 1) }; paint(); } return true; }
    if (k === 'Escape') { state.sel = null; paint(); return true; }
    return false;
  };
  return { paint, key, select: (li, ci, i) => { state.sel = { li, ci, i }; }, targetsOf, normalise };
}
