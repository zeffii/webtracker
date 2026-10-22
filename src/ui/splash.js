// The first screen: a white card with the logo turning behind a very faint "webtracker" and a quiet "click anywhere to enter".
// The browser needs a click before it will make sound, so a click on the card (or Enter / Space) is that click; it runs what the Start button runs. While
// the engine starts, a few grey lines report the real steps, and the card fades to show the tracker (about a second).
// The logo is fourteen identical slabs in one plane (from your 3D model), drawn as a wireframe on a plain canvas.
import { createBlob } from './blob.js';
import * as config from './config.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));

// The logo as modelled: fourteen identical thin slabs lying in one plane (x, y of each centre and its angle in degrees, in
// units of the ring's radius; every slab is 0.545 long, 0.189 wide and 0.077 thick).
const PETALS = [[-0.7451, -0.0000, -0.0], [-0.6313, -0.3956, 32.1], [-0.3411, -0.6624, 62.7], [-0.1337, -0.7330, 79.7], [0.2802, -0.6904, 112.1], [0.5745, -0.4744, 140.4], [0.6839, -0.2956, 156.6], [0.7439, 0.0411, -176.8], [0.6471, 0.3693, -150.3], [0.4004, 0.6283, -122.5], [0.3023, 0.6810, -113.9], [-0.0559, 0.7430, -85.7], [-0.3864, 0.6370, -58.8], [-0.7011, 0.2523, -19.8]];
const LEN = 0.5455, WID = 0.1895, T = 0.0773, R = .46, CX = -.12, CY = .30, D = 4.2;   // R, CX, CY: size and place on the card, in card widths; D: eye distance
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]], FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const BOXES = PETALS.map(([x, y, deg]) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pts = [];
  for (const dz of [-1, 1]) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = dx * LEN / 2, py = dy * WID / 2;
    pts.push([x + px * c - py * s, y + px * s + py * c, dz * T / 2]);
  }
  return pts;
});

export function createSplash({ box, onStart }) {
  const card = box.querySelector('.s-card'), cv = box.querySelector('canvas'), go = box.querySelector('.s-go'), log = box.querySelector('.s-log');
  // The backdrop: a translucent blob in WebGL (Config: First screen look), or, without WebGL or on request, the turning logo.
  const bcv = box.querySelector('.s-blob');
  const blob = config.get('splashStyle') === 'blob' && bcv ? createBlob(bcv) : null;
  box.classList.toggle('blob', !!blob);
  if (!blob && bcv) bcv.hidden = true;
  const g = blob ? null : cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, boost = 0, boostTo = 0, running = true, typing = [], nextAt = 0, busy = false;
  document.body.classList.add('splashing');
  box.hidden = false;
  card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', 'Enter webtracker'); card.focus({ preventScroll: true });

  if (blob) {
    box.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); blob.point(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2); });
    box.addEventListener('pointerdown', () => blob.excite(true));
  }
  const size = () => { dpr = devicePixelRatio || 1; W = card.clientWidth; H = card.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  new ResizeObserver(size).observe(card); size();

  // "click anywhere to enter" unrolls from its first letter; the unwritten rest keeps its width, so the line does not drift.
  {
    const full = go.textContent;
    const roll = async () => {
      await wait(450);
      for (let i = 1; i <= full.length && !busy; i++) {
        go.replaceChildren(document.createTextNode(full.slice(0, i)), Object.assign(document.createElement('span'), { textContent: full.slice(i), style: 'opacity:0' }));
        await wait(38);
      }
      if (!busy) go.textContent = full;
    };
    go.replaceChildren(Object.assign(document.createElement('span'), { textContent: full, style: 'opacity:0' }));
    roll();
  }

  const t0 = performance.now();
  const draw = now => {
    if (!running) return;
    if (blob) { blob.draw(now); requestAnimationFrame(draw); return; }
    const t = (now - t0) / 1000;
    boost += (boostTo - boost) * .02;
    const yaw = .5 * Math.sin(t * .18) + boost, pitch = .26 * Math.sin(t * .13 + 1), roll = t * .012;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const r = R * W, ox = CX * W, oy = CY * W;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.lineJoin = 'round'; g.lineCap = 'round';
    const pts = BOXES.map(b => b.map(([x, y, z]) => {
      const X = x * cr - y * sr, Y = x * sr + y * cr;
      const Y2 = Y * cp - z * sp, Z2 = Y * sp + z * cp;
      const X3 = X * cy + Z2 * sy, Z3 = -X * sy + Z2 * cy, k = D / (D - Z3);
      return { x: ox + r * X3 * k, y: oy - r * Y2 * k, z: Z3 };
    }));
    const order = pts.map((p, i) => [i, p.reduce((s, v) => s + v.z, 0) / 8]).sort((a, b) => a[1] - b[1]);
    for (const [i, depth] of order) {
      const p = pts[i], alpha = 1 - .5 * (1 - Math.max(0, Math.min(1, (depth + 1) / 2)));
      g.fillStyle = `rgba(255,51,153,${.07 * alpha})`;
      for (const f of FACES) { g.beginPath(); f.forEach((v, k) => (k ? g.lineTo(p[v].x, p[v].y) : g.moveTo(p[v].x, p[v].y))); g.closePath(); g.fill(); }
      g.strokeStyle = `rgba(255,51,153,${alpha})`; g.lineWidth = 1.5;
      g.beginPath(); for (const [a, b] of EDGES) { g.moveTo(p[a].x, p[a].y); g.lineTo(p[b].x, p[b].y); } g.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  // One grey line of the report, typed quickly; lines start at least 55 ms apart so a burst of fast steps still reads as a sequence.
  function say(text, tag = 'ok') {
    const row = document.createElement('div'); log.append(row);
    const start = Math.max(performance.now(), nextAt); nextAt = start + 55;
    const label = text.length > 42 ? text.slice(0, 41) + '…' : text;   // every status word starts in the same column
    const line = tag === '' ? text : `${label} `.padEnd(44, '.') + ` ${tag.padEnd(5)}`.trimEnd();
    const job = (async () => {
      await wait(start - performance.now());
      for (let i = 0; i < line.length; i += 9) { row.textContent = line.slice(0, i + 9); await frame(); }
      if (tag !== 'ok' && tag !== 'ready' && tag !== '') row.className = 'bad';
    })();
    typing.push(job);
    return job;
  }

  const enter = () => {
    if (busy) return;
    busy = true; go.hidden = true; card.classList.add('busy'); boostTo = .7; blob?.excite(true);
    log.textContent = ''; typing = []; nextAt = 0;
    onStart();
  };
  card.addEventListener('click', enter);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enter(); } });

  return {
    say,
    // The start-up is done: let the lines finish, then fade the card away and show the app.
    async finish() {
      await Promise.all(typing); await wait(120);
      box.classList.add('leaving'); await wait(380);
      running = false; blob?.lose(); box.hidden = true; box.classList.remove('leaving'); document.body.classList.remove('splashing');
    },
    // It did not work: say why, and let Enter be clicked again.
    async fail(message) {
      await Promise.all(typing);
      const row = document.createElement('div'); row.className = 'bad'; row.textContent = message; log.append(row);
      go.hidden = false; go.textContent = 'click to try again'; card.classList.remove('busy'); busy = false; boostTo = 0; blob?.excite(false);
    },
  };
}
