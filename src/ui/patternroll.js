// The pattern roll: the notes of the pattern under the cursor, drawn as a piano roll turned on its side. Rows run down the window the
// way they do in the tracker (so a row here is the same row there), pitch runs across, a chord's name stands beside the row where it
// begins, and the velocities can be shown as stalks in a lane of their own. A strip down the right edge is a minimap of the whole
// pattern with the part on show boxed; click or drag in it to scroll. It only reads: it follows the cursor and draws what is written.
//
// createPatternRoll({ win, host, target }): `win` is the window it lives in, `host` the element it fills, and target() returns
// { lane, tick } (the lane object and the tick under the cursor) or null. playing() returns the playing tick, or -1 when stopped; the
// playing row is drawn as a green line, and the roll scrolls with it when follow() is true. refresh() draws it; call it every frame.
import { rollData } from '../seq/rolldata.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
const hue = k => (k * 67 + 200) % 360;
const GUT = 34, CHORD = 58, STALKS = 64, MAP = 34, RH = 16;

export function createPatternRoll({ win, host, target, playing = () => -1, follow: followPlay = () => true, volume = true, onVolume }) {
  const doc = win.document;
  const make = (tag, text, cls) => { const e = doc.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const bar = make('div', undefined, 'pr-bar'), title = make('span', 'No pattern', 'pr-title');
  const box = make('input'); box.type = 'checkbox'; box.checked = volume;
  const lab = make('label', undefined, 'pr-vol'); lab.title = 'Show each note\'s velocity as a stalk in a lane on the right'; lab.append(box, doc.createTextNode(' Volume'));
  bar.append(title, lab);
  const canvas = make('canvas', undefined, 'pr-canvas');
  host.append(bar, canvas);
  const g = canvas.getContext('2d');
  let top = 0, follow = -1, data = null, size = { w: 0, h: 0 }, dragging = false, rows = 0;
  box.addEventListener('change', () => { onVolume?.(box.checked); });

  const css = name => win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  const colors = () => ({ bg: css('--bg') || '#14171a', fg: css('--fg') || '#cfe3e7', accent: css('--accent') || '#4a8fe0' });

  const fit = () => {
    const r = canvas.getBoundingClientRect(), dpr = win.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w !== size.w || h !== size.h || canvas.width !== Math.round(w * dpr)) {
      size = { w, h }; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const geometry = () => {
    const vol = box.checked;
    const px0 = GUT, px1 = size.w - MAP - CHORD - (vol ? STALKS : 0) - 6;
    return { px0, px1, cx: px1 + 6, sx: px1 + 6 + CHORD, mx: size.w - MAP + 4 };
  };

  const maxTop = () => Math.max(0, (data?.length ?? 0) * RH - (size.h - 4));
  const clampTop = () => { top = Math.max(0, Math.min(maxTop(), top)); };

  // The pitch range shown: the notes with a little room, at least two octaves, from a C.
  const span = () => {
    let lo = Math.floor(((data?.lo ?? 36) - 2) / 12) * 12, hi = Math.ceil(((data?.hi ?? 60) + 3) / 12) * 12;
    if (hi - lo < 24) hi = lo + 24;
    return [lo, hi];
  };

  const draw = () => {
    fit();
    const c = colors(), { w, h } = size;
    g.globalAlpha = 1; g.fillStyle = c.bg; g.fillRect(0, 0, w, h);
    const t = target();
    const cursor = t ? rollData(t.lane, t.tick) : null;
    data = cursor;
    if (!data) { g.fillStyle = c.fg; g.globalAlpha = .55; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Put the cursor in a pattern', w / 2, h / 2); g.globalAlpha = 1; title.textContent = 'No pattern'; return; }
    title.textContent = `${data.name} · ${data.length} rows`;
    const curRow = t.tick - data.start;
    if (curRow !== follow) {   // the cursor moved: keep its row in view (a scroll by hand holds until then)
      follow = curRow;
      const y = curRow * RH;
      if (y < top + RH) top = y - RH * 2; else if (y > top + h - RH * 3) top = y - h + RH * 4;
    }
    const play = playing() - data.start;
    if (play >= 0 && play < data.length && followPlay()) {   // playing: the roll scrolls so the playing row stays in view
      const y = play * RH;
      if (y < top + RH || y > top + h - RH * 3) top = y - h / 3;
    }
    clampTop();
    const { px0, px1, cx, sx, mx } = geometry();
    const [lo, hi] = span(), pw = (px1 - px0) / (hi - lo), X = p => px0 + (p - lo) * pw;
    rows = Math.ceil(h / RH) + 1;
    const r0 = Math.floor(top / RH), r1 = Math.min(data.length, r0 + rows);
    // pitch columns: black keys shaded, an octave line at each C
    for (let p = lo; p < hi; p++) {
      if (BLACK.has(p % 12)) { g.globalAlpha = .07; g.fillStyle = c.fg; g.fillRect(X(p), 0, pw, h); }
      if (p % 12 === 0) { g.globalAlpha = .28; g.fillStyle = c.fg; g.fillRect(X(p), 0, 1, h); }
    }
    g.font = '10px ui-monospace, Consolas, monospace'; g.textBaseline = 'top'; g.textAlign = 'left';
    for (let p = lo; p < hi; p += 12) { g.globalAlpha = .55; g.fillStyle = c.fg; g.fillText(`C${p / 12}`, X(p) + 3, 2); }
    // rows: a line at every fourth, the row number at the left
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let r = r0; r < r1; r++) {
      const y = r * RH - top;
      if (r % 4 === 0) { g.globalAlpha = .22; g.fillStyle = c.fg; g.fillRect(px0, y, sx + (box.checked ? STALKS : 0) - px0, 1); g.globalAlpha = .6; g.fillText(String(r).padStart(2, '0'), GUT - 5, y + RH / 2); }
    }
    // notes
    for (const n of data.notes) {
      if (n.row + n.len < r0 || n.row > r1) continue;
      const y = n.row * RH - top, x = X(n.pitch);
      g.fillStyle = `hsl(${hue(n.col)} 70% 58%)`;
      g.globalAlpha = .35 + .65 * n.vel; g.fillRect(x + 1, y + 1, Math.max(2, pw - 2), n.len * RH - 2);
      g.globalAlpha = 1; g.fillStyle = `hsl(${hue(n.col)} 70% 30%)`; g.fillRect(x + 1, y + 1, Math.max(2, pw - 2), 2);
    }
    // chord names
    g.textAlign = 'left'; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'top';
    for (const ch of data.chords) {
      if (!ch.name) continue;
      const y = ch.row * RH - top;
      if (y < -RH || y > h) continue;
      g.globalAlpha = 1; g.fillStyle = c.fg; g.fillText(ch.name, cx, y + 2, CHORD - 2);
    }
    // velocity stalks
    if (box.checked) {
      const sw = STALKS - 12, x0 = sx + 4;
      g.globalAlpha = .12; g.fillStyle = c.fg; g.fillRect(sx, 0, 1, h);
      for (const n of data.notes) {
        const y = n.row * RH - top + 4 + n.col * 4;   // each voice on its own thin line, so a chord's stalks do not pile up
        if (y < -RH || y > h + RH) continue;
        g.globalAlpha = .5; g.fillStyle = `hsl(${hue(n.col)} 70% 58%)`; g.fillRect(x0, y - 1, sw * n.vel, 2);
        g.globalAlpha = 1; g.beginPath(); g.arc(x0 + sw * n.vel, y, 2.5, 0, 6.3); g.fill();
      }
    }
    // the cursor row
    const cy = curRow * RH - top + RH / 2;
    g.globalAlpha = 1; g.fillStyle = '#e5484d'; g.fillRect(0, cy - 0.5, mx - 4, 1.5);
    if (play >= 0 && play < data.length) { const py = play * RH - top + RH / 2; g.globalAlpha = 1; g.fillStyle = '#2fb36b'; g.fillRect(0, py - 1, mx - 4, 2); }
    // the minimap: the whole pattern squeezed into the strip's height, the part on show boxed
    const mh = h - 8, my = 4, unit = mh / data.length;
    g.globalAlpha = .1; g.fillStyle = c.fg; g.fillRect(mx, my, MAP - 8, mh);
    const mpw = (MAP - 8) / (hi - lo);
    for (const n of data.notes) {
      g.globalAlpha = .9; g.fillStyle = `hsl(${hue(n.col)} 70% 58%)`;
      g.fillRect(mx + (n.pitch - lo) * mpw, my + n.row * unit, Math.max(1.5, mpw), Math.max(1, n.len * unit - 0.5));
    }
    const vy = my + (top / RH) * unit, vh = Math.min(mh, (h / RH) * unit);
    g.globalAlpha = 1; g.strokeStyle = c.accent; g.lineWidth = 1.5; g.strokeRect(mx - 0.5, Math.min(vy, my + mh - vh), MAP - 7, vh);
    if (play >= 0 && play < data.length) { g.fillStyle = '#2fb36b'; g.fillRect(mx - 2, my + play * unit - 0.5, MAP - 4, 1.5); }
    g.fillStyle = '#e5484d'; g.fillRect(mx - 2, my + curRow * unit - 0.5, MAP - 4, 1.5);
    g.globalAlpha = 1;
  };

  // scrolling: the wheel, and the minimap (click or drag to put the middle of the box there)
  const toMap = e => {
    if (!data) return;
    const r = canvas.getBoundingClientRect(), mh = size.h - 8, y = e.clientY - r.top - 4;
    top = (y / mh) * data.length * RH - size.h / 2; clampTop(); draw();
  };
  canvas.addEventListener('wheel', e => { e.preventDefault(); top += e.deltaY; clampTop(); draw(); }, { passive: false });
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    if (e.clientX - r.left >= size.w - MAP) { dragging = true; canvas.setPointerCapture(e.pointerId); toMap(e); }
  });
  canvas.addEventListener('pointermove', e => { if (dragging) toMap(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  return { refresh: draw, get volume() { return box.checked; }, setVolume(v) { box.checked = v; } };
}

export const rollStyle = `html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--bg,#14171a);color:var(--fg,#cfe3e7)}
body{display:flex!important;flex-direction:column;width:100%}
.pr-bar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:4px 8px;font:12px system-ui,sans-serif;border-bottom:1px solid rgba(128,128,128,.35)}
.pr-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-vol{flex:none;cursor:pointer;user-select:none}
.pr-canvas{flex:1;min-height:0;width:100%;display:block;touch-action:none}`;
