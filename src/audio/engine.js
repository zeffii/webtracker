import { NODE_TYPES } from './nodes/index.js';
import { ParamRegistry } from './params.js';
import { compile } from '../graph/compile.js';
import { compileDsp } from './wasm/load.js';

export class Engine {
  ctx = null;
  wasmModule = null;
  node = null;
  watching = new Set();   // instruments whose output is being watched (replayed when the audio thread starts)
  onFault = null;   // called with an instrument id when the audio thread had to rebuild it
  registry = new ParamRegistry();
  transport = new Int32Array(new SharedArrayBuffer(8));   // [tick, playing], written by the worklet

  async start() {
    if (!crossOriginIsolated) {
      throw new Error('Not cross-origin isolated. Open the page through serve.mjs.');
    }
    try { this.wasmModule = compileDsp(); } catch (e) { console.warn('WASM unavailable, using JS DSP', e); this.wasmModule = null; }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'tracker-engine', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { sab: this.registry.sab, transport: this.transport.buffer, wasm: this.wasmModule },
    });
    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'fault') this.onFault?.(data.instrument);
      else if (data.type === 'load') this.onLoad?.(data);
      else if (data.type === 'scope') this.onScope?.(data);
    };
    for (const id of this.watching) this.node.port.postMessage({ type: 'scope', instrument: id, on: true });
    this.node.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  // Where the audio stack says we stand: output latency in ms and, where the browser reports it, how many times it
  // had to fill in silence because a block arrived late.
  health() {
    const ctx = this.ctx;
    if (!ctx) return { latency: 0, drops: null };
    const stats = ctx.playoutStats;
    return {
      latency: ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000,
      drops: stats ? (stats.fallbackFramesEvents ?? null) : null,
    };
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

  noteOn(instrument, note, vel = 1, extra = {}) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOn', note, vel, ...extra } });
  }

  noteOff(instrument, note) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOff', note } });
  }

  // watch an instrument's output: its last samples come back through onScope({ instrument, l, r })
  scope(instrument, on) {
    if (on) this.watching.add(instrument); else this.watching.delete(instrument);
    this.node?.port.postMessage({ type: 'scope', instrument, on });
  }

  // all notes off, everywhere
  panic() {
    this.node.port.postMessage({ type: 'panic' });
  }

  // stops all computation (silence, no DSP) until play() is called
  cut() {
    this.node.port.postMessage({ type: 'cut' });
  }

  setSong({ bpm, ticksPerBeat, length, swing = 0.5, loop }) {
    this.node.port.postMessage({ type: 'song', song: { bpm, ticksPerBeat, length, swing, ...(loop ? { loop: { start: loop.start, end: loop.end } } : {}) } });
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
