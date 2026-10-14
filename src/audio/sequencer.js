import { EMPTY, CUT, OFF, decodeNote, decodeHex2, decodeHex4 } from '../seq/cells.js';

// The sequence lives in fixed-size pages of ticks. Each lane has one buffer per
// page, with one float channel per cell channel (see KINDS in cells.js).
export const PAGE_TICKS = 1024;

// Command table for a CCXXYY column: id -> parameter target, as flat arrays so
// that playing a row does not allocate.
function buildCommandTable(commands) {
  const t = { slot: new Int32Array(256).fill(-1), min: new Float64Array(256), max: new Float64Array(256), log: new Uint8Array(256), int: new Uint8Array(256) };
  for (const c of commands) {
    t.slot[c.id] = c.slot; t.min[c.id] = c.min; t.max[c.id] = c.max; t.log[c.id] = c.log ? 1 : 0; t.int[c.id] = c.int ? 1 : 0;
  }
  return t;
}

// Runs on the audio thread. Splits each block at tick boundaries so events land
// on the exact sample, writes parameter columns into the shared slots, and sends
// note events to the lane's instrument. Pure logic, so it also runs offline.
export class Sequencer {
  lanes = new Map();
  song = { bpm: 120, ticksPerBeat: 4, length: 16 };
  tick = 0;
  countdown = 0;
  playing = false;

  constructor({ sampleRate, runtime, params, transport, maxBlock = 512 }) {
    this.sampleRate = sampleRate;
    this.runtime = runtime;
    this.params = params;         // Float32Array over the shared parameter block
    this.transport = transport;   // Int32Array: [tick, playing]
    this.scratchL = new Float32Array(maxBlock);
    this.scratchR = new Float32Array(maxBlock);
  }

  setSong(song) {
    this.song = song;
  }

  // lane = { id, instrument, columns, pages }. Messages are preallocated per lane
  // so that playing a row does not allocate.
  setLane({ id, instrument, columns, pages }) {
    const cols = columns.map(c => ({ ...c, table: c.commands ? buildCommandTable(c.commands) : null }));
    this.lanes.set(id, {
      instrument, pages,
      columns: cols,
      channels: cols.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0),
      noteCols: cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0),
      prev: new Int16Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)).fill(-1),   // the note each note column last started
      notes: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      vels: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      on: { type: 'noteOn', note: 0, vel: 1 },
      off: { type: 'noteOff', note: 0 },
      cut: { type: 'noteCut' },
      all: { type: 'allOff' },
    });
  }

  // Drops every lane, stops, and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.lanes.clear();
    this.playing = false;
    this.tick = 0;
    this.transport[0] = 0;
    this.transport[1] = 0;
  }

  play() {
    this.tick = 0;
    this.countdown = 0;
    this.playing = true;
    this.transport[1] = 1;
  }

  // Stopping lets every voice fade out over its release time.
  stop() {
    for (const lane of this.lanes.values()) {
      this.runtime.note(lane.instrument, lane.all);
      lane.prev.fill(-1);
    }
    this.playing = false;
    this.transport[1] = 0;
  }

  release(lane, k) {
    if (lane.prev[k] < 0) return;
    lane.off.note = lane.prev[k];
    this.runtime.note(lane.instrument, lane.off);
    lane.prev[k] = -1;
  }

  // x is 0..1; the slot gets the value on the parameter's own scale.
  writeParam(slot, min, max, log, x) {
    const value = log ? min * Math.pow(max / min, x) : min + x * (max - min);
    if (Number.isFinite(value)) this.params[slot] = value;
  }

  playRow(lane) {
    const page = lane.pages[(this.tick / PAGE_TICKS) | 0];
    if (!page) return;
    const base = (this.tick % PAGE_TICKS) * lane.channels;
    lane.notes.fill(EMPTY);
    lane.vels.fill(1);
    for (let c = 0; c < lane.columns.length; c++) {
      const col = lane.columns[c];
      const v = page[base + col.ch];
      if (v === EMPTY) continue;
      if (col.kind === 'param') {
        // A whole-number parameter (toggle, enum) takes the number in the cell itself, at any width.
        if (col.int) this.params[col.slot] = Math.min(col.max, col.min + Math.round(v * col.denom));
        else this.writeParam(col.slot, col.min, col.max, col.log, Math.round(v * col.denom) / col.denom);
      } else if (col.kind === 'cmd') {
        // Needs both halves: the command id and its value.
        const value = page[base + col.ch + 1];
        const id = decodeHex2(v), t = col.table;
        if (value !== EMPTY && t.slot[id] >= 0) {
          // 0003 is wave 3 for a whole-number target; otherwise the value runs across the range.
          if (t.int[id] === 1) this.params[t.slot[id]] = Math.min(t.max[id], t.min[id] + decodeHex4(value));
          else this.writeParam(t.slot[id], t.min[id], t.max[id], t.log[id] === 1, decodeHex4(value) / 65535);
        }
      } else if (col.kind === 'vel') {
        lane.vels[col.nc] = decodeHex2(v) / 255;
      } else {
        lane.notes[col.nc] = v;
      }
    }
    for (let k = 0; k < lane.noteCols; k++) {
      const note = lane.notes[k];
      if (note === EMPTY) continue;
      if (note === CUT) {
        this.runtime.note(lane.instrument, lane.cut);
        lane.prev.fill(-1);
        continue;
      }
      // A new note does not end the previous one: what happens to it is the instrument's
      // new-note action (a one-shot sample plays out, a looping one fades or is cut), or, for a
      // polyphonic instrument, it takes another voice. A note off ends the column's last note.
      if (note === OFF) { this.release(lane, k); continue; }
      lane.on.note = decodeNote(note);
      lane.on.vel = lane.vels[k];
      this.runtime.note(lane.instrument, lane.on);
      lane.prev[k] = lane.on.note;
    }
  }

  fireTick() {
    for (const lane of this.lanes.values()) this.playRow(lane);
    Atomics.store(this.transport, 0, this.tick);   // the tick now sounding
    if (++this.tick >= this.song.length) this.tick = 0;
  }

  process(left, right, n) {
    const samplesPerTick = this.sampleRate * 60 / (this.song.bpm * this.song.ticksPerBeat);
    let done = 0;
    while (done < n) {
      let span = n - done;
      if (this.playing) {
        if (this.countdown <= 0) {
          this.fireTick();
          this.countdown += samplesPerTick;
        }
        span = Math.min(span, Math.max(1, Math.ceil(this.countdown)));
      }
      this.runtime.process(this.scratchL, this.scratchR, span);
      for (let i = 0; i < span; i++) {
        left[done + i] = this.scratchL[i];
        right[done + i] = this.scratchR[i];
      }
      if (this.playing) this.countdown -= span;
      done += span;
    }
  }
}
