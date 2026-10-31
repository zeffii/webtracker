import { noteToken } from '../seq/cells.js';
import { synthKinds, ensureMaster } from '../instruments.js';
import { cleanName, idFromName, uniqueId } from './ops.js';

// SunVox project files (.sunvox) -> a project: the notes and the arrangement, not the sounds. Each SunVox module
// that plays notes gets a lane on a plain synth named after it, each SunVox pattern becomes a pattern on the lanes
// whose module it plays, and every placement (clones included) lands where it sat on the SunVox timeline.
//
// The file is a run of chunks: a 4-character id, a 32-bit little-endian size, then the data. A pattern is either
// PDTA (events) ... PEND, or a clone, PPAR (the pattern it copies) ... PEND; PXXX is its position in lines.
// An event is 8 bytes: note, velocity, module (16 bits, 0 = none, else module number + 1), effect/controller, value.

const NOTE_OFF = 128;
const HIGHEST = 116;   // SunVox note 116 is G-9, the top of the note column; notes above it are left out
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');

function readChunks(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunks = [];
  for (let at = 0; at + 8 <= b.length;) {
    const id = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
    const size = view.getUint32(at + 4, true);
    chunks.push({ id, data: b.subarray(at + 8, Math.min(b.length, at + 8 + size)) });
    at += 8 + size;
  }
  return chunks;
}

const int32 = data => (data.length >= 4 ? new DataView(data.buffer, data.byteOffset, 4).getInt32(0, true) : 0);
const text = data => String.fromCharCode(...data).replace(/\0.*$/s, '').replace(/[^\x20-\x7e]/g, '').trim();

function readEvents(data, tracks, lines) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rows = [];
  for (let line = 0; line < lines; line++) {
    const row = [];
    for (let track = 0; track < tracks; track++) {
      const at = (line * tracks + track) * 8;
      if (at + 8 > data.length) { row.push(null); continue; }
      row.push({ note: data[at], velocity: data[at + 1], module: view.getUint16(at + 2, true) });
    }
    rows.push(row);
  }
  return rows;
}

// Returns { name, bpm, speed, modules: [{ name, type }], patterns: [{ name, tracks, lines, rows, x, y, parent? }] }.
// A clone has `parent` (the index of the pattern it copies) and borrows that pattern's tracks, lines and rows.
export function parseSunvox(buffer) {
  const b = new Uint8Array(buffer);
  const chunks = readChunks(b);
  if (!chunks.length || chunks[0].id !== 'SVOX') throw new Error('Not a SunVox file.');
  const song = { name: '', bpm: 125, speed: 6, modules: [], patterns: [] };
  let pattern = null, module = null;
  for (const { id, data } of chunks) {
    if (id === 'BPM ') song.bpm = int32(data);
    else if (id === 'SPED') song.speed = int32(data);
    else if (id === 'NAME') song.name = text(data);
    else if (id === 'PDTA') pattern = { name: '', tracks: 0, lines: 0, x: 0, y: 0, data };
    else if (id === 'PPAR') pattern = { name: '', parent: int32(data), x: 0, y: 0 };
    else if (pattern && id === 'PCHN') pattern.tracks = int32(data);
    else if (pattern && id === 'PLIN') pattern.lines = int32(data);
    else if (pattern && id === 'PNME') pattern.name = text(data);
    else if (pattern && id === 'PXXX') pattern.x = int32(data);
    else if (pattern && id === 'PYYY') pattern.y = int32(data);
    else if (id === 'PEND') {
      if (pattern) {
        if (pattern.data) pattern.rows = readEvents(pattern.data, pattern.tracks, pattern.lines);
        delete pattern.data;
        song.patterns.push(pattern);
      }
      pattern = null;
    }
    else if (id === 'SFFF') module = { name: '', type: '' };
    else if (module && id === 'SNAM') module.name = text(data);
    else if (module && id === 'STYP') module.type = text(data);
    else if (id === 'SEND') { if (module) song.modules.push(module); module = null; }
  }
  for (const p of song.patterns) {   // a clone takes its parent's notes
    const source = p.parent !== undefined ? song.patterns[p.parent] : null;
    if (source) Object.assign(p, { tracks: source.tracks, lines: source.lines, rows: source.rows });
    if (!p.rows) p.rows = [];
  }
  return song;
}

