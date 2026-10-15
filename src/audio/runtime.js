import { NODE_TYPES } from './nodes/index.js';

const MAX_VOICES = 16;

// Runs compiled graphs block by block. Independent of AudioWorklet so it can
// also be driven offline (see test/smoke.mjs).
export class GraphRuntime {
  instruments = new Map();
  graphs = new Map();      // compiled graphs, to rebuild an instrument that went bad
  samples = new Map();     // the last sample message per instrument and node, replayed on a rebuild
  stamp = 0;               // counts note events, to find the oldest voice
  onFault = null;          // called with an instrument id when it is rebuilt

  constructor({ sampleRate, params, maxBlock = 512, wasm = null }) {
    this.wasm = wasm;           // compiled WebAssembly.Module for the DSP kernels, or null for the JS reference
    this.sampleRate = sampleRate;
    this.params = params;       // Float32Array over the shared parameter block
    this.maxBlock = maxBlock;
    this.clock = { tickSamples: (sampleRate * 60) / (120 * 4) };   // the sequencer keeps this in step with the song's tempo
  }

  // Drops every instrument and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.instruments.clear();
    this.graphs.clear();
    this.samples.clear();
  }

  // Allocates buffers and node state. Runs on a message, not per block.
  //
  // An instrument with voices > 1 runs that many copies of the part of its graph that feeds
  // the `voices` node (or of the whole graph, when there is none); the `voices` node adds
  // the copies together and everything after it runs once. Notes go to one copy each (see
  // note()), copies that are not sounding are not run, and parameters are shared by all.
  load(compiled) {
    this.graphs.set(compiled.instrument, compiled);
    const V = Math.max(1, Math.min(MAX_VOICES, Math.round(compiled.voices ?? 1) || 1));
    const fresh = () => Array.from({ length: compiled.bufferCount }, () => new Float32Array(this.maxBlock));
    const resolver = buffers => ref => (Array.isArray(ref) ? ref.map(b => buffers[b]) : buffers[ref]);   // stereo ports are [left, right]
    const make = (n, resolve) => {
      const create = () => NODE_TYPES[n.type].create({ sampleRate: this.sampleRate, maxBlock: this.maxBlock, connected: n.connected, wasm: this.wasm, data: n.data, stereo: n.stereo === true, clock: this.clock });
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
      return node;
    };
    const buffers0 = fresh(), resolve0 = resolver(buffers0);
    const inst = { nodes: [], sets: [], byId: new Map(), left: null, right: null };
    const register = (node, at) => { const list = inst.byId.get(node.id) ?? []; list[at] = node; inst.byId.set(node.id, list); };
    this.instruments.set(compiled.instrument, inst);

    if (V === 1) {
      inst.nodes = compiled.nodes.map(n => make(n, resolve0));
      inst.nodes.forEach(node => register(node, 0));
      inst.left = buffers0[compiled.master[0]];
      inst.right = buffers0[compiled.master[1]];
      return;
    }

    // Which nodes are per voice: those that feed a voices node, or all of them without one.
    const producer = new Map();
    compiled.nodes.forEach((n, i) => n.outputs.flat().forEach(b => producer.set(b, i)));
    const boundary = compiled.nodes.map((n, i) => (n.type === 'voices' ? i : -1)).filter(i => i >= 0);
    const perVoice = new Set();
    const visit = i => {
      if (perVoice.has(i)) return;
      perVoice.add(i);
      for (const b of compiled.nodes[i].inputs.flat()) if (producer.has(b)) visit(producer.get(b));
    };
    if (boundary.length) for (const i of boundary) for (const b of compiled.nodes[i].inputs.flat()) { if (producer.has(b)) visit(producer.get(b)); }
    else compiled.nodes.forEach((_, i) => perVoice.add(i));
    for (const i of boundary) perVoice.delete(i);   // a voices node is shared, whatever feeds it

    const mixing = boundary.length === 0;
    const mixL = new Float32Array(this.maxBlock), mixR = new Float32Array(this.maxBlock);
    for (let v = 0; v < V; v++) {
      const buffers = v === 0 ? buffers0 : fresh(), resolve = resolver(buffers);
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
    if (msg.type === 'sample' || msg.type === 'curve' || msg.type === 'spectrum') this.samples.set(`${instrument}\u0000${nodeId}\u0000${msg.type}`, msg);   // replayed if the instrument is rebuilt
    for (const node of this.instruments.get(instrument)?.byId.get(nodeId) ?? []) node.instance.message?.(msg);
  }

  // Note events go to every voice-aware node of the instrument. With several voices, a note on
  // takes a silent voice, else the one that was released longest ago, else the oldest; a note
  // off releases the newest voice playing that note; all-off releases them all; a cut stops them.
  note(instrument, msg) {
    const inst = this.instruments.get(instrument);
    if (!inst) return;
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

  process(left, right, n) {
    left.fill(0, 0, n);
    right.fill(0, 0, n);
    for (const [id, inst] of this.instruments) {
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
      for (let i = 0; i < n; i++) {
        left[i] += inst.left[i];
        right[i] += inst.right[i];
      }
    }
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
