// The colour of a pattern as a CSS colour, the same palette the sequencer uses: one of 16 pastels, a custom
// #rrggbb, or (automatic) one of six by the pattern's number.
const AUTO = ['210 70% 55%', '150 60% 45%', '30 80% 55%', '280 60% 60%', '0 70% 55%', '55 70% 50%'];
const PASTEL = [0, 22, 45, 68, 90, 112, 135, 158, 180, 202, 225, 248, 270, 292, 315, 338];
export function patternColour(pat, alpha = 1) {
  const c = pat?.color;
  // the theme (--pat-* in themes.css) decides how bright, saturated and strong, and how far the hues are pulled toward its own
  const tint = (h, s, l) => `hsl(calc(var(--pat-hue, 0) + (${h} - var(--pat-hue, 0)) * var(--pat-spread, 1)) calc(${s}% + var(--pat-ds, 0%)) calc(${l}% + var(--pat-dl, 0%)) / calc(${alpha} * var(--pat-am, 1)))`;
  if (Number.isInteger(c) && c >= 0 && c < 16) return tint(PASTEL[c], 65, 72);
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return `${c}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  const [h, s, l] = AUTO[(pat?.index ?? 0) % 6].split(' ');
  return tint(h, parseFloat(s), parseFloat(l));
}
