// The scope overlay: one big oscilloscope laid over the sequence view, showing the master output. It draws on a canvas that
// does not take the mouse or the keyboard, so the pattern editor works underneath exactly as before. It reads the same
// ring of the last output samples as the meters (see audio/vring.js) and costs nothing while it is off: no frames are
// drawn and the audio thread is told not to write the ring.
//
// createScopeOverlay({ host, over, ring, sampleRate, config }): `host` is the positioned element that holds the sequence view,
// `over` the element it covers (the pattern text), `ring` the shared ring buffer. The settings live in Config:
//   scopeOn, scopeLook (trace | phosphor | xy), scopeAmt (brightness, 10 to 100), scopeWin (milliseconds across, 8 to 58).
import { RING, ringReader } from '../audio/vring.js';

const READER_BIT = 2;   // the meters use bit 1; each reader of the ring has its own
const LEFT = '255,140,20', RIGHT = '40,130,255', XY = '30,170,120';   // left in the accent orange, right in blue, XY in a green (all read on light and dark themes)

export function createScopeOverlay({ host, over, ring, sampleRate, config }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'scope-overlay'; canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  const reader = ringReader(ring, READER_BIT), pull = new Float32Array(RING * 2);
  const left = new Float32Array(RING), right = new Float32Array(RING);   // the newest RING frames, oldest first
  let raf = 0, running = false;

  // Puts the canvas over the pattern text (the host may be scrolled sideways, so the offset follows that).
  function place() {
    canvas.style.left = `${over.offsetLeft}px`; canvas.style.top = `${over.offsetTop}px`;
    canvas.style.width = `${over.offsetWidth}px`; canvas.style.height = `${over.offsetHeight}px`;
    const d = Math.min(2, window.devicePixelRatio || 1), w = Math.round(over.offsetWidth * d), h = Math.round(over.offsetHeight * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  // What came in since the last frame goes on the end of the history.
  function take() {
    const got = reader.read(pull);
    if (!got) return;
    if (got >= RING) { for (let i = 0; i < RING; i++) { left[i] = pull[i * 2]; right[i] = pull[i * 2 + 1]; } return; }
    left.copyWithin(0, got); right.copyWithin(0, got);
    for (let i = 0; i < got; i++) { left[RING - got + i] = pull[i * 2]; right[RING - got + i] = pull[i * 2 + 1]; }
  }

  // The first rising zero crossing in the history that leaves a whole window after it: a steady note then stands still.
  function trigger(win) {
    const from = RING - win - 1, to = Math.max(1, from - 1024);
    for (let i = from; i > to; i--) if (left[i - 1] < 0 && left[i] >= 0) return i;
    return from;
  }

  function draw() {
    const W = over.offsetWidth, H = over.offsetHeight;
    if (!W || !H) return;   // the pattern view is not showing
    const look = config.get('scopeLook'), amt = config.get('scopeAmt') / 100;
    const win = Math.min(RING - 1100, Math.max(64, Math.round(config.get('scopeWin') / 1000 * sampleRate())));
    take();
    if (look === 'trace') ctx.clearRect(0, 0, W, H);
    else { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${look === 'xy' ? 0.22 : 0.16})`; ctx.fillRect(0, 0, W, H); }   // older frames fade away
    ctx.globalCompositeOperation = 'source-over'; ctx.lineJoin = 'round'; ctx.lineWidth = look === 'phosphor' ? 1.8 : 1.3;
    if (look === 'xy') {
      const scale = Math.min(W, H) * 0.46 * 1.6, cx = W / 2, cy = H / 2;
      ctx.strokeStyle = `rgba(${XY},${amt})`; ctx.beginPath();
      for (let i = RING - win; i < RING; i += 2) { const x = cx + left[i] * scale, y = cy - right[i] * scale; i === RING - win ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    } else {
      const s = trigger(win);
      for (const [data, rgb] of [[left, LEFT], [right, RIGHT]]) {
        ctx.strokeStyle = `rgba(${rgb},${amt})`; ctx.beginPath();
        for (let i = 0; i < win; i++) { const x = i / (win - 1) * W, y = H / 2 - data[s + i] * H * 0.42; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function frame() { raf = 0; if (!running) return; place(); draw(); if (!reduce) raf = requestAnimationFrame(frame); }
  function sync() {
    const on = !!config.get('scopeOn');
    canvas.hidden = !on;
    if (on === running) return;
    running = on; reader.enable(on);
    if (on) { left.fill(0); right.fill(0); if (!raf) raf = requestAnimationFrame(frame); }
    else { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  const mine = new Set(['scopeOn', 'scopeLook', 'scopeAmt', 'scopeWin']);
  config.onChange(key => { if (!mine.has(key)) return; if (key === 'scopeLook') ctx.clearRect(0, 0, canvas.width, canvas.height); sync(); if (running && reduce) frame(); });
  sync();
  return { canvas, sync };
}
