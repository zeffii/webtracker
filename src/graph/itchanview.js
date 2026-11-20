import { makeCanvas, drag, button, forPage, clamp, ORANGE, BLUE, PINK } from './spaceui.js';
import { computePeaks } from '../project/waveform.js';
import {
  ENVELOPES, ENVELOPE_NAMES, proxyOf, rangeOf, loopsOf, moveRangeEdge, setLoop, clearProxy,
  newInstrument, instrumentsFor, withInstrument, newEnvelope, addPoint, movePoint, removePoint, setMarks,
} from './itchanmodel.js';

// The IT channel's panel: a small sample area and the instrument's envelopes, in one row.
//
// The sample area shows the bank sample a slot plays. The slot is a proxy: it plays the whole sample with the loops the bank gave it, until
// you drag the dark edges to use a stretch of it, or drag a loop marker (or drag across the waveform to make a loop, with Shift for the
// sustain loop) to give the slot loops of its own. "Bank" brings back the sample's own stretch and loops. Nothing is changed in the bank.
//
// The instrument side picks an instrument and draws its volume, panning and pitch envelopes: click empty space for a point, drag a point,
// double-click it to remove it. "Loop" and "Sustain" modes mark a range of points by clicking two of them. Pitch can be set to move the
// filter cutoff instead (the IT filter envelope).
const DEFAULT_SW = 760, DEFAULT_SH = 150, EW = 380, EH = 124, PL = 6, PR = 6;
const SIZE_KEY = 'wax.itchanSampleSize';   // the sample area's size, as dragged
let SW = DEFAULT_SW, SH = DEFAULT_SH;
const GRAB = 7;
const NNA = ['cut', 'continue', 'off', 'fade'], DCT = ['off', 'note', 'sample', 'instrument'], DCA = ['cut', 'off', 'fade'];

// A colour for each sounding note's playhead: vivid, and far from the colour of the one before (the golden angle round the hue wheel).
export const headColour = uid => `hsl(${Math.round((uid * 137.508) % 360)} 92% 62%)`;

