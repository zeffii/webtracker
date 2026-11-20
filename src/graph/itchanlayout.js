// Where each part of the IT channel screen sits. Positions and sizes are in character cells, as drawn on the layout board;
// to move something, change its numbers here. The screen is GRID.cols x GRID.rows cells of CELL.w x CELL.h pixels.
export const CELL = { w: 8, h: 12 };
export const GRID = { cols: 83, rows: 30 };

export const LAYOUT = {
  title:    { x: 33, y: 0,  w: 22, h: 1 },    // the chosen sample's name, over the top of the waveform
  wave:     { x: 0,  y: 0,  w: 59, h: 11 },
  samples:  { x: 60, y: 0,  w: 22, h: 11 },
  loop:     { x: 0,  y: 12, w: 44, h: 1 },
  sustain:  { x: 0,  y: 13, w: 44, h: 1 },
  susPitch: { x: 0,  y: 14, w: 44, h: 1 },    // how the sustain loop follows the pitch (IT 3)
  ins:      { x: 46, y: 12, w: 12, h: 2 },    // the instrument picker and its fadeout
  envlist:  { x: 60, y: 12, w: 22, h: 4 },
  mode:     { x: 0,  y: 15, w: 28, h: 1 },
  nna:      { x: 30, y: 15, w: 29, h: 1 },
  rate:     { x: 0,  y: 16, w: 44, h: 1 },    // how fast the note travels through the chosen envelope
  fkeys:    { x: 0,  y: 17, w: 43, h: 2 },
  plays:    { x: 44, y: 17, w: 39, h: 1 },    // the sample the instrument plays
  envgraph: { x: 0,  y: 20, w: 83, h: 10 },
};

export const sizeOf = id => ({ w: LAYOUT[id].w * CELL.w, h: LAYOUT[id].h * CELL.h });

// Put an element where the layout says.
export function place(element, id) {
  const { x, y } = LAYOUT[id], { w, h } = sizeOf(id);
  Object.assign(element.style, { position: 'absolute', left: `${x * CELL.w}px`, top: `${y * CELL.h}px`, width: `${w}px`, height: `${h}px` });
  return element;
}
