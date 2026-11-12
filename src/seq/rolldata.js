// The notes of one pattern as a piano roll sees them: bars with a pitch, a start row and a length, and a name for each chord.
//
// rollData(lane, tick) finds the pattern placed under `tick` in `lane` and reads its note columns. A note begins at a note cell and
// lasts until the next cell of that column that is not blank (another note, `===` off, `^^^` cut) or until the pattern ends. Its
// velocity comes from the velocity column paired with its note column (blank means full). Rows are counted from the pattern's start.
import { noteSemitones } from './cells.js';
import { placementAt } from './edit.js';
import { detect, suggest } from './chords.js';

export function rollData(lane, tick) {
  const pl = lane && placementAt(lane, tick);
  if (!pl) return null;
  const pat = lane.patterns[pl.puid], length = Math.min(pl.length, pat.length);
  const cols = lane.columns, noteCols = [], velCols = [];
  cols.forEach((c, i) => { if (c.kind === 'note') noteCols.push(i); else if (c.kind === 'vel') velCols.push(i); });
  const notes = [];
  noteCols.forEach((col, k) => {
    let open = null;
    const close = row => { if (open) { open.len = Math.max(1, row - open.row); notes.push(open); open = null; } };
    for (let r = 0; r < length; r++) {
      const cell = lane.rows[pl.start + r]?.[col];
      const st = noteSemitones(cell);
      if (st !== null) {
        close(r);
        const vc = velCols[k] !== undefined ? lane.rows[pl.start + r]?.[velCols[k]] : null;
        const vel = vc && /^[0-9A-Fa-f]{2}$/.test(vc) ? parseInt(vc, 16) / 255 : 1;
        open = { row: r, len: 1, pitch: st, vel, col: k };
      } else if (cell === '===' || cell === '^^^') close(r);
    }
    close(length);
  });
  notes.sort((a, b) => a.row - b.row || a.pitch - b.pitch);
  // A chord is named wherever the set of notes sounding changes at a note's start; three different notes make a chord.
  const chords = [];
  let last = '';
  for (const row of [...new Set(notes.map(n => n.row))]) {
    const sounding = notes.filter(n => n.row <= row && row < n.row + n.len).map(n => n.pitch + 12);   // +12: C-0 is MIDI 12
    const key = [...new Set(sounding)].sort((a, b) => a - b).join(',');
    if (key === last) continue;
    last = key;
    const set = [...new Set(sounding)];
    const found = set.length >= 3 ? (detect(set) ?? suggest(set)) : null;
    chords.push({ row, name: found?.name ?? null });
  }
  const pitches = notes.map(n => n.pitch);
  return {
    puid: pl.puid, name: pat.name, start: pl.start, length, notes, chords,
    lo: pitches.length ? Math.min(...pitches) : 36, hi: pitches.length ? Math.max(...pitches) : 60,
    columns: noteCols.length,
  };
}
