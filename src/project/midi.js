import { noteToken } from '../seq/cells.js';
import { synthKinds } from '../instruments.js';
import { cleanName, uniqueId } from './ops.js';

// Standard MIDI files (format 0 and 1) -> tracks of notes, and notes -> lanes on new synth instruments.

const text = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));

// Returns { ppq, bpm, tracks: [{ name, channel, notes: [{ time, length, note, vel }] }] }; times are in quarter notes.
// A format 0 file (everything in one track) is split by channel.
export function parseMidi(buffer) {
  const b = new Uint8Array(buffer), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (text(b, 0, 4) !== 'MThd') throw new Error('Not a MIDI file.');
  const format = dv.getUint16(8), count = dv.getUint16(10), division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('MIDI files timed in SMPTE frames are not supported.');
  const ppq = division;
  let at = 8 + dv.getUint32(4), bpm = null;
  const raw = [];
  for (let t = 0; t < count && at + 8 <= b.length; t++) {
    if (text(b, at, at + 4) !== 'MTrk') throw new Error('Damaged MIDI file (missing track).');
    const end = Math.min(b.length, at + 8 + dv.getUint32(at + 4));
    let p = at + 8, tick = 0, status = 0, name = '';
    const events = [];
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status;   // running status
      if (s === 0xff) {
        const type = b[p++], len = vlq();
        if (type === 0x03 && !name) name = text(b, p, p + len).replace(/[^\x20-\x7e]/g, '').trim();
        if (type === 0x51 && bpm === null && len === 3) bpm = 60000000 / ((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]);
        p += len;
      } else if (s === 0xf0 || s === 0xf7) {
        p += vlq();
      } else {
        const kind = s & 0xf0, ch = s & 15, a = b[p++], v = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++];
        if (kind === 0x90 && v > 0) events.push({ tick, ch, note: a, vel: v, on: true });
        else if (kind === 0x80 || kind === 0x90) events.push({ tick, ch, note: a, on: false });
      }
    }
    raw.push({ name, events });
    at = end;
  }
  const tracks = [];
  for (const { name, events } of raw) {
    const groups = format === 0 || raw.length === 1 ? [...new Set(events.map(e => e.ch))].map(ch => events.filter(e => e.ch === ch)) : [events];
    for (const list of groups) {
      const open = new Map(), notes = [];
      for (const e of list) {
        const key = `${e.ch}:${e.note}`;
        if (e.on) { if (open.has(key)) { const o = open.get(key); notes.push({ time: o.tick / ppq, length: (e.tick - o.tick) / ppq, note: e.note, vel: o.vel }); } open.set(key, e); }
        else if (open.has(key)) { const o = open.get(key); notes.push({ time: o.tick / ppq, length: (e.tick - o.tick) / ppq, note: e.note, vel: o.vel }); open.delete(key); }
      }
      const last = Math.max(0, ...list.map(e => e.tick));
      for (const o of open.values()) notes.push({ time: o.tick / ppq, length: Math.max(1, last - o.tick) / ppq, note: o.note, vel: o.vel });
      if (!notes.length) continue;
      notes.sort((x, y) => x.time - y.time || x.note - y.note);
      const channel = list[0].ch;
      tracks.push({ name: name || `ch${channel + 1}`, channel, notes });
    }
  }
  return { ppq, bpm: bpm ?? 120, tracks };
}

