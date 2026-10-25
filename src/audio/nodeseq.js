// The Node Sequencer's engine. It runs on the audio thread beside the pattern lanes (the Sequencer calls it on every tick and subtick),
// and offline in the tests: it has no audio of its own, it sends notes and parameter values out through `io`.
//
//   io.note(instrument, msg)   a note message for an instrument (noteOn, noteOff)
//   io.params, io.stamps       the shared parameter block, and the count of pattern writes to each slot
//   io.post(msg)               a message to the page (activity, notes to record, mistakes in a script)
//
// A graph is { sub, nodes: [{ id, type, group, params, data }], wires: [{ from: "node.port", to: "node.port" }], groups: [{ name, on }] };
// `resolve` says what the names in it mean on this machine: { slots: { nodeId: { slot, min, max, log, int } }, groupSlots: [slot or -1 for each group] }.
import { NS_TYPES, defaultParams } from '../nodeseq/nodes.js';

export const MAX_SUBS = 16, MAX_GROUPS = 8;

export class NodeSeq {
  constructor({ sampleRate = 44100, io, random = Math.random } = {}) {
    this.sampleRate = sampleRate;
    this.io = io;
    this.rand = random;
    this.info = { tick: 0, subIdx: 0, subs: 4, tpb: 4, barTicks: 16, abs: 0, tickSec: 0.125, bpm: 120 };
    this.subs = 4;
    this.recs = new Map(); this.list = []; this.corder = []; this.wires = [];
    this.on = new Array(MAX_GROUPS).fill(true); this.seen = new Array(MAX_GROUPS).fill(0);
    this.resolve = {}; this.queue = []; this.depth = 0; this.abs = -1;
    this.watch = false; this.record = false;   // whether the page wants activity, and notes to write into patterns
    this.pulses = []; this.errors = new Map(); this.monLeft = 0;
    this.host = this.makeHost();
  }

  makeHost() {
    return {
      noteOn: (target, note, vel, from, key) => { if (target) this.io.note(target, { type: 'noteOn', note, vel, from, col: key }); },
      noteOff: (target, note) => { if (target) this.io.note(target, { type: 'noteOff', note, implied: false }); },
      setParam: (id, x) => {
        const r = this.resolve.slots?.[id];
        if (!r || r.slot === undefined || r.slot < 0) return;
        let v = r.log ? r.min * Math.pow(r.max / r.min, x) : r.min + x * (r.max - r.min);
        if (r.int) v = Math.round(v);
        if (Number.isFinite(v)) this.io.params[r.slot] = v;   // not counted as a pattern write: it is not an event
      },
      recordNote: (id, target, note, vel, subs) => {
        if (this.record && target) this.io.post({ type: 'nsnote', id, target, note, vel, subs, tick: this.info.tick, sub: this.info.subIdx });
      },
      monitor: (id, v, vel) => { if (this.watch && this.monLeft > 0) { this.monLeft--; this.io.post({ type: 'nsmon', id, v, vel, tick: this.info.tick, sub: this.info.subIdx }); } },
      setGroup: (g, mode) => { if (g >= 0 && g < MAX_GROUPS) this.setGroupOn(g, mode === 0 ? true : mode === 1 ? false : !this.on[g]); },
      report: (id, message) => {
        if ((this.errors.get(id) ?? null) === message) return;
        if (message === null) this.errors.delete(id); else this.errors.set(id, message);
        this.io.post({ type: 'nserr', id, message });
      },
    };
  }

