// The look of a node in the Node Sequencer: a small tile with a glyph and one short value under it. No port names are drawn (the editor shows
// one when the pointer rests on a port); the order of the ports says what they are, as the order of the arguments does in code.
//
// A glyph is a list of [how, path] in a 12 x 12 box: 's' strokes the path, 'f' fills it, 'd' strokes it faintly. Paths are SVG path data.

export const TILE = 34;        // the width and least height of a tile
export const PORT_GAP = 9;     // room for each port along an edge

const dot = (x, y, r) => `M${x + r} ${y}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;
const DICE = [['s', 'M2.5 1.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z'], ['f', dot(4, 4, 0.9) + dot(8, 8, 0.9) + dot(6, 6, 0.9)]];
const NOTE = [['f', `M6.4 9.4a2.4 1.8 0 1 0-4.8 0a2.4 1.8 0 1 0 4.8 0`], ['s', 'M6.2 9V1.6l3.6 1.6']];
const CHORD = [['f', 'M4.7 9.2a1.7 1.2 0 1 0-3.4 0a1.7 1.2 0 1 0 3.4 0M8.7 6.2a1.7 1.2 0 1 0-3.4 0a1.7 1.2 0 1 0 3.4 0M12.1 3.2a1.5 1.1 0 1 0-3 0a1.5 1.1 0 1 0 3 0'], ['s', 'M4.4 9V1.8M8.4 6V.8']];

export const GLYPHS = {
  clock: [['s', 'M10.6 6a4.6 4.6 0 1 0-9.2 0a4.6 4.6 0 1 0 9.2 0'], ['s', 'M6 3v3l2 1.5']],
  every: [['s', 'M2 6h8'], ['f', dot(6, 2.6, 1) + dot(6, 9.4, 1)]],
  Pseq: [['s', 'M1 3h10M1 6h10M1 9h6']],
  Prand: DICE,
  Pchord: CHORD, Chord: CHORD,
  Phrase: [['s', 'M1 2.5h10M1 6h10M1 9.5h6'], ['s', 'M9 8l2 1.5-2 1.5']],
  Pwhite: [['s', 'M1 8l2-4 2 5 2-6 2 5 2-3']],
  delay: [['d', 'M1 9V5M4 9V3M7.5 9V5'], ['s', 'M10.5 9V1.5M8.6 3.4l1.9-1.9 1.9 1.9']],
  chance: DICE,
  math: [['s', 'M6 2v8M2 6h8']],
  hold: [['s', 'M1 9h3V4h4v5h3']],
  ad: [['s', 'M1 10.5L4 2h1l5.8 8.5']],
  scale: [['s', 'M1.5 10.5l9-9']],
  note: NOTE,
  set: [['d', 'M1 3.6h10M1 8.4h10'], ['f', dot(7.6, 3.6, 1.7) + dot(3.8, 8.4, 1.7)]],
  script: [['s', 'M4 1.5c-1.5 0-1.5 1-1.5 2.2S2.5 5.5 1.5 6c1 .5 1 1 1 2.3s0 2.2 1.5 2.2M8 1.5c1.5 0 1.5 1 1.5 2.2s0 1.8 1 2.3c-1 .5-1 1-1 2.3s0 2.2-1.5 2.2']],
  run: [['f', 'M3 1.8v8.4l7-4.2z']],
  monitor: [['s', 'M1 6c2-3.5 8-3.5 10 0c-2 3.5-8 3.5-10 0'], ['f', dot(6, 6, 1.4)]],
  lfo: [['s', 'M0.8 6c1.4-5.2 3-5.2 4.4 0s3 5.2 4.4 0 .8-1.8 1.6-1.4']],
  steps: [['f', 'M1 9h2V5H1zM5 9h2V2H5zM9 9h2V6H9z']],
  euclid: [['f', dot(6, 2, 1.1) + dot(9.5, 4, 1.1) + dot(9.5, 8, 1.1) + dot(6, 10, 1.1) + dot(2.5, 8, 1.1) + dot(2.5, 4, 1.1)]],
};

// Tiles wider than the usual: the ones that draw something of their own across the tile.
export const WIDTH = { steps: 150, euclid: 100 };

// The size of a tile: wide enough for its own picture and tall enough for the ports along its edges.
export function tileSize(type, inCount, outCount, data, params) {
  const rows = Math.max(inCount, outCount);
  let w = WIDTH[type] ?? TILE;
  if (type === 'Voicing') w = Math.max(TILE, Math.round(params?.notes ?? 4) * 8 + 10);
  return { w, h: Math.max(TILE, rows * PORT_GAP + 10) };
}

// The few characters shown under the glyph. `live` is what the audio thread last said about the node.
export function tileLabel(n, live, chordCount = 0) {
  const d = n.data ?? {}, p = n.params ?? {};
  switch (n.type) {
    case 'Chord': return String(d.text ?? '').replace(/\s+/g, '').slice(0, 6);
    case 'Pchord': return String(d.text ?? '').trim().split(/\r?\n/)[0].replace(/\s+/g, '').slice(0, 6);
    case 'Pseq': case 'Prand': return String(d.text ?? '').trim().split(/[\s,]+/).slice(0, 2).join(' ').slice(0, 7);
    case 'note': return d.target ? String(d.target).slice(0, 7) : '?';
    case 'set': return d.target ? String(d.target).split('.').pop().slice(0, 7) : '?';
    case 'delay': return `${p.subs ?? 2}`;
    case 'math': return `${p.mul !== undefined && p.mul !== 1 ? `×${p.mul} ` : ''}${p.add ? (p.add > 0 ? '+' : '') + p.add : ''}`.trim().slice(0, 7);
    case 'every': return `÷${p.n ?? 4}`;
    case 'chance': return `${Math.round((p.p ?? 0.5) * 100)}%`;
    case 'run': return `G${Math.round(p.group ?? 2)}`;
    case 'Phrase': return live && live.i >= 0 ? `${live.i + 1}/${chordCount}` : `${chordCount}`;
    case 'monitor': return live ? String(Math.round(live.v * 100) / 100).slice(0, 6) : '';
    default: return '';
  }
}

const cache = new Map();
// Draws a glyph with its top left at (x, y), `size` pixels across.
export function drawGlyph(ctx, type, x, y, size, colour) {
  const g = GLYPHS[type]; if (!g) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 12, size / 12); ctx.lineWidth = 1 / (size / 12) * 1.15; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [how, d] of g) {
    let path = cache.get(d); if (!path) { path = new Path2D(d); cache.set(d, path); }
    if (how === 'f') ctx.fill(path); else { ctx.globalAlpha *= how === 'd' ? 0.4 : 1; ctx.stroke(path); ctx.globalAlpha = how === 'd' ? ctx.globalAlpha / 0.4 : ctx.globalAlpha; }
  }
  ctx.restore();
}
