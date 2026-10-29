// The two colours the live picture's shaders get as C1 (deep) and C2 (light). A palette is a pair; Config, Visual picks one, or Custom
// takes the two colour boxes next to it. The shaders keep to C1 and C2, so a new palette repaints every shader at once.
export const PALETTES = {
  teal:   { label: 'Teal',   c1: '#4dbccc', c2: '#9ef7fa' },
  ember:  { label: 'Ember',  c1: '#e0552b', c2: '#ffc27a' },
  sunset: { label: 'Sunset', c1: '#c8416b', c2: '#ffb36b' },
  rose:   { label: 'Rose',   c1: '#d9487a', c2: '#ffc4d9' },
  gold:   { label: 'Gold',   c1: '#d9a52b', c2: '#fff0a8' },
  lime:   { label: 'Lime',   c1: '#6fbf3a', c2: '#e2ff8c' },
  forest: { label: 'Forest', c1: '#2f9e6e', c2: '#b8f5c8' },
  aurora: { label: 'Aurora', c1: '#2fb59a', c2: '#cdb4ff' },
  ice:    { label: 'Ice',    c1: '#6aa7e8', c2: '#e6f4ff' },
  violet: { label: 'Violet', c1: '#7b5cd6', c2: '#d8b8ff' },
  mono:   { label: 'Mono',   c1: '#8a8f98', c2: '#f2f4f7' },
};

// '#4dbccc' -> [0.30, 0.74, 0.80]
export const hexToRgb = hex => {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] : [0, 0, 0];
};

// The pair of colours (as [r, g, b] in 0 to 1) the settings choose.
export function paletteColours(get) {
  const id = get('visualPalette'), p = PALETTES[id];
  return p ? [hexToRgb(p.c1), hexToRgb(p.c2)] : [hexToRgb(get('visualColour1')), hexToRgb(get('visualColour2'))];
}
