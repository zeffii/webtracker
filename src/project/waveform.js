import { setLoop } from './ops.js';
import { computeSpectrogram, heat } from './spectrogram.js';

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

// The waveform (or spectrogram) of one sample with its loop points, the sustain loop and the loop crossfade. Drag the start or end marker to move
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

  let id = null, drag = null, cache = null, lastKey = null, mode = 'wave';
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

  const LOOPS = [
    { start: 'loopStart', end: 'loopEnd', on: 'loopOn', xf: 'loopXfade', colour: 'hsl(210 70% 55%)', fill: 'rgba(60, 140, 255, 0.2)', marks: 'AB' },
    { start: 'susStart', end: 'susEnd', on: 'susOn', xf: 'susXfade', colour: 'hsl(35 90% 55%)', fill: 'rgba(255, 170, 40, 0.18)', marks: 'ab' },
  ];

  function draw() {
    const s = sample();
    const { start, end } = s ? loopOf(s) : { start: 0, end: 0 };
    const key = s ? `${id}:${mode}:${s.data.length}:${start}:${end}:${LOOPS.slice(1).map(l => `${s[l.start]}.${s[l.end]}.${s[l.on]}`).join()}:${s.loopOn}:${s.loopXfade}:${s.susXfade}` : 'none';
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, W, H);
    if (!s) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    if (mode === 'spec') {
      const pw = canvas.width, ph = canvas.height;
      if (!cache || cache.data !== s.data || cache.spec?.pw !== pw) cache = { ...(cache?.data === s.data ? cache : { data: s.data }), spec: { pw, ph, cells: computeSpectrogram(s.data, s.right, pw, ph) } };
      const image = ctx.createImageData(pw, ph);
      for (let i = 0; i < pw * ph; i++) image.data.set(heat(cache.spec.cells[i]), i * 4);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(image, 0, 0);
      ctx.restore();
    } else {
      if (!cache || cache.data !== s.data || !cache.peaks) cache = { data: s.data, peaks: computePeaks(s.data, W), rightPeaks: s.right ? computePeaks(s.right, W) : null };
      // a stereo sample is drawn as two lanes, left above right
      const lanes = cache.rightPeaks ? [[cache.peaks, H / 4], [cache.rightPeaks, 3 * H / 4]] : [[cache.peaks, H / 2]];
      const amp = lanes.length === 2 ? H / 4 - 4 : H / 2 - 4;
      ctx.fillStyle = ink;
      for (const [peaks, mid] of lanes) {
        ctx.fillRect(0, mid, W, 1);
        for (let x = 0; x < W; x++) {
          const lo = peaks[2 * x], hi = peaks[2 * x + 1];
          ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
        }
      }
    }
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    LOOPS.forEach((l, n) => {
      const a = n === 0 ? start : s[l.start] ?? 0, b = n === 0 ? end : s[l.end] ?? 0;
      if (!(b > a) || (n === 0 && !drag && s[l.on] === false) || (n === 1 && s[l.on] === false)) return;
      const xs = frameToX(a), xe = frameToX(b);
      ctx.fillStyle = l.fill;
      ctx.fillRect(xs, 0, xe - xs, H);
      const xf = Math.min(s[l.xf] ?? 0, a, b - a);
      if (xf > 0) {   // the crossfade: the last frames of the loop blend with the audio just before its start
        ctx.fillStyle = l.colour;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(frameToX(b - xf), 0, frameToX(b) - frameToX(b - xf), H);
        ctx.fillRect(frameToX(a - xf), H - 8, frameToX(a) - frameToX(a - xf), 8);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = l.colour;
      ctx.fillRect(xs, 0, 2, H);
      ctx.fillRect(xe - 2, 0, 2, H);
      ctx.textAlign = 'left';
      ctx.fillText(l.marks[0], xs + 4, 2 + n * 12);
      ctx.textAlign = 'right';
      ctx.fillText(l.marks[1], xe - 4, 2 + n * 12);
    });
    ctx.fillStyle = mode === 'spec' ? '#fff' : ink;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(`${id}  ${s.data.length} frames${s.right ? '  stereo' : ''}`, 4, H - 2);
  }

  return {
    show(next) { id = next; drag = null; lastKey = null; },
    setMode(next) { mode = next === 'spec' ? 'spec' : 'wave'; lastKey = null; },
    get mode() { return mode; },
    get sampleId() { return id; },
    draw,
  };
}
