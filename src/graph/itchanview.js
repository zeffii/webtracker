import { makeCanvas, drag, button, forPage, clamp, PINK } from './spaceui.js';
import { sizeOf, place } from './itchanlayout.js';
import { computePeaks } from '../project/waveform.js';
import {
  ENVELOPES, ENVELOPE_NAMES, proxyOf, rangeOf, loopsOf, moveRangeEdge, moveLoop, setLoop, setTrack, TRACK_MODES, clearProxy,
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
const { w: SW, h: SH } = sizeOf('wave'), { w: EW, h: EH } = sizeOf('envgraph'), PL = 6, PR = 6;
// The screen is one size, with everything on it at once, each part where itchanlayout.js puts it: a window like an LCD's.
const GRAB = 7;
let BLUE = '#9fefff', ORANGE = '#ffd86b';   // loop and sustain on the screen: cyan and yellow on a dark one (see applyLcd)
const LCD_KEY = 'wax.itchanLcdColour', LCD_DEFAULT = '#3d5a99';   // the screen's colour: change it with the swatch on the title bar
const OVERLAY = { vol: '#ffffff', pan2: '#ff9ec0', pit: '#8fffd0' };   // an envelope's colour when it is behind the chosen one
const ENV_TOP = 14, ENV_BOTTOM = 30;   // the room above the envelope for its name, and below it for the tick and time rulers
const NNA = ['cut', 'cont', 'off', 'fade'], DCT = ['off', 'note', 'smpl', 'inst'], DCA = ['cut', 'off', 'fade'];   // short, to fit the row

// A colour for each sounding note's playhead: vivid, and far from the colour of the one before (the golden angle round the hue wheel).
export const headColour = uid => `hsl(${Math.round((uid * 137.508) % 360)} 92% 62%)`;

export function createItChanView({ getTiming = () => null, doc = document, getData, setData, getSampleIds, getSample, isIt3 = () => false, watch = () => {} }) {
  const el = doc.createElement('div'); el.className = 'curve-editor drum2 itchan-panel itchan-lcd'; el.tabIndex = 0;
  // The screen's colours all come from one: the text is light or dark to suit it, and the edge, the fields and the lines are mixed from it.
  let lcdColour = LCD_DEFAULT;
  try { const saved = localStorage.getItem(LCD_KEY); if (/^#[0-9a-f]{6}$/i.test(saved ?? '')) lcdColour = saved; } catch { /* no storage */ }
  const applyLcd = colour => {
    lcdColour = colour;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16)), light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
    const fg = light ? '#14181f' : '#f2f6ff', mix = (amount, towards) => `color-mix(in srgb, ${colour} ${100 - amount}%, ${towards})`;
    BLUE = light ? '#0b6e8c' : '#9fefff'; ORANGE = light ? '#9a5200' : '#ffd86b';
    el.style.setProperty('--lcd-loop', BLUE); el.style.setProperty('--lcd-sus', ORANGE); el.style.setProperty('--lcd-bg', colour); el.style.setProperty('--lcd-fg', fg);
    el.style.setProperty('--lcd-edge', mix(35, '#000000')); el.style.setProperty('--lcd-field', mix(22, '#000000'));
    el.style.setProperty('--lcd-line', mix(55, light ? '#000000' : '#ffffff'));
  };
  applyLcd(lcdColour);
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
  // `onLive` (optional) follows the number while it is being typed or stepped: on every third change, and once it has stopped
  // changing for a moment, so the picture keeps up without the controls being rebuilt under the user's hand
  const number = (value, min, max, onPick, title = '', width = 62, onLive = null) => {
    const n = make('input', { type: 'number', min, max, value, title }); n.style.width = `${width}px`;
    const current = () => clamp(Math.round(Number(n.value) || 0), min, max);
    let changes = 0, idle = null;
    if (onLive) n.addEventListener('input', () => {
      clearTimeout(idle); idle = setTimeout(() => onLive(current()), 150);
      if (++changes % 3 === 0) onLive(current());
    });
    n.addEventListener('change', () => { clearTimeout(idle); onPick(current()); }); return n;
  };

  // ---- the sample area ----------------------------------------------------------------------------------------------------
  const stage = make('div', { className: 'itchan-stage' });   // everything on the screen, each part placed by itchanlayout.js
  const at = (id, item) => { place(item, id); stage.append(item); return item; };
  const cell = (id, className = 'itchan-cell') => at(id, make('div', { className }));
  const { canvas: sampleCanvas, ctx: sctx, ink: sink } = makeCanvas(doc, SW, SH, 'itchan-sample');
  at('wave', sampleCanvas);
  const list = cell('samples', 'itchan-loaded');   // the samples this node plays: one row each, so it is empty until one is added
  list.tabIndex = 0;
  const loopHold = cell('loop'), susHold = cell('sustain'), susPitchHold = cell('susPitch');
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
    if (!bank) { sctx.fillStyle = page; sctx.globalAlpha = 0.6; sctx.fillText('No sample in this slot: add one to the machine.', PL, 6); sctx.globalAlpha = 1; return; }
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
      // the height of the playhead is the note's volume from its envelope and fadeout: a faint full-height line, the level drawn over it from the bottom
      const top = SH - Math.max(2, Math.min(1, head.level) * SH);
      sctx.fillStyle = headColour(uid); sctx.globalAlpha = 0.25; sctx.fillRect(x, 0, 1, SH);
      sctx.globalAlpha = 1; sctx.fillRect(x - 1, top, 2, SH - top);
      sctx.beginPath(); sctx.moveTo(x - 5, top); sctx.lineTo(x + 5, top); sctx.lineTo(x, top + 7); sctx.fill();
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
        // a press on a loop's own band (not its edges) takes the whole loop: it slides, its length unchanged
        if (!held) for (const [which, info, lane] of [['loop', loopsOf(bank, proxyOf(data, slot)).loop, 1], ['sus', loopsOf(bank, proxyOf(data, slot)).sus, 14]]) {
          if (info.active && y >= lane && y <= lane + 10 && x > xOf(info.start) && x < xOf(info.end)) { held = { slide: which, grab: frameOf(x) - info.start }; break; }
        }
        if (!held) made = { which: sampleCanvas.dataset.shift === '1' ? 'sus' : 'loop', from: frameOf(x) };
        return true;
      },
      move: x => {
        const bank = bankOf(); if (!bank) return;
        const length = bank.data.length, frame = frameOf(x);
        if (held?.slide) setData(moveLoop(getData(), slot, held.slide, bank, frame - held.grab));
        else if (held) {
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
    for (const hold of [loopHold, susHold, susPitchHold]) hold.replaceChildren();
    const pitchParts = [];
    const ids = getSampleIds(), bank = bankOf(), data = getData();
    if (!ids.length) return;
    slot = clamp(slot, 0, ids.length - 1);
    if (!bank) return;
    const { loop, sus } = loopsOf(bank, proxyOf(data, slot));
    const frames = n => String(Math.round(n)).padStart(4, '0');
    const loopRow = (label, which, info, tip, colour) => {
      const off = !info.on, patchLoop = change => { setData(setLoop(getData(), slot, which, bank, change)); refresh(); };
      const dimmed = el => { if (off) el.classList.add('off'); return el; };   // what belongs to a loop that is not on is greyed
      const parts = [
        check(label.padEnd(7), info.on, v => patchLoop({ on: v }), tip),
        dimmed(make('span', { textContent: info.active ? ` ${frames(info.start)}‥${frames(info.end)} ` : info.on && info.exists && !info.inside ? ' outside the stretch ' : ' ····‥···· ' })),
        dimmed(check('ping', info.pingpong, v => patchLoop({ pingpong: v }), 'Play the loop forwards and back')),
      ];
      if (isIt3()) parts.push(dimmed(make('span', { textContent: ' xf ' })), dimmed(number(info.xfade, 0, 1 << 20, v => patchLoop({ xfade: v }), 'Crossfade at the loop seam, in frames (IT 3)', 52, v => { setData(setLoop(getData(), slot, which, bank, { xfade: v })); drawSample(); })));
      if (isIt3() && which === 'sus') {   // the width of the sustain loop follows the pitch of the note
        const mode = info.track?.mode ?? 'off', amount = info.track?.amount ?? 1;
        const readout = make('span', { textContent: ` ${amount.toFixed(2)}` });
        const slider = make('input', { type: 'range', min: -2, max: 2, step: 0.05, value: amount, title: 'Octaves of loop width for each octave of pitch: 1 keeps the loop the same length in time, 0 the same in frames' });
        slider.style.width = '64px'; slider.disabled = mode === 'off' || off;
        slider.addEventListener('input', () => { readout.textContent = ` ${Number(slider.value).toFixed(2)}`; setData(setTrack(getData(), slot, which, bank, mode, Number(slider.value))); });
        const modeNames = { off: 'constant', center: 'centre', left: 'left', right: 'right' };
        pitchParts.push(dimmed(make('span', { textContent: 'sustain pitch ' })), dimmed(select(TRACK_MODES.map(m => [m, modeNames[m]]), mode, v => { setData(setTrack(getData(), slot, which, bank, v, amount)); refresh(); }, 'How the sustain loop grows and shrinks with the pitch of the note (IT 3): about its centre, or with its left or right end held')), dimmed(slider), dimmed(readout));
      }
      const line = row(...parts);
      line.style.color = colour === BLUE ? 'var(--lcd-loop)' : 'var(--lcd-sus)'; line.style.accentColor = line.style.color;   // the colour this loop has in the waveform
      return line;
    };
    loopHold.append(loopRow('loop', 'loop', loop, 'The loop that plays while the note is held, or after the sustain loop', BLUE));
    susHold.append(loopRow('sustain', 'sus', sus, 'The loop that plays only while the key is held', ORANGE));
    if (pitchParts.length) susPitchHold.append(row(...pitchParts));
  }

  // ---- the instrument side ------------------------------------------------------------------------------------------------
  const { canvas: envCanvas, ctx: ectx, ink: eink } = makeCanvas(doc, EW, EH, 'itchan-env');
  at('envgraph', envCanvas);
  const insHold = cell('ins'), nnaHold = cell('nna'), playsHold = cell('plays'), modeHold = cell('mode'), rateHold = cell('rate'), envListHold = cell('envlist');

  const current = () => getData()?.ins?.[insIndex] ?? null;
  const patchIns = patch => { setData(withInstrument(getData(), insIndex, patch)); refresh(); };
  const patchEnv = env => patchIns({ [envKind]: env });

  // The span on show is the envelope's length with some room, and is held still while a point is being dragged (the last point would
  // otherwise rescale the picture under the pointer); it is worked out afresh when the drag ends.
  let heldSpan = null;
  const spanOf = () => Math.max(64, Math.ceil(Math.max(0, ...ENVELOPES.map(kind => current()?.[kind]).filter(Boolean).map(e => e.pts[e.pts.length - 2])) * 1.15));   // the longest of the instrument's envelopes: they share the ticks
  const envLayout = env => {
    const span = heldSpan ?? spanOf(), tall = EH - ENV_BOTTOM - ENV_TOP;
    return { span, X: tick => PL + tick / span * (EW - PL - PR), Y: v => EH - ENV_BOTTOM - v / 64 * tall, tickAt: x => (clamp(x, PL, EW - PR) - PL) / (EW - PL - PR) * span, valueAt: y => (EH - ENV_BOTTOM - y) / tall * 64 };
  };
  const ENV_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
  const clockText = (ms, inMs) => (inMs ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`);

  // The rulers: a line at every step of ticks that is wide enough to see, labelled at the wider steps, with the time each is at
  // (given the song's tempo and the envelope's rate) under it, in milliseconds while the picture is short and in seconds when not.
  function drawEnvRulers(env, L, page) {
    const width = EW - PL - PR, perTick = width / L.span, timing = getTiming(), rate = env.rate ?? 1;
    const minor = ENV_STEPS.find(n => n * perTick >= 7) ?? ENV_STEPS.at(-1), major = ENV_STEPS.find(n => n * perTick >= 46) ?? ENV_STEPS.at(-1);
    const inMs = timing ? L.span / rate * timing.tickMs < 2000 : false;
    ectx.fillStyle = page; ectx.globalAlpha = 0.07;
    for (let t = 0; t <= L.span; t += minor) ectx.fillRect(Math.round(L.X(t)), ENV_TOP, 1, EH - ENV_BOTTOM - ENV_TOP);
    ectx.globalAlpha = 0.16;
    for (let t = 0; t <= L.span; t += major) ectx.fillRect(Math.round(L.X(t)), ENV_TOP, 1, EH - ENV_BOTTOM - ENV_TOP + 4);
    ectx.globalAlpha = 0.6; ectx.textAlign = 'left';
    for (let t = 0; t <= L.span; t += major) {
      const x = L.X(t); if (x > EW - PR - 34) break;
      ectx.fillText(`${t}`, x + 2, EH - ENV_BOTTOM + 4);
      if (timing) ectx.fillText(clockText(t / rate * timing.tickMs, inMs), x + 2, EH - ENV_BOTTOM + 15);
    }
    ectx.textAlign = 'right'; ectx.globalAlpha = 0.45; ectx.fillText(timing ? 'ticks / time' : 'ticks', EW - PR, 2);
  }

  function drawEnv() {
    if (!ectx) return;
    const page = eink(), env = current()?.[envKind] ?? null;
    ectx.clearRect(0, 0, EW, EH);
    ectx.font = '10px ui-monospace, Consolas, monospace'; ectx.textBaseline = 'top'; ectx.textAlign = 'left';
    ectx.fillStyle = page; ectx.globalAlpha = 0.65;
    ectx.fillText(`${ENVELOPE_NAMES[envKind].toUpperCase()}${envKind === 'pit' && current()?.filter ? ' (filter cutoff)' : ''}`, PL, 2);
    if (!env) { ectx.fillText('off: press its key below to draw one', PL, EH / 2); ectx.globalAlpha = 1; return; }
    const L = envLayout(env);
    drawEnvRulers(env, L, page);
    ectx.fillStyle = page; ectx.globalAlpha = 0.12; ectx.fillRect(PL, L.Y(32), EW - PL - PR, 1);
    const pts = []; for (let i = 0; i < env.pts.length; i += 2) pts.push([L.X(env.pts[i]), L.Y(env.pts[i + 1])]);
    const span = (from, to, colour) => {
      if (from < 0 || to < 0 || !pts[from] || !pts[to]) return;
      ectx.globalAlpha = 0.16; ectx.fillStyle = forPage(colour, page); ectx.fillRect(pts[from][0], ENV_TOP, Math.max(2, pts[to][0] - pts[from][0]), EH - ENV_BOTTOM - ENV_TOP);
      ectx.globalAlpha = 0.9; ectx.fillRect(pts[from][0] - 1, ENV_TOP, 2, EH - ENV_BOTTOM - ENV_TOP); ectx.fillRect(pts[to][0] - 1, ENV_TOP, 2, EH - ENV_BOTTOM - ENV_TOP);
    };
    span(env.ls, env.le, BLUE); span(env.ss, env.se, ORANGE);
    for (const kind of ENVELOPES) {   // the instrument's other envelopes, faint behind the chosen one
      const other = current()?.[kind]; if (kind === envKind || !other) continue;
      ectx.globalAlpha = 0.35; ectx.strokeStyle = OVERLAY[kind]; ectx.fillStyle = OVERLAY[kind]; ectx.lineWidth = 1.4; ectx.beginPath();
      for (let i = 0; i < other.pts.length; i += 2) ectx[i ? 'lineTo' : 'moveTo'](L.X(other.pts[i]), L.Y(other.pts[i + 1]));
      ectx.stroke();
      for (let i = 0; i < other.pts.length; i += 2) { ectx.beginPath(); ectx.arc(L.X(other.pts[i]), L.Y(other.pts[i + 1]), 2.6, 0, Math.PI * 2); ectx.fill(); }
    }
    ectx.fillStyle = page;
    ectx.globalAlpha = 1; ectx.strokeStyle = page; ectx.lineWidth = 1.8; ectx.beginPath();
    pts.forEach(([x, y], i) => (i ? ectx.lineTo(x, y) : ectx.moveTo(x, y))); ectx.stroke();
    ectx.fillStyle = page;
    pts.forEach(([x, y], i) => { ectx.beginPath(); ectx.arc(x, y, i === pending ? 5 : 3.5, 0, Math.PI * 2); ectx.fill(); });
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
        if (index >= 0) { held = index; heldSpan = L.span; return true; }
        const added = addPoint(env, L.tickAt(x), L.valueAt(y));
        if (added.index < 0) return false;
        held = added.index; heldSpan = L.span; patchEnv(added.env); return true;
      },
      move: (x, y) => {
        const env = current()?.[envKind]; if (!env || held < 0) return;
        const L = envLayout(env);
        patchEnv(movePoint(env, held, L.tickAt(x), L.valueAt(y)));
      },
      done: () => { held = -1; heldSpan = null; drawEnv(); },
    });
    envCanvas.addEventListener('dblclick', e => {
      const r = envCanvas.getBoundingClientRect(), x = (e.clientX - r.left) * (EW / (r.width || EW)), y = (e.clientY - r.top) * (EH / (r.height || EH));
      const index = hit(x, y), env = current()?.[envKind];
      if (index >= 0 && env) patchEnv(removePoint(env, index));
    });
  }

  function insControlsRow() {
    for (const hold of [insHold, nnaHold, playsHold, modeHold, rateHold, envListHold]) hold.replaceChildren();
    const data = getData(), count = getSampleIds().length;
    if (!Array.isArray(data?.ins) || !data.ins.length) {
      envListHold.append(make('div', { className: 'dim', textContent: 'a note plays the sample with its number' }),
        button(doc, 'Use instruments', 'Make an instrument for each sample, so notes can have envelopes, keymaps and note actions. Nothing sounds different until you edit one.', () => { setData({ ...getData(), ins: instrumentsFor(count) }); insIndex = 0; refresh(); }));
      return;
    }
    insIndex = clamp(insIndex, 0, data.ins.length - 1);
    const ins = current() ?? newInstrument(0);
    const names = data.ins.map((_, i) => [i, `${(i + 1).toString(16).toUpperCase().padStart(2, '0')}`]);
    const slots = getSampleIds().map((id, i) => [i, `${i.toString(16).toUpperCase().padStart(2, '0')} ${id}`]);
    insHold.append(
      row(make('span', { textContent: 'ins ' }), select(names, insIndex, v => { insIndex = Number(v); pending = null; refresh(); }, 'The instrument: the Ins value of a cell, 01 being the first'),
        button(doc, '+', 'Add an instrument', () => { setData(withInstrument(getData(), getData().ins.length, newInstrument(clamp(slot, 0, Math.max(0, count - 1))))); insIndex = getData().ins.length - 1; refresh(); })),
      row(make('span', { textContent: 'fade ' }), number(ins.fade, 0, 8192, v => patchIns({ fade: v }), 'Fadeout speed after the note is released (0: none)', 40)));
    playsHold.append(row(make('span', { textContent: 'plays ' }), select(slots, ins.map?.[60] ?? 0, v => patchIns({ map: new Array(120).fill(Number(v)) }), 'The sample every key plays (a keymap with several samples comes from an imported file)')));
    nnaHold.append(row(make('span', { textContent: 'new ' }), select(NNA.map((n, i) => [i, n]), ins.nna, v => patchIns({ nna: Number(v) }), 'What happens to a note still playing when a new one starts on the channel'),
      make('span', { textContent: ' dup ' }), select(DCT.map((n, i) => [i, n]), ins.dct, v => patchIns({ dct: Number(v) }), 'The duplicate check: which notes count as a duplicate'),
      make('span', { textContent: '→' }), select(DCA.map((n, i) => [i, n]), ins.dca, v => patchIns({ dca: Number(v) }), 'What is done to a duplicate')));
    const rangeText = (e, from, to) => (e && e[from] >= 0 && e[to] >= 0 ? `${e.pts[e[from] * 2]}‥${e.pts[e[to] * 2]}` : '·');
    const rateSlider = (kind, e) => {   // how fast the note travels through the envelope: 1 is IT's own speed, a tick of the song moves it that far
      const readout = make('span', { textContent: ` ${(e.rate ?? 1).toFixed(2)}x` });
      const slider = make('input', { type: 'range', min: -3, max: 3, step: 0.05, value: Math.log2(e.rate ?? 1), title: 'Rate: how fast the note travels through this envelope (1x is the IT speed; 2x takes half the time). Double-click for 1x' });
      slider.style.width = '150px';
      const rateNow = () => (Math.abs(Number(slider.value)) < 0.025 ? 1 : 2 ** Number(slider.value));
      slider.addEventListener('input', () => { const rate = rateNow(); readout.textContent = ` ${rate.toFixed(2)}x`; setData(withInstrument(getData(), insIndex, { [kind]: { ...(current()?.[kind] ?? e), rate } })); drawEnv(); });
      slider.addEventListener('change', () => refresh());
      slider.addEventListener('dblclick', () => { envKind = kind; patchEnv({ ...e, rate: 1 }); });
      return [slider, readout];
    };
    const env = ins[envKind] ?? null;
    rateHold.append(row(make('span', { textContent: `rate ${ENVELOPE_NAMES[envKind].slice(0, 3).toLowerCase()} ` }), ...(env ? rateSlider(envKind, env) : [make('span', { className: 'dim', textContent: '·' })])));
    // the envelopes as a list: a box to switch each on, how many points, its loop and sustain; the chosen row is the one drawn below
    const envList = make('div', { className: 'itchan-envlist' });
    const header = row(...['', '', 'n', 'loop', 'sust'].map(text => make('span', { className: 'dim', textContent: text })));
    header.classList.add('itchan-envrow');
    envList.append(header);
    for (const kind of ENVELOPES) {
      const e = ins[kind] ?? null, off = !e;
      const grey = item => { if (off) item.classList.add('off'); return item; };
      const loopText = make('span', { textContent: rangeText(e, 'ls', 'le') }), susText = make('span', { textContent: rangeText(e, 'ss', 'se') });
      loopText.style.color = kind === envKind ? 'color-mix(in srgb, var(--lcd-loop) 40%, var(--lcd-bg))' : 'var(--lcd-loop)'; susText.style.color = kind === envKind ? 'color-mix(in srgb, var(--lcd-sus) 40%, var(--lcd-bg))' : 'var(--lcd-sus)';   // darker on the chosen row, which is shown inverted
      const line = row(
        make('span', { textContent: kind === envKind ? '▸' : ' ' }),
        check(ENVELOPE_NAMES[kind].slice(0, 3).toLowerCase(), !off, v => { envKind = kind; pending = null; patchEnv(v ? newEnvelope(kind) : null); }, `Use the ${ENVELOPE_NAMES[kind].toLowerCase()} envelope`),
        grey(make('span', { textContent: e ? String(e.pts.length / 2) : '·' })), grey(loopText), grey(susText));
      line.classList.add('itchan-envrow'); if (kind === envKind) line.classList.add('on');
      line.addEventListener('mousedown', ev => { if (ev.target.closest?.('input, select, button') || kind === envKind) return; envKind = kind; pending = null; refresh(); });
      envList.append(line);
    }
    envListHold.append(envList);
    const modes = [['point', 'Point'], ['loop', 'Loop'], ['sus', 'Sust']].map(([m, label]) => { const b = button(doc, label, m === 'point' ? 'Click for a point, drag to move, double-click to remove' : 'Click two points to mark the range', () => { markMode = m; pending = null; refresh(); }); b.style.opacity = !env ? '0.35' : markMode === m ? '1' : '0.55'; return b; });
    modeHold.append(row(make('span', { className: 'dim', textContent: `${ENVELOPE_NAMES[envKind].slice(0, 3).toLowerCase()} edit ` }), ...modes));
  }

  // what the node reports: where each sounding note is. The panel asks for the reports again every second while it is on the page.
  const feed = msg => {
    heads.clear();
    for (const [uid, headSlot, frame, level = 1] of msg.heads ?? []) heads.set(uid, { slot: headSlot, frame, level });
    drawSample();
  };
  const heartbeat = () => { watch(); const timer = doc.defaultView?.setInterval?.(() => { if (!el.isConnected) doc.defaultView.clearInterval(timer); else watch(); }, 1000); };
  // ---- the screen: the title over the waveform, and the function keys ---------------------------------------------------------------
  // F1 to F8 are the keys under the screen, each acting on what is on it; a key that switches something on is lit while it is on.
  const head = cell('title', 'itchan-head'), fkeys = cell('fkeys', 'itchan-fkeys');
  const cycle = (list, value) => (value + 1) % list.length;
  const keyDefs = () => {
    const data = getData(), bank = bankOf(), ins = current(), hasIns = Array.isArray(data?.ins) && data.ins.length > 0;
    const loops = bank ? loopsOf(bank, proxyOf(data, slot)) : null;
    const toggleEnv = kind => {
      const e = ins?.[kind] ?? null;
      return { label: { vol: 'vol', pan2: 'pan', pit: 'pit' }[kind], on: Boolean(e), sel: kind === envKind, tip: `Use the ${ENVELOPE_NAMES[kind].toLowerCase()} envelope (press again, once chosen, to switch it off)`,
        act: () => { if (!hasIns) return; if (kind !== envKind) { envKind = kind; pending = null; if (!e) patchEnv(newEnvelope(kind)); else refresh(); } else patchEnv(e ? null : newEnvelope(kind)); } };
    };
    return [...ENVELOPES.map(toggleEnv),
      { label: 'flt', on: Boolean(ins?.filter), tip: 'The pitch envelope moves the filter cutoff instead of the pitch', act: () => hasIns && patchIns({ filter: !ins?.filter }) },
      { label: 'loop', on: Boolean(loops?.loop.on), tip: 'The loop on or off', act: () => bank && (setData(setLoop(getData(), slot, 'loop', bank, { on: !loops.loop.on })), refresh()) },
      { label: 'sust', on: Boolean(loops?.sus.on), tip: 'The sustain loop on or off', act: () => bank && (setData(setLoop(getData(), slot, 'sus', bank, { on: !loops.sus.on })), refresh()) },
      { label: 'zoom', on: zoom, tip: 'Show only the stretch this slot plays', act: () => { zoom = !zoom; refresh(); } },
      { label: 'bank', tip: 'Back to the bank sample\'s own stretch and loops', act: () => { setData(clearProxy(getData(), slot)); refresh(); } }];
  };
  const renderScreen = () => {
    const ids = getSampleIds(); head.replaceChildren();
    if (ids.length) { const n = clamp(slot, 0, ids.length - 1); head.append(make('span', { className: 'itchan-title', textContent: ` ${n.toString(16).toUpperCase().padStart(2, '0')} ${ids[n]} ` })); }
    const swatch = make('input', { type: 'color', className: 'itchan-swatch', value: lcdColour, title: 'The screen\'s colour (double-click for the usual one)' });
    swatch.addEventListener('input', () => { applyLcd(swatch.value); try { localStorage.setItem(LCD_KEY, swatch.value); } catch { /* no storage */ } drawSample(); drawEnv(); });
    swatch.addEventListener('dblclick', () => { applyLcd(LCD_DEFAULT); try { localStorage.removeItem(LCD_KEY); } catch { /* no storage */ } refresh(); });
    head.append(swatch);
    fkeys.replaceChildren(...keyDefs().map((key, i) => {
      const b = make('button', { type: 'button', textContent: key.label, title: key.blank ? '' : `F${i + 1}  ${key.tip ?? ''}` });
      b.className = `${key.on ? 'on' : ''} ${key.sel ? 'sel' : ''} ${key.label && key.on === false ? 'off' : ''}`.trim();
      b.addEventListener('click', () => key.act?.());
      return b;
    }));
  };
  el.addEventListener('keydown', e => {
    const n = /^F([1-8])$/.exec(e.key)?.[1]; if (!n || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation(); keyDefs()[Number(n) - 1]?.act?.();
  });
  el.append(stage);
  const renderList = () => {
    const ids = getSampleIds();
    list.replaceChildren(...ids.map((id, i) => {
      const row_ = make('div', { className: `itchan-loaded-row${i === slot ? ' on' : ''}`, textContent: `${i.toString(16).toUpperCase().padStart(2, '0')} ${id}`, title: 'Show this sample' });
      row_.addEventListener('mousedown', () => { slot = i; refresh(); });
      return row_;
    }));
  };
  function refresh() { renderList(); renderScreen(); sampleControlsRow(); insControlsRow(); drawSample(); drawEnv(); }
  sampleDrag(); envDrag();
  refresh(); heartbeat();
  return { el, refresh, feed, draw: () => { drawSample(); drawEnv(); } };
}
