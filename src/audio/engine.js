import { PARAM_COUNT, SLOT, initParams } from './params.js';

export class Engine {
  ctx = null;
  node = null;
  params = null;

  async start() {
    if (!crossOriginIsolated) {
      throw new Error('Not cross-origin isolated. Open the page through serve.mjs.');
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));

    const sab = new SharedArrayBuffer(PARAM_COUNT * 4);
    this.params = new Float32Array(sab);
    initParams(this.params);

    this.node = new AudioWorkletNode(this.ctx, 'tracker-engine', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { sab },
    });
    this.node.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  // Latest-value mailbox: the worklet reads this slot once per block.
  set(id, value) {
    if (this.params) this.params[SLOT[id]] = value;
  }
}
