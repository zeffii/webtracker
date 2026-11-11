// The compact look of a node tile: how big it is, where its glyph sits and what its ports are called.
//
// The classic look has one size per shape and prints every port's name. The compact look is as small as the tile's contents allow:
//   - a port that is the only one on its side has no label ("input" and "output" are implicit when there is just one);
//   - several ports get short names (left, right become L, R);
//   - a tile with no labels is only as wide as its glyph plus some padding;
//   - the glyph sits between the two label columns, so when only the inputs are named it moves up against the output socket,
//     and when only the outputs are named it moves against the input socket.
// Everything here is plain arithmetic (a character is a fixed width), so the same numbers serve drawing, hit testing and the tests.
export const COMPACT_ROW = 14;
const CHAR_W = 6;          // the 10px monospace label font
const PAD = 8;             // from a socket to whatever is next to it
const GLYPH_W = 28;
const GLYPH_H = 16;
const CIRCLE = 36;         // the voices node: a circle, labels would not fit and are not shown
const SPEAKER_W = 60;      // the output node's cone, with room for the L and R

const SHORT = { left: 'L', right: 'R' };
export const shortPortName = name => SHORT[name] ?? (name.startsWith('@') ? name.slice(1) : name);

// The label of each port on one side: nothing when it is the only one.
export const portLabels = names => (names.length === 1 ? [''] : names.map(shortPortName));

// { w, h, glyph: { x, w, h } (x is the glyph's centre from the tile's left edge), labels: { in: [...], out: [...] } }
export function compactLayout(def, inputs, outputs) {
  const rows = Math.max(inputs.length, outputs.length, 1);
  const labels = { in: portLabels(inputs), out: portLabels(outputs) };
  const widest = side => Math.max(0, ...labels[side].map(s => s.length)) * CHAR_W;
  const circle = def.shape === 'circle';
  const h = circle ? CIRCLE : Math.max(rows * COMPACT_ROW + 12, 32);
  if (circle) return { w: CIRCLE, h, glyph: { x: CIRCLE / 2, w: CIRCLE * 0.5, h: CIRCLE * 0.5 }, labels: { in: labels.in.map(() => ''), out: labels.out.map(() => '') } };
  const left = widest('in') ? PAD + widest('in') + 4 : PAD, right = widest('out') ? PAD + widest('out') + 4 : PAD;
  const glyphW = def.shape === 'speaker' ? 20 : GLYPH_W;
  const w = def.shape === 'speaker' ? Math.max(SPEAKER_W, left + glyphW + right) : left + glyphW + right;
  return { w, h, glyph: { x: left + (w - left - right) / 2, w: glyphW, h: Math.min(GLYPH_H, h - 10) }, labels };
}
