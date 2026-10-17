const SPAN = 800;   // frames shown, centred on the current slice marker

// The marker region view: a narrow zoomed picture of the waveform around the current slice marker, as tall as the main waveform, for placing the marker to the frame.
export function createMarkerRegionView({ canvas, getSample, getActive }) {
  const ctx = canvas.getContext('2d');
  let W = canvas.width;
  const H = canvas.height;
  const dpr = globalThis.devicePixelRatio || 1;
  let lastKey = null, lastData = null;
  const resize = () => {
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    lastKey = null;
  };
  if (dpr !== 1) resize();

  function draw() {
    const s = getSample(), at = s ? getActive() : -1;
    const key = s && at >= 0 ? `${at}:${W}:${typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : ''}` : 'none';
    if (s?.data !== lastData) { lastData = s?.data; lastKey = null; }
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, W, H);
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if (!s || at < 0) { ctx.fillStyle = ink; ctx.globalAlpha = 0.5; ctx.fillText('marker', 4, 2); ctx.fillText('region', 4, 14); ctx.globalAlpha = 1; return; }
    const first = at - SPAN / 2, per = SPAN / W;   // frames per pixel
    const lanes = s.right ? [[s.data, H / 4], [s.right, 3 * H / 4]] : [[s.data, H / 2]];
    const amp = lanes.length === 2 ? H / 4 - 4 : H / 2 - 4;
    ctx.fillStyle = ink;
    for (const [data, mid] of lanes) {
      ctx.fillRect(0, mid, W, 1);
      for (let x = 0; x < W; x++) {
        const a = Math.max(0, Math.floor(first + x * per)), b = Math.min(data.length, Math.max(a + 1, Math.floor(first + (x + 1) * per)));
        if (a >= data.length || b <= 0) continue;
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i < b; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (x > 0 && per < 1) { const prev = data[Math.max(0, a - 1)]; if (prev < lo) lo = prev; if (prev > hi) hi = prev; }   // zoomed in past one frame a pixel: join the dots
        ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
    }
    const cx = Math.round(W / 2);
    ctx.fillStyle = '#f0707a';
    ctx.fillRect(cx, 0, 1, H);
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${at}`, 3, H - 2);
  }

  return {
    draw,
    // The width of the view in CSS pixels.
    fit(width) { const w = Math.max(24, Math.round(width)); if (w !== W) { W = w; resize(); } return W; },
  };
}
