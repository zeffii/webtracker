import { NODE_TYPES } from './nodes/index.js';

// Runs compiled graphs block by block. Independent of AudioWorklet so it can
// also be driven offline (see test/smoke.mjs).
export class GraphRuntime {
  instruments = new Map();
  graphs = new Map();      // compiled graphs, to rebuild an instrument that went bad
  samples = new Map();     // the last sample message per instrument and node, replayed on a rebuild
  onFault = null;          // called with an instrument id when it is rebuilt

  constructor({ sampleRate, params, maxBlock = 512, wasm = null }) {
    this.wasm = wasm;           // compiled WebAssembly.Module for the DSP kernels, or null for the JS reference
    this.sampleRate = sampleRate;
    this.params = params;       // Float32Array over the shared parameter block
    this.maxBlock = maxBlock;
  }

  // Drops every instrument and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.instruments.clear();
    this.graphs.clear();
    this.samples.clear();
  }

  // Allocates buffers and node state. Runs on a message, not per block.
  load(compiled) {
    this.graphs.set(compiled.instrument, compiled);
    const buffers = Array.from({ length: compiled.bufferCount }, () => new Float32Array(this.maxBlock));
    const resolve = ref => (Array.isArray(ref) ? ref.map(b => buffers[b]) : buffers[ref]);   // stereo ports are [left, right]
    const nodes = compiled.nodes.map(n => ({
      id: n.id,
      instance: NODE_TYPES[n.type].create({ sampleRate: this.sampleRate, maxBlock: this.maxBlock, connected: n.connected, wasm: this.wasm, data: n.data }),
      slots: Int32Array.from(n.slots),
      inputs: n.inputs.map(resolve),
      outputs: n.outputs.map(resolve),
    }));
    this.instruments.set(compiled.instrument, {
      nodes,
      left: buffers[compiled.master[0]],
      right: buffers[compiled.master[1]],
    });
  }

  // Message for one node, for example the sample data for a sampler.
  message(instrument, nodeId, msg) {
    if (msg.type === 'sample' || msg.type === 'curve' || msg.type === 'spectrum') this.samples.set(`${instrument}\u0000${nodeId}\u0000${msg.type}`, msg);   // replayed if the instrument is rebuilt
    const node = this.instruments.get(instrument)?.nodes.find(n => n.id === nodeId);
    node?.instance.message?.(msg);
  }

  // Note events go to every voice-aware node of the instrument.
  note(instrument, msg) {
    for (const node of this.instruments.get(instrument)?.nodes ?? []) node.instance.note?.(msg);
  }

  process(left, right, n) {
    left.fill(0, 0, n);
    right.fill(0, 0, n);
    for (const [id, inst] of this.instruments) {
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
