import { GraphRuntime } from './runtime.js';
import { Sequencer } from './sequencer.js';

class TrackerEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { sab, transport, wasm } = options.processorOptions;
    const params = new Float32Array(sab);
    this.rt = new GraphRuntime({ sampleRate, params, wasm });
    this.seq = new Sequencer({ sampleRate, runtime: this.rt, params, transport: new Int32Array(transport) });
    // Load meter. The worklet has no fine clock, only Date.now() in whole milliseconds, but the average of many such
    // readings is unbiased, so the load is exact on average; the peak is good to about a millisecond.
    this.budget = (128 / sampleRate) * 1000;
    this.blocks = 0; this.sumMs = 0; this.peakMs = 0; this.late = 0;
    this.tick = Infinity; this.seen = 0;   // the clock's step, found as the smallest non-zero reading (it is 1 ms on some systems, coarser on others)
    this.rt.onFault = instrument => this.port.postMessage({ type: 'fault', instrument });
    this.rt.onScope = (instrument, l, r) => this.port.postMessage({ type: 'scope', instrument, l, r }, [l.buffer, r.buffer]);
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') this.rt.load(data.graph);
      else if (data.type === 'node') this.rt.message(data.instrument, data.node, data.msg);
      else if (data.type === 'note') { if (!this.halted) this.rt.note(data.instrument, data.msg); }
      else if (data.type === 'scope') this.rt.setScope(data.instrument, data.on);
      else if (data.type === 'cut') { this.rt.panic(); this.seq.stop(); this.halted = true; }
      else if (data.type === 'panic') this.rt.panic();
      else if (data.type === 'reset') {
        const fresh = new Float32Array(data.sab);
        this.rt.reset(fresh);
        this.seq.reset(fresh);
      }
      else if (data.type === 'song') this.seq.setSong(data.song);
      else if (data.type === 'lane') this.seq.setLane(data.lane);
      else if (data.type === 'transport') { if (data.play) this.halted = false; (data.play ? this.seq.play() : this.seq.stop()); }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (this.halted) return true;   // cut: no computation at all until Play
    const t0 = Date.now();
    this.seq.process(out[0], out[1], out[0].length);
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
