import { NODE_TYPES } from './nodes/index.js';

// Runs compiled graphs block by block. Independent of AudioWorklet so it can
// also be driven offline (see test/smoke.mjs).
export class GraphRuntime {
  instruments = new Map();

  constructor({ sampleRate, params, maxBlock = 512 }) {
    this.sampleRate = sampleRate;
    this.params = params;       // Float32Array over the shared parameter block
    this.maxBlock = maxBlock;
  }

  // Drops every instrument and switches to a new parameter block.
  reset(params) {
    this.params = params;
    this.instruments.clear();
  }

  // Allocates buffers and node state. Runs on a message, not per block.
  load(compiled) {
    const buffers = Array.from({ length: compiled.bufferCount }, () => new Float32Array(this.maxBlock));
    const nodes = compiled.nodes.map(n => ({
      id: n.id,
      instance: NODE_TYPES[n.type].create({ sampleRate: this.sampleRate, maxBlock: this.maxBlock, connected: n.connected }),
      slots: Int32Array.from(n.slots),
      inputs: n.inputs.map(i => buffers[i]),
      outputs: n.outputs.map(i => buffers[i]),
    }));
    this.instruments.set(compiled.instrument, {
      nodes,
      left: buffers[compiled.master[0]],
      right: buffers[compiled.master[1]],
    });
  }

  // Message for one node, for example the sample data for a sampler.
  message(instrument, nodeId, msg) {
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
    for (const inst of this.instruments.values()) {
      for (const node of inst.nodes) {
        node.instance.process(node.inputs, node.outputs, n, this.params, node.slots);
      }
      for (let i = 0; i < n; i++) {
        left[i] += inst.left[i];
        right[i] += inst.right[i];
      }
    }
  }
}
