import { setLoop, setSlices, sliceHex, frameHex } from './ops.js';
import * as config from '../ui/config.js';
import { computeSpectrogram, computePitchSpectrogram, heat } from './spectrogram.js';
import { sharpen } from './spectralfx.js';

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
export function createWaveformView({ canvas, statusEl, getProject, onLoop, onSelect = () => {}, onHead = () => {}, onSlices = () => {}, onActiveSlice = () => {}, onMenu = () => {}, onFocus = () => {} }) {
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
  let overlay = null;   // the piano roll (pianorollview.js): drawn on top, and it takes the mouse first while it is on
  const viewOf = () => ({ W, H, frameToX, xToFrame });
  let active = -1;   // the slice marker the keys nudge, drawn brighter
  let settled = true, settleTimer = null;   // while the size is being dragged the spectrogram is the old picture stretched; it is computed afresh once the size has rested
  const SETTLE_MS = 250;
  let id = null, drag = null, cache = null, lastKey = null, mode = 'wave', selection = { from: 0, to: 0 }, insertAt = 0;
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const sample = () => (id ? getProject().samples[id] : undefined);
  const frames = () => sample().data.length;
  // The view: frames va..vb are what the display shows (vb 0 = the whole sample). Zoom changes it; selecting, loops and slices all go through frameToX / xToFrame.
  let va = 0, vb = 0;
  const MIN_SPAN = 16;
  const range = () => { const n = sample() ? frames() : 0; const b = vb > 0 ? Math.min(vb, n) : n, a = Math.min(va, Math.max(0, b - 1)); return [a, Math.max(b, a + 1)]; };
  const gutter = () => overlay?.gutter?.() ?? 0;   // the piano roll's key strip stands at the left edge: the sample starts to its right
  const frameToX = f => { const [a, b] = range(), g = gutter(); return g + ((f - a) / (b - a)) * (W - g); };
  const xToFrame = x => { const [a, b] = range(), g = gutter(); return Math.round(a + Math.min(Math.max((x - g) / Math.max(1, W - g), 0), 1) * (b - a)); };
  const setView = (a, b) => {
    const n = frames();
    const span = Math.min(n, Math.max(MIN_SPAN, Math.round(b - a)));
    a = Math.min(Math.max(0, Math.round(a)), n - span);
    if (span >= n) { va = 0; vb = 0; } else { va = a; vb = a + span; }
    lastKey = null;
  };
  // what a loop drag is showing for the loop ('loop') or the sustain loop ('sus'), or null when no drag is on it
  const prevFor = t => (drag?.preview && drag.kind !== 'select' && drag.kind !== 'slice' && (drag.target ?? 'loop') === t ? drag.preview : null);
  const loopOf = s => prevFor('loop') ?? { start: s.loopStart ?? 0, end: s.loopEnd ?? 0 };
  const hidden = n => config.get(n === 0 ? 'waveHideLoop' : 'waveHideSus');   // the Loop and SusLoop lines of the sample screen have a hide switch

  const commit = (start, end, kind = 'loop') => {
    try {
      const users = setLoop(getProject(), id, start, end, kind);
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
  // With the loop, the sustain loop and the selection all hidden, a plain drag has nothing else to do, so it moves the marker under the mouse.
  const regionsHidden = () => hidden(0) && hidden(1) && config.get('waveHideSel');
  // The cursor says what a drag would do: a marker within reach (and free to grab: Alt held, or every region hidden) shows the move cursor.
  let lastX = -1e9;
  const showCursor = () => {
    const own = overlay?.cursor();
    if (own) { canvas.style.cursor = own; return; }
    const s = sample();
    const over = !drag && s && frames() && (altHeld || regionsHidden()) && nearestSlice(s, lastX, GRAB) >= 0;
    canvas.style.cursor = drag?.kind === 'slice' || over ? 'col-resize' : 'default';
  };
  let altHeld = false;
  globalThis.addEventListener?.('keydown', e => { if (e.key === 'Alt') { altHeld = true; showCursor(); } });
  globalThis.addEventListener?.('keyup', e => { if (e.key === 'Alt') { altHeld = false; showCursor(); } });
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
    if (overlay?.menu(e, viewOf())) { lastKey = null; return; }
    onMenu(e, Math.min(xToFrame(e.offsetX), frames() - 1));
  });
  let pan = null;   // a middle-button drag: where it began and the frames the view showed then
  globalThis.addEventListener?.('mousemove', e => {
    if (!pan) return;
    if (!(e.buttons & 4)) { pan = null; return; }
    const d = -((e.clientX - pan.x) / Math.max(1, W - gutter())) * (pan.b - pan.a);
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
    if (overlay?.down(e, viewOf())) { lastKey = null; showCursor(); return; }
    // Plain drag (or Shift): the selection. Alt: the loop, or a slice marker when one is under the mouse (Alt+click alone makes a marker).
    // Ctrl: the sustain loop. The start or end of the loop being worked on is grabbed when the mouse is on it.
    const region = (target, markOnClick) => {
      const keys = target === 'sus' ? ['susStart', 'susEnd'] : ['loopStart', 'loopEnd'];
      const start = s[keys[0]] ?? 0, end = s[keys[1]] ?? 0;
      if (hidden(target === 'sus' ? 1 : 0)) config.set(target === 'sus' ? 'waveHideSus' : 'waveHideLoop', false);   // working on it shows it
      if (end > start && Math.abs(e.offsetX - frameToX(start)) <= GRAB) drag = { kind: 'start', target, preview: { start, end } };
      else if (end > start && Math.abs(e.offsetX - frameToX(end)) <= GRAB) drag = { kind: 'end', target, preview: { start, end } };
      else drag = { kind: 'region', target, anchor: xToFrame(e.offsetX), preview: null, markOnClick };
    };
    const bare = !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (e.altKey || (bare && regionsHidden() && nearestSlice(s, e.offsetX, GRAB) >= 0)) {   // with every region hidden a marker can be grabbed without Alt
      const at = nearestSlice(s, e.offsetX, GRAB);
      if (at >= 0) { drag = { kind: 'slice', i: at, preview: [...(s.slices ?? [])] }; return; }
      region('loop', Math.min(xToFrame(e.offsetX), frames() - 1));
      return;
    }
    if (e.ctrlKey || e.metaKey) { region('sus'); return; }
    if (config.get('waveHideSel')) config.set('waveHideSel', false);   // selecting shows the selection
    drag = { kind: 'select', anchor: xToFrame(e.offsetX), preview: null };
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
  canvas.addEventListener('mousemove', e => { if (overlay) { overlay.move(e, viewOf()); lastKey = null; } move(e.offsetX); lastX = e.offsetX; altHeld = !!e.altKey; showCursor(); });
  canvas.addEventListener('mouseleave', () => { if (overlay) { overlay.leave(); lastKey = null; } });
  // a drag goes on outside the display: the pointer past either edge holds the selection at the first or last frame of the view
  // (it used to be cancelled the moment the mouse left, which threw away selections reaching the edge)
  globalThis.addEventListener?.('mousemove', e => {
    if (e.target === canvas) return;
    const box = canvas.getBoundingClientRect();
    if (overlay?.dragging) { overlay.move({ offsetX: e.clientX - box.left, offsetY: e.clientY - box.top, shiftKey: e.shiftKey }, viewOf()); lastKey = null; }
    if (drag) move(e.clientX - box.left);
  });
  globalThis.addEventListener?.('mouseup', e => {
    if (overlay?.dragging) { overlay.up(); lastKey = null; showCursor(); }
    if (drag && e.target !== canvas) finish();
  });

  const finish = () => {
    const d = drag;
    drag = null;
    if (d?.kind === 'slice') { commitSlices(d.preview, d.preview[d.i]); return; }
    if (d?.kind === 'select') { if (d.preview) onSelect({ from: d.preview.start, to: d.preview.end }); else onHead(d.anchor); return; }   // a click without a drag places the playhead
    if (d?.preview) commit(Math.max(0, d.preview.start), d.preview.end, d.target ?? 'loop');
    else if (d?.kind === 'region' && d.markOnClick !== undefined) commitSlices([...(sample()?.slices ?? []), d.markOnClick], d.markOnClick);   // Alt+click without a drag: a slice marker
  };
  canvas.addEventListener('mouseup', () => { if (overlay?.dragging) { overlay.up(); lastKey = null; showCursor(); return; } finish(); });
  canvas.addEventListener('mouseleave', e => { if (drag && !globalThis.addEventListener) { move(e.offsetX); finish(); } });
  canvas.addEventListener('wheel', e => {   // Ctrl+wheel zooms about the mouse; the plain wheel moves along a zoomed view
    if (!sample() || !frames()) return;
    if (overlay?.wheel(e, viewOf())) { e.preventDefault?.(); lastKey = null; return; }   // over the piano roll's key strip: its pitch range
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
    if (e?.altKey) { const at = nearestSlice(sample(), e.offsetX, GRAB * 2); if (at >= 0) { commitSlices(sample().slices.filter((_, i) => i !== at)); return; } }   // Alt+double-click: the marker under it goes, or else the loop
    if (e?.ctrlKey || e?.metaKey) commit(0, 0, 'sus');   // Ctrl+double-click takes the sustain loop away, Alt+double-click (away from a marker) the loop
    else if (e?.altKey) commit(0, 0);
    else onSelect({ from: 0, to: 0 });
  });

  const LOOPS = [
    { start: 'loopStart', end: 'loopEnd', on: 'loopOn', xf: 'loopXfade', colour: 'hsl(210 70% 55%)', fill: 'rgba(60, 140, 255, 0.2)', marks: 'AB' },
    { start: 'susStart', end: 'susEnd', on: 'susOn', xf: 'susXfade', colour: 'hsl(35 90% 55%)', fill: 'rgba(255, 170, 40, 0.18)', marks: 'ab' },
  ];

  function draw() {
    const s = sample();
    const { start, end } = s ? loopOf(s) : { start: 0, end: 0 };
    const sp = prevFor('sus');
    const pick = drag?.kind === 'select' && drag.preview ? { from: drag.preview.start, to: drag.preview.end } : config.get('waveHideSel') ? { from: 0, to: 0 } : selection;   // hidden: drawn as no selection (it still stands)
    const [va0, vb0] = s ? range() : [0, 0];
    const key = s ? `${va0}-${vb0}:${id}:${mode}:${s.data.length}:${start}:${end}:${LOOPS.slice(1).map(l => `${s[l.start]}.${s[l.end]}.${s[l.on]}`).join()}:${sp ? `${sp.start}-${sp.end}` : ''}:${hidden(0)}${hidden(1)}:${s.loopOn}:${s.loopXfade}:${s.susXfade}:${pick.from}-${pick.to}:${slicesOf(s).join(',')}:${active}:${ghost ? `${ghost.frames.join(',')}/${ghost.replaced?.from}-${ghost.replaced?.to}` : ''}:${W}:${gutter()}:${H}:${settled}:${overlay?.key() ?? ''}:${typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : ''}` : 'none';
    if (key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, W, H);
    if (!s) return;
    const ink = typeof getComputedStyle === 'function' ? getComputedStyle(canvas).color : '#888';
    if (mode === 'spec') {
      const sl = x => (x && (va0 > 0 || vb0 < s.data.length) ? x.subarray(va0, vb0) : x);
      const g0 = gutter(), gx = Math.round(g0 * dpr), pw = canvas.width - gx, ph = canvas.height;
      const axis = overlay?.pitch() ?? null, sig = axis?.sig ?? '';
      const fresh = cache?.data === s.data && cache.spec?.pw === pw && cache.spec?.ph === ph && cache.spec?.a === va0 && cache.spec?.b === vb0 && cache.spec?.sig === sig;
      if (axis) {   // the piano roll's pitch axis: worked out on at most 1200 columns (a long FFT each) and stretched to the display
        const fx = `${axis.contrast ?? 0}.${axis.islands ?? 0}`, cols = Math.min(pw, 1200);
        if (!(fresh && cache.spec.img && cache.spec.fx === fx) && (settled || !cache?.spec?.img)) {
          // the contrast and island passes run on the finished cells, so moving their sliders does not redo the FFT
          const cells = fresh && cache.spec.cells ? cache.spec.cells : computePitchSpectrogram(sl(s.data), sl(s.right), s.rate, cols, ph, axis);
          const shown = sharpen(cells, cols, ph, { contrast: axis.contrast, islands: axis.islands, rowsPerSemitone: ph / Math.max(1, axis.hi - axis.lo) });
          const image = ctx.createImageData(cols, ph);
          for (let i = 0; i < cols * ph; i++) image.data.set(heat(shown[i]), i * 4);
          const img = typeof document !== 'undefined' ? document.createElement?.('canvas') : null;
          if (img?.getContext) { img.width = cols; img.height = ph; img.getContext('2d').putImageData(image, 0, 0); }
          cache = { ...(cache?.data === s.data ? cache : { data: s.data }), spec: { pw, ph, a: va0, b: vb0, sig, cells, fx, img: img?.getContext ? img : null } };
        }
        if (cache.spec.img) ctx.drawImage(cache.spec.img, g0, 0, W - g0, H);
      } else if (!fresh && cache?.data === s.data && cache.spec?.img && !settled && cache.spec.a === va0 && cache.spec.b === vb0 && !cache.spec.sig) {   // the size is still changing: show the last picture, stretched
        ctx.drawImage(cache.spec.img, g0, 0, W - g0, H);
      } else {
        if (!fresh) cache = { ...(cache?.data === s.data ? cache : { data: s.data }), spec: { pw, ph, a: va0, b: vb0, sig: '', cells: computeSpectrogram(sl(s.data), sl(s.right), pw, ph) } };
        const image = ctx.createImageData(pw, ph);
        for (let i = 0; i < pw * ph; i++) image.data.set(heat(cache.spec.cells[i]), i * 4);
        if (!cache.spec.img && typeof document !== 'undefined' && document.createElement) {   // kept to stretch while the size is dragged
          const img = document.createElement('canvas'); img.width = pw; img.height = ph;
          img.getContext?.('2d')?.putImageData(image, 0, 0);
          if (img.getContext) cache.spec.img = img;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.putImageData(image, gx, 0);
        ctx.restore();
      }
    } else {
      if (!cache || cache.data !== s.data || !cache.peaks || cache.w !== W - gutter() || cache.a !== va0 || cache.b !== vb0) cache = { data: s.data, w: W - gutter(), a: va0, b: vb0, peaks: computePeaks(s.data, W - gutter(), va0, vb0), rightPeaks: s.right ? computePeaks(s.right, W - gutter(), va0, vb0) : null };
      // a stereo sample is drawn as two lanes, left above right
      const lanes = cache.rightPeaks ? [[cache.peaks, H / 4], [cache.rightPeaks, 3 * H / 4]] : [[cache.peaks, H / 2]];
      const amp = lanes.length === 2 ? H / 4 - 4 : H / 2 - 4;
      const g0 = gutter();
      ctx.fillStyle = ink;
      for (const [peaks, mid] of lanes) {
        ctx.fillRect(g0, mid, W - g0, 1);
        for (let x = 0; x < W - g0; x++) {
          const lo = peaks[2 * x], hi = peaks[2 * x + 1];
          ctx.fillRect(g0 + x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
        }
      }
    }
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    LOOPS.forEach((l, n) => {
      const a = n === 0 ? start : sp?.start ?? s[l.start] ?? 0, b = n === 0 ? end : sp?.end ?? s[l.end] ?? 0;
      if (!(b > a) || hidden(n)) return;
      const off = !drag && s[l.on] === false;   // a switched-off loop is drawn faint
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
    if (insertAt >= 0 && insertAt <= frames()) {   // the playhead a paste goes to: a pink line with a flag, anywhere in the sample
      const [va, vb] = range();
      if (insertAt >= va && insertAt <= vb) {
        const x = Math.round(frameToX(insertAt)) + 0.5;
        ctx.fillStyle = 'hsl(335 80% 62%)';
        ctx.fillRect(x - 0.5, 0, 1, H);
        ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x + 0.5, 6); ctx.closePath(); ctx.fill();
      }
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
    overlay?.draw(ctx, viewOf());
    ctx.fillStyle = mode === 'spec' ? '#fff' : ink;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(`${id}  ${s.data.length} frames${s.right ? '  stereo' : ''}${vb0 < s.data.length || va0 > 0 ? `  view ${va0}-${vb0}` : ''}`, 4, H - 2);
  }

  // The playhead: a thin translucent red line over the canvas (its own element, so the waveform is not redrawn for it). `frame` is null to hide it.
  const head = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (head) head.className = 'wave-play';
  const playhead = frame => {
    if (!head || !canvas.parentNode?.appendChild) return;
    const s = sample();
    const [a, b] = s ? range() : [0, 1];
    if (frame === null || frame === undefined || !s || frame < a || frame >= b) { if (head.parentNode) head.remove(); return; }
    head.style.left = `${canvas.offsetLeft + canvas.clientLeft + (gutter() + ((frame - a) / (b - a)) * (canvas.clientWidth - gutter()))}px`;
    head.style.top = `${canvas.offsetTop + canvas.clientTop}px`;
    head.style.height = `${canvas.clientHeight}px`;
    if (head.parentNode !== canvas.parentNode) canvas.parentNode.appendChild(head);
  };

  return {
    playhead,
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
    // The audio changed in place (normalise, fades, reverse...): the length and the array are the same, so drop the pictures.
    invalidate() { cache = null; lastKey = null; },
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
    // the frame under a canvas x, and the slice marker at or before a frame (-1 when there is none)
    frameAtX(x) { return Math.min(Math.max(0, xToFrame(x)), Math.max(0, frames() - 1)); },
    // how many frames one pixel of the view covers (1 or more), and a scroll that brings a frame into view when the view is zoomed in
    framesPerPixel() { const [a, b] = range(); return Math.max(1, (b - a) / Math.max(1, W - gutter())); },
    reveal(frame) {
      if (!sample() || vb <= 0) return;
      const [a, b] = range();
      if (frame >= a && frame <= b) return;
      const span = b - a; setView(frame - span / 2, frame + span / 2);
    },
    sliceBefore(frame) { const s = sample(); return (s?.slices ?? []).reduce((best, f) => (f <= frame && f > best ? f : best), -1); },
    sample,
    setSelection(from, to) { selection = { from, to }; lastKey = null; },
    setHead(frame) { insertAt = frame; lastKey = null; },   // where a paste goes: drawn as a pink marker with a flag on top
    // the piano roll overlay (pianorollview.js), or null
    setOverlay(next) { overlay = next; lastKey = null; },
    redraw() { lastKey = null; },
    setMode(next) { mode = next === 'spec' ? 'spec' : 'wave'; lastKey = null; },
    get mode() { return mode; },
    get sampleId() { return id; },
    draw,
  };
}
