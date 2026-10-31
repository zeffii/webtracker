// The keyboard that opens over a Chord tile when the pointer rests on it: three octaves to play a chord into, like a kslider. Click a key to add
// or take away that note (drag across keys to paint), drag the bar under a lit key to set that note's volume, the arrows (or the wheel) move the
// three octaves up and down. Everything here is plain geometry in the editor's own coordinates, so the editor only has to draw and hit-test with it;
// the notes themselves are edited with editNote and editVolume in chordtext.js.

export const OCTAVES = 3, KEY_W = 13.5, KEY_H = 54, BAR_H = 34, PAD = 17, TOP = 34, FOOT = 20;
export const WIDTH = OCTAVES * 7 * KEY_W + PAD * 2, HEIGHT = TOP + KEY_H + 8 + BAR_H + FOOT;
export const LOWEST = 24, HIGHEST = 84;   // where the first key of the three octaves may be: C1 to C6
const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK_AT = { 1: 0.7, 3: 1.7, 6: 3.7, 8: 4.7, 10: 5.7 };

// The full-size panel, centred on the tile's box.
export function panelRect(box) {
  return { x: box.x + box.w / 2 - WIDTH / 2, y: box.y + box.h / 2 - HEIGHT / 2, w: WIDTH, h: HEIGHT };
}
// The panel on its way open: p is 0 (the tile) to 1 (the whole keyboard).
export function growing(box, p) {
  const full = panelRect(box), w = box.w + (full.w - box.w) * p, h = box.h + (full.h - box.h) * p;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}
// The lowest key to start from for some notes: the octave of the lowest one, or C3 for none.
export const startFor = notes => (notes.length ? Math.max(LOWEST, Math.min(HIGHEST, Math.floor(Math.min(...notes) / 12) * 12)) : 48);

// Where a note's key is, left edge and width, and whether it is a black one.
function keyBox(rect, lo, m) {
  const pc = m - lo, oct = Math.floor(pc / 12), r = ((pc % 12) + 12) % 12, x0 = rect.x + PAD, y0 = rect.y + TOP;
  if (pc < 0 || pc >= OCTAVES * 12) return null;
  const wi = WHITE.indexOf(r);
  if (wi >= 0) return { x: x0 + (wi + 7 * oct) * KEY_W, w: KEY_W - 1, h: KEY_H, black: false, y: y0 };
  return { x: x0 + (BLACK_AT[r] + 7 * oct) * KEY_W + KEY_W * 0.62, w: KEY_W * 0.62, h: KEY_H * 0.6, black: true, y: y0 };
}
const barBox = (rect, lo, m) => {
  const k = keyBox(rect, lo, m);
  if (!k) return null;
  const cx = k.black ? k.x + k.w / 2 : k.x + k.w / 2;
  return { x: cx - 6, y: rect.y + TOP + KEY_H + 8, w: 12, h: BAR_H };
};
const arrowBox = (rect, dir) => ({ x: rect.x + rect.w - (dir > 0 ? 28 : 56), y: rect.y + 6, w: 22, h: 16 });

// What is at a point of a full-size panel: { kind: 'key', note }, { kind: 'bar', note, y, h } (a bar under a lit note), { kind: 'arrow', dir }, or null.
export function hit(rect, lo, litNotes, x, y) {
  if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) return null;
  for (const dir of [-1, 1]) { const a = arrowBox(rect, dir); if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return { kind: 'arrow', dir }; }
  for (const m of litNotes) { const b = barBox(rect, lo, m); if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'bar', note: m, y: b.y, h: b.h }; }
  for (let m = lo; m < lo + OCTAVES * 12; m++) {   // black keys sit over the white ones, so they are tried first
    const k = keyBox(rect, lo, m);
    if (k?.black && x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return { kind: 'key', note: m };
  }
  for (let m = lo; m < lo + OCTAVES * 12; m++) {
    const k = keyBox(rect, lo, m);
    if (k && !k.black && x >= k.x && x <= k.x + k.w + 1 && y >= k.y && y <= k.y + k.h) return { kind: 'key', note: m };
  }
  return null;
}
// The volume (percent, in steps of 5) for a pointer height over a bar.
export const volumeAt = (bar, y) => Math.max(0, Math.min(100, Math.round(((bar.y + bar.h - y) / bar.h) * 20) * 5));
// The first key of the three octaves, moved a whole octave up or down and kept in range.
export const shifted = (lo, dir) => Math.max(LOWEST, Math.min(HIGHEST, lo + dir * 12));

