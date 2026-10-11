import { GraphRuntime } from './runtime.js';

class TrackerEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rt = new GraphRuntime({
      sampleRate,
      params: new Float32Array(options.processorOptions.sab),
    });
    this.port.onmessage = ({ data }) => {
      if (data.type === 'load') this.rt.load(data.graph);
      else if (data.type === 'node') this.rt.message(data.instrument, data.node, data.msg);
      else if (data.type === 'note') this.rt.note(data.instrument, data.msg);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    this.rt.process(out[0], out[1], out[0].length);
    return true;
  }
}

registerProcessor('tracker-engine', TrackerEngine);
