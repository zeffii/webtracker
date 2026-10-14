import { setLoop } from './ops.js';

// Min and max of the sample for each pixel column: what the waveform view draws.
export function computePeaks(data, width) {
  const peaks = new Float32Array(width * 2);
  const per = data.length / width;
  for (let x = 0; x < width; x++) {
    const from = Math.floor(x * per), to = Math.min(data.length, Math.max(from + 1, Math.floor((x + 1) * per)));
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i < to; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks[2 * x] = lo === Infinity ? 0 : lo;
    peaks[2 * x + 1] = hi === -Infinity ? 0 : hi;
  }
  return peaks;
}

const GRAB = 6;   // pixels either side of a marker that grab it

// The waveform of one sample with its loop points. Drag the start or end marker to move
// it; drag across empty waveform to make a new loop; double-click to clear the loop. The
// loop is applied when the mouse is released.
export function createWaveformView({ canvas, statusEl, getProject, onLoop }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const dpr = globalThis.devicePixelRatio || 1;
  if (dpr !== 1) {
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
  }

  let id = null, drag = null, cache = null, lastKey = null;
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const sample = () => (id ? getProject().samples[id] : undefined);
  const frames = () => sample().data.length;
  const frameToX = f => (f / frames()) * W;
  const xToFrame = x => Math.round(Math.min(Math.max(x / W, 0), 1) * frames());
  const loopOf = s => drag?.preview ?? { start: s.loopStart ?? 0, end: s.loopEnd ?? 0 };

  const commit = (start, end) => {
    try {
      const users = setLoop(getProject(), id, start, end);
      say('');
      onLoop(users);
    } catch (err) {
      say(err.message);
    }
  };

  canvas.addEventListener('mousedown', e => {
    const s = sample();
    if (!s || !frames()) return;
    const { start, end } = loopOf(s);
    if (end > start && Math.abs(e.offsetX - frameToX(start)) <= GRAB) drag = { kind: 'start', preview: { start, end } };
    else if (end > start && Math.abs(e.offsetX - frameToX(end)) <= GRAB) drag = { kind: 'end', preview: { start, end } };
    else drag = { kind: 'region', anchor: xToFrame(e.offsetX), preview: null };
  });

  canvas.addEventListener('mousemove', e => {
    const s = sample();
    if (!drag || !s) return;
    const f = xToFrame(e.offsetX);
    if (drag.kind === 'start') drag.preview = { start: Math.min(f, drag.preview.end - 2), end: drag.preview.end };
    else if (drag.kind === 'end') drag.preview = { start: drag.preview.start, end: Math.max(f, drag.preview.start + 2) };
    else if (Math.abs(f - drag.anchor) >= 2) drag.preview = { start: Math.min(f, drag.anchor), end: Math.max(f, drag.anchor) };
  });

  const finish = () => {
    const d = drag;
    drag = null;
    if (d?.preview) commit(Math.max(0, d.preview.start), d.preview.end);
  };
  canvas.addEventListener('mouseup', finish);
  canvas.addEventListener('mouseleave', () => { drag = null; });
  canvas.addEventListener('dblclick', () => { if (sample()) commit(0, 0); });

  function draw() {
    const s = sample();
    const { start, end } = s ? loopOf(s) : { start: 0, end: 0 };
    const key = `${id}:${s?.data.length}:${start}:${end}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, W, H);
    if (!s) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    const accent = 'hsl(210 70% 55%)';
    if (!cache || cache.data !== s.data) cache = { data: s.data, peaks: computePeaks(s.data, W) };
    const mid = H / 2, amp = H / 2 - 4;
    ctx.fillStyle = ink;
    ctx.fillRect(0, mid, W, 1);
    for (let x = 0; x < W; x++) {
      const lo = cache.peaks[2 * x], hi = cache.peaks[2 * x + 1];
      ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
    if (end > start) {
      const xs = frameToX(start), xe = frameToX(end);
      ctx.fillStyle = 'rgba(60, 140, 255, 0.2)';
      ctx.fillRect(xs, 0, xe - xs, H);
      ctx.fillStyle = accent;
      ctx.fillRect(xs, 0, 2, H);
      ctx.fillRect(xe - 2, 0, 2, H);
      ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(`start ${start}`, Math.min(xs + 4, W - 90), 2);
      ctx.textAlign = 'right';
      ctx.fillText(`end ${end}`, Math.max(xe - 4, 90), H - 14);
    }
    ctx.fillStyle = ink;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(`${id}  ${s.data.length} frames`, 4, H - 2);
  }

  return {
    show(next) { id = next; drag = null; lastKey = null; },
    get sampleId() { return id; },
    draw,
  };
}
