import { NODE_TYPES } from './nodes/index.js';
import { PARAM_CAPACITY } from './params.js';

const MAX_VOICES = 16;

// Runs compiled graphs block by block. Independent of AudioWorklet so it can
// also be driven offline (see test/smoke.mjs).
export const SCOPE_N = 2048, SCOPE_HOP = 1024;

export class GraphRuntime {
  instruments = new Map();
  graphs = new Map();      // compiled graphs, to rebuild an instrument that went bad
  samples = new Map();     // the last sample message per instrument and node, replayed on a rebuild
  stamp = 0;               // counts note events, to find the oldest voice
  onFault = null;          // called with an instrument id when it is rebuilt
  onEmit = null;           // called with (instrument id, node id, message, transfer list): what a node sends the page (the tap node's takes)
  onScope = null;          // called with (instrument id, node id, left, right): the last SCOPE_N samples a watched node put out
  scopes = new Map();      // watched nodes: key -> { instrument, node, l, r, at, since }

  constructor({ sampleRate, params, maxBlock = 512, wasm = null }) {
    this.wasm = wasm;           // compiled WebAssembly.Module for the DSP kernels, or null for the JS reference
    this.sampleRate = sampleRate;
    this.params = params;       // Float32Array over the shared parameter block
    this.maxBlock = maxBlock;
    // the sequencer keeps tickSamples in step with the song's tempo, and counts in `stamps` every time a pattern writes a
    // parameter (even to the value it already has), which is how a node can tell a new event from an unchanged value
    this.clock = { tickSamples: (sampleRate * 60) / (120 * 4), stamps: new Uint32Array(PARAM_CAPACITY) };
  }

  // Starts or stops watching the output of one node (the scope beside it in the graph view).
  setScope(instrument, node, on) {
    const key = `${instrument}\u0000${node}`;
    if (!on) this.scopes.delete(key);
    else if (!this.scopes.has(key)) this.scopes.set(key, { instrument, node, l: new Float32Array(SCOPE_N), r: new Float32Array(SCOPE_N), at: 0, since: 0, type: null });
  }

