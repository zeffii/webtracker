import { NODE_TYPES } from './nodes/index.js';
import { ParamRegistry } from './params.js';
import { compile } from '../graph/compile.js';

export class Engine {
  ctx = null;
  node = null;
  registry = new ParamRegistry();
  transport = new Int32Array(new SharedArrayBuffer(8));   // [tick, playing], written by the worklet

  async start() {
    if (!crossOriginIsolated) {
      throw new Error('Not cross-origin isolated. Open the page through serve.mjs.');
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'tracker-engine', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { sab: this.registry.sab, transport: this.transport.buffer },
    });
    this.node.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  // Forgets every instrument and lane and starts a fresh parameter block, so a new
  // project can be loaded into the running engine.
  reset() {
    this.registry = new ParamRegistry();
    this.node.port.postMessage({ type: 'reset', sab: this.registry.sab });
  }

  // Compiles on the main thread and posts the flat result to the worklet.
  loadInstrument(instrument, desc) {
    const graph = compile(desc, { instrument, nodeTypes: NODE_TYPES, registry: this.registry });
    this.node.port.postMessage({ type: 'load', graph });
  }

  sendToNode(instrument, node, msg, transfer = []) {
    this.node.port.postMessage({ type: 'node', instrument, node, msg }, transfer);
  }

  noteOn(instrument, note, vel = 1) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOn', note, vel } });
  }

  noteOff(instrument, note) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOff', note } });
  }

  setSong({ bpm, ticksPerBeat, length }) {
    this.node.port.postMessage({ type: 'song', song: { bpm, ticksPerBeat, length } });
  }

  // lane = { id, instrument, columns, pages }. The pages are shared memory.
  setLane(lane) {
    this.node.port.postMessage({ type: 'lane', lane });
  }

  play() {
    this.node.port.postMessage({ type: 'transport', play: true });
  }

  stop() {
    this.node.port.postMessage({ type: 'transport', play: false });
  }

  get tick() {
    return Atomics.load(this.transport, 0);
  }

  // Latest-value mailbox: the worklet reads this slot once per block.
  set(address, value) {
    this.registry.set(address, value);
  }
}