// Draws the panel. `s` is { rect, p, lo, notes: [midi], volumes: [percent], stray: Set of midi, name, strayNames, range }, `C` the editor's colours.
export function drawPanel(ctx, C, s) {
  const { rect, p } = s;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(rect.x + 2, rect.y + 3, rect.w, rect.h);
  ctx.fillStyle = C.bg; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = C.hi; ctx.lineWidth = 1.2; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  if (p < 0.95) { ctx.restore(); return; }
  const lit = new Map(s.notes.map((m, i) => [m, s.volumes[i]]));
  ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'alphabetic';
  // the name, with the notes that are not part of the chord after it in the accent colour
  ctx.fillStyle = C.ink; ctx.textAlign = 'left';
  const label = s.name || 'click keys to build a chord';
  ctx.fillText(label, rect.x + 10, rect.y + 17);
  if (s.strayNames.length) { ctx.fillStyle = C.accent; ctx.fillText(s.strayNames.join(' '), rect.x + 10 + ctx.measureText(`${label} `).width, rect.y + 17); }
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.6; ctx.textAlign = 'right'; ctx.fillText(s.range, rect.x + rect.w - 62, rect.y + 17); ctx.globalAlpha = 1;
  for (const dir of [-1, 1]) {
    const a = arrowBox(rect, dir); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8; ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w, a.h); ctx.globalAlpha = 1;
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(dir < 0 ? '◄' : '►', a.x + a.w / 2 + 0.5, a.y + 12);
  }
  const on = m => (s.stray.has(m) ? C.accent : C.hi);
  for (let m = s.lo; m < s.lo + OCTAVES * 12; m++) {   // white keys, then black ones over them
    const k = keyBox(rect, s.lo, m);
    if (!k || k.black) continue;
    ctx.fillStyle = lit.has(m) ? on(m) : C.dark ? '#d9dce1' : '#fbfbfc'; ctx.fillRect(k.x, k.y, k.w, k.h);
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 0.6; ctx.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1); ctx.globalAlpha = 1;
    if (m % 12 === 0) { ctx.fillStyle = lit.has(m) ? C.bg : C.ink; ctx.globalAlpha = 0.6; ctx.font = '7px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText(`C${Math.floor(m / 12) - 1}`, k.x + k.w / 2, k.y + k.h - 4); ctx.globalAlpha = 1; }
  }
  for (let m = s.lo; m < s.lo + OCTAVES * 12; m++) {
    const k = keyBox(rect, s.lo, m);
    if (!k || !k.black) continue;
    ctx.fillStyle = lit.has(m) ? on(m) : C.dark ? '#101216' : '#23262c'; ctx.fillRect(k.x, k.y, k.w, k.h);
    if (lit.has(m)) { ctx.strokeStyle = C.ink; ctx.lineWidth = 0.8; ctx.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1); }
  }
  // the volume bars under the lit keys
  for (const [m, v] of lit) {
    const b = barBox(rect, s.lo, m);
    if (!b) continue;
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.3; ctx.lineWidth = 0.8; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); ctx.globalAlpha = 1;
    const h = (b.h * v) / 100; ctx.fillStyle = C.ev; ctx.fillRect(b.x + 1, b.y + b.h - h, b.w - 2, Math.max(1, h));
  }
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.5; ctx.font = '7px ui-monospace, Consolas, monospace'; ctx.textAlign = 'left';
  ctx.fillText('click keys, drag bars for volume', rect.x + 10, rect.y + rect.h - 6); ctx.globalAlpha = 1;
  ctx.restore();
}