// Adds a lane on a new subtractive synth for every track of the file to project data ({ song, instruments, samples },
// as ops.projectData gives). The song's ticks per beat are raised when the file needs finer timing than 16ths (what is
// already there is spread out to match); notes snap to the ticks; chords go over note columns, each note
// running until its note off; velocity goes in the volume column. The song's tempo becomes the file's and it grows to
// fit. Returns the number of lanes added and whether the end was cut off.
// The song's ticks per beat that suits the file: the smallest of 4 (16ths), 8, 12 (triplets), 16 and 24 that puts 95% of
// the note starts within a tenth of a tick of a tick, else the one that fits best. It is made a multiple of the song's own
// so what is already there can be spread out to match (see retime).
export function pickResolution(midi, current = 4) {
  const starts = midi.tracks.flatMap(t => t.notes.map(n => n.time));
  if (!starts.length) return current;
  let best = current, bestScore = -1;
  for (const c of [4, 8, 12, 16, 24]) {
    const tpb = c % current === 0 ? c : current * c / (current > 0 ? gcd(current, c) : 1);
    if (tpb > 48) continue;
    const score = starts.filter(t => Math.abs(t * tpb - Math.round(t * tpb)) <= 0.1).length / starts.length;
    if (score >= 0.95) return tpb;
    if (score > bestScore + 1e-9) { best = tpb; bestScore = score; }
  }
  return best;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Spreads the song out by a whole number: every row is followed by k - 1 empty ones and every position, length and
// loop point is multiplied, so it plays exactly as before at k times the ticks per beat.
export function retime(data, k) {
  if (k === 1) return;
  const { song } = data;
  if (song.length * k > 4096) throw new Error('The song is too long to be given finer ticks (the limit is 4096).');
  const gap = text => text.split('\n').flatMap(line => {
    const blank = line.trim().split(/\s+/).map(c => '.'.repeat(c.length)).join(' ');
    return [line, ...Array.from({ length: k - 1 }, () => blank)];
  }).join('\n');
  for (const lane of song.lanes) {
    for (const p of Object.values(lane.patterns)) p.text = gap(p.text);
    lane.placements = lane.placements.map(pl => ({ ...pl, start: pl.start * k, length: pl.length * k }));
    if (lane.mutes) lane.mutes = lane.mutes.map(t => t * k);
    if (lane.offs) lane.offs = lane.offs.map(t => t * k);
  }
  if (song.loop) song.loop = { start: song.loop.start * k, end: song.loop.end * k };
  song.length *= k;
  song.ticksPerBeat *= k;
}

export function importMidi(data, midi, { maxLength = 4096 } = {}) {
  const { song } = data;
  const tpb = pickResolution(midi, song.ticksPerBeat ?? 4);
  retime(data, tpb / song.ticksPerBeat);
  const hex = n => n.toString(16).toUpperCase().padStart(2, '0');
  const placed = midi.tracks.map(t => t.notes.map(n => {
    const start = Math.round(n.time * tpb);
    return { start, end: Math.max(start + 1, Math.round((n.time + n.length) * tpb)), note: n.note, vel: n.vel };
  }));
  const end = Math.max(0, ...placed.flat().map(n => n.end));
  const length = Math.min(maxLength, Math.max(song.length, Math.ceil(end / 16) * 16));
  let lanes = 0;
  midi.tracks.forEach((track, i) => {
    const notes = placed[i].filter(n => n.start < length && n.note >= 12 && n.note <= 127);
    const cols = [];   // the tick each note column is free from
    for (const n of notes) {
      let c = cols.findIndex(free => free <= n.start);
      if (c < 0) c = cols.push(0) - 1;
      n.col = c; cols[c] = Math.min(n.end, length);
    }
    const width = Math.min(8, Math.max(1, cols.length));
    const rows = Array.from({ length }, () => Array.from({ length: width }, () => ['...', '..']));
    for (const n of notes) {
      if (n.col >= width) continue;
      if (n.end < length && rows[n.end][n.col][0] === '...') rows[n.end][n.col][0] = '===';
      rows[n.start][n.col] = [noteToken(n.note - 12), hex(Math.round(n.vel / 127 * 255))];
    }
    const name = cleanName(track.name) || `track${i + 1}`;
    const id = uniqueId(new Set(Object.keys(data.instruments)), name);
    const def = structuredClone(synthKinds.subtractive.make());
    def.noteColumns = width;
    def.graph.voices = Math.min(16, Math.max(width + 2, 4));
    data.instruments[id] = def;
    const puid = `midi-${id}`;
    song.lanes.push({
      id: uniqueId(new Set(song.lanes.map(l => l.id)), id),
      instrument: id,
      patterns: { [puid]: { name: id, text: rows.map(r => r.flat().join(' ')).join('\n') } },
      placements: [{ puid, start: 0, length }],
    });
    lanes++;
  });
  song.length = length;
  song.bpm = Math.round(midi.bpm);
  return { lanes, cut: end > length, ticksPerBeat: tpb };
}
