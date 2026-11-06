// What the four room and head panels (reflect, headpan, haas, ringmod) share: a canvas that is sharp on any screen, a drag helper, the colours,
// and the heartbeat that keeps a node reporting while its panel is on the page.
export const ORANGE = 'hsl(30 90% 58%)', BLUE = 'hsl(195 75% 58%)', PINK = 'hsl(335 80% 62%)';

// A canvas of w x h CSS pixels. Returns { canvas, ctx, ink } where ink() is the text colour of the page right now.
export function makeCanvas(doc, w, h, className) {
  const dpr = Math.max(1, Math.min(3, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const canvas = doc.createElement('canvas');
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.className = className;
  if (canvas.style) Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, touchAction: 'none' });
  const ctx = canvas.getContext?.('2d') ?? null;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = () => (doc.defaultView?.getComputedStyle?.(canvas).color) || '#999';
  return { canvas, ctx, ink };
}

// pointer drag on a canvas: start(x, y) returns true to take the drag (x, y in CSS pixels of the canvas); move(x, y); done().
export function drag(canvas, w, h, { start, move, done = () => {} }) {
  let on = false;
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (w / (r.width || w)), (e.clientY - r.top) * (h / (r.height || h))]; };
  canvas.addEventListener('pointerdown', e => { if (start(...at(e))) { on = true; canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); } });
  canvas.addEventListener('pointermove', e => { if (on) move(...at(e)); });
  const end = () => { if (on) { on = false; done(); } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}

export function heartbeat(doc, el, watch) {
  watch();
  const timer = doc.defaultView?.setInterval?.(() => { if (!el.isConnected) { doc.defaultView.clearInterval(timer); return; } watch(); }, 1000);
}

export const button = (doc, label, title, onClick) => {
  const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.className = 'sp-btn';
  b.addEventListener('click', onClick); return b;
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
