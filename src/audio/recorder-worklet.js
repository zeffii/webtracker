// Records whatever arrives on its input: blocks of left and right samples go to the page, along with the loudest
// sample seen since the last report, so the page can draw a meter and wait for sound before it starts keeping audio.
const CHUNK = 2048;
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.l = new Float32Array(CHUNK); this.r = new Float32Array(CHUNK); this.n = 0; this.peak = 0;
    this.port.onmessage = ({ data }) => { if (data === 'start') { this.on = true; this.n = 0; } else if (data === 'stop') { this.flush(); this.on = false; } };
  }
  flush() {
    if (!this.n && !this.peak) return;
    const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n);
    this.port.postMessage({ l, r, peak: this.peak }, [l.buffer, r.buffer]);
    this.n = 0; this.peak = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const input = inputs[0], a = input[0];
    if (!a) return true;
    const b = input[1] ?? a;
    for (let i = 0; i < a.length; i++) {
      this.l[this.n] = a[i]; this.r[this.n] = b[i]; this.n++;
      const m = Math.max(Math.abs(a[i]), Math.abs(b[i])); if (m > this.peak) this.peak = m;
      if (this.n === CHUNK) this.flush();
    }
    return true;
  }
}
registerProcessor('recorder', Recorder);
