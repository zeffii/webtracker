// The canvas picture's starting text and templates (see canvaspicture.js for what a picture can use, canvasguide.js for the manual).
// They hold their colours to C1 and C2, so a new palette in Config repaints all of them.

// What a new canvas picture starts as: one dot for each lane. A note sends its dot to a new place (the pitch decides how far across),
// the dot glides there over three ticks, flashes at the hit and leaves a trail. A ring on the beat shows the sub-tick position.
export const DEFAULT_CANVAS = `// A canvas picture. setup() runs once; draw() runs every frame (about 60 times a second).
// ctx is the browser's 2D canvas (ctx.arc, ctx.fillRect, ctx.fillText ...); W and H are its size in pixels.
// Song names: song (position in ticks, with the fraction), tick, frac, beat, T (seconds), hit("kick"), since("kick"), ticked() ...
// They are all in the manual under this editor.

const dots = [];   // one for each lane: where it started, where it is going, and when it set off

function setup() {
  // runs on every note any lane plays: n is { lane, id, inst, note, vel, tick }
  onNote('*', n => {
    const d = dots[n.lane] ??= { x: W / 2, y: H / 2, ax: W / 2, ay: H / 2, bx: W / 2, by: H / 2, born: song };
    d.ax = d.x; d.ay = d.y;                          // set off from where it is now
    d.bx = map(n.note, 24, 96, 0.1, 0.9) * W;        // the pitch decides how far across
    d.by = (0.15 + 0.7 * hash(n.tick, n.lane)) * H;  // and the row decides how high
    d.born = song;
  });
}

function draw() {
  fade(0.2);                                         // the old picture fades a little: trails

  // a ring that swells once a beat; frac is how far into the tick, so it moves between ticks, not in steps
  const ring = fract(beat);
  ctx.strokeStyle = alpha(C1, 0.5 * (1 - ring));
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, S * (0.1 + 0.35 * ring), 0, TAU); ctx.stroke();

  lanes().forEach((lane, i) => {
    const d = dots[i];
    if (!d) return;
    const k = ease((song - d.born) / 3);             // 0 to 1 over three ticks, slow at both ends
    d.x = lerp(d.ax, d.bx, k); d.y = lerp(d.ay, d.by, k);
    const flash = Math.exp(-since(i) * 7);           // 1 at the hit, then gone in a fraction of a second
    ctx.fillStyle = flash > 0.35 ? C2 : C1;
    ctx.beginPath(); ctx.arc(d.x, d.y, S * (0.012 + 0.035 * flash), 0, TAU); ctx.fill();
  });
}
`;

export const CANVAS_TEMPLATES = {
  bounce: {
    label: 'Bounce: a ball dropped by every note',
    source: `// every note drops a ball from the top at the note's pitch; it falls, bounces and goes out. dt is the time since the last frame.
const balls = [];

function setup() {
  onNote('*', n => balls.push({ x: map(n.note, 24, 96, 0.08, 0.92) * W, y: H * 0.05, vy: 0, size: 0.01 + 0.03 * n.vel, life: 1, lane: n.lane }));
}

function draw() {
  background('#10161a');
  for (const b of balls) {
    b.vy += S * 2.2 * dt;                            // gravity, in pixels per second
    b.y += b.vy * dt;
    if (b.y > H * 0.95) { b.y = H * 0.95; b.vy *= -0.62; }
    b.life -= dt * 0.25;
    ctx.fillStyle = alpha(b.lane % 2 ? C1 : C2, Math.max(0, b.life));
    ctx.beginPath(); ctx.arc(b.x, b.y, S * b.size, 0, TAU); ctx.fill();
  }
  while (balls.length && balls[0].life <= 0) balls.shift();
}
`,
  },
  type: {
    label: 'Type: the lane names jump on the beat',
    source: `// big letters, one lane name at a time, cut in on every hit and kicked up a little: hard cuts and type, the old music-video way
let word = '';
let at = 0;

function setup() {
  onNote('*', n => { word = n.inst.toUpperCase(); at = T; });
}

function draw() {
  background('#0c0f12');
  const age = T - at;
  const kick = Math.exp(-age * 9);                   // 1 at the cut, then settles
  ctx.save();
  ctx.translate(W / 2, H / 2 + S * 0.02 * (1 - kick));
  ctx.rotate((hash(Math.floor(at * 10)) - 0.5) * 0.16 * kick);
  ctx.scale(1 + 0.25 * kick, 1 + 0.25 * kick);
  ctx.fillStyle = kick > 0.4 ? C2 : C1;
  ctx.font = '900 ' + Math.round(S * 0.2) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(word, 0, 0, W * 0.9);
  ctx.restore();
  ctx.fillStyle = alpha(C1, 0.6);
  ctx.fillRect(0, H - S * 0.02, W * fract(song / 32), S * 0.02);   // where we are in a 32-tick bar
}
`,
  },
  ahead: {
    label: 'Ahead: lanes with the next hits shown before they come',
    source: `// one line for each lane. The next 16 ticks are drawn to the right of the middle as small marks (cell() looks at the pattern), and the
// hits pass through the middle line as they play. song has the fraction, so the marks glide instead of stepping.
function draw() {
  background('#0d1215');
  const rows = lanes();
  const rowH = H / Math.max(1, rows.length);
  const x0 = W * 0.3, perTick = W * 0.04;
  ctx.fillStyle = alpha(C1, 0.35); ctx.fillRect(x0 - 1, 0, 2, H);
  rows.forEach((lane, i) => {
    const y = (i + 0.5) * rowH;
    for (let a = -2; a <= 16; a++) {
      const c = cell(i, a);
      if (!c || !c.hit) continue;
      const x = x0 + (a - frac) * perTick;           // frac moves the whole row smoothly between ticks
      ctx.fillStyle = a <= 0 ? C2 : alpha(C1, 0.9 - a * 0.04);
      ctx.fillRect(x, y - rowH * 0.3, perTick * 0.7, rowH * 0.6);
    }
    ctx.fillStyle = alpha(C2, 0.6); ctx.font = Math.round(rowH * 0.5) + 'px ui-monospace, monospace';
    ctx.fillText(lane.id, 6, y + rowH * 0.18, x0 - 12);
  });
}
`,
  },
};
