// The playhead drawn as a thin red line across a grid, as an alternative to the ">" marker in the tick column.
// It lives inside the grid element (which must be position:relative) as an absolutely placed div; the grids
// replace their innerHTML on every draw, so the div is put back each time. `y` is in pixels from the top of
// the element's content, or null to hide it.
export function createPlayline(el) {
  const line = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (line) line.className = 'playline';
  return {
    show(y, h = 0) {   // h > 0: a soft band that tall instead of a line
      if (!line || !el.appendChild) return;
      if (y === null) { line.remove(); return; }
      line.className = h > 0 ? 'playline band' : 'playline';
      line.style.height = h > 0 ? `${h}px` : '';
      line.style.top = `${y}px`;
      line.style.width = `${Math.max(el.scrollWidth, el.clientWidth)}px`;
      if (line.parentNode !== el) el.appendChild(line);
    },
  };
}

// The song's loop as two thin light-red lines across the whole grid: one where it starts, one where it ends. Same
// arrangement as the playline: absolutely placed divs inside the grid element, put back after every redraw.
export function createLoopLines(el) {
  const mk = () => { const d = typeof document !== 'undefined' ? document.createElement('div') : null; if (d) d.className = 'looplines'; return d; };
  const lines = [mk(), mk()];
  return {
    show(ys, off = false) {   // ys: [start y, end y], either may be null when out of view; null hides both
      if (!lines[0] || !el.appendChild) return;
      lines.forEach((d, i) => {
        const y = ys?.[i];
        if (y === null || y === undefined) { d.remove(); return; }
        d.className = off ? 'looplines off' : 'looplines';
        d.style.top = `${y}px`;
        d.style.width = `${Math.max(el.scrollWidth, el.clientWidth)}px`;
        if (d.parentNode !== el) el.appendChild(d);
      });
    },
  };
}
