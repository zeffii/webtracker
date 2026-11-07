// The song overview: a strip at the right edge of the sequence editor showing the whole song at once, scaled to fit the height of the
// editor, so its zoom never changes however the rows are zoomed. Each lane is a thin column of its patterns in their colours; the loop is
// a band, the part of the song the editor shows now is a box, and the cursor row and the playhead are lines across it. Click it to jump
// the editor there (the box centres on the click), or drag the box to scroll.
//
// The maths (tickAt, yOf, boxOf) is plain and exported for the tests; createOverview does the drawing and the pointer.
export const MARGIN = 2;   // pixels above and below the song inside the strip

// the pixel row of a tick, and the tick at a pixel row, for a strip `h` tall showing `len` ticks
export const yOf = (tick, len, h) => MARGIN + Math.max(0, Math.min(len, tick)) / Math.max(1, len) * (h - 2 * MARGIN);
export const tickAt = (y, len, h) => Math.max(0, Math.min(len, (y - MARGIN) / (h - 2 * MARGIN) * len));

// the box for the rows on show: from the first row to the end of the last (rows are `cell` ticks), as [top, bottom] pixels
export function boxOf(first, last, cell, len, h) {
  return [yOf(first * cell, len, h), Math.max(yOf(first * cell, len, h) + 3, yOf(last * cell, len, h))];
}

// where the first visible row should be to put `tick` in the middle of `rowCount` rows, in a song of `rows` rows
export const firstRowFor = (tick, cell, rowCount, rows) => Math.max(0, Math.min(Math.round(tick / cell - rowCount / 2), Math.max(0, rows - rowCount)));

const COLW = 6, GAP = 2, SIDE = 4;   // a lane column, the space between columns, the inner margin

