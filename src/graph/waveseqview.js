import { makeCanvas, forPage, clamp, ORANGE } from './spaceui.js';
import { createDragNumber } from './dragnumber.js';
import { LANE_COLOURS } from './vectorpad.js';
import { MAX_STEPS, MAX_LEN, LANES, cleanLanes, laneTicks, DEFAULT_STEP } from '../audio/nodes/vectorcore.js';
import { WAVE_COUNT, waveShape } from '../audio/nodes/wavebank.js';
import { FRAME } from '../audio/nodes/wtutil.js';

// The wave sequences of a vector node: one row per lane (four in the compass synth, one in a waveseq node), time running
// to the right in song ticks. Every step shows one cycle of its wave, as tall as its level; the small wedge along its top is
// the crossfade in from the step before. All rows share one scale, so lanes of different lengths show how they drift
// against each other, and a lane that loops is drawn again, faint, after its end.
//   click a step          choose it (its settings are under the rows, each changed by dragging it up or down)
//   drag a step up/down   another wave from the bank
//   drag its right edge   longer or shorter, in ticks
// It is mouse only and never takes the keyboard.
const W = 520, GUTTER = 22, RIGHT = 8, RULER = 16, ROW = 46, EDGE = 5;
const MIN_TICKS = 8, LOOP = 1;
const PIXELS_PER_WAVE = 3;   // how far a drag goes for the next wave

