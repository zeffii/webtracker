import { makeCanvas, forPage, ORANGE, BLUE } from './spaceui.js';
import { ROTORS, SPEEDS, nextRotorSpeed, targetSpeed } from '../audio/nodes/rotary.js';

// The rotary speaker's panel: the cabinet seen from above. The horn (top of the sound) and the drum (bottom of the sound) turn at the
// speeds the node's rotors have, worked out here by the same rule the node uses, so you see them glide when the switch moves. The two dots
// under each rotor are the microphones; `spread` moves them apart. The three words under the picture are the switch.
// It is mouse only and never takes the keyboard.
const W = 300, H = 170, RADIUS = 46, CY = 70;
const CENTRES = { horn: 82, drum: 218 };
const COLOURS = { horn: ORANGE, drum: BLUE };

export function createRotaryView({ doc = document, getParam, setParam }) {
  const el = doc.createElement('div'); el.className = 'rotary-panel';
  const { canvas, ctx, ink } = makeCanvas(doc, W, H, 'rotary-pad');
  const turning = { horn: { angle: 0, speed: 0 }, drum: { angle: 0.5, speed: 0 } };   // angle in turns, speed in Hz
  let last = null;

  function drawRotor(name, page) {
    const state = turning[name], cx = CENTRES[name], colour = forPage(COLOURS[name], page);
    const a = state.angle * 2 * Math.PI - Math.PI / 2;   // 0 points down, at the microphones
    ctx.lineWidth = 1; ctx.strokeStyle = page; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(cx, CY, RADIUS, 0, 7); ctx.stroke();
    // the speaker: a line from the middle to the rim, with a dot where the sound leaves
    const x = cx + Math.cos(-a) * RADIUS, y = CY - Math.sin(-a) * RADIUS;
    ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, CY); ctx.lineTo(x, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, CY, 2, 0, 7); ctx.fill();
    // the microphones, in front (below), `spread` apart
    const off = getParam('spread') * 0.25 * 2 * Math.PI;
    ctx.fillStyle = page; ctx.globalAlpha = 0.8;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + Math.sin(side * off) * (RADIUS + 12), CY + Math.cos(side * off) * (RADIUS + 12), 2.5, 0, 7); ctx.fill(); }
    ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.75; ctx.fillText(`${name}  ${state.speed.toFixed(state.speed < 1 ? 2 : 1)} Hz`, cx, CY + RADIUS + 24);
  }

  function draw() {
    if (!ctx) return;
    const page = ink();
    ctx.clearRect(0, 0, W, H);
    drawRotor('horn', page); drawRotor('drum', page);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    const speed = Math.round(getParam('speed'));
    buttons.forEach((b, i) => b.classList?.toggle('on', i === speed));
  }

  // one frame on: the rotors close in on the speed the switch asks for, and turn
  function advance(now) {
    if (!el.isConnected) { last = null; return; }   // the panel was closed: stop
    const seconds = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const target = targetSpeed(Math.round(getParam('speed')), getParam('slow'), getParam('fast')), inertia = getParam('inertia');
    for (const name of ['horn', 'drum']) {
      const spec = ROTORS[name], state = turning[name];
      state.speed = nextRotorSpeed(spec, state.speed, target * spec.ratio, seconds, inertia);
      state.angle = (state.angle + spec.direction * state.speed * seconds + 1) % 1;
    }
    draw();
    doc.defaultView?.requestAnimationFrame?.(advance);
  }

  const row = doc.createElement('div'); row.className = 'osc-wave-row rotary-switch';
  const buttons = SPEEDS.map((name, i) => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = name; b.title = `Speed: ${name}`;
    b.addEventListener('click', () => { setParam('speed', i); draw(); });
    return b;
  });
  row.append(...buttons);
  el.append(canvas, row);
  draw();
  doc.defaultView?.requestAnimationFrame?.(advance);   // (it starts once the panel is on the page)
  return { el, refresh: draw, draw };
}
