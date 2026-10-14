// Oversampling for nonlinear stages: factor 1, 2 or 4, built from half-band FIR stages
// (41 taps, Blackman window). run(x, shape) takes one input sample and returns one output
// sample, calling shape() at the higher rate. `latency` is the delay it adds, in input samples.
const K = 20;
const TAP_J = [], TAP_H = [];
for (let j = 0; j <= 2 * K; j++) {   // taps of a half-band lowpass: the centre and the odd offsets
  const n = j - K;
  if (n !== 0 && n % 2 === 0) continue;
  const sinc = n === 0 ? 1 : Math.sin((Math.PI * n) / 2) / ((Math.PI * n) / 2);
  const window = 0.42 + 0.5 * Math.cos((Math.PI * n) / K) + 0.08 * Math.cos((2 * Math.PI * n) / K);
  TAP_J.push(j);
  TAP_H.push(0.5 * sinc * window);
}

class HalfBand {
  buf = new Float64Array(2 * K + 1);
  pos = 0;
  push(x) {
    const len = this.buf.length;
    this.buf[this.pos] = x;
    let sum = 0;
    for (let t = 0; t < TAP_J.length; t++) {
      let at = this.pos - TAP_J[t];
      if (at < 0) at += len;
      sum += TAP_H[t] * this.buf[at];
    }
    if (++this.pos === len) this.pos = 0;
    return sum;
  }
}

export class Oversampler {
  constructor(factor) {
    this.levels = factor === 4 ? 2 : factor === 2 ? 1 : 0;
    this.up = Array.from({ length: this.levels }, () => new HalfBand());
    this.down = Array.from({ length: this.levels }, () => new HalfBand());
    this.latency = Array.from({ length: this.levels }).reduce((sum, _, l) => sum + (2 * K) / 2 ** (l + 1), 0);
  }

  run(x, shape, level = 0) {
    if (level === this.levels) return shape(x);
    const a = this.run(this.up[level].push(2 * x), shape, level + 1);
    const b = this.run(this.up[level].push(0), shape, level + 1);
    this.down[level].push(a);
    return this.down[level].push(b);
  }
}

// A fixed delay in samples, to line the dry signal up with an oversampled one.
export class Delay {
  constructor(max) { this.buf = new Float64Array(max + 1); this.pos = 0; }
  push(x, samples) {
    const len = this.buf.length;
    this.buf[this.pos] = x;
    let at = this.pos - samples;
    if (at < 0) at += len;
    if (++this.pos === len) this.pos = 0;
    return this.buf[at];
  }
}