// lanes: the stored lists of steps; count: how many rows; getParam('smode') is read for the faint repeats
export function createWaveSeqView({ doc = document, lanes: stored, count = LANES.length, getParam, onChange }) {
  const H = RULER + count * ROW + 4;
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'waveseq-pad');
  let lanes = cleanLanes(stored, count);
  let chosen = { lane: 0, step: 0 };
  let grab = null;   // { kind: 'wave', from: y, wave } | { kind: 'length', x0 }

  const emit = () => onChange(lanes.map(lane => lane.map(step => ({ ...step, fade: Math.round(step.fade * 100) / 100, lvl: Math.round(step.lvl * 100) / 100 }))));
  const ticksShown = () => Math.max(MIN_TICKS, ...lanes.map(laneTicks));
  const tickWidth = () => (W - GUTTER - RIGHT) / ticksShown();
  const rowTop = lane => RULER + lane * ROW;
  const step = () => lanes[chosen.lane][chosen.step];

  // The steps of a lane as boxes on the canvas: [{ x0, x1 }], in pixels.
  const boxes = lane => {
    const width = tickWidth();
    let at = GUTTER;
    return lanes[lane].map(s => { const x0 = at; at += s.len * width; return { x0, x1: at }; });
  };

  // one cycle of a wave between x0 and x1, centred on `mid`
  function drawWave(wave, x0, x1, mid, height) {
    const shape = waveShape(wave), span = Math.max(2, Math.round(x1 - x0));
    ctx.beginPath();
    for (let px = 0; px <= span; px++) {
      const value = shape[Math.min(FRAME - 1, Math.floor((px / span) * FRAME))];
      const x = x0 + (px / span) * (x1 - x0), y = mid - value * height;
      px ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  function drawRuler(page) {
    const width = tickWidth(), total = ticksShown(), every = total > 64 ? 16 : total > 32 ? 8 : 4;
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = page;
    for (let tick = 0; tick <= total; tick++) {
      const x = Math.round(GUTTER + tick * width), major = tick % every === 0;
      ctx.globalAlpha = major ? 0.6 : 0.3;
      ctx.fillRect(x, RULER - (major ? 5 : 2), 1, major ? 5 : 2);
      if (major && tick < total) { ctx.globalAlpha = 0.75; ctx.fillText(`${tick}`, x + 3, 1); }
    }
  }

  function drawLane(lane, page) {
    const colour = forPage(LANE_COLOURS[lane % LANE_COLOURS.length], page), accent = forPage(ORANGE, page);
    const top = rowTop(lane), mid = top + ROW / 2, tall = ROW / 2 - 9, steps = lanes[lane], placed = boxes(lane);
    if (count > 1) { ctx.globalAlpha = 1; ctx.fillStyle = colour; ctx.font = '11px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'middle'; ctx.fillText(LANES[lane], 4, mid); }
    ctx.globalAlpha = 0.14; ctx.fillStyle = page; ctx.fillRect(GUTTER, Math.round(mid), W - GUTTER - RIGHT, 1);
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textBaseline = 'top';
    steps.forEach((s, i) => {
      const { x0, x1 } = placed[i], isChosen = chosen.lane === lane && chosen.step === i;
      // the crossfade in: a small wedge along the top of the step, as long as the fade
      if (steps.length > 1 && s.fade > 0) {
        const reach = Math.max(2, s.fade * (x1 - x0));
        ctx.globalAlpha = 0.4; ctx.fillStyle = colour;
        ctx.beginPath(); ctx.moveTo(x0 + 1, top + 7); ctx.lineTo(x0 + reach, top + 7); ctx.lineTo(x0 + reach, top + 2); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.lineWidth = isChosen ? 1.8 : 1.2;
      drawWave(s.w, x0 + 2, x1 - 2, mid, tall * Math.max(0.08, s.lvl));
      ctx.globalAlpha = 0.45; ctx.fillStyle = page;
      ctx.fillRect(Math.round(x1), mid - 4, 1, 9);   // where the step ends
      if (s.semi !== 0 && x1 - x0 > 18) { ctx.globalAlpha = 0.7; ctx.fillText(`${s.semi > 0 ? '+' : ''}${s.semi}`, x0 + 3, top + ROW - 15); }
      if (isChosen) { ctx.globalAlpha = 1; ctx.fillStyle = accent; ctx.fillRect(x0 + 1, top + ROW - 3, Math.max(2, x1 - x0 - 2), 2); }
    });
    // a lane that loops, drawn again after its end
    if (steps.length > 1 && Math.round(getParam('smode')) === LOOP) {
      const width = tickWidth(), length = laneTicks(steps) * width;
      ctx.strokeStyle = colour; ctx.lineWidth = 1;
      for (let start = GUTTER + length; start < W - RIGHT - 4; start += length) {
        steps.forEach((s, i) => {
          const x0 = start + (placed[i].x0 - GUTTER), x1 = Math.min(W - RIGHT, start + (placed[i].x1 - GUTTER));
          if (x1 - x0 < 4) return;
          ctx.globalAlpha = 0.22;
          drawWave(s.w, x0 + 2, x1 - 2, mid, tall * Math.max(0.08, s.lvl));
        });
      }
    }
  }

  function draw() {
    if (!ctx) return;
    const page = ink();
    ctx.clearRect(0, 0, W, H);
    drawRuler(page);
    for (let lane = 0; lane < count; lane++) drawLane(lane, page);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------------ the mouse on the rows
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / (r.width || W)), (e.clientY - r.top) * (H / (r.height || H))]; };
  // which step is under (x, y): { lane, step, edge: whether it is on the step's right edge }, or null
  function stepAt(x, y) {
    const lane = Math.floor((y - RULER) / ROW);
    if (lane < 0 || lane >= count) return null;
    const placed = boxes(lane);
    for (let i = 0; i < placed.length; i++) {
      if (Math.abs(x - placed[i].x1) <= EDGE) return { lane, step: i, edge: true };
      if (x >= placed[i].x0 && x < placed[i].x1) return { lane, step: i, edge: false };
    }
    return null;
  }
  canvas.addEventListener('pointerdown', e => {
    const [x, y] = at(e), hit = stepAt(x, y);
    if (!hit) return;
    chosen = { lane: hit.lane, step: hit.step };
    grab = hit.edge ? { kind: 'length', x0: boxes(hit.lane)[hit.step].x0, width: tickWidth() } : { kind: 'wave', from: y, wave: step().w };
    canvas.setPointerCapture?.(e.pointerId); e.preventDefault();
    refreshFields(); draw();
  });
  canvas.addEventListener('pointermove', e => {
    const [x, y] = at(e);
    if (!grab) { canvas.style.cursor = stepAt(x, y)?.edge ? 'ew-resize' : 'ns-resize'; return; }
    if (grab.kind === 'length') step().len = clamp(Math.round((x - grab.x0) / grab.width), 1, MAX_LEN);   // (the scale is the one from when the drag began, so the edge stays under the mouse)
    else step().w = clamp(grab.wave + Math.round((grab.from - y) / PIXELS_PER_WAVE), 0, WAVE_COUNT - 1);
    emit(); refreshFields(); draw();
  });
  const release = () => { grab = null; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);

  // ------------------------------------------------------------------------------------ the chosen step's settings, in words
  const change = (key, value) => { step()[key] = value; emit(); draw(); };
  const fields = [
    createDragNumber({ doc, label: 'wave', title: 'Which wave of the bank this step plays (drag up or down)', get: () => step().w, set: v => change('w', v), min: 0, max: WAVE_COUNT - 1, format: v => `${v}`.padStart(3, '0') }),
    createDragNumber({ doc, label: 'length', title: 'How long the step lasts, in song ticks', get: () => step().len, set: v => change('len', v), min: 1, max: MAX_LEN, perPixel: 0.15, reset: 4, format: v => `${v} t` }),
    createDragNumber({ doc, label: 'fade', title: 'How much of the step is spent crossfading in from the step before: 0 switches at once', get: () => step().fade, set: v => change('fade', v), min: 0, max: 1, step: 0.01, perPixel: 0.01, reset: 0.5, format: v => `${Math.round(v * 100)}%` }),
    createDragNumber({ doc, label: 'pitch', title: 'This step, in semitones away from the note', get: () => step().semi, set: v => change('semi', v), min: -24, max: 24, perPixel: 0.15, reset: 0, format: v => `${v > 0 ? '+' : ''}${v} st` }),
    createDragNumber({ doc, label: 'level', title: 'How loud this step is', get: () => step().lvl, set: v => change('lvl', v), min: 0, max: 1, step: 0.01, perPixel: 0.01, reset: 1, format: v => `${Math.round(v * 100)}%` }),
  ];
  const name = doc.createElement('span'); name.className = 'waveseq-name';
  const button = (label, title, onClick) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.addEventListener('click', onClick); return b; };
  const edit = fn => { fn(lanes[chosen.lane]); chosen.step = clamp(chosen.step, 0, lanes[chosen.lane].length - 1); emit(); refreshFields(); draw(); };
  const add = button('add step', 'A copy of the chosen step, put after it', () => edit(lane => { if (lane.length < MAX_STEPS) { lane.splice(chosen.step + 1, 0, { ...step() }); chosen.step++; } }));
  const remove = button('remove', 'Take the chosen step out of its lane', () => edit(lane => { if (lane.length > 1) lane.splice(chosen.step, 1); }));
  const earlier = button('earlier', 'Move the chosen step one place towards the start', () => edit(lane => { if (chosen.step > 0) { const [s] = lane.splice(chosen.step, 1); lane.splice(--chosen.step, 0, s); } }));
  const later = button('later', 'Move the chosen step one place towards the end', () => edit(lane => { if (chosen.step < lane.length - 1) { const [s] = lane.splice(chosen.step, 1); lane.splice(++chosen.step, 0, s); } }));
  const single = button('one step', 'Back to a single step: the lane is a plain oscillator again', () => edit(lane => { lane.splice(0, lane.length, DEFAULT_STEP(step().w)); chosen.step = 0; }));
  function refreshFields() {
    name.textContent = `${count > 1 ? LANES[chosen.lane] : 'step '}${chosen.step + 1}`;
    if (name.style) name.style.color = LANE_COLOURS[chosen.lane % LANE_COLOURS.length];
    for (const f of fields) f.refresh();
  }
  const row = doc.createElement('div'); row.className = 'osc-wave-row waveseq-fields';
  row.append(name, ...fields.map(f => f.el));
  const buttons = doc.createElement('div'); buttons.className = 'osc-wave-row';
  buttons.append(add, remove, earlier, later, single);
  const el = doc.createElement('div'); el.className = 'waveseq-view';
  el.append(canvas, row, buttons);
  refreshFields(); draw();
  return { el, draw, refresh: draw };
}
