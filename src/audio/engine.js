import { NODE_TYPES } from './nodes/index.js';
import { ParamRegistry } from './params.js';
import { compile } from '../graph/compile.js';
import { compileDsp } from './wasm/load.js';
import { ringBuffer, laneBuffer } from './vring.js';

// What the audio thread would actually run for an instrument: the nodes that are wired to something, and the wires.
// A node that is not connected yet (just added) changes nothing it plays, so adding or removing one needs no reload.
const signature = desc => {
  const linked = new Set(desc.connections.flat().map(port => port.split('.')[0]));
  return JSON.stringify([desc.voices ?? 1, desc.nodes.filter(n => linked.has(n.id)).map(({ x, y, ...n }) => n), desc.connections]);
};

export class Engine {
  ctx = null;
  wasmModule = null;
  node = null;
  watching = new Set();   // nodes whose output is being watched (replayed when the audio thread starts)
  onFault = null;   // called with an instrument id when the audio thread had to rebuild it
  registry = new ParamRegistry();
  lring = laneBuffer();   // per-instrument output rings, for the layered spectrum
  laneIds = [];           // the instruments in the slots of lring
  vring = ringBuffer();   // the last output samples, for the vectorscope
  sent = new Map();       // the latest of each message that sets the audio thread up (graphs, node data, song, lanes), for rendering offline
  loaded = new Map();     // instrument -> the signature of what the audio thread has, to skip a reload that would change nothing
  transport = new Int32Array(new SharedArrayBuffer(16));   // [tick, playing, fraction of the tick in 1/65536], written by the worklet

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
      processorOptions: { sab: this.registry.sab, transport: this.transport.buffer, wasm: this.wasmModule, vring: this.vring, lring: this.lring },
    });
    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'fault') this.onFault?.(data.instrument);
      else if (data.type === 'load') this.onLoad?.(data);
      else if (data.type === 'scope') this.onScope?.(data);
      else if (data.type === 'emit') this.onEmit?.(data);
    };
    if (this.laneIds.length) this.node.port.postMessage({ type: 'lanetaps', ids: this.laneIds });
    for (const key of this.watching) { const [instrument, node] = key.split('\u0000'); this.node.port.postMessage({ type: 'scope', instrument, node, on: true }); }
    this.node.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  // Which instrument each slot of the per-instrument rings follows.
  setLaneTaps(ids) { this.laneIds = ids; this.node?.port.postMessage({ type: 'lanetaps', ids }); }

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
    this.loaded.clear();
    this.sent.clear();
    this.node.port.postMessage({ type: 'reset', sab: this.registry.sab });
  }

  // Compiles on the main thread and posts the flat result to the worklet.
  loadInstrument(instrument, desc) {
    const graph = compile(desc, { instrument, nodeTypes: NODE_TYPES, registry: this.registry });   // also gives every parameter its slot, wired or not
    const sig = signature(desc);
    if (this.loaded.get(instrument) === sig) return false;   // nothing it plays has changed: the running voices and tails are left alone
    this.loaded.set(instrument, sig);
    this.sent?.set(`load:${instrument}`, { type: 'load', graph });
    this.node.port.postMessage({ type: 'load', graph });
    return true;
  }

  sendToNode(instrument, node, msg, transfer = []) {
    this.sent?.set(`node:${instrument}:${node}:${msg.type}:${msg.slot ?? ''}`, { type: 'node', instrument, node, msg: transfer.length ? structuredClone(msg) : msg });
    this.node.port.postMessage({ type: 'node', instrument, node, msg }, transfer);
  }

  noteOn(instrument, note, vel = 1, extra = {}) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOn', note, vel, ...extra } });
  }

  noteOff(instrument, note) {
    this.node.port.postMessage({ type: 'note', instrument, msg: { type: 'noteOff', note } });
  }

  // watch one node's output: its last samples come back through onScope({ instrument, node, l, r })
  scope(instrument, node, on) {
    const key = `${instrument}\u0000${node}`;
    if (on) this.watching.add(key); else this.watching.delete(key);
    this.node?.port.postMessage({ type: 'scope', instrument, node, on });
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
    const slot = name => this.registry.slots.get(`master.m.${name}`);   // the master lane's parameters, once its instrument is loaded
    const master = slot('bpm') !== undefined ? { bpm: slot('bpm'), swing: slot('swing'), tpb: slot('tpb'), volume: slot('volume') } : undefined;
    this.sent?.set('song', { type: 'song', song: { bpm, ticksPerBeat, length, swing, ...(master ? { master } : {}) } });
    this.node.port.postMessage({ type: 'song', song: { bpm, ticksPerBeat, length, swing, ...(master ? { master } : {}), ...(loop && !loop.off ? { loop: { start: loop.start, end: loop.end } } : {}) } });
  }

  // lane = { id, instrument, columns, pages }. The pages are shared memory.
  setLane(lane) {
    this.sent?.set(`lane:${lane.id}`, { type: 'lane', lane });
    this.node.port.postMessage({ type: 'lane', lane });
  }

  // Everything an offline render needs: what the audio thread was told (graphs first, then node data, the song, the
  // lanes), a private copy of the parameter values, the compiled DSP and the sample rate.
  exportState() {
    const order = { load: 0, node: 1, song: 2, lane: 3 };
    const messages = [...this.sent.values()].sort((a, b) => order[a.type] - order[b.type]);
    return { messages, params: new Float32Array(new Float32Array(this.registry.sab)), wasm: this.wasmModule, sampleRate: this.ctx?.sampleRate ?? 44100 };
  }

  // From a tick, or from the start of the loop or the song.
  play(from = null) {
    this.node.port.postMessage({ type: 'transport', play: true, from });
  }

  // One row, once.
  playRow(tick) {
    this.node.port.postMessage({ type: 'transport', row: tick });
  }

  stop() {
    this.node.port.postMessage({ type: 'transport', play: false });
  }

  get tick() {
    return Atomics.load(this.transport, 0);
  }

  // The song position in ticks and fractions of one, as of the last audio block.
  get position() {
    return Atomics.load(this.transport, 0) + Atomics.load(this.transport, 2) / 65536;
  }

  // Latest-value mailbox: the worklet reads this slot once per block.
  set(address, value) {
    this.registry.set(address, value);
  }
}
