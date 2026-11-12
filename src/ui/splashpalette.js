// Random colours for the first screen. Every load draws a new set, so no two starts look alike.
//
// randomPalette(rand) gives four colours for the effects (each as [r, g, b] from 0 to 1) plus the text colours to lay on them:
//   bg    the ground (dark or light, chosen at random)         ink   the main colour of the pattern
//   hi    the highlight, lighter than the ink                   warm  a small accent, from another part of the colour wheel
// The hues come from one of a few schemes (neighbours, opposites, a triad ...) so the set always belongs together, however random.
//
// hueTurn(rand) gives the angle (degrees) and strength to bend the translucent blob's built-in colours by, kept well away from
// the old teal/orange pair so that the look is never the same one twice running.

// No purple or pink. The colour wheel is squeezed into the part that is left (reds round through orange, yellow, green and cyan to
// blue, 355 degrees to 245), so a spread of random hues still never lands in the band between.
const FIRST_HUE = 355, HUE_SPAN = 250;
export const allowedHue = h => (FIRST_HUE + (((h % 360) + 360) % 360) / 360 * HUE_SPAN) % 360;
export const isPurplish = h => { const x = ((h % 360) + 360) % 360; return x > 250 && x < 350; };

const SCHEMES = [[0, 25, -25, 180], [0, 180, 150, 210], [0, 120, 240, 60], [0, 150, 210, 30], [0, 60, 300, 180], [0, 40, 80, 200]];

// h in degrees, s and l from 0 to 1.
export function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const css = ([r, g, b], a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
const between = (rand, lo, hi) => lo + (hi - lo) * rand();

// A colour of this hue and saturation, lightened (up) or darkened until its luminance is at least `gap` away from `ref`'s: blue and
// red look dark at a lightness where green looks bright, so the same lightness would not stand off the ground equally in every hue.
function apart(h, s, l, ref, gap, up) {
  let c = hslToRgb(h, s, l);
  for (let i = 0; i < 12 && Math.abs(luminance(c) - luminance(ref)) < gap; i++) { l = Math.max(0.03, Math.min(0.97, l + (up ? 0.04 : -0.04))); c = hslToRgb(h, s, l); }
  return c;
}

export function randomPalette(rand = Math.random) {
  const base = rand() * 360, scheme = SCHEMES[Math.floor(rand() * SCHEMES.length)], dark = rand() < 0.5;
  const hue = i => allowedHue(base + scheme[i % scheme.length]);
  const bg = hslToRgb(hue(0), between(rand, 0.2, 0.55), dark ? between(rand, 0.06, 0.14) : between(rand, 0.8, 0.9));
  const ink = apart(hue(1), between(rand, 0.55, 0.85), dark ? between(rand, 0.5, 0.62) : between(rand, 0.3, 0.4), bg, 0.2, dark);
  const hi = dark ? apart(hue(2), between(rand, 0.55, 0.9), between(rand, 0.72, 0.84), bg, 0.3, true) : hslToRgb(hue(2), between(rand, 0.55, 0.9), between(rand, 0.92, 0.97));
  const warm = hslToRgb(hue(3), between(rand, 0.7, 0.95), between(rand, 0.52, 0.62));
  // text over the picture: light on a dark ground, dark on a light one
  const light = dark;
  const text = light ? [0.96, 0.96, 0.97] : hslToRgb(hue(0), 0.35, 0.16);
  const pill = light ? hslToRgb(hue(0), 0.3, 0.1) : hslToRgb(hue(0), 0.4, 0.96);   // the prompt's box: dark on a dark picture, pale on a pale one
  return {
    bg, ink, hi, warm, dark,
    vars: {
      '--s-word': css(text, light ? 0.85 : 0.82), '--s-go': css(text, 0.8), '--s-log': css(text, 0.6), '--s-build': css(text, 0.55),
      '--s-glow': css(light ? [0, 0, 0] : hi, 0.35),
      '--s-pill': css(pill, 0.88), '--s-edge': css(text, 0.25), '--s-lift': css(ink, 0.3),
    },
  };
}

// The turning of the blob's colours (degrees in the YIQ colour space, see hueMatrix in blob.js): the blob's own colours are a warm
// family (red, orange, yellow, cream) and a cool one (teal, cyan). Measured by turning each of them, these ranges are the turns that
// keep every one out of the purples and pinks and away from the original look: 300 to 330 (warm yellows and greens under blue)
// and 175 to 185 (blue where it was orange, orange and red where it was teal). Tested in the smoke test.
export const BLOB_TURNS = [[300, 330], [175, 185]];
const ORIGINAL_HUE = 192;
export function hueTurn(rand = Math.random) {
  const [lo, hi] = BLOB_TURNS[rand() < 0.6 ? 0 : 1], degrees = lo + rand() * (hi - lo), saturation = between(rand, 0.9, 1.15);
  // text colours: the old teal-grey, turned to match the picture (the same turn, roughly, in the usual hue wheel)
  const h = (ORIGINAL_HUE + (degrees < 250 ? 170 : -40)) % 360;
  const text = hslToRgb(h, 0.22, 0.34), soft = hslToRgb(h, 0.16, 0.5), glow = hslToRgb(h, 0.5, 0.33);
  return { degrees, saturation, vars: { '--s-go': css(text), '--s-log': css(soft), '--s-glow': css(glow, 0.38), '--s-edge': css(text, 0.25), '--s-lift': css(glow, 0.15) } };
}

// Which look a start uses: the one chosen in Config, or any of the three at random.
export const LOOKS = ['blob', 'reaction', 'plasma'];
export const pickLook = (style, rand = Math.random) => (style === 'random' ? LOOKS[Math.floor(rand() * LOOKS.length)] : style);
