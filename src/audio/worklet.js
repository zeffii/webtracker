import { GraphRuntime } from './runtime.js';
import { Sequencer } from './sequencer.js';

class TrackerEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { sab, transport, wasm } = options.processorOptions;
    const params = new Float32Array(sab);
    this.rt = new GraphRuntime({ sampleRate, params, wasm });
    this.seq = new Sequencer({ sampleRate, runtime: this.rt, params, transport: new Int32Array(transport) });
    this.rt.onFault = instrument => this.port.postMessage({ type: 'fault', instrument });
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') this.rt.load(data.graph);
      else if (data.type === 'node') this.rt.message(data.instrument, data.node, data.msg);
      else if (data.type === 'note') this.rt.note(data.instrument, data.msg);
      else if (data.type === 'panic') this.rt.panic();
      else if (data.type === 'reset') {
        const fresh = new Float32Array(data.sab);
        this.rt.reset(fresh);
        this.seq.reset(fresh);
      }
      else if (data.type === 'song') this.seq.setSong(data.song);
      else if (data.type === 'lane') this.seq.setLane(data.lane);
      else if (data.type === 'transport') (data.play ? this.seq.play() : this.seq.stop());
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    this.seq.process(out[0], out[1], out[0].length);
    return true;
  }
}

registerProcessor('tracker-engine', TrackerEngine);
