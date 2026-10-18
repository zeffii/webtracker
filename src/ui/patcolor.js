// The colour of a pattern as a CSS colour, the same palette the sequencer uses: one of 16 pastels, a custom
// #rrggbb, or (automatic) one of six by the pattern's number.
const AUTO = ['210 70% 55%', '150 60% 45%', '30 80% 55%', '280 60% 60%', '0 70% 55%', '55 70% 50%'];
const PASTEL = [0, 22, 45, 68, 90, 112, 135, 158, 180, 202, 225, 248, 270, 292, 315, 338];
export function patternColour(pat, alpha = 1) {
  const c = pat?.color;
  if (Number.isInteger(c) && c >= 0 && c < 16) return `hsl(${PASTEL[c]} 65% 72% / ${alpha})`;
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return `${c}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  return `hsl(${AUTO[(pat?.index ?? 0) % 6]} / ${alpha})`;
}
