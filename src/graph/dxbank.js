import { ALGORITHMS } from '../audio/nodes/dx7.js';

// The DX panel's algorithm bank: every one of the 32 operator arrangements drawn as a small thumbnail, in a grid.
// Carriers are the filled amber boxes, modulators the grey ones; lines run from a modulator down to what it modulates.

// Places the six operators of an algorithm inside a W x H box: carriers on the bottom row, each modulator one row
// above whatever it feeds, siblings spread out and parents centred over their children. Returns the centre x and
// the top y of every operator, and the modulation lines between them and the lines of the output bus under the carriers, as [x1, y1, x2, y2] segments.
export function layoutAlgorithm(alg, W, H, nw, nh, padB = 5) {
  const receivers = [[], [], [], [], [], []], senders = [[], [], [], [], [], []];
  for (const [to, from] of alg.mods) { receivers[from].push(to); senders[to].push(from); }
  const row = new Array(6).fill(-1);
  const rowOf = k => row[k] >= 0 ? row[k] : (row[k] = receivers[k].length ? 1 + Math.max(...receivers[k].map(rowOf)) : 0);
  for (let k = 0; k < 6; k++) rowOf(k);

  const column = [], placed = new Set();
  let columns = 0;
  const place = k => {
    placed.add(k);
    const kids = senders[k].filter(s => !placed.has(s));
    kids.forEach(s => placed.add(s));
    kids.forEach(place);
    column[k] = kids.length ? kids.reduce((sum, s) => sum + column[s], 0) / kids.length : columns++;
  };
  [...alg.carriers].sort((a, b) => a - b).forEach(place);

  const rows = Math.max(...row) + 1;
  const stepX = Math.min((W - 8) / Math.max(columns, 1), nw + W * 0.05);
  const stepY = Math.min((H - padB - nh - 4) / Math.max(rows - 1, 1), nh * 1.9);
  const lift = ((H - padB - nh - 4) - (rows - 1) * stepY) / 2;
  const pos = [];
  for (let k = 0; k < 6; k++) pos[k] = { cx: W / 2 + (column[k] - (columns - 1) / 2) * stepX, top: H - padB - nh - row[k] * stepY - lift };

  const lines = [], bus = [];
  for (const [to, from] of alg.mods) {
    const s = pos[from], r = pos[to], fromY = s.top + nh, midY = r.top - Math.max(2, Math.min((r.top - fromY) / 2, (stepY - nh) / 2));
    lines.push([s.cx, fromY, s.cx, midY], [s.cx, midY, r.cx, midY], [r.cx, midY, r.cx, r.top]);
  }
  const busY = Math.max(...alg.carriers.map(c => pos[c].top)) + nh + 3;
  const xs = alg.carriers.map(c => pos[c].cx);
  for (const c of alg.carriers) bus.push([pos[c].cx, pos[c].top + nh, pos[c].cx, busY]);
  bus.push([Math.min(...xs), busY, Math.max(...xs), busY]);
  return { pos, lines, bus, busY };
}

// Draws the whole bank into a canvas context: `cols` thumbnails per row, no boxes. Each is a few dots joined by
// thin lines (carriers in the accent colour, modulators in the second colour) with its number in the corner; the
// selected one is drawn fully and underlined, the others a little faded.
export function drawBank(ctx, { width, cols, cellH, selected, ink, accent, modulator = ink }) {
  const cellW = width / cols, rows = Math.ceil(ALGORITHMS.length / cols), dot = 3.5;
  ctx.clearRect(0, 0, width, rows * cellH);
  ctx.font = '8px ui-monospace, Consolas, monospace';
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ALGORITHMS.forEach((alg, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH, on = i === selected;
    const { pos, lines } = layoutAlgorithm(alg, cellW, cellH - 4, 2 * dot, 2 * dot, 6);
    ctx.globalAlpha = on ? 1 : 0.6;
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of lines) { ctx.moveTo(x + x1 + 0.5, y + y1 + 0.5); ctx.lineTo(x + x2 + 0.5, y + y2 + 0.5); }
    ctx.stroke();
    pos.forEach((p, k) => {
      ctx.fillStyle = alg.carriers.includes(k) ? accent : modulator;
      ctx.beginPath(); ctx.arc(x + p.cx, y + p.top + dot, dot, 0, 2 * Math.PI); ctx.fill();
    });
    ctx.fillStyle = on ? accent : ink; ctx.globalAlpha = on ? 1 : 0.45;
    ctx.fillText(String(i + 1), x + 3, y + 1);
    if (on) { ctx.globalAlpha = 1; ctx.fillStyle = accent; ctx.fillRect(x + 4, y + cellH - 3, cellW - 8, 2); }
    ctx.globalAlpha = 1;
  });
  return { cellW, cellH, cols };
}