export function createOverview({ host, grid, colourOf, onJump = () => {}, canJump = () => true }) {
  if (typeof document === 'undefined' || !host?.appendChild) return { paint() {}, width: 0 };
  const canvas = document.createElement('canvas');
  canvas.className = 'seq-overview';
  canvas.hidden = true;
  host.appendChild(canvas);
  const ctx = canvas.getContext?.('2d') ?? null;
  const colours = new Map();   // pattern colour class or style -> a css colour, read from the editor's own stylesheet
  let themeKey = '', shown = '', geometry = null, dragging = null;

  const colourFor = (pat, fallback) => {
    const { cls, style } = colourOf(pat);
    const key = `${cls}|${style}`;
    if (colours.has(key)) return colours.get(key);
    let out = fallback;
    if (style) out = style;
    else if (grid.appendChild && typeof getComputedStyle === 'function') {
      const probe = document.createElement('i');
      probe.className = `L ${cls}`;
      probe.style.cssText = 'position:absolute;visibility:hidden;background-image:none;background-color:var(--c)';
      grid.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      if (c && c !== 'rgba(0, 0, 0, 0)') out = c;
    }
    colours.set(key, out);
    return out;
  };

  // state: { lanes, len, first, last, cell, loop, cursor: { lane, tick }, playTick (or null), rowCount, rows }
  function paint(s) {
    if (!ctx) return;
    const header = grid.querySelector?.('.r')?.offsetHeight || 18;
    const h = Math.round((grid.clientHeight || 0) - header);
    const lanes = s.lanes.map((l, li) => ({ l, li })).filter(({ l }) => l.placements?.length || l.curves?.length);
    const w = lanes.length * (COLW + GAP) + SIDE * 2;
    const fits = (s.last - s.first) * s.cell >= s.len;   // everything is on show already
    if (h < 40 || !lanes.length || fits) { canvas.hidden = true; grid.style.paddingRight = ''; shown = ''; geometry = null; return; }
    const theme = `${document.documentElement.dataset?.theme ?? ''}|${document.documentElement.dataset?.codeTheme ?? ''}`;
    if (theme !== themeKey) { themeKey = theme; colours.clear(); shown = ''; }
    // what has changed: the layout of the song, the box, the cursor, the playhead, the loop
    let sig = 0;
    for (const { l } of lanes) for (const p of l.placements ?? []) sig = (Math.imul(sig, 31) + p.start * 7 + p.length + p.puid.length) | 0;
    const key = [w, h, s.len, s.first, s.last, s.cell, s.cursor.lane, s.cursor.tick, s.playTick === null ? '' : Math.floor(s.playTick / Math.max(1, s.len / h)), s.loop ? `${s.loop.start},${s.loop.end},${s.loop.off ? 1 : 0}` : '', sig, lanes.map(({ l }) => (l.silenced ? 1 : 0)).join('')].join('|');
    canvas.hidden = false;
    geometry = { h, len: s.len, cell: s.cell, rowCount: s.rowCount, rows: s.rows, box: boxOf(s.first, s.last, s.cell, s.len, h) };
    grid.style.paddingRight = `${w + 10}px`;
    if (key === shown) return;
    shown = key;
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, top: `${grid.offsetTop + header}px`, right: '4px' });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fg = getComputedStyle(grid).color || '#888';
    const Y = t => yOf(t, s.len, h);
    ctx.fillStyle = fg; ctx.globalAlpha = 0.06; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    // the loop band
    if (s.loop) {
      ctx.fillStyle = '#e05a5a'; ctx.globalAlpha = s.loop.off ? 0.05 : 0.12; ctx.fillRect(0, Y(s.loop.start), w, Y(s.loop.end) - Y(s.loop.start));
      ctx.globalAlpha = s.loop.off ? 0.3 : 0.8; ctx.strokeStyle = '#e05a5a'; ctx.setLineDash([2, 2]);
      for (const t of [s.loop.start, s.loop.end]) { ctx.beginPath(); ctx.moveTo(0, Math.round(Y(t)) + 0.5); ctx.lineTo(w, Math.round(Y(t)) + 0.5); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // the lanes: their patterns, in their colours (a lane that is silenced, faint)
    lanes.forEach(({ l, li }, i) => {
      const x = SIDE + i * (COLW + GAP);
      ctx.globalAlpha = l.silenced ? 0.3 : 1;
      for (const p of l.placements ?? []) {
        const pat = l.patterns[p.puid];
        if (!pat) continue;
        const end = p.start + Math.min(p.length, pat.length ?? p.length);
        ctx.fillStyle = colourFor(pat, '#7aa7d8');
        ctx.fillRect(x, Y(p.start), COLW, Math.max(1.5, Y(end) - Y(p.start) - 1));
      }
      ctx.globalAlpha = 1;
      if (li === s.cursor.lane) { ctx.strokeStyle = fg; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, MARGIN - 1, COLW + 3, h - 2 * MARGIN + 2); ctx.globalAlpha = 1; }
    });
    // the part the editor shows
    const [b0, b1] = geometry.box;
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.16; ctx.fillRect(0, b0, w, b1 - b0); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#d6336c'; ctx.lineWidth = 1.5; ctx.strokeRect(0.75, b0 + 0.25, w - 1.5, Math.max(1, b1 - b0 - 0.5));
    // the cursor row and the playhead
    ctx.fillStyle = '#d6336c'; ctx.fillRect(0, Math.round(Y(s.cursor.tick)), w, 2);
    if (s.playTick !== null) { ctx.fillStyle = fg; ctx.globalAlpha = 0.9; ctx.fillRect(0, Math.round(Y(s.playTick)), w, 1); ctx.globalAlpha = 1; }
  }

  // pointer: a click centres the box there; a press inside the box drags it (keeping the place it was grabbed at)
  const yIn = e => e.clientY - canvas.getBoundingClientRect().top;
  canvas.addEventListener('pointerdown', e => {
    if (!geometry || e.button !== 0 || !canJump()) return;
    const y = yIn(e), [b0, b1] = geometry.box;
    dragging = { grab: y >= b0 && y <= b1 ? y - (b0 + b1) / 2 : 0 };
    canvas.setPointerCapture?.(e.pointerId);
    onJump(tickAt(y - dragging.grab, geometry.len, geometry.h));
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => { if (dragging && geometry) onJump(tickAt(yIn(e) - dragging.grab, geometry.len, geometry.h)); });
  const end = () => { dragging = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  // How far across the grid (pixels from its left edge) the playhead and loop lines should run: they stop at the strip's left border, since the strip
  // has a playhead and loop band of its own. null when the strip is not showing (the lines run the full width).
  const edge = () => (canvas.hidden ? null : Math.max(0, canvas.offsetLeft - (grid.offsetLeft ?? 0) - (grid.clientLeft ?? 0)));
  return { paint, canvas, edge, get width() { return canvas.hidden ? 0 : canvas.width; } };
}
