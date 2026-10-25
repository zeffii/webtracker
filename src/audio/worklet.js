import { GraphRuntime } from './runtime.js';
import { Sequencer } from './sequencer.js';
import { ringWriter, laneWriter } from './vring.js';

class TrackerEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { sab, transport, wasm, vring, lring } = options.processorOptions;
    this.vring = ringWriter(vring);
    this.dither = false; this.noise = 2463534242 | 0;
    const lanes = this.lanes = laneWriter(lring), slotOf = new Map();
    this.setLaneIds = ids => { slotOf.clear(); ids.forEach((id, k) => slotOf.set(id, k)); };
    const params = new Float32Array(sab);
    this.rt = new GraphRuntime({ sampleRate, params, wasm });
    this.rt.onLane = (id, l, r, n) => { const k = slotOf.get(id); if (k !== undefined && lanes.wants(k)) lanes.write(k, l, r, n); };
    this.seq = new Sequencer({ sampleRate, runtime: this.rt, params, transport: new Int32Array(transport) });
    this.seq.post = msg => this.port.postMessage(msg);
    this.nsBlocks = 0;
    // Load meter. The worklet has no fine clock, only Date.now() in whole milliseconds, but the average of many such
    // readings is unbiased, so the load is exact on average; the peak is good to about a millisecond.
    this.budget = (128 / sampleRate) * 1000;
    this.blocks = 0; this.sumMs = 0; this.peakMs = 0; this.late = 0;
    this.tick = Infinity; this.seen = 0;   // the clock's step, found as the smallest non-zero reading (it is 1 ms on some systems, coarser on others)
    this.rt.onFault = instrument => this.port.postMessage({ type: 'fault', instrument });
    this.rt.onScope = (instrument, node, l, r) => this.port.postMessage({ type: 'scope', instrument, node, l, r }, [l.buffer, r.buffer]);
    this.rt.onEmit = (instrument, node, msg, transfer) => this.port.postMessage({ type: 'emit', instrument, node, msg }, transfer ?? []);
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') this.rt.load(data.graph);
      else if (data.type === 'node') this.rt.message(data.instrument, data.node, data.msg);
      else if (data.type === 'note') { if (!this.halted) this.rt.note(data.instrument, data.msg); }
      else if (data.type === 'scope') this.rt.setScope(data.instrument, data.node, data.on);
      else if (data.type === 'cut') { this.rt.panic(); this.seq.stop(); this.halted = true; }
      else if (data.type === 'panic') this.rt.panic();
      else if (data.type === 'streamwatch') { this.rt.prof = data.on ? new Map() : null; this.streamBlocks = 0; if (data.on) this.postStreams(); }
      else if (data.type === 'streamcut') { for (const id of data.ids) this.rt.setCut(id, data.on); this.postStreams(); }
      else if (data.type === 'streamreset') { for (const id of data.ids) this.rt.rebuild(id); this.postStreams(); }
      else if (data.type === 'dither') this.dither = data.on;
      else if (data.type === 'volfloor') this.seq.volFloor = data.on ? 0.003 : 0;
      else if (data.type === 'lanetaps') this.setLaneIds(data.ids);
      else if (data.type === 'reset') {
        const fresh = new Float32Array(data.sab);
        this.rt.reset(fresh);
        this.seq.reset(fresh);
      }
      else if (data.type === 'song') this.seq.setSong(data.song);
      else if (data.type === 'nodeseq') this.seq.setNodeseq(data.graph, data.resolve);
      else if (data.type === 'nsp') this.seq.ns.setParam(data.id, data.name, data.value);
      else if (data.type === 'nsd') this.seq.ns.setData(data.id, data.data);
      else if (data.type === 'nsflags') this.seq.ns.setFlags(data);
      else if (data.type === 'lane') this.seq.setLane(data.lane);
      else if (data.type === 'transport') {
        if (data.play || data.row !== undefined) this.halted = false;
        if (data.play && this.rt.cut.size) { this.rt.cut.clear(); this.postStreams(); }   // Play brings back every lane the Stream Manager switched off
        if (data.row !== undefined) this.seq.row(data.row);
        else if (data.play) this.seq.play(data.from ?? null);
        else this.seq.stop();
      }
    };
  }

  // The Stream Manager's report: every instrument's voices, level and share of the block budget since the last one.
  postStreams() {
    const rows = this.rt.streamStats(), blocks = Math.max(1, this.streamBlocks ?? 1);
    for (const r of Object.values(rows)) r.ms = r.ms / blocks / this.budget;
    this.rt.prof?.clear();
    this.streamBlocks = 0;
    this.port.postMessage({ type: 'streams', rows });
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (this.halted) {   // cut: no computation at all until Play, but the displays are fed silence so they fall to nothing
      const out = outputs[0], n = out[0].length;
      if (this.vring.on) { this.silent ??= new Float32Array(n); this.vring.write(this.silent, this.silent, n); }
      this.lanes.silence(n);
      return true;
    }
    const t0 = Date.now();
    this.seq.process(out[0], out[1], out[0].length);
    if (this.rt.prof && ++this.streamBlocks >= 32) this.postStreams();   // about twenty reports a second, only while the manager is open
    if (this.seq.ns.watch) this.seq.ns.flush(++this.nsBlocks % 10 === 0);   // activity for the Node Sequencer view, a few dozen times a second
    if (this.dither) {   // triangular noise of one 16-bit step (-96 dB): very quiet sound, fading in or out, is otherwise rounded by the sound card into crackle
      let z = this.noise, n = out[0].length;
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) {
        z ^= z << 13; z ^= z >>> 17; z ^= z << 5; const a = (z >>> 0) / 4294967296;
        z ^= z << 13; z ^= z >>> 17; z ^= z << 5; const b = (z >>> 0) / 4294967296;
        out[c][i] += (a + b - 1) / 32768;
      }
      this.noise = z;
    }
    if (this.vring.on) this.vring.write(out[0], out[1], out[0].length);
    const ms = Date.now() - t0;
    this.sumMs += ms; this.blocks++; this.seen++;
    if (ms > 0 && ms < this.tick) this.tick = ms;
    const sure = Math.max(0, ms - this.tick);   // a reading is at most one clock step above the true time, so this is certainly spent
    if (sure > this.peakMs && this.seen > 400) this.peakMs = sure;
    if (this.seen > 400 && sure >= this.budget) this.late++;
    if (this.blocks >= 100) {
      this.port.postMessage({ type: 'load', avg: this.sumMs / this.blocks / this.budget, peak: this.peakMs / this.budget, late: this.late });
      this.blocks = 0; this.sumMs = 0; this.peakMs = 0; this.late = 0;
    }
    return true;
  }
}

registerProcessor('tracker-engine', TrackerEngine);
