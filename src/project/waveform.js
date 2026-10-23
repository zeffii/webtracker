import { setLoop, setSlices, sliceHex, frameHex } from './ops.js';
import * as config from '../ui/config.js';
import { computeSpectrogram, heat } from './spectrogram.js';

// Min and max of the sample for each pixel column: what the waveform view draws.
export function computePeaks(data, width, a = 0, b = data.length) {
  const peaks = new Float32Array(width * 2);
  const per = (b - a) / width;
  for (let x = 0; x < width; x++) {
    const from = Math.min(data.length, a + Math.floor(x * per)), to = Math.min(data.length, Math.max(from + 1, a + Math.floor((x + 1) * per)));
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
// loop is applied when the mouse is released. Slice markers (red, labelled with their number and the hex value
// an Off cell would need): Alt+click adds one, Alt+drag moves one, Alt+double-click removes the nearest.
export function createWaveformView({ canvas, statusEl, getProject, onLoop, onSelect = () => {}, onSlices = () => {}, onActiveSlice = () => {}, onMenu = () => {}, onFocus = () => {} }) {
  const ctx = canvas.getContext('2d');
  let W = canvas.width;
  let H = canvas.height;
  const dpr = globalThis.devicePixelRatio || 1;
  if (dpr !== 1) {
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
  }

  let ghost = null;   // the auto-slice preview (see setGhost)
  let active = -1;   // the slice marker the keys nudge, drawn brighter
  let settled = true, settleTimer = null;   // while the size is being dragged the spectrogram is the old picture stretched; it is computed afresh once the size has rested
  const SETTLE_MS = 250;
  let id = null, drag = null, cache = null, lastKey = null, mode = 'wave', selection = { from: 0, to: 0 };
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const sample = () => (id ? getProject().samples[id] : undefined);
  const frames = () => sample().data.length;
  // The view: frames va..vb are what the display shows (vb 0 = the whole sample). Zoom changes it; selecting, loops and slices all go through frameToX / xToFrame.
  let va = 0, vb = 0;
  const MIN_SPAN = 16;
  const range = () => { const n = sample() ? frames() : 0; const b = vb > 0 ? Math.min(vb, n) : n, a = Math.min(va, Math.max(0, b - 1)); return [a, Math.max(b, a + 1)]; };
  const frameToX = f => { const [a, b] = range(); return ((f - a) / (b - a)) * W; };
  const xToFrame = x => { const [a, b] = range(); return Math.round(a + Math.min(Math.max(x / W, 0), 1) * (b - a)); };
  const setView = (a, b) => {
    const n = frames();
    const span = Math.min(n, Math.max(MIN_SPAN, Math.round(b - a)));
    a = Math.min(Math.max(0, Math.round(a)), n - span);
    if (span >= n) { va = 0; vb = 0; } else { va = a; vb = a + span; }
    lastKey = null;
  };
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

  const slicesOf = s => drag?.kind === 'slice' ? drag.preview : s.slices ?? [];
  const nearestSlice = (s, x, reach) => {
    let best = -1;
    (s.slices ?? []).forEach((f, i) => { const d = Math.abs(x - frameToX(f)); if (d <= reach && (best < 0 || d < Math.abs(x - frameToX(s.slices[best])))) best = i; });
    return best;
  };
  const commitSlices = (list, grabbed) => {
    try {
      const users = setSlices(getProject(), id, list);
      say('');
      onSlices(users);
      if (grabbed !== undefined) { active = (sample().slices ?? []).indexOf(grabbed); onActiveSlice(active); }
    } catch (err) { say(err.message); }
  };

  canvas.addEventListener('contextmenu', e => {   // a right click: the edit menu, with the frame under the mouse
    if (!sample() || !frames()) return;
    e.preventDefault();
    drag = null;
    onMenu(e, Math.min(xToFrame(e.offsetX), frames() - 1));
  });
  let pan = null;   // a middle-button drag: where it began and the frames the view showed then
  globalThis.addEventListener?.('mousemove', e => {
    if (!pan) return;
    if (!(e.buttons & 4)) { pan = null; return; }
    const d = -((e.clientX - pan.x) / Math.max(1, W)) * (pan.b - pan.a);
    setView(pan.a + d, pan.b + d);
  });
  globalThis.addEventListener?.('mouseup', e => { if (e.button === 1) pan = null; });
  canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault?.(); });
  canvas.addEventListener('mousedown', e => {
    onFocus();   // the keys of the sample screen (Shift+C and the rest) go to it, so a click on the display hands it the focus
    if (e.button === 1) {   // the middle button: drag the zoomed view along
      e.preventDefault?.();
      if (sample() && frames() && vb > 0) pan = { x: e.clientX, a: range()[0], b: range()[1] };
      return;
    }
    if ((e.button ?? 0) !== 0) return;
    const s = sample();
    if (!s || !frames()) return;
    if (e.altKey) {   // slice markers: grab the one under the mouse, or make a new one there
      const at = nearestSlice(s, e.offsetX, GRAB);
      const list = [...(s.slices ?? [])];
      if (at < 0) list.push(Math.min(xToFrame(e.offsetX), frames() - 1));
      drag = { kind: 'slice', i: at < 0 ? list.length - 1 : at, preview: list };
      return;
    }
    if (e.shiftKey) { drag = { kind: 'select', anchor: xToFrame(e.offsetX), preview: null }; return; }
    const { start, end } = loopOf(s);
    if (end > start && Math.abs(e.offsetX - frameToX(start)) <= GRAB) drag = { kind: 'start', preview: { start, end } };
    else if (end > start && Math.abs(e.offsetX - frameToX(end)) <= GRAB) drag = { kind: 'end', preview: { start, end } };
    else drag = { kind: 'region', anchor: xToFrame(e.offsetX), preview: null };
  });

  const move = x => {
    const s = sample();
    if (!drag || !s) return;
    const f = xToFrame(x);
    if (drag.kind === 'slice') drag.preview[drag.i] = Math.min(f, frames() - 1);
    else if (drag.kind === 'start') drag.preview = { start: Math.min(f, drag.preview.end - 2), end: drag.preview.end };
    else if (drag.kind === 'select') { if (Math.abs(f - drag.anchor) >= 1) drag.preview = { start: Math.min(f, drag.anchor), end: Math.max(f, drag.anchor) }; }
    else if (drag.kind === 'end') drag.preview = { start: drag.preview.start, end: Math.max(f, drag.preview.start + 2) };
    else if (Math.abs(f - drag.anchor) >= 2) drag.preview = { start: Math.min(f, drag.anchor), end: Math.max(f, drag.anchor) };
  };
  canvas.addEventListener('mousemove', e => move(e.offsetX));
  // a drag goes on outside the display: the pointer past either edge holds the selection at the first or last frame of the view
  // (it used to be cancelled the moment the mouse left, which threw away selections reaching the edge)
  globalThis.addEventListener?.('mousemove', e => { if (drag && e.target !== canvas) move(e.clientX - canvas.getBoundingClientRect().left); });
  globalThis.addEventListener?.('mouseup', e => { if (drag && e.target !== canvas) finish(); });

  const finish = () => {
    const d = drag;
    drag = null;
    if (d?.kind === 'slice') { commitSlices(d.preview, d.preview[d.i]); return; }
    if (d?.kind === 'select') { if (d.preview) onSelect({ from: d.preview.start, to: d.preview.end }); return; }
    if (d?.preview) commit(Math.max(0, d.preview.start), d.preview.end);
  };
  canvas.addEventListener('mouseup', finish);
  canvas.addEventListener('mouseleave', e => { if (drag && !globalThis.addEventListener) { move(e.offsetX); finish(); } });
  canvas.addEventListener('wheel', e => {   // Ctrl+wheel zooms about the mouse; the plain wheel moves along a zoomed view
    if (!sample() || !frames()) return;
    const [a, b] = range();
    if (e.ctrlKey) {
      e.preventDefault?.();
      const at = xToFrame(e.offsetX), k = e.deltaY < 0 ? 0.5 : 2;
      const na = at - (at - a) * k;
      setView(na, na + (b - a) * k);
    } else if (vb > 0) {
      e.preventDefault?.();
      const d = ((e.deltaX || e.deltaY) / 100) * (b - a) * 0.2;
      setView(a + d, b + d);
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    if (!sample()) return;
    if (e?.altKey) { const at = nearestSlice(sample(), e.offsetX, GRAB * 2); if (at >= 0) commitSlices(sample().slices.filter((_, i) => i !== at)); return; }
    if (e?.shiftKey) onSelect({ from: 0, to: 0 }); else commit(0, 0);
  });

  const LOOPS = [
    { start: 'loopStart', end: 'loopEnd', on: 'loopOn', xf: 'loopXfade', colour: 'hsl(210 70% 55%)', fill: 'rgba(60, 140, 255, 0.2)', marks: 'AB' },
    { start: 'susStart', end: 'susEnd', on: 'susOn', xf: 'susXfade', colour: 'hsl(35 90% 55%)', fill: 'rgba(255, 170, 40, 0.18)', marks: 'ab' },
  ];

  function draw() {
    const s = sample();
    const { start, end } = s ? (drag?.kind === 'select' ? { start: s.loopStart ?? 0, end: s.loopEnd ?? 0 } : loopOf(s)) : { start: 0, end: 0 };
    const pick = drag?.kind === 'select' && drag.preview ? { from: drag.preview.start, to: drag.preview.end } : selection;
    const [va0, vb0] = s ? range() : [0, 0];
    const key = s ? `${va0}-${vb0}:${id}:${mode}:${s.data.length}:${start}:${end}:${LOOPS.slice(1).map(l => `${s[l.start]}.${s[l.end]}.${s[l.on]}`).join()}:${s.loopOn}:${s.loopXfade}:${s.susXfade}:${pick.from}-${pick.to}:${slicesOf(s).join(',')}:${active}:${ghost ? `${ghost.frames.join(',')}/${ghost.replaced?.from}-${ghost.replaced?.to}` : ''}:${W}:${H}:${settled}:${typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : ''}` : 'none';
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, W, H);
    if (!s) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    if (mode === 'spec') {
      const sl = x => (x && (va0 > 0 || vb0 < s.data.length) ? x.subarray(va0, vb0) : x);
      const pw = canvas.width, ph = canvas.height;
      const fresh = cache?.data === s.data && cache.spec?.pw === pw && cache.spec?.ph === ph && cache.spec?.a === va0 && cache.spec?.b === vb0;
      if (!fresh && cache?.data === s.data && cache.spec?.img && !settled && cache.spec.a === va0 && cache.spec.b === vb0) {   // the size is still changing: show the last picture, stretched
        ctx.drawImage(cache.spec.img, 0, 0, W, H);
      } else {
        if (!fresh) cache = { ...(cache?.data === s.data ? cache : { data: s.data }), spec: { pw, ph, a: va0, b: vb0, cells: computeSpectrogram(sl(s.data), sl(s.right), pw, ph) } };
        const image = ctx.createImageData(pw, ph);
        for (let i = 0; i < pw * ph; i++) image.data.set(heat(cache.spec.cells[i]), i * 4);
        if (!cache.spec.img && typeof document !== 'undefined' && document.createElement) {   // kept to stretch while the size is dragged
          const img = document.createElement('canvas'); img.width = pw; img.height = ph;
          img.getContext?.('2d')?.putImageData(image, 0, 0);
          if (img.getContext) cache.spec.img = img;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.putImageData(image, 0, 0);
        ctx.restore();
      }
    } else {
      if (!cache || cache.data !== s.data || !cache.peaks || cache.w !== W || cache.a !== va0 || cache.b !== vb0) cache = { data: s.data, w: W, a: va0, b: vb0, peaks: computePeaks(s.data, W, va0, vb0), rightPeaks: s.right ? computePeaks(s.right, W, va0, vb0) : null };
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
      if (!(b > a)) return;
      const off = n === 0 ? !drag && s[l.on] === false : s[l.on] === false;   // a switched-off loop is drawn faint
      ctx.globalAlpha = off ? 0.35 : 1;
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
      ctx.globalAlpha = 1;
    });
    if (pick.to > pick.from) {   // the selection the edit tools act on
      const xs = frameToX(pick.from), xe = frameToX(pick.to);
      ctx.fillStyle = 'rgba(128, 128, 128, 0.35)';
      ctx.fillRect(xs, 0, xe - xs, H);
      ctx.fillStyle = mode === 'spec' ? '#fff' : ink;
      ctx.fillRect(xs, 0, 1, H);
      ctx.fillRect(xe - 1, 0, 1, H);
    }
    slicesOf(s).forEach((f, i) => {   // the slice markers, numbered in order of position
      const hexMode = config.get('hexMode'), num = (drag?.kind === 'slice' ? [...drag.preview].sort((a, b) => a - b).indexOf(f) : i).toString(16).toUpperCase().padStart(2, '0');
      const x = frameToX(f), label = hexMode === 'absolute' ? num : `${num} ${sliceHex(f, frames())}`;   // the number and the relative hex at the top
      const here = drag?.kind !== 'slice' && i === active;
      ctx.fillStyle = '#f0707a';
      const going = ghost?.replaced && f >= ghost.replaced.from && f < ghost.replaced.to;   // the preview would replace this one: drawn faint
      if (going) ctx.globalAlpha = 0.3;
      ctx.fillRect(x - (here ? 1 : 0), 0, here ? 3 : 1, H);
      ctx.textBaseline = 'top';
      const right = x > W - 70;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText(label, x + (right ? -3 : 3), 14 + (i % 3) * 12);
      if (hexMode !== 'relative') {   // the absolute hex at the bottom, on a very light blue ground
        const abs = frameHex(f, frames()), w = ctx.measureText(abs).width + 6, y = H - 34 - (i % 3) * 14, bx = right ? x - 3 - w : x + 3;
        ctx.fillStyle = 'rgba(200, 225, 255, 0.92)';
        ctx.fillRect(bx, y, w, 13);
        ctx.fillStyle = '#1d3557';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(abs, bx + 3, y + 7);
      }
      ctx.globalAlpha = 1;
    });
    if (ghost) {   // the auto-slice preview: dashed teal lines with a small flag, never stored
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = '#17b3a3'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ghost.frames.forEach(f => {
        const x = Math.round(frameToX(f)) + 0.5;
        if (x < -1 || x > W + 1) return;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.setLineDash([]); ctx.fillRect(x - 3, 0, 7, 4); ctx.setLineDash([4, 3]);
      });
      ctx.restore();
    }
    ctx.fillStyle = mode === 'spec' ? '#fff' : ink;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(`${id}  ${s.data.length} frames${s.right ? '  stereo' : ''}${vb0 < s.data.length || va0 > 0 ? `  view ${va0}-${vb0}` : ''}`, 4, H - 2);
  }

  return {
    show(next) { id = next; drag = null; lastKey = null; active = -1; va = 0; vb = 0; },
    // Zoom: 'selection' fits the selection (else the loop), 'out' doubles the view, 'all' shows the whole sample. Returns a message when nothing happened.
    zoom(kind) {
      const s = sample();
      if (!s || !frames()) return '';
      const [a, b] = range();
      if (kind === 'all') setView(0, frames());
      else if (kind === 'out') { const mid = (a + b) / 2; setView(mid - (b - a), mid + (b - a)); }
      else if (selection.to > selection.from) setView(selection.from, selection.to);
      else return 'Select a range first (Shift+drag), then zoom to it.';
      return '';
    },
    get view() { return range(); },
    // The width follows the space the view has (CSS pixels); the picture is drawn again at once.
    fit(width) {
      const w = Math.round(Math.max(300, width));
      if (w === W) return W;
      W = w;
      canvas.style.width = `${W}px`;
      canvas.width = W * dpr;
      if (dpr !== 1) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      cache = null; lastKey = null;
      return W;
    },
    // The height (CSS pixels), from the grip under the view. The waveform follows at once; the spectrogram is computed
    // again once the size has stopped changing for a quarter of a second.
    resize(height) {
      const h = Math.round(Math.min(600, Math.max(80, height)));
      if (h === H) return H;
      H = h;
      canvas.style.height = `${H}px`;
      canvas.height = H * dpr;
      if (dpr !== 1) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      settled = false; lastKey = null;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settled = true; lastKey = null; }, SETTLE_MS);
      return H;
    },
    get height() { return H; },
    setActiveSlice(i) { active = i; lastKey = null; },
    // markers drawn as a preview only (auto-slice): frames, and the range whose own markers they would replace ({ from, to }, or null); nothing is stored
    setGhost(frames, replaced = null) { ghost = frames?.length ? { frames: [...frames], replaced } : null; lastKey = null; },
    activeFrame() { const s = sample(); return s && active >= 0 ? slicesOf(s)[active] ?? -1 : -1; },
    sample,
    setSelection(from, to) { selection = { from, to }; lastKey = null; },
    setMode(next) { mode = next === 'spec' ? 'spec' : 'wave'; lastKey = null; },
    get mode() { return mode; },
    get sampleId() { return id; },
    draw,
  };
}
