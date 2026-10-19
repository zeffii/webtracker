// The vectorscope overlay: left against right, turned 45 degrees (a mono sound is a vertical line, a wide one spreads
// sideways, out of phase lies flat), drawn as a glowing line that fades. It reads the ring of output samples once per
// frame and does nothing at all while hidden.
import { RING, ringReader } from '../audio/vring.js';

const TAU = Math.PI * 2;

export function createVectorscope({ box, canvas, sab, options = () => ({ linger: 12, glow: 55 }) }) {
  const reader = ringReader(sab), g = canvas.getContext('2d'), buf = new Float32Array(RING * 2);
  let raf = 0, open = false;

  function size() {
    const dpr = devicePixelRatio || 1, s = Math.max(40, Math.round(box.clientWidth * dpr));
    if (canvas.width !== s) { canvas.width = canvas.height = s; }
    return [dpr, s];
  }

  function graticule(S, dpr) {
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.beginPath();
    g.moveTo(S / 2, S * .06); g.lineTo(S / 2, S * .94); g.moveTo(S * .06, S / 2); g.lineTo(S * .94, S / 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath();
    g.moveTo(S * .14, S * .14); g.lineTo(S * .86, S * .86); g.moveTo(S * .86, S * .14); g.lineTo(S * .14, S * .86); g.stroke();
    g.beginPath(); g.arc(S / 2, S / 2, S * .38, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.3)'; g.font = `${10 * dpr}px monospace`;
    g.fillText('M', S / 2 + 4 * dpr, S * .06 + 9 * dpr); g.fillText('L', S * .1, S * .1 + 4 * dpr); g.fillText('R', S * .9 - 8 * dpr, S * .1 + 4 * dpr);
  }

  function frame() {
    if (!open) return;
    const [dpr, S] = size(), { linger, glow } = options(), glowK = glow / 100, lin = linger / 100;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(6,7,10,${Math.max(.04, .5 - lin * 1.5)})`; g.fillRect(0, 0, S, S);
    graticule(S, dpr);
    const n = reader.read(buf);
    if (n > 0) {
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = 1.2 * dpr; g.strokeStyle = `rgba(120,255,170,${.35 + .4 * glowK})`;
      g.shadowColor = 'rgba(80,255,150,.9)'; g.shadowBlur = (2 + 10 * glowK) * dpr;
      g.beginPath();
      const step = n > 1500 ? 2 : 1, R = S * .38;   // a long gap (a slow frame) is thinned rather than drawn in full
      for (let i = 0; i < n; i += step) {
        const l = buf[i * 2], r = buf[i * 2 + 1];
        const x = S / 2 + Math.max(-1.2, Math.min(1.2, (l - r) * .7071)) * R, y = S / 2 - Math.max(-1.2, Math.min(1.2, (l + r) * .7071)) * R;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    get open() { return open; },
    show() { if (open) return; open = true; box.hidden = false; g.clearRect(0, 0, canvas.width, canvas.height); reader.enable(true); raf = requestAnimationFrame(frame); },
    hide() { open = false; box.hidden = true; reader.enable(false); cancelAnimationFrame(raf); },
  };
}