export function createItChanView({ doc = document, getData, setData, getSampleIds, getSample, isIt3 = () => false, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'curve-editor drum2 itchan-panel';
  let slot = 0, insIndex = 0, envKind = 'vol', markMode = 'point', pending = null, zoom = false;

  const make = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
  const row = (...kids) => make('div', { className: 'prow' }, ...kids);
  const select = (options, value, onPick, title = '') => {
    const s = make('select', { title }, ...options.map(([v, label]) => make('option', { value: String(v), textContent: label })));
    s.value = String(value); s.addEventListener('change', () => onPick(s.value)); return s;
  };
  const check = (label, value, onPick, title = '') => {
    const box = make('input', { type: 'checkbox', checked: value, title });
    box.addEventListener('change', () => onPick(box.checked));
    return make('label', { title }, box, ` ${label}`);
  };
  const number = (value, min, max, onPick, title = '', width = 62) => {
    const n = make('input', { type: 'number', min, max, value, title }); n.style.width = `${width}px`;
    n.addEventListener('change', () => onPick(clamp(Math.round(Number(n.value) || 0), min, max))); return n;
  };

  // ---- the sample area ----------------------------------------------------------------------------------------------------
  try { const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null'); if (saved) { SW = clamp(saved[0], 240, 2400); SH = clamp(saved[1], 90, 600); } } catch { /* no storage, or nothing saved */ }
  const sampleSide = make('div', { className: 'itchan-side' });
  const { canvas: sampleCanvas, ctx: sctx, ink: sink } = makeCanvas(doc, SW, SH, 'itchan-sample');
  const sampleControls = make('div', { className: 'itchan-controls' });
  const grip = make('div', { className: 'itchan-grip', title: 'Drag to stretch the sample area' });
  const sampleBox = make('div', { className: 'itchan-samplebox' }, sampleCanvas, grip);
  sampleSide.append(sampleBox, sampleControls);
  // The sample area can be stretched by its corner; the size is kept for next time.
  const resizeSample = (w, h) => {
    SW = clamp(Math.round(w), 240, 2400); SH = clamp(Math.round(h), 90, 600);
    const dpr = Math.max(1, Math.min(3, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
    sampleCanvas.width = SW * dpr; sampleCanvas.height = SH * dpr;
    if (sampleCanvas.style) Object.assign(sampleCanvas.style, { width: `${SW}px`, height: `${SH}px` });
    sctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sampleControls.style) sampleControls.style.width = `${SW}px`;
    peakCache = null; drawSample();
  };
  grip.addEventListener('pointerdown', e => {
    const x0 = e.clientX, y0 = e.clientY, w0 = SW, h0 = SH;
    grip.setPointerCapture?.(e.pointerId); e.preventDefault();
    const move = m => resizeSample(w0 + m.clientX - x0, h0 + m.clientY - y0);
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); try { localStorage.setItem(SIZE_KEY, JSON.stringify([SW, SH])); } catch { /* no storage */ } };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  if (sampleControls.style) sampleControls.style.width = `${SW}px`;
  let peakCache = null;   // the waveform's columns, kept while the sample, the stretch on show and the width stay the same
  const heads = new Map();   // the playheads: note number -> { slot, frame }, as the node last reported them

  const bankOf = () => { const id = getSampleIds()[slot]; return id === undefined ? null : getSample(id); };
  let window_ = [0, 1];   // the frames on show
  const frameOf = x => window_[0] + (clamp(x, PL, SW - PR) - PL) / (SW - PL - PR) * (window_[1] - window_[0]);
  const xOf = frame => PL + (frame - window_[0]) / (window_[1] - window_[0]) * (SW - PL - PR);

  const sampleHandles = (bank, data) => {
    const proxy = proxyOf(data, slot), [a, b] = rangeOf(proxy, bank.data.length), { loop, sus } = loopsOf(bank, proxy);
    const list = [{ id: 'range-start', frame: a, edge: true }, { id: 'range-end', frame: b, edge: true }];
    if (loop.active) list.push({ id: 'loop-start', frame: loop.start }, { id: 'loop-end', frame: loop.end });
    if (sus.active) list.push({ id: 'sus-start', frame: sus.start }, { id: 'sus-end', frame: sus.end });
    return list;
  };

  function drawSample() {
    if (!sctx) return;
    const page = sink(), bank = bankOf(), data = getData();
    sctx.clearRect(0, 0, SW, SH);
    sctx.font = '10px ui-monospace, Consolas, monospace'; sctx.textBaseline = 'top'; sctx.textAlign = 'left';
    if (!bank) { sctx.fillStyle = page; sctx.globalAlpha = 0.6; sctx.fillText('No sample in this slot: add one to the list above.', PL, 6); sctx.globalAlpha = 1; return; }
    const length = bank.data.length, proxy = proxyOf(data, slot), [a, b] = rangeOf(proxy, length), { loop, sus } = loopsOf(bank, proxy);
    window_ = zoom ? [Math.max(0, a - (b - a) * 0.05), Math.min(length, b + (b - a) * 0.05)] : [0, length];
    const mid = SH / 2, tall = SH / 2 - 14, width = SW - PL - PR;
    // the waveform, from the first and last frame on show
    const key = `${width}|${Math.floor(window_[0])}|${Math.ceil(window_[1])}`;
    if (!peakCache || peakCache.data !== bank.data || peakCache.key !== key) peakCache = { data: bank.data, key, peaks: computePeaks(bank.data, width, Math.floor(window_[0]), Math.ceil(window_[1])) };
    const peaks = peakCache.peaks;
    sctx.fillStyle = page; sctx.globalAlpha = 0.85;
    for (let px = 0; px < width; px++) {
      const lo = peaks[2 * px], hi = peaks[2 * px + 1];
      sctx.fillRect(PL + px, mid - hi * tall, 1, Math.max(1, (hi - lo) * tall));
    }
    // the part of the sample that is not played is dimmed
    sctx.globalAlpha = 1; sctx.fillStyle = 'rgba(0,0,0,0.45)';
    sctx.fillRect(PL, 0, Math.max(0, xOf(a) - PL), SH); sctx.fillRect(xOf(b), 0, Math.max(0, SW - PR - xOf(b)), SH);
    const band = (loopInfo, colour, lane) => {
      if (!loopInfo.active) return;
      sctx.globalAlpha = 0.16; sctx.fillStyle = forPage(colour, page); sctx.fillRect(xOf(loopInfo.start), lane, xOf(loopInfo.end) - xOf(loopInfo.start), 10);
      sctx.globalAlpha = 1; sctx.fillStyle = forPage(colour, page);
      for (const frame of [loopInfo.start, loopInfo.end]) sctx.fillRect(Math.round(xOf(frame)) - 1, 0, 2, SH);
      if (loopInfo.xfade > 0) {   // the crossfade: the audio just before the loop start (source) is blended over the last frames before the loop end
        const seam = frame => [xOf(frame - loopInfo.xfade), xOf(frame)];
        for (const frame of [loopInfo.start, loopInfo.end]) { const [x0, x1] = seam(frame); sctx.globalAlpha = 0.35; sctx.fillRect(x0, 0, Math.max(2, x1 - x0), SH); sctx.globalAlpha = 0.9; sctx.fillRect(x0, lane + 10, Math.max(2, x1 - x0), 3); }
        sctx.globalAlpha = 0.9; sctx.textAlign = 'right'; sctx.fillText(`xfade ${Math.round(loopInfo.xfade)}`, xOf(loopInfo.end) - 3, lane + 15);
      }
    };
    band(loop, BLUE, 1); band(sus, ORANGE, 14);
    sctx.globalAlpha = 1; sctx.fillStyle = page;
    for (const frame of [a, b]) sctx.fillRect(Math.round(xOf(frame)) - 1, 0, 2, SH);   // the stretch's edges
    sctx.globalAlpha = 0.7; sctx.fillStyle = forPage(PINK, page);
    const tag = proxy && (proxy.start !== undefined || proxy.end !== undefined) ? `${Math.round(a)}-${Math.round(b)} of ${length}` : `whole, ${length} frames`;
    sctx.textAlign = 'right'; sctx.fillText(tag, SW - PR - 18, SH - 12); sctx.globalAlpha = 1;
    // the playheads of the notes sounding from this slot, each its own colour
    for (const [uid, head] of heads) {
      if (head.slot !== slot || head.frame < window_[0] || head.frame > window_[1]) continue;
      const x = Math.round(xOf(head.frame));
      sctx.fillStyle = headColour(uid); sctx.fillRect(x - 1, 0, 2, SH);
      sctx.beginPath(); sctx.moveTo(x - 5, 0); sctx.lineTo(x + 5, 0); sctx.lineTo(x, 7); sctx.fill();
    }
  }

  function sampleDrag() {
    let held = null, made = null;
    drag(sampleCanvas, SW, SH, {
      start: (x, y) => {
        const bank = bankOf(); if (!bank) return false;
        const data = getData(), handles = sampleHandles(bank, data);
        // loop markers win over the stretch's edges when they are on top of each other
        const near = handles.filter(h => Math.abs(xOf(h.frame) - x) <= GRAB).sort((p, q) => (q.edge ? -1 : 1) - (p.edge ? -1 : 1) || Math.abs(xOf(p.frame) - x) - Math.abs(xOf(q.frame) - x));
        held = near[0] ?? null; made = null;
        if (!held) made = { which: sampleCanvas.dataset.shift === '1' ? 'sus' : 'loop', from: frameOf(x) };
        return true;
      },
      move: x => {
        const bank = bankOf(); if (!bank) return;
        const length = bank.data.length, frame = frameOf(x);
        if (held) {
          if (held.edge) setData(moveRangeEdge(getData(), slot, held.id === 'range-start' ? 'start' : 'end', frame, length));
          else { const which = held.id.startsWith('loop') ? 'loop' : 'sus'; setData(setLoop(getData(), slot, which, bank, { [held.id.endsWith('start') ? 'start' : 'end']: frame, on: true })); }
        } else if (made) {
          setData(setLoop(getData(), slot, made.which, bank, { start: Math.min(made.from, frame), end: Math.max(made.from, frame) + 2, on: true }));
        }
        refresh();
      },
    });
    // a Shift held at the press makes the sustain loop: the drag helper does not pass the event, so it is noted here, before the drag starts
    sampleCanvas.addEventListener('pointerdown', e => { sampleCanvas.dataset.shift = e.shiftKey ? '1' : ''; }, true);
  }

  function sampleControlsRow() {
    sampleControls.replaceChildren();
    const ids = getSampleIds(), bank = bankOf(), data = getData();
    if (!ids.length) return;
    slot = clamp(slot, 0, ids.length - 1);
    const picker = select(ids.map((id, i) => [i, `${i.toString(16).toUpperCase().padStart(2, '0')} ${id}`]), slot, v => { slot = Number(v); refresh(); }, 'The sample slot: the one a Smp value or instrument picks');
    sampleControls.append(row(picker, check('zoom', zoom, v => { zoom = v; refresh(); }, 'Show only the stretch this slot plays'), button(doc, 'Bank', 'Back to the bank sample\'s own stretch and loops', () => { setData(clearProxy(getData(), slot)); refresh(); })));
    if (!bank) return;
    const { loop, sus } = loopsOf(bank, proxyOf(data, slot));
    const loopRow = (label, which, info, tip) => {
      const parts = [
        check(label, info.on, v => { setData(setLoop(getData(), slot, which, bank, { on: v })); refresh(); }, tip),
        check('ping-pong', info.pingpong, v => { setData(setLoop(getData(), slot, which, bank, { pingpong: v })); refresh(); }, 'Play the loop forwards and back'),
      ];
      if (isIt3()) parts.push(make('span', { textContent: ' xfade ' }), number(info.xfade, 0, 1 << 20, v => { setData(setLoop(getData(), slot, which, bank, { xfade: v })); refresh(); }, 'Crossfade at the loop seam, in frames (IT 3)'));
      parts.push(make('span', { className: 'dim', textContent: info.active ? ` ${info.from} ${Math.round(info.start)}-${Math.round(info.end)}` : info.on && info.exists && !info.inside ? ' outside the stretch' : '' }));
      return row(...parts);
    };
    sampleControls.append(loopRow('loop', 'loop', loop, 'The loop that plays while the note is held, or after the sustain loop'), loopRow('sustain', 'sus', sus, 'The loop that plays only while the key is held'));
  }

  // ---- the instrument side ------------------------------------------------------------------------------------------------
  const insSide = make('div', { className: 'itchan-side' });
  const { canvas: envCanvas, ctx: ectx, ink: eink } = makeCanvas(doc, EW, EH, 'itchan-env');
  const insControls = make('div', { className: 'itchan-controls' });
  insSide.append(insControls, envCanvas);

  const current = () => getData()?.ins?.[insIndex] ?? null;
  const patchIns = patch => { setData(withInstrument(getData(), insIndex, patch)); refresh(); };
  const patchEnv = env => patchIns({ [envKind]: env });

  const envLayout = env => {
    const last = env ? env.pts[env.pts.length - 2] : 64, span = Math.max(64, Math.ceil(last * 1.15));
    return { span, X: tick => PL + tick / span * (EW - PL - PR), Y: v => EH - 12 - v / 64 * (EH - 26), tickAt: x => (clamp(x, PL, EW - PR) - PL) / (EW - PL - PR) * span, valueAt: y => (EH - 12 - y) / (EH - 26) * 64 };
  };

  function drawEnv() {
    if (!ectx) return;
    const page = eink(), env = current()?.[envKind] ?? null;
    ectx.clearRect(0, 0, EW, EH);
    ectx.font = '10px ui-monospace, Consolas, monospace'; ectx.textBaseline = 'top'; ectx.textAlign = 'left';
    ectx.fillStyle = page; ectx.globalAlpha = 0.65;
    ectx.fillText(`${ENVELOPE_NAMES[envKind].toUpperCase()}${envKind === 'pit' && current()?.filter ? ' (filter cutoff)' : ''}`, PL, 2);
    if (!env) { ectx.fillText('off: tick the box above to draw one', PL, EH / 2); ectx.globalAlpha = 1; return; }
    const L = envLayout(env);
    ectx.globalAlpha = 0.12; ectx.fillRect(PL, L.Y(32), EW - PL - PR, 1);
    const pts = []; for (let i = 0; i < env.pts.length; i += 2) pts.push([L.X(env.pts[i]), L.Y(env.pts[i + 1])]);
    const span = (from, to, colour) => {
      if (from < 0 || to < 0 || !pts[from] || !pts[to]) return;
      ectx.globalAlpha = 0.16; ectx.fillStyle = forPage(colour, page); ectx.fillRect(pts[from][0], 14, Math.max(2, pts[to][0] - pts[from][0]), EH - 28);
      ectx.globalAlpha = 0.9; ectx.fillRect(pts[from][0] - 1, 14, 2, EH - 28); ectx.fillRect(pts[to][0] - 1, 14, 2, EH - 28);
    };
    span(env.ls, env.le, BLUE); span(env.ss, env.se, ORANGE);
    ectx.globalAlpha = 1; ectx.strokeStyle = page; ectx.lineWidth = 1.5; ectx.beginPath();
    pts.forEach(([x, y], i) => (i ? ectx.lineTo(x, y) : ectx.moveTo(x, y))); ectx.stroke();
    ectx.fillStyle = page;
    pts.forEach(([x, y], i) => { ectx.beginPath(); ectx.arc(x, y, i === pending ? 5 : 3.5, 0, Math.PI * 2); ectx.fill(); });
    ectx.globalAlpha = 0.5; ectx.textAlign = 'right'; ectx.fillText(`${env.pts[env.pts.length - 2]} ticks`, EW - PR, EH - 12);
    ectx.globalAlpha = 1;
  }

  function envDrag() {
    let held = -1;
    const hit = (x, y) => {
      const env = current()?.[envKind]; if (!env) return -1;
      const L = envLayout(env);
      for (let i = 0; i < env.pts.length; i += 2) if (Math.hypot(L.X(env.pts[i]) - x, L.Y(env.pts[i + 1]) - y) <= GRAB) return i / 2;
      return -1;
    };
    drag(envCanvas, EW, EH, {
      start: (x, y) => {
        const env = current()?.[envKind]; if (!env) return false;
        const index = hit(x, y), L = envLayout(env);
        if (markMode !== 'point') {   // loop and sustain: two clicks on points
          if (index < 0) return false;
          const kind = markMode === 'loop' ? 'loop' : 'sus';
          if (pending === null) { pending = index; patchEnv(setMarks(env, kind, index, index)); }
          else { patchEnv(setMarks(env, kind, pending, index)); pending = null; }
          return false;
        }
        if (index >= 0) { held = index; return true; }
        const added = addPoint(env, L.tickAt(x), L.valueAt(y));
        if (added.index < 0) return false;
        held = added.index; patchEnv(added.env); return true;
      },
      move: (x, y) => {
        const env = current()?.[envKind]; if (!env || held < 0) return;
        const L = envLayout(env);
        patchEnv(movePoint(env, held, L.tickAt(x), L.valueAt(y)));
      },
      done: () => { held = -1; },
    });
    envCanvas.addEventListener('dblclick', e => {
      const r = envCanvas.getBoundingClientRect(), x = (e.clientX - r.left) * (EW / (r.width || EW)), y = (e.clientY - r.top) * (EH / (r.height || EH));
      const index = hit(x, y), env = current()?.[envKind];
      if (index >= 0 && env) patchEnv(removePoint(env, index));
    });
  }

  function insControlsRow() {
    insControls.replaceChildren();
    const data = getData(), count = getSampleIds().length;
    if (!Array.isArray(data?.ins) || !data.ins.length) {
      insControls.append(row(button(doc, 'Use instruments', 'Make an instrument for each sample, so notes can have envelopes, keymaps and note actions. Nothing sounds different until you edit one.', () => { setData({ ...getData(), ins: instrumentsFor(count) }); insIndex = 0; refresh(); })),
        make('span', { className: 'dim', textContent: ' now: a note plays the sample with the same number' }));
      return;
    }
    insIndex = clamp(insIndex, 0, data.ins.length - 1);
    const ins = current() ?? newInstrument(0);
    const names = data.ins.map((_, i) => [i, `${(i + 1).toString(16).toUpperCase().padStart(2, '0')} instrument`]);
    const slots = getSampleIds().map((id, i) => [i, `${i.toString(16).toUpperCase().padStart(2, '0')} ${id}`]);
    insControls.append(
      row(select(names, insIndex, v => { insIndex = Number(v); pending = null; refresh(); }, 'The instrument: the Ins value of a cell, 01 being the first'),
        button(doc, '+', 'Add an instrument', () => { setData(withInstrument(getData(), getData().ins.length, newInstrument(clamp(slot, 0, Math.max(0, count - 1))))); insIndex = getData().ins.length - 1; refresh(); }),
        make('span', { textContent: ' plays ' }), select(slots, ins.map?.[60] ?? 0, v => patchIns({ map: new Array(120).fill(Number(v)) }), 'The sample every key plays (a keymap with several samples comes from an imported file)')),
      row(make('span', { textContent: 'new note ' }), select(NNA.map((n, i) => [i, n]), ins.nna, v => patchIns({ nna: Number(v) }), 'What happens to a note still playing when a new one starts on the channel'),
        make('span', { textContent: ' dup ' }), select(DCT.map((n, i) => [i, n]), ins.dct, v => patchIns({ dct: Number(v) }), 'The duplicate check: which notes count as a duplicate'),
        make('span', { textContent: ' then ' }), select(DCA.map((n, i) => [i, n]), ins.dca, v => patchIns({ dca: Number(v) }), 'What is done to a duplicate'),
        make('span', { textContent: ' fade ' }), number(ins.fade, 0, 8192, v => patchIns({ fade: v }), 'Fadeout speed after the note is released (0: none)', 54)),
    );
    const env = ins[envKind] ?? null;
    const tabs = ENVELOPES.map(kind => { const b = button(doc, ENVELOPE_NAMES[kind], '', () => { envKind = kind; pending = null; refresh(); }); b.style.opacity = kind === envKind ? '1' : '0.55'; return b; });
    const modes = [['point', 'Point'], ['loop', 'Loop'], ['sus', 'Sustain']].map(([m, label]) => { const b = button(doc, label, m === 'point' ? 'Click for a point, drag to move, double-click to remove' : 'Click two points to mark the range', () => { markMode = m; pending = null; refresh(); }); b.style.opacity = markMode === m ? '1' : '0.55'; return b; });
    const parts = [...tabs, check('on', Boolean(env), v => patchEnv(v ? newEnvelope(envKind) : null), 'Use this envelope'), ...modes];
    if (envKind === 'pit') parts.push(check('filter', ins.filter, v => patchIns({ filter: v }), 'The pitch envelope moves the filter cutoff instead of the pitch'));
    insControls.append(row(...parts));
  }

  // what the node reports: where each sounding note is. The panel asks for the reports again every second while it is on the page.
  const feed = msg => {
    heads.clear();
    for (const [uid, headSlot, frame] of msg.heads ?? []) heads.set(uid, { slot: headSlot, frame });
    drawSample();
  };
  const heartbeat = () => { watch(); const timer = doc.defaultView?.setInterval?.(() => { if (!el.isConnected) doc.defaultView.clearInterval(timer); else watch(); }, 1000); };
  el.append(sampleSide, insSide);
  function refresh() { sampleControlsRow(); insControlsRow(); drawSample(); drawEnv(); }
  sampleDrag(); envDrag();
  refresh(); heartbeat();
  return { el, refresh, feed, draw: () => { drawSample(); drawEnv(); } };
}
