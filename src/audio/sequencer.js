import { EMPTY, CUT, OFF, relativeNote, decodeNote, decodeHex1, decodeHex2, decodeHex4 } from '../seq/cells.js';
import { loopRange } from '../seq/loop.js';
import { RES } from '../seq/automation.js';
import { Limiter } from './limiter.js';
import { NodeSeq } from './nodeseq.js';

// The sequence lives in fixed-size pages of ticks. Each lane has one buffer per
// page, with one float channel per cell channel (see KINDS in cells.js).
export const PAGE_TICKS = 1024;

// Command table for a CCXXYY column: id -> parameter target, as flat arrays so
// that playing a row does not allocate.
function buildCommandTable(commands, presets = [], groups = {}) {
  const t = {
    presets: new Map(presets.map(p => [p.id, p])),   // preset id -> { slots, values, msgs }, recalled by command 00
    slot: new Int32Array(256).fill(-1), min: new Float64Array(256), max: new Float64Array(256), log: new Uint8Array(256), int: new Uint8Array(256), fix: new Float64Array(256).fill(NaN), reset: new Uint8Array(256), setting: new Uint8Array(256), groups };   // fix: a command that writes one value whatever its value cell says
  for (const c of commands) {
    if (c.reset) t.reset[c.id] = c.reset; if (c.setting) t.setting[c.id] = c.setting === 'save' ? 1 : 2;
    t.slot[c.id] = c.slot; t.min[c.id] = c.min; t.max[c.id] = c.max; t.log[c.id] = c.log ? 1 : 0; t.int[c.id] = c.int ? 1 : 0; if (Number.isFinite(c.fixed)) t.fix[c.id] = c.fixed;
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
  tickLen = 0;     // samples in the tick now sounding (swing makes them differ)
  playing = false;
  preview = 0;     // samples left of a single played row, after which what it started is let go

  constructor({ sampleRate, runtime, params, transport, maxBlock = 512 }) {
    const self = this;
    this.sampleRate = sampleRate;
    this.runtime = runtime;
    this.params = params;         // Float32Array over the shared parameter block
    this.transport = transport;   // Int32Array: [tick, playing, how far through the tick, in 1/65536]
    this.limiter = new Limiter(sampleRate);
    this.scratchL = new Float32Array(maxBlock);
    this.scratchR = new Float32Array(maxBlock);
    // the Node Sequencer: its graph runs on the same clock, subdividing each tick (the swing of a tick carries into its subticks)
    this.post = () => {};   // set by the worklet: messages to the page
    this.ns = new NodeSeq({ sampleRate, io: { note: (instrument, msg) => this.runtime.note(instrument, msg), get params() { return self.params; }, get stamps() { return self.runtime.clock?.stamps; }, post: m => this.post(m) } });
    this.subIdx = 0; this.subLen = 0; this.subCountdown = 0;
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

  // The graph of the Node Sequencer (see nodeseq.js), with what its names mean on this machine.
  setNodeseq(graph, resolve) { this.ns.load(graph, resolve); }

  // A number for the meters that keeps the largest value since they last looked (they read it and clear it).
  report(slot, value) { if (value > Atomics.load(this.transport, slot)) Atomics.store(this.transport, slot, value); }

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
  setLane({ id, instrument, columns, pages, mask, auto }) {
    const cols = columns.map(c => ({ ...c, table: c.commands ? buildCommandTable(c.commands, c.presets, c.groups) : null }));
    const before = this.lanes.get(id);
    if (before) this.restoreAmp(before);
    const fresh = {
      instrument, pages,
      mask: mask ?? new Uint8Array(0),   // 1 or 2 for each tick the lane is muted, plus 4 where it lets go of its notes
      muted: false,
      auto: auto ?? [],   // lane curves: { slot, min, max, log, taper, table } with the value (0..1) at RES samples a tick, NaN where there is none
      autoCur: new Float32Array(auto?.length ?? 0).fill(NaN),   // where each curve's parameter is (0..1), NaN before it has acted
      columns: cols,
      channels: cols.reduce((n, c) => Math.max(n, c.ch + (c.kind === 'cmd' ? 2 : 1)), 0),
      noteCols: cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0),
      prev: new Int16Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)).fill(-1),   // the note each note column last started
      notes: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      vels: new Float32Array(cols.reduce((n, c) => (c.kind === 'note' ? n + 1 : n), 0)),
      noteTargets: cols.filter(c => c.kind === 'note').map(c => c.target ?? instrument),   // the machine each note column plays (a meta machine's columns play other machines)
      targets: [...new Set(cols.filter(c => c.target).map(c => c.target))],   // every machine the lane plays; just its own when no column names one
      colKeys: cols.filter(c => c.kind === 'note').map((_, k) => `${id}:${k}`),   // which note column a note came from, for machines that keep a column on one voice
      trigCols: cols.filter(c => c.kind === 'trig'),
      trigs: new Float32Array(cols.reduce((n, c) => (c.kind === 'trig' ? n + 1 : n), 0)),
      on: { type: 'noteOn', note: 0, vel: 1, from: -1 },   // from: the note this column was playing, for a slide
      off: { type: 'noteOff', note: 0, implied: false },
      cut: { type: 'noteCut' },
      all: { type: 'allOff' },
    };
    // A lane that is replaced while it plays (its machine was rewired, a column changed) keeps what it was sounding, so the
    // note-offs still find their notes; with a different set of note columns everything of that machine is let go instead.
    if (before && before.instrument === instrument) {   // (a meta machine's columns are matched by key when they change, not here)
      if (before.prev.length === fresh.prev.length) { fresh.prev.set(before.prev); fresh.notes.set(before.notes); fresh.vels.set(before.vels); fresh.muted = before.muted; fresh.settings = before.settings; }
      else if (before.prev.some(n => n >= 0)) this.allOff(before);
    }
    this.lanes.set(id, fresh);
  }

  // Drops every lane, stops, and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.lanes.clear();
    this.ns.stop();
    this.playing = false;
    this.tick = 0;
    this.transport[0] = 0;
    this.transport[1] = 0;
  }

  // From a tick when one is given; otherwise from the start of the loop, or of the song.
  play(from = null) {
    if (this.playing) this.releaseAll();   // jumping while playing: what rings is let go first
    this.resetTempo();
    this.preview = 0;
    this.tick = from !== null && from >= 0 && from < this.song.length ? from : this.song.loop ? loopRange(this.song).start : 0;
    this.songPos = this.tick;
    for (const lane of this.lanes.values()) { this.restoreAmp(lane); lane.autoCur.fill(NaN); }
    this.countdown = 0;
    this.subIdx = 0; this.subLen = 0; this.subCountdown = 0;
    this.ns.start();
    this.playing = true;
    this.transport[1] = 1;
  }

  // Stopping lets every voice fade out over its release time.
  // A Volume curve leaves the machine at its own level (the channel stage back at 1), not wherever the curve stopped.
  restoreAmp(lane) {
    for (let k = 0; k < lane.auto.length; k++) if (lane.auto[k].amp && !Number.isNaN(lane.autoCur[k])) this.params[lane.auto[k].slot] = 1;
  }

  stop() {
    for (const lane of this.lanes.values()) this.restoreAmp(lane);
    this.releaseAll();
    this.ns.stop();
    this.preview = 0;
    this.playing = false;
    this.transport[1] = 0;
  }

  // Lets go of everything a lane is sounding, on every machine it plays.
  allOff(lane) {
    if (lane.targets.length === 0) this.runtime.note(lane.instrument, lane.all);
    else for (const t of lane.targets) this.runtime.note(t, lane.all);
  }

  releaseAll() {
    for (const lane of this.lanes.values()) {
      this.allOff(lane);
      lane.prev.fill(-1);
    }
  }

  // Plays one row once, without starting the song: every lane's events at that tick fire together, and what they started
  // is let go a beat later. Does nothing while the song plays.
  row(tick) {
    if (this.playing || tick < 0 || tick >= this.song.length) return;
    this.releaseAll();
    this.tick = tick;
    this.songPos = tick;
    this.resetTempo();
    const clock = this.runtime.clock;
    if (clock) clock.tickId = (clock.tickId | 0) + 1;
    for (const lane of this.lanes.values()) this.playRow(lane);
    Atomics.store(this.transport, 0, tick);
    this.preview = this.sampleRate * 60 / this.tempo().bpm;
  }

  // implied: the release comes from a new note in the same column, not from a note off in the pattern.
  release(lane, k, implied = false) {
    if (lane.prev[k] < 0) return;
    lane.off.note = lane.prev[k];
    lane.off.implied = implied;
    this.runtime.note(lane.noteTargets[k], lane.off);
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
        const inGroups = mask => Object.entries(t.groups).filter(([bit]) => mask & bit).flatMap(([, list]) => list);
        if (t.reset[id]) { for (const g of inGroups(t.reset[id])) { this.params[g.slot] = g.value; this.touch(g.slot); } }   // Ax: back to the starting values
        else if (t.setting[id] && value !== EMPTY) {   // 70 save, 71 load: xx the groups, yy the slot of 16
          const x = decodeHex4(value), list = inGroups((x >> 8) & 255), slotNo = x & 15;
          lane.settings ??= [];
          if (t.setting[id] === 1) lane.settings[slotNo] = list.map(g => [g.slot, this.params[g.slot]]);
          else for (const [slot, val] of lane.settings[slotNo] ?? []) if (list.some(g => g.slot === slot)) { this.params[slot] = val; this.touch(slot); }
        }
        else if (t.slot[id] >= 0 && !Number.isNaN(t.fix[id])) { this.params[t.slot[id]] = t.fix[id]; this.touch(t.slot[id]); }   // e.g. F0: back to relative offsets
        else if (value !== EMPTY && t.slot[id] >= 0) {
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
        lane.notes[col.nc] = col.rel ? relativeNote(v, col.root) : v;
      }
    }
    // A muted lane still writes its parameters but plays no notes; muting lets what is sounding go.
    if (lane.mask[this.tick] & 4) { this.allOff(lane); lane.prev.fill(-1); }   // a note-off marker
    const muted = (lane.mask[this.tick] & 3) > 0;
    if (muted !== lane.muted) {
      lane.muted = muted;
      if (muted) { this.allOff(lane); lane.prev.fill(-1); }
    }
    if (muted) return;
    for (let k = 0; k < lane.trigs.length; k++) {   // a trigger cell is a hit of its own: velocity is the digit, 0 is nothing
      const vel = decodeHex1(lane.trigs[k]) / 15;
      if (lane.trigs[k] === EMPTY || vel <= 0) continue;
      lane.on.from = -1;
      lane.on.col = undefined;
      lane.on.note = lane.trigCols[k].note;
      lane.on.vel = vel;
      this.runtime.note(lane.trigCols[k].target ?? lane.instrument, lane.on);
    }
    for (let k = 0; k < lane.noteCols; k++) {
      const note = lane.notes[k];
      if (note === EMPTY) continue;
      if (note === CUT) {
        this.runtime.note(lane.noteTargets[k], lane.cut);
        if (lane.targets.length === 0) lane.prev.fill(-1);
        else for (let j = 0; j < lane.noteCols; j++) if (lane.noteTargets[j] === lane.noteTargets[k]) lane.prev[j] = -1;
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
      lane.on.col = lane.colKeys[k];
      lane.on.note = decodeNote(note);
      lane.on.vel = lane.vels[k];
      this.runtime.note(lane.noteTargets[k], lane.on);
      lane.prev[k] = lane.on.note;
    }
  }

  // The lane curves at the song position, eased: a parameter follows its curve with a short lag (so a steep stretch does not
  // click), and when a section ends it glides back to the curve's rest value, if it has one. A value a pattern wrote stays
  // until the curve moves it again.
  volFloor = 0;
  applyCurves(span) {
    const p = this.songPos * RES, i = Math.floor(p);
    const follow = 1 - Math.exp(-span / (this.sampleRate * 0.02)), release = 1 - Math.exp(-span / (this.sampleRate * 0.12));
    for (const lane of this.lanes.values()) {
      for (let k = 0; k < lane.auto.length; k++) {
        const a = lane.auto[k], tab = a.table;
        let x = NaN;
        if (i >= 0 && i < tab.length - 1) { const v0 = tab[i], v1 = tab[i + 1]; x = Number.isNaN(v1) ? v0 : v0 + (v1 - v0) * (p - i); }
        let cur = lane.autoCur[k], want, rate;
        if (!Number.isNaN(x)) { want = x; rate = follow; }
        else if (a.rest !== null && !Number.isNaN(cur) && cur !== a.rest) { want = a.rest; rate = release; }
        else continue;
        cur = Number.isNaN(cur) ? want : cur + (want - cur) * rate;
        if (Math.abs(cur - want) < 1e-4) cur = want;
        if (cur === lane.autoCur[k]) continue;
        lane.autoCur[k] = cur;
        let e = a.taper === 1 ? cur : cur ** a.taper;
        if (a.amp && e < this.volFloor) e = this.volFloor;   // Config, De-normal diagnostics: a Volume curve never closes the channel completely
        this.params[a.slot] = a.log ? a.min * (a.max / a.min) ** e : a.min + e * (a.max - a.min);
      }
    }
  }

  fireTick() {
    const clock = this.runtime.clock;
    if (clock) clock.tickId = (clock.tickId | 0) + 1;   // nodes that count song ticks (the MOD channel) watch this
    for (const lane of this.lanes.values()) this.playRow(lane);
    if (this.ns.list.length) {   // the Node Sequencer's tick, after the patterns have written their parameters (a cell can start or stop a group)
      const { bpm, tpb } = this.tempo();
      this.ns.onTick(this.tick, { tpb, barTicks: Math.max(1, Math.round(this.song.beatsPerBar ?? 4)) * tpb, tickSamples: this.sampleRate * 60 / (bpm * tpb), bpm });
    }
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
          this.tickLen = 2 * samplesPerTick * (first ? swing : 1 - swing);
          this.countdown += this.tickLen;
          this.subIdx = 0; this.subLen = this.tickLen / this.ns.subs; this.subCountdown = this.subLen;
        }
        span = Math.min(span, Math.max(1, Math.ceil(this.countdown)));
        if (this.ns.subs > 1 && this.ns.list.length) span = Math.min(span, Math.max(1, Math.ceil(this.subCountdown)));   // the next subtick
      }
      const clock = this.runtime.clock;
      if (clock) { clock.playing = this.playing; clock.songPos = this.songPos; clock.tickSamples = samplesPerTick; }
      if (this.playing) { this.applyCurves(span); if (this.ns.list.length) this.ns.control(span); }
      this.runtime.process(this.scratchL, this.scratchR, span);
      const m = this.song.master;
      if (m) {   // the master volume, eased across the span
        const to = this.params[m.volume], from = this.gain ?? to;
        if (from !== 1 || to !== 1) for (let i = 0; i < span; i++) { const g = from + (to - from) * (i + 1) / span; this.scratchL[i] *= g; this.scratchR[i] *= g; }
        this.gain = to;
        // the limiter, after the volume. What the meters show (how much it held back, the loudest input) goes in the transport.
        if (m.limit !== undefined) {
          const on = this.params[m.limit] >= 0.5;
          if (on) {
            const res = this.limiter.process(this.scratchL, this.scratchR, span, this.params[m.ceiling], this.params[m.boost], this.params[m.release]);
            if (this.transport.length > 5) { this.report(4, Math.round(res.reduction * 100)); this.report(5, Math.round((Math.max(-200, res.peak) + 200) * 100)); }
          } else if (this.transport.length > 5) {
            let top = 0;
            for (let i = 0; i < span; i++) top = Math.max(top, Math.abs(this.scratchL[i]), Math.abs(this.scratchR[i]));
            this.report(5, Math.round((Math.max(-200, 20 * Math.log10(Math.max(1e-10, top))) + 200) * 100));
          }
        }
      }
      if (this.playing) this.songPos += span / samplesPerTick;
      for (let i = 0; i < span; i++) {
        left[done + i] = this.scratchL[i];
        right[done + i] = this.scratchR[i];
      }
      if (this.playing) {
        this.countdown -= span;
        if (this.ns.list.length && this.ns.subs > 1) {   // a subtick starts (the first of a tick came with the tick itself; the last ends where the next tick begins)
          this.subCountdown -= span;
          if (this.subCountdown <= 0 && this.subIdx + 1 < this.ns.subs) { this.subIdx++; this.ns.onSub(this.subIdx); this.subCountdown += this.subLen; }
        }
      }
      if (this.preview > 0 && (this.preview -= span) <= 0) this.releaseAll();
      done += span;
    }
    // how far through the sounding tick the song is, for whatever on the page wants a position finer than a tick (MIDI recording)
    this.transport[2] = this.playing && this.tickLen > 0 ? Math.max(0, Math.min(65535, Math.floor((1 - this.countdown / this.tickLen) * 65536))) : 0;
  }
}
