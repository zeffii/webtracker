// Two passes that make the piano roll's spectrogram easier to read, applied to the brightness cells (0..255, row 0 at
// the top) after they are worked out, so moving the sliders never redoes the FFT.
//
// contrast: an S-curve around a mid level. The quiet smear fades to black and the loud parts saturate, so the blobs
//   get edges. 0 leaves the picture as it was.
// islands: a note shows up as a broad soft blob, and several notes next to each other run together. Islands looks at
//   every column, finds the peak inside each loud blob (the loudest point within about a semitone either way), and lifts
//   a thin bright ridge there. The rest of the blob and the background are pushed quieter, in proportion to the amount.
//   0 leaves the picture as it was.

const MID = 0.55;       // the level the contrast curve pivots on (brightness is dB below the loudest cell over 80 dB)
const BLOB = 0.4;       // brightness a cell needs, after contrast, to count as part of a blob

export function applyContrast(cells, amount) {
  if (!(amount > 0)) return cells;
  const k = 2 + 22 * amount * amount, f = v => 1 / (1 + Math.exp(-k * (v - MID))), lo = f(0), span = f(1) - lo;
  const table = Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * (f(i / 255) - lo) / span));
  return cells.map(v => table[v]);
}

// rowsPerSemitone says how tall a semitone is on screen, so the peak search and the ridge width follow the zoom
export function addIslands(cells, cols, rows, amount, rowsPerSemitone = 4) {
  if (!(amount > 0)) return cells;
  const out = new Uint8Array(cells.length), ridge = new Float32Array(cells.length), inside = new Uint8Array(cells.length);
  const smooth = Math.max(1, Math.round(rowsPerSemitone * 0.5)), reach = Math.max(2, Math.round(rowsPerSemitone * 0.75));
  const sigma = Math.max(1, rowsPerSemitone * 0.32), half = Math.ceil(sigma * 4.5);
  const level = BLOB * 255, col = new Float32Array(rows);
  const at = (y, x) => cells[Math.min(rows - 1, Math.max(0, y)) * cols + x];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      let s = 0;
      for (let k = -smooth; k <= smooth; k++) s += at(y + k, x);
      col[y] = s / (2 * smooth + 1);
      if (cells[y * cols + x] >= level) inside[y * cols + x] = 1;
    }
    for (let y = 1; y < rows - 1; y++) {
      if (col[y] < level || col[y] < col[y - 1] || col[y] <= col[y + 1]) continue;
      let top = true;
      for (let k = -reach; k <= reach && top; k++) if (col[Math.min(rows - 1, Math.max(0, y + k))] > col[y]) top = false;
      if (!top) continue;
      for (let j = Math.max(0, y - half); j <= Math.min(rows - 1, y + half); j++) {
        const g = Math.exp(-0.5 * ((j - y) / sigma) ** 2);
        if (g > ridge[j * cols + x]) ridge[j * cols + x] = g;
      }
    }
  }
  for (let i = 0; i < cells.length; i++) {
    const g = ridge[i], v = cells[i] / 255;
    const quiet = inside[i] ? 1 - 0.85 * amount * (1 - g) : 1 - 0.6 * amount;
    out[i] = Math.round(255 * Math.min(1, v * quiet + (inside[i] ? amount * g * 0.9 : 0)));
  }
  return out;
}

export function sharpen(cells, cols, rows, { contrast = 0, islands = 0, rowsPerSemitone = 4 } = {}) {
  return addIslands(applyContrast(cells, contrast), cols, rows, islands, rowsPerSemitone);
}
