// A canvas that draws crisply: its backing store has one pixel per screen pixel (the context is scaled so the
// code still draws in the logical w x h), and it is shown at exactly that size instead of being stretched.
export const sharpCanvas = (doc, w, h, className = 'dx') => {
  const canvas = doc.createElement('canvas'), ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); canvas.className = className;
  if (canvas.style) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; canvas.style.maxWidth = 'none'; }
  canvas.getContext?.('2d')?.setTransform?.(ratio, 0, 0, ratio, 0, 0);
  return canvas;
};
