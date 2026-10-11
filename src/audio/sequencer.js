import { EMPTY, CUT, OFF, decodeNote, decodeHex2 } from '../seq/cells.js';

// The sequence lives in fixed-size pages of ticks. Each lane has one buffer per
// page, with one float channel per column.
export const PAGE_TICKS = 1024;

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
    this.lanes.set(id, {
      instrument, columns, pages,
      channels: columns.length,
      prev: -1,
      on: { type: 'noteOn', note: 0, vel: 1 },
      off: { type: 'noteOff', note: 0 },
      cut: { type: 'noteCut' },
    });
  }

  play() {
    this.tick = 0;
    this.countdown = 0;
    this.playing = true;
    this.transport[1] = 1;
  }

  stop() {
    for (const lane of this.lanes.values()) this.release(lane);
    this.playing = false;
    this.transport[1] = 0;
  }

  release(lane) {
    if (lane.prev < 0) return;
    lane.off.note = lane.prev;
    this.runtime.note(lane.instrument, lane.off);
    lane.prev = -1;
  }

  playRow(lane) {
    const page = lane.pages[(this.tick / PAGE_TICKS) | 0];
    if (!page) return;
    const base = (this.tick % PAGE_TICKS) * lane.channels;
    let note = EMPTY, vel = 1;
    for (let c = 0; c < lane.channels; c++) {
      const v = page[base + c];
      if (v === EMPTY) continue;
      const col = lane.columns[c];
      if (col.kind === 'param') {
        const x = decodeHex2(v) / 255;
        this.params[col.slot] = col.log
          ? col.min * Math.pow(col.max / col.min, x)
          : col.min + x * (col.max - col.min);
      } else if (col.kind === 'vel') {
        vel = decodeHex2(v) / 255;
      } else {
        note = v;
      }
    }
    if (note === EMPTY) return;
    if (note === CUT) {
      this.runtime.note(lane.instrument, lane.cut);
      lane.prev = -1;
      return;
    }
    this.release(lane);   // a new note or a note off ends the previous one
    if (note === OFF) return;
    lane.on.note = decodeNote(note);
    lane.on.vel = vel;
    this.runtime.note(lane.instrument, lane.on);
    lane.prev = lane.on.note;
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
