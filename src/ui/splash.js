// The first screen: a white card with the logo turning behind a very faint "webtracker" and one small Enter button.
// The browser needs a click before it will make sound, so Enter is that click; it runs what the Start button runs. While
// the engine starts, a few grey lines report the real steps, and the card fades to show the tracker (about a second).
// The logo is sixteen identical rectangles (found by fitting the icon), all in one plane, drawn as a wireframe on a plain canvas.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));

const SHAPE = { w: .1636, h: .4909, rects: [[.7182, -.1909, 100], [.3727, .6455, 32], [.7455, .0182, 90], [-.7364, .0636, 92], [.3545, -.6545, 152], [-.0364, .7455, 0], [-.6818, .2909, 110], [-.4636, .5818, 142], [-.5909, .4545, 128], [-.6091, -.4273, 58], [-.2818, -.6909, 18], [.7182, .2455, 66], [.7091, -.2455, 106], [-.6818, -.2909, 62], [.6636, .3455, 60], [-.1636, -.7091, 12]] };
const T = .08, R = .56, CX = -.16, CY = .31, D = 4.2;   // slab thickness, radius, centre (in card widths), eye distance
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]], FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const BOXES = SHAPE.rects.map(([x, y, deg]) => {
  const a = -deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pts = [];
  for (const dz of [-1, 1]) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = dx * SHAPE.w / 2, py = dy * SHAPE.h / 2;
    pts.push([x + px * c - py * s, y + px * s + py * c, dz * T / 2]);
  }
  return pts;
});

export function createSplash({ box, onStart }) {
  const card = box.querySelector('.s-card'), cv = box.querySelector('canvas'), go = box.querySelector('.s-go'), log = box.querySelector('.s-log');
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, boost = 0, boostTo = 0, running = true, typing = [], nextAt = 0;
  document.body.classList.add('splashing');
  box.hidden = false;
  go.focus({ preventScroll: true });

  const size = () => { dpr = devicePixelRatio || 1; W = card.clientWidth; H = card.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  new ResizeObserver(size).observe(card); size();

  const t0 = performance.now();
  const draw = now => {
    if (!running) return;
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
    const line = tag === '' ? text : `${text} `.padEnd(40, '.') + ` ${tag === 'ready' ? 'ready' : tag}`;
    const job = (async () => {
      await wait(start - performance.now());
      for (let i = 0; i < line.length; i += 9) { row.textContent = line.slice(0, i + 9); await frame(); }
      if (tag !== 'ok' && tag !== 'ready' && tag !== '') row.className = 'bad';
    })();
    typing.push(job);
    return job;
  }

  go.addEventListener('click', () => {
    go.hidden = true; go.disabled = true; boostTo = .7;
    log.textContent = ''; typing = []; nextAt = 0;
    onStart();
  });

  return {
    say,
    // The start-up is done: let the lines finish, then fade the card away and show the app.
    async finish() {
      await Promise.all(typing); await wait(120);
      box.classList.add('leaving'); await wait(380);
      running = false; box.hidden = true; box.classList.remove('leaving'); document.body.classList.remove('splashing');
    },
    // It did not work: say why, and let Enter be clicked again.
    async fail(message) {
      await Promise.all(typing);
      const row = document.createElement('div'); row.className = 'bad'; row.textContent = message; log.append(row);
      go.hidden = false; go.disabled = false; boostTo = 0;
    },
  };
}