  // A graph (or an edited one): nodes that keep their id and type keep their state, so an edit while it plays does not restart it.
  load(graph, resolve = {}) {
    this.graph = graph; this.resolve = resolve;
    this.subs = Math.max(1, Math.min(MAX_SUBS, Math.round(graph?.sub ?? 4) || 4));
    this.info.subs = this.subs;
    const old = this.recs;
    this.recs = new Map(); this.list = [];
    for (const n of graph?.nodes ?? []) {
      const T = NS_TYPES[n.type];
      if (!T || this.recs.has(n.id)) continue;
      let rec = old.get(n.id);
      if (rec && rec.type === n.type) { Object.assign(rec.p, defaultParams(n.type), n.params ?? {}); rec.data = n.data ?? {}; rec.group = this.groupOf(n); }
      else { if (rec) rec.inst?.stop?.(); rec = this.makeRec(n); }
      rec.outs = {}; rec.srcs = {};
      this.recs.set(n.id, rec); this.list.push(rec);
    }
    for (const [id, rec] of old) if (!this.recs.has(id)) rec.inst?.stop?.();
    this.wires = [];
    for (const w of graph?.wires ?? []) {
      const [fid, fport] = String(w.from).split('.'), [tid, tport] = String(w.to).split('.');
      const a = this.recs.get(fid), b = this.recs.get(tid);
      const po = a && NS_TYPES[a.type].outs.find(p => p.n === fport), pi = b && NS_TYPES[b.type].ins.find(p => p.n === tport);
      if (!po || !pi || po.k !== pi.k || a === b) continue;
      const i = this.wires.length;
      this.wires.push({ i, a, out: fport, b, port: tport, k: po.k });
      if (po.k === 'e') (a.outs[fport] ??= []).push({ i, rec: b, port: tport });
      else b.srcs[tport] = { rec: a, out: fport };
    }
    this.corder = this.controlOrder();
    if (!this.live) this.reset();
  }

  groupOf(n) { return Math.max(0, Math.min(MAX_GROUPS - 1, Math.round(n.group ?? 0) || 0)); }

  makeRec(n) {
    const T = NS_TYPES[n.type];
    const rec = { id: n.id, type: n.type, p: { ...defaultParams(n.type), ...(n.params ?? {}) }, data: n.data ?? {}, group: this.groupOf(n), outs: {}, srcs: {}, cout: {}, inst: null };
    const self = this;
    const cx = {
      id: n.id, p: rec.p, info: this.info, host: this.host,
      get data() { return rec.data; },
      emit: (out, v, vel) => self.emit(rec, out, v, vel),
      read: name => { const s = rec.srcs[name]; if (!s) return NaN; const v = s.rec.cout[s.out]; return v === undefined ? 0 : v; },
      ctl: (out, x) => { rec.cout[out] = x; },
      after: (subs, fn, always = false) => self.after(rec, subs, fn, always),
      rand: () => self.rand(),
    };
    rec.inst = T.create(cx);
    return rec;
  }

  // Control wires carry no events: each node computes from the nodes feeding it, so they run sources first.
  controlOrder() {
    const order = [], state = new Map();
    const visit = rec => {
      if (state.get(rec) !== undefined) return;
      state.set(rec, 1);
      for (const s of Object.values(rec.srcs)) visit(s.rec);
      order.push(rec);
    };
    for (const rec of this.list) visit(rec);
    return order.filter(r => r.inst.control);
  }

  // ---- events
  emit(rec, out, v, vel) {
    const list = rec.outs[out];
    if (!list || !this.on[rec.group]) return;
    for (const w of list) {
      if (this.watch && this.pulses.length < 256) this.pulses.push(w.i);
      this.deliver(w.rec, w.port, v, vel);
    }
  }

  deliver(rec, port, v, vel) {
    if (this.depth > 32 || !this.on[rec.group]) return;   // a loop of wires stops itself after a while
    this.depth++;
    try { rec.inst.event?.(port, v, vel); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } finally { this.depth--; }
  }