  // Drops every instrument and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.instruments.clear();
    this.graphs.clear();
    this.samples.clear();
    this.order = null;
  }

  // Allocates buffers and node state. Runs on a message, not per block.
  //
  // An instrument with voices > 1 runs that many copies of the part of its graph that feeds
  // the `voices` node (or of the whole graph, when there is none); the `voices` node adds
  // the copies together and everything after it runs once. Notes go to one copy each (see
  // note()), copies that are not sounding are not run, and parameters are shared by all.
  load(compiled) {
    this.graphs.set(compiled.instrument, compiled);
    this.order = null;
    const V = Math.max(1, Math.min(MAX_VOICES, Math.round(compiled.voices ?? 1) || 1));
    const fresh = () => Array.from({ length: compiled.bufferCount }, () => new Float32Array(this.maxBlock));
    const resolver = buffers => ref => (Array.isArray(ref) ? ref.map(b => buffers[b]) : buffers[ref]);   // stereo ports are [left, right]
    const make = (n, resolve) => {
      const create = () => NODE_TYPES[n.type].create({ sampleRate: this.sampleRate, maxBlock: this.maxBlock, connected: n.connected, wasm: this.wasm, data: n.data, init: n.init, stereo: n.stereo === true, clock: this.clock, source: n.source, tap: id => this.tap(id), emit: (msg, transfer) => this.onEmit?.(compiled.instrument, n.id, msg, transfer) });
      const node = { id: n.id, instance: create(), slots: Int32Array.from(n.slots), inputs: n.inputs.map(resolve), outputs: n.outputs.map(resolve) };
      if (n.dual) {   // a mono node on a stereo signal: one copy per channel over the same parameters
        const left = node.instance, right = create();
        const side = (refs, c) => refs.map(r => (Array.isArray(r) ? r[c] : r));
        const inL = side(node.inputs, 0), inR = side(node.inputs, 1), outL = side(node.outputs, 0), outR = side(node.outputs, 1);
        node.instance = {
          process: (_in, _out, len, params, slots) => { left.process(inL, outL, len, params, slots); right.process(inR, outR, len, params, slots); },
          message: msg => { left.message?.(msg); right.message?.(msg); },
          note: msg => { left.note?.(msg); right.note?.(msg); },
        };
      }
      if (n.paramPorts) {   // a wire into a parameter port sets the parameter, from 0 to 1 on its own scale, before the node runs
        const inner = node.instance, ports = n.paramPorts;
        node.instance = {
          ...inner,
          process: (ins, outs, len, params, slots) => {
            for (const p of ports) {
              const x = Math.min(1, Math.max(0, ins[p.input][len - 1]));
              const v = p.log ? p.min * Math.pow(p.max / p.min, x) : p.min + x * (p.max - p.min);
              params[p.slot] = Number.isFinite(v) ? (p.int ? Math.round(v) : v) : params[p.slot];
            }
            inner.process(ins, outs, len, params, slots);
          },
          message: msg => inner.message?.(msg),
          note: msg => inner.note?.(msg),
        };
      }
      const bypassAt = NODE_TYPES[n.type].params.findIndex(p => p.name === 'bypass');
      if (bypassAt >= 0 && NODE_TYPES[n.type].category === 'Effects') {   // hard bypass: the input goes straight to the output
        const inner = node.instance, slot = node.slots[bypassAt];
        const pair = r => (Array.isArray(r) ? r : [r]);
        node.instance = {
          ...inner,
          process: (ins, outs, len, params, slots) => {
            if (params[slot] < 0.5) { inner.process(ins, outs, len, params, slots); return; }
            const a = pair(ins[0]), b = pair(outs[0]);
            for (let c = 0; c < b.length; c++) b[c].set((a[c] ?? a[0]).subarray(0, len), 0);
          },
          message: msg => inner.message?.(msg),
          note: msg => inner.note?.(msg),
        };
      }
      return node;
    };
    const buffers0 = fresh(), resolve0 = resolver(buffers0);
    const inst = { nodes: [], sets: [], byId: new Map(), left: null, right: null };
    const register = (node, at) => { const list = inst.byId.get(node.id) ?? []; list[at] = node; inst.byId.set(node.id, list); };
    this.instruments.set(compiled.instrument, inst);

    inst.pre = [];   // shared nodes that run before the voices (see below)
    if (V === 1) {
      inst.nodes = compiled.nodes.map(n => make(n, resolve0));
      inst.nodes.forEach(node => register(node, 0));
      inst.left = buffers0[compiled.master[0]];
      inst.right = buffers0[compiled.master[1]];
      return;
    }

    // Which nodes are per voice: those that feed a voices node, or all of them without one.
    // A node type marked `shared` (the ctrl node) is never copied per voice, even when it feeds something that is: one
    // copy runs first and every voice reads its output, so a sweep is the same for all of them.
    const isShared = n => NODE_TYPES[n.type]?.shared === true && n.inputs.length === 0;
    const sharedBufs = new Set(compiled.nodes.filter(isShared).flatMap(n => n.outputs.flat()));
    const producer = new Map();
    compiled.nodes.forEach((n, i) => n.outputs.flat().forEach(b => producer.set(b, i)));
    const boundary = compiled.nodes.map((n, i) => (n.type === 'voices' ? i : -1)).filter(i => i >= 0);
    const perVoice = new Set();
    const visit = i => {
      if (perVoice.has(i)) return;
      perVoice.add(i);
      for (const b of compiled.nodes[i].inputs.flat()) if (producer.has(b) && !sharedBufs.has(b)) visit(producer.get(b));
    };
    if (boundary.length) for (const i of boundary) for (const b of compiled.nodes[i].inputs.flat()) { if (producer.has(b) && !sharedBufs.has(b)) visit(producer.get(b)); }
    else compiled.nodes.forEach((_, i) => perVoice.add(i));
    compiled.nodes.forEach((n, i) => { if (isShared(n)) perVoice.delete(i); });
    for (const i of boundary) perVoice.delete(i);   // a voices node is shared, whatever feeds it

    const mixing = boundary.length === 0;
    const mixL = new Float32Array(this.maxBlock), mixR = new Float32Array(this.maxBlock);
    for (let v = 0; v < V; v++) {
      const buffers = v === 0 ? buffers0 : fresh(), resolve = ref => { const at = b => (sharedBufs.has(b) ? buffers0[b] : buffers[b]); return Array.isArray(ref) ? ref.map(at) : at(ref); };
      const set = {
        nodes: compiled.nodes.filter((_, i) => perVoice.has(i)).map(n => make(n, resolve)),
        taps: mixing ? [[buffers[compiled.master[0]], buffers[compiled.master[1]]]] : boundary.map(i => resolve(compiled.nodes[i].inputs[0])),
        active: false, released: false, silent: 0, note: -1, stamp: 0, releasedAt: 0,
      };
      set.nodes.forEach(node => register(node, v));
      inst.sets.push(set);
    }
    // the shared part, in graph order; a voices node adds the active copies' taps
    compiled.nodes.forEach((n, i) => {
      if (perVoice.has(i)) return;
      const node = make(n, resolve0);
      if (isShared(n)) { inst.pre.push(node); register(node, 0); return; }
      if (n.type === 'voices') {
        const at = boundary.indexOf(i), [outL, outR] = node.outputs[0];
        node.instance = {
          process: (_in, _out, len) => {
            outL.fill(0, 0, len); outR.fill(0, 0, len);
            for (const s of inst.sets) {
              if (!s.active) continue;
              const [l, r] = s.taps[at];
              for (let k = 0; k < len; k++) { outL[k] += l[k]; outR[k] += r[k]; }
            }
          },
        };
      }
      inst.nodes.push(node);
      register(node, 0);
    });
    inst.mixing = mixing;
    inst.left = mixing ? mixL : buffers0[compiled.master[0]];
    inst.right = mixing ? mixR : buffers0[compiled.master[1]];
  }

  // Message for one node (every copy of it), for example the sample data for a sampler.
  message(instrument, nodeId, msg) {
    if (msg.type === 'sample' || msg.type === 'curve' || msg.type === 'spectrum' || msg.type === 'waves' || msg.type === 'table' || msg.type === 'pair' || msg.type === 'taps' || msg.type === 'bank' || msg.type === 'gate') this.samples.set(`${instrument}\u0000${nodeId}\u0000${msg.type}${msg.slot ?? ''}`, msg);   // replayed if the instrument is rebuilt
    for (const node of this.instruments.get(instrument)?.byId.get(nodeId) ?? []) node.instance.message?.(msg);
  }

  // Note events go to every voice-aware node of the instrument. With several voices, a note on
  // takes a silent voice, else the one that was released longest ago, else the oldest; a note
  // off releases the newest voice playing that note; all-off releases them all; a cut stops them.
  note(instrument, msg) {
    const inst = this.instruments.get(instrument);
    if (!inst) return;
    if (inst.sets.length > 0) {   // nodes outside the voices (the note trigger, and an envelope that works on the mixed sound) hear every note once, not per voice
      for (const node of inst.pre) node.instance.note?.(msg);
      for (const node of inst.nodes) node.instance.note?.(msg);
    }
    if (inst.sets.length === 0) {
      for (const node of inst.nodes) node.instance.note?.(msg);
      return;
    }
    const send = set => { for (const node of set.nodes) node.instance.note?.(msg); };
    const release = set => { set.released = true; set.releasedAt = ++this.stamp; };
    if (msg.type === 'noteOn') {
      let pick = inst.sets.find(s => !s.active);
      if (!pick) {
        for (const s of inst.sets) {
          if (s.released ? !pick?.released || s.releasedAt < pick.releasedAt : !pick?.released && (!pick || s.stamp < pick.stamp)) pick = s;
        }
      }
      Object.assign(pick, { active: true, released: false, silent: 0, note: msg.note, stamp: ++this.stamp });
      send(pick);
    } else if (msg.type === 'noteOff') {
      let best = null;
      for (const s of inst.sets) if (s.active && !s.released && s.note === msg.note && (!best || s.stamp > best.stamp)) best = s;
      if (best) { release(best); send(best); }
    } else if (msg.type === 'allOff') {
      for (const s of inst.sets) if (s.active && !s.released) { release(s); send(s); }
    } else if (msg.type === 'noteCut') {
      for (const s of inst.sets) { send(s); s.active = false; }
    } else {
      for (const s of inst.sets) if (s.active) send(s);
    }
  }

  // Every voice of every instrument stops at once.
  panic() {
    for (const id of this.instruments.keys()) this.note(id, { type: 'noteCut' });
  }

  // The sound of an instrument that has already run in this block, for a sidechain node: its left and right buffers, or null
  // when it does not exist or has not run yet (so a loop of listeners, should one get in, hears silence instead of looping).
  tap(id) {
    const inst = this.instruments.get(id);
    return inst && inst.block === this.blockNo ? inst : null;
  }

  // The order the instruments run in: one that listens to another (through a sidechain node) comes after it. Otherwise the
  // order they were loaded in. A loop among them is cut where it closes.
  runOrder() {
    if (this.order) return this.order;
    const order = [], state = new Map();
    const visit = id => {
      if (state.has(id)) return;
      state.set(id, 1);
      for (const n of this.graphs.get(id)?.nodes ?? []) if (n.type === 'sidechain' && n.source && this.instruments.has(n.source)) visit(n.source);
      order.push(id);
    };
    for (const id of this.instruments.keys()) visit(id);
    return (this.order = order);
  }

  process(left, right, n) {
    left.fill(0, 0, n);
    right.fill(0, 0, n);
    this.blockNo = (this.blockNo ?? 0) + 1;
    for (const id of this.runOrder()) {
      const inst = this.instruments.get(id);
      if (!inst) continue;
      for (const node of inst.pre) node.instance.process(node.inputs, node.outputs, n, this.params, node.slots);
      if (inst.sets.length) {
        if (inst.mixing) { inst.left.fill(0, 0, n); inst.right.fill(0, 0, n); }
        for (const set of inst.sets) {
          if (!set.active) continue;
          for (const node of set.nodes) node.instance.process(node.inputs, node.outputs, n, this.params, node.slots);
          let peak = 0;
          for (const [l, r] of set.taps) for (let i = 0; i < n; i++) { const a = Math.abs(l[i]), b = Math.abs(r[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
          set.silent = peak < 1e-5 ? set.silent + 1 : 0;
          if (set.released && set.silent >= 3) set.active = false;   // finished: it stops costing anything
          if (inst.mixing) {
            const [l, r] = set.taps[0];
            for (let i = 0; i < n; i++) { inst.left[i] += l[i]; inst.right[i] += r[i]; }
          }
        }
      }
      for (const node of inst.nodes) {
        node.instance.process(node.inputs, node.outputs, n, this.params, node.slots);
      }
      let sum = 0;
      for (let i = 0; i < n; i++) sum += inst.left[i] + inst.right[i];
      if (!Number.isFinite(sum)) {   // one instrument has gone bad: rebuild it, and keep the others sounding
        this.rebuild(id);
        this.onFault?.(id);
        continue;
      }
      inst.block = this.blockNo;
      this.onLane?.(id, inst.left, inst.right, n);   // the page's layered spectrum, when it is on
      if (this.scopes.size) for (const scope of this.scopes.values()) if (scope.instrument === id) this.watch(scope, inst, n);
      for (let i = 0; i < n; i++) {
        left[i] += inst.left[i];
        right[i] += inst.right[i];
      }
    }
  }

  // Keeps the last SCOPE_N samples of a node's first output in a ring (the voices' copies added together when it is a
  // per-voice node) and hands them over, oldest first, every SCOPE_HOP samples. A mono output is shown on both sides.
  watch(s, inst, n) {
    const list = inst.byId.get(s.node);
    if (!list) return;
    s.type ??= this.graphs.get(s.instrument)?.nodes.find(k => k.id === s.node)?.type;
    const tl = (this.scopeTemp ??= [new Float32Array(this.maxBlock), new Float32Array(this.maxBlock)])[0], tr = this.scopeTemp[1];
    const pair = node => { const o = node.outputs; return Array.isArray(o[0]) ? o[0] : s.type === 'out' ? [o[0], o[1]] : [o[0], o[0]]; };
    let l, r;
    if (list.length === 1) [l, r] = pair(list[0]);
    else {
      tl.fill(0, 0, n); tr.fill(0, 0, n);
      list.forEach((node, v) => {
        if (!node || !inst.sets[v]?.active) return;
        const [a, b] = pair(node);
        for (let i = 0; i < n; i++) { tl[i] += a[i]; tr[i] += b[i]; }
      });
      l = tl; r = tr;
    }
    for (let i = 0; i < n; i++) { s.l[s.at] = l[i]; s.r[s.at] = r[i]; s.at = (s.at + 1) % SCOPE_N; }
    s.since += n;
    if (s.since < SCOPE_HOP) return;
    s.since = 0;
    const outL = new Float32Array(SCOPE_N), outR = new Float32Array(SCOPE_N), tail = SCOPE_N - s.at;
    outL.set(s.l.subarray(s.at), 0); outL.set(s.l.subarray(0, s.at), tail);
    outR.set(s.r.subarray(s.at), 0); outR.set(s.r.subarray(0, s.at), tail);
    this.onScope?.(s.instrument, s.node, outL, outR);
  }

  // Fresh node state for an instrument, with its samples put back.
  rebuild(id) {
    this.load(this.graphs.get(id));
    for (const [key, msg] of this.samples) {
      const [instrument, nodeId] = key.split('\u0000');
      if (instrument === id) this.message(id, nodeId, msg);
    }
  }
}