// The notes one module plays in one pattern, as rows of [note, velocity] per column, or null when it plays none.
// A track becomes a column when the module plays a note on it; a note off with no module stops the track's last note.
function notesFor(pattern, moduleNumber) {
  const columnOf = new Map();
  const lastModule = new Array(pattern.tracks).fill(0);
  const cells = [];
  pattern.rows.forEach((row, line) => row.forEach((event, track) => {
    if (!event || !event.note) return;
    const owner = event.module || (event.note === NOTE_OFF ? lastModule[track] : 0);
    if (event.module && event.note < NOTE_OFF) lastModule[track] = event.module;
    if (owner !== moduleNumber) return;
    if (event.note < NOTE_OFF && !columnOf.has(track)) columnOf.set(track, columnOf.size);
    if (event.note <= NOTE_OFF) cells.push({ line, track, ...event });
  }));
  if (!columnOf.size) return null;
  const width = Math.min(8, columnOf.size);
  const rows = Array.from({ length: pattern.lines }, () => Array.from({ length: width }, () => ['...', '..']));
  for (const { line, track, note, velocity } of cells) {
    const column = columnOf.get(track);
    if (column === undefined || column >= width) continue;
    if (note === NOTE_OFF) { rows[line][column] = ['===', '..']; continue; }
    if (note > HIGHEST) continue;
    const velocityCell = velocity ? hex(Math.round((Math.min(129, velocity) - 1) / 128 * 255), 2) : '..';
    rows[line][column] = [noteToken(note - 1), velocityCell];
  }
  return { width, text: rows.map(r => r.flat().join(' ')).join('\n') };
}

// The project data ({ song, instruments, samples }) for a parsed SunVox file. One SunVox line is one tick; the
// beat is 24 / speed lines when that comes out whole, otherwise 4 ticks with the BPM scaled to keep the tempo.
export function sunvoxToProject(sv, name = 'sunvox') {
  const speed = Math.max(1, sv.speed);
  const whole = Number.isInteger(24 / speed);
  const ticksPerBeat = whole ? 24 / speed : 4;
  const bpm = whole ? sv.bpm : Math.round(sv.bpm * 6 / speed);
  const placed = sv.patterns.filter(p => p.lines > 0 && p.rows.length);
  if (!placed.length) throw new Error('That SunVox file has no patterns.');
  const firstLine = Math.min(...placed.map(p => p.x));

  const playing = new Set();   // module numbers (index + 1) that play notes
  for (const p of placed) for (const row of p.rows) for (const e of row) if (e && e.module && e.module <= sv.modules.length && e.note && e.note <= HIGHEST) playing.add(e.module);
  if (!playing.size) throw new Error('That SunVox file has no notes.');

  const instruments = {}, lanes = [];
  const sourceIndex = p => (p.parent !== undefined ? p.parent : sv.patterns.indexOf(p));
  for (const number of [...playing].sort((a, b) => a - b)) {
    const module = sv.modules[number - 1];
    const id = uniqueId(new Set(Object.keys(instruments)), idFromName(cleanName(module?.name) || `module${number}`));
    const lane = { id, instrument: id, patterns: {}, placements: [] };
    let columns = 1;
    for (const p of placed) {
      const index = sourceIndex(p);
      const source = sv.patterns[index];
      const puid = `sv${hex(index, 3)}${source.name ? `-${idFromName(source.name)}` : ''}`;
      if (!(puid in lane.patterns)) {
        const notes = notesFor(source, number);
        lane.patterns[puid] = notes ? { name: source.name || puid, text: notes.text } : null;
        if (notes) columns = Math.max(columns, notes.width);
      }
      if (lane.patterns[puid]) lane.placements.push({ puid, start: p.x - firstLine, length: p.lines });
    }
    for (const key of Object.keys(lane.patterns)) if (!lane.patterns[key]) delete lane.patterns[key];
    const def = structuredClone(synthKinds.subtractive.make());
    def.noteColumns = columns;
    def.graph.voices = Math.min(16, Math.max(columns + 2, 4));
    instruments[id] = def;
    lane.placements.sort((a, b) => a.start - b.start);
    lanes.push(lane);
  }

  const end = Math.max(...placed.map(p => p.x - firstLine + p.lines));
  const song = {
    name: cleanName(sv.name) || name, bpm, ticksPerBeat, swing: 0.5,
    length: Math.max(16, Math.ceil(end / 16) * 16),
    lanes: [{ id: 'master', instrument: 'master', patterns: {}, placements: [] }, ...lanes],
  };
  const data = { song, instruments, samples: {} };
  ensureMaster(data);
  return data;
}