  after(rec, subs, fn, always) {
    const at = this.abs + Math.max(0, Math.round(subs));
    if (at <= this.abs) { if (always || this.on[rec.group]) { try { fn(); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } } return; }
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].at > at) i--;
    this.queue.splice(i, 0, { at, fn, rec, always });
  }

  runDue() {
    while (this.queue.length && this.queue[0].at <= this.abs) {
      const it = this.queue.shift();
      if (it.always || this.on[it.rec.group]) { try { it.fn(); } catch (e) { this.host.report(it.rec.id, `${e.name}: ${e.message}`); } }
    }
  }

  // ---- groups
  setGroupOn(g, on) {
    if (this.on[g] === on) return;
    this.on[g] = on;
    for (const rec of this.list) if (rec.group === g) { try { if (on) rec.inst.reset?.(); else rec.inst.stop?.(); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } }
  }

  // A group a pattern has written to follows the cell: 0 stops it, anything above half starts it.
  pollGroups() {
    const slots = this.resolve.groupSlots, stamps = this.io.stamps;
    if (!slots || !stamps) return;
    for (let g = 0; g < MAX_GROUPS; g++) {
      const slot = slots[g];
      if (slot === undefined || slot < 0) continue;
      const st = stamps[slot];
      if (st !== this.seen[g]) { this.seen[g] = st; this.setGroupOn(g, this.io.params[slot] >= 0.5); }
    }
  }

  // ---- the clock
  reset() {
    this.abs = -1; this.queue.length = 0; this.depth = 0;
    const groups = this.graph?.groups ?? [];
    for (let g = 0; g < MAX_GROUPS; g++) this.on[g] = groups[g]?.on ?? true;
    const slots = this.resolve.groupSlots, stamps = this.io.stamps;
    for (let g = 0; g < MAX_GROUPS; g++) this.seen[g] = slots?.[g] >= 0 && stamps ? stamps[slots[g]] : 0;
    for (const rec of this.list) { rec.cout = {}; try { rec.inst.reset?.(); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } }
  }

  start() { this.live = true; this.reset(); }

  stop() {
    this.live = false;
    for (const rec of this.list) { try { rec.inst.stop?.(); } catch { /* it is stopping anyway */ } }
    for (const it of this.queue) if (it.always) { try { it.fn(); } catch { /* ditto */ } }
    this.queue.length = 0;
  }

  // The first subtick of a tick: the tick itself, then the subtick.
  onTick(tick, { tpb, barTicks, tickSamples, bpm }) {
    const i = this.info;
    i.tick = tick; i.subIdx = 0; i.tpb = tpb; i.barTicks = barTicks; i.tickSec = tickSamples / this.sampleRate; i.bpm = bpm; i.subs = this.subs;
    this.abs++; i.abs = this.abs;
    this.monLeft = 32;
    this.pollGroups();
    this.runDue();
    for (const rec of this.list) if (this.on[rec.group] && rec.inst.tick) { try { rec.inst.tick(); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } }
    this.subEvent();
  }

  onSub(idx) {
    this.info.subIdx = idx;
    this.abs++; this.info.abs = this.abs;
    this.runDue();
    this.subEvent();
  }

  subEvent() {
    for (const rec of this.list) if (this.on[rec.group] && rec.inst.sub) { try { rec.inst.sub(); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } }
  }

  // Controls move with the audio: once for every stretch of samples the sequencer runs.
  control(span) {
    const dt = span / this.sampleRate;
    for (const rec of this.corder) if (this.on[rec.group]) { try { rec.inst.control(dt); } catch (e) { this.host.report(rec.id, `${e.name}: ${e.message}`); } }
  }

  // ---- for the page
  setFlags({ watch, record }) { if (watch !== undefined) this.watch = !!watch; if (record !== undefined) this.record = !!record; }

  setParam(id, name, value) { const rec = this.recs.get(id); if (rec) rec.p[name] = value; }
  setData(id, data) { const rec = this.recs.get(id); if (rec) rec.data = data ?? {}; }

  // Called after each block: the wires that carried an event, and (now and then) where everything is.
  flush(withState) {
    if (this.pulses.length) { this.io.post({ type: 'nspulse', w: this.pulses }); this.pulses = []; }
    if (withState) {
      const nodes = {};
      for (const rec of this.list) { const v = rec.inst.view?.(); if (v) nodes[rec.id] = v; }
      this.io.post({ type: 'nsstate', tick: this.info.tick, sub: this.info.subIdx, on: [...this.on], nodes });
    }
  }
}
