import { EMPTY, CUT, OFF, decodeNote, decodeHex1, decodeHex2, decodeHex4 } from '../seq/cells.js';
import { loopRange } from '../seq/loop.js';

// The sequence lives in fixed-size pages of ticks. Each lane has one buffer per
// page, with one float channel per cell channel (see KINDS in cells.js).
export const PAGE_TICKS = 1024;

// Command table for a CCXXYY column: id -> parameter target, as flat arrays so
// that playing a row does not allocate.
function buildCommandTable(commands, presets = []) {
  const t = {
    presets: new Map(presets.map(p => [p.id, p])),   // preset id -> { slots, values, msgs }, recalled by command 00
    slot: new Int32Array(256).fill(-1), min: new Float64Array(256), max: new Float64Array(256), log: new Uint8Array(256), int: new Uint8Array(256) };
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
  song = { bpm: 120, ticksPerBeat: 4, length: 16, swing: 0.5 };
  tick = 0;
  songPos = 0;   // where the song is, in ticks and fractions of one, for nodes that follow the grid
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

  // song.master, when there is one, holds the parameter slots of the master lane ({ bpm, swing, tpb, volume }). The song's
  // own bpm, swing and ticks per beat are where the tempo starts (and what a change in the header sets again); after
  // that the lane's cells move the parameters, and Sequencer.tempo() reads them every tick.
  setSong(song) {
    const old = this.song;
    this.song = song;
    const changed = !old.master || old.bpm !== song.bpm || old.ticksPerBeat !== song.ticksPerBeat || (old.swing ?? 0.5) !== (song.swing ?? 0.5);
    if (song.master && changed) this.resetTempo();
    if (this.runtime.clock) this.runtime.clock.tickSamples = (this.sampleRate * 60) / (song.bpm * song.ticksPerBeat);
  }

  resetTempo() {
    const m = this.song.master;
    if (!m) return;
    this.params[m.bpm] = this.song.bpm;
    this.params[m.swing] = Math.round((this.song.swing ?? 0.5) * 100);
    this.params[m.tpb] = this.song.ticksPerBeat;
    this.params[m.volume] = 1;
  }

  // The tempo now: the master lane's values when there is one, else the song's.
  tempo() {
    const m = this.song.master, s = this.song;
    if (!m) return { bpm: s.bpm, swing: Math.min(0.75, Math.max(0.5, s.swing ?? 0.5)), tpb: s.ticksPerBeat };
    return {
      bpm: Math.min(999, Math.max(20, this.params[m.bpm])),
      swing: Math.min(0.75, Math.max(0.5, this.params[m.swing] / 100)),
      tpb: Math.min(48, Math.max(1, Math.round(this.params[m.tpb]))),
    };
  }

  // lane = { id, instrument, columns, pages }. Messages are preallocated per lane
  // so that playing a row does not allocate.
  setLane({ id, instrument, columns, pages, mask }) {
    const cols = columns.map(c => ({ ...c, table: c.commands ? buildCommandTable(c.commands, c.presets) : null }));
    this.lanes.set(id, {
      instrument, pages,
      mask: mask ?? new Uint8Array(0),   // non-zero for each tick the lane is muted
      muted: false,
      columns: cols,
      channels: cols.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0),
      noteCols: cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0),
      prev: new Int16Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)).fill(-1),   // the note each note column last started
      notes: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      vels: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      trigCols: cols.filter(c => c.kind === 'trig'),
      trigs: new Float32Array(cols.reduce((n, c) => (c.kind === 'trig' ? n + 1 : n), 0)),
      on: { type: 'noteOn', note: 0, vel: 1, from: -1 },   // from: the note this column was playing, for a slide
      off: { type: 'noteOff', note: 0, implied: false },
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
    this.resetTempo();
    this.tick = this.song.loop ? loopRange(this.song).start : 0;   // a loop is played from its start
    this.songPos = this.tick;
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

  // implied: the release comes from a new note in the same column, not from a note off in the pattern.
  release(lane, k, implied = false) {
    if (lane.prev[k] < 0) return;
    lane.off.note = lane.prev[k];
    lane.off.implied = implied;
    this.runtime.note(lane.instrument, lane.off);
    lane.prev[k] = -1;
  }

  // A preset: every parameter it holds, and the drawn curves and spectra, set at once.
  recall(lane, preset) {
    for (let i = 0; i < preset.slots.length; i++) { this.params[preset.slots[i]] = preset.values[i]; this.touch(preset.slots[i]); }
    for (const { node, msg } of preset.msgs) this.runtime.message?.(lane.instrument, node, msg);
  }

  // x is 0..1; the slot gets the value on the parameter's own scale.
  writeParam(slot, min, max, log, x) {
    const value = log ? min * Math.pow(max / min, x) : min + x * (max - min);
    if (Number.isFinite(value)) this.params[slot] = value;
    this.touch(slot);
  }

  // Counts a pattern's write to a slot (nodes watch the count to tell a new event from an unchanged value).
  touch(slot) {
    const stamps = this.runtime.clock?.stamps;
    if (stamps) stamps[slot]++;
  }

  playRow(lane) {
    const page = lane.pages[(this.tick / PAGE_TICKS) | 0];
    if (!page) return;
    const base = (this.tick % PAGE_TICKS) * lane.channels;
    lane.notes.fill(EMPTY);
    lane.vels.fill(1);
    lane.trigs.fill(EMPTY);
    for (let c = 0; c < lane.columns.length; c++) {
      const col = lane.columns[c];
      const v = page[base + col.ch];
      if (v === EMPTY) continue;
      if (col.kind === 'param') {
        // A whole-number parameter (toggle, enum) takes the number in the cell itself, at any width.
        if (col.int) { this.params[col.slot] = Math.min(col.max, col.min + Math.round(v * col.denom)); this.touch(col.slot); }
        else this.writeParam(col.slot, col.min, col.max, col.log, Math.round(v * col.denom) / col.denom);
      } else if (col.kind === 'cmd') {
        // Needs both halves: the command id and its value.
        const value = page[base + col.ch + 1];
        const id = decodeHex2(v), t = col.table;
        if (value !== EMPTY && t.slot[id] >= 0) {
          // 0003 is wave 3 for a whole-number target; otherwise the value runs across the range.
          if (t.int[id] === 1) { this.params[t.slot[id]] = Math.min(t.max[id], t.min[id] + decodeHex4(value)); this.touch(t.slot[id]); }
          else this.writeParam(t.slot[id], t.min[id], t.max[id], t.log[id] === 1, decodeHex4(value) / 65535);
        } else if (value !== EMPTY && id === 0 && t.presets.size) {
          // Command 00 recalls the preset numbered by the value; an unknown number does nothing.
          const preset = t.presets.get(decodeHex4(value));
          if (preset) this.recall(lane, preset);
        }
      } else if (col.kind === 'trig') {
        lane.trigs[col.tc] = v;
      } else if (col.kind === 'vel') {
        lane.vels[col.nc] = decodeHex2(v) / 255;
      } else {
        lane.notes[col.nc] = v;
      }
    }
    // A muted lane still writes its parameters but plays no notes; muting lets what is sounding go.
    const muted = lane.mask[this.tick] > 0;
    if (muted !== lane.muted) {
      lane.muted = muted;
      if (muted) { this.runtime.note(lane.instrument, lane.all); lane.prev.fill(-1); }
    }
    if (muted) return;
    for (let k = 0; k < lane.trigs.length; k++) {   // a trigger cell is a hit of its own: velocity is the digit, 0 is nothing
      const vel = decodeHex1(lane.trigs[k]) / 15;
      if (lane.trigs[k] === EMPTY || vel <= 0) continue;
      lane.on.from = -1;
      lane.on.note = lane.trigCols[k].note;
      lane.on.vel = vel;
      this.runtime.note(lane.instrument, lane.on);
    }
    for (let k = 0; k < lane.noteCols; k++) {
      const note = lane.notes[k];
      if (note === EMPTY) continue;
      if (note === CUT) {
        this.runtime.note(lane.instrument, lane.cut);
        lane.prev.fill(-1);
        continue;
      }
      // A note off ends the column's last note. So does a new note, if the last one has not been
      // released yet: it is released first, and then what happens to it is up to the instrument
      // (a one-shot sample plays out, a looping one fades; a polyphonic instrument lets it ring
      // through its release while the new note takes another voice).
      if (note === OFF) { this.release(lane, k); continue; }
      const from = lane.prev[k];   // still sounding in this column, or -1
      this.release(lane, k, true);
      lane.on.from = from;
      lane.on.note = decodeNote(note);
      lane.on.vel = lane.vels[k];
      this.runtime.note(lane.instrument, lane.on);
      lane.prev[k] = lane.on.note;
    }
  }

  fireTick() {
    for (const lane of this.lanes.values()) this.playRow(lane);
    Atomics.store(this.transport, 0, this.tick);   // the tick now sounding
    if (Math.abs(this.songPos - this.tick) > 1.5) this.songPos = this.tick;   // a loop or the end of the song: back on the grid
    if (this.song.loop) {   // the loop: back to its start when its end is reached
      const { start, end } = loopRange(this.song);
      if (++this.tick >= end || this.tick < start) this.tick = start;
    } else if (++this.tick >= this.song.length) this.tick = 0;
  }

  process(left, right, n) {
    let { bpm, swing, tpb } = this.tempo();
    let samplesPerTick = this.sampleRate * 60 / (bpm * tpb);
    let group = Math.max(1, Math.round(tpb / 4));
    let done = 0;
    while (done < n) {
      let span = n - done;
      if (this.playing) {
        if (this.countdown <= 0) {
          // Swing: ticks come in pairs, and the first of a pair lasts `swing` of the pair, so the
          // second (the off-beat) lands late. 0.5 is straight; 2/3 is a triplet shuffle. At finer ticks the swing
          // stays on the 16ths: with 8 ticks to a beat the groups are two ticks long (slow slow fast fast), with 12
          // three, so changing the resolution does not change the groove.
          const first = (Math.floor(this.tick / group) & 1) === 0;
          this.fireTick();
          ({ bpm, swing, tpb } = this.tempo());   // the row may have changed the tempo
          samplesPerTick = this.sampleRate * 60 / (bpm * tpb);
          group = Math.max(1, Math.round(tpb / 4));
          this.countdown += 2 * samplesPerTick * (first ? swing : 1 - swing);
        }
        span = Math.min(span, Math.max(1, Math.ceil(this.countdown)));
      }
      const clock = this.runtime.clock;
      if (clock) { clock.playing = this.playing; clock.songPos = this.songPos; clock.tickSamples = samplesPerTick; }
      this.runtime.process(this.scratchL, this.scratchR, span);
      const m = this.song.master;
      if (m) {   // the master volume, eased across the span
        const to = this.params[m.volume], from = this.gain ?? to;
        if (from !== 1 || to !== 1) for (let i = 0; i < span; i++) { const g = from + (to - from) * (i + 1) / span; this.scratchL[i] *= g; this.scratchR[i] *= g; }
        this.gain = to;
      }
      if (this.playing) this.songPos += span / samplesPerTick;
      for (let i = 0; i < span; i++) {
        left[done + i] = this.scratchL[i];
        right[done + i] = this.scratchR[i];
      }
      if (this.playing) this.countdown -= span;
      done += span;
    }
  }
}
