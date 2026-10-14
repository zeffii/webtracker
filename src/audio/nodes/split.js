// Band splitter: four stereo bands from two or three Linkwitz-Riley (24 dB/oct) crossovers,
// in series: low | lmid | hmid | high. The bands are phase-aligned (the lower ones pass
// allpass filters matching the higher splits), so wiring all four back into one input
// gives the original level at every frequency. Use fewer bands by wiring neighbours
// together. Crossovers are kept in order: f1 < f2 < f3.
//
// A Linkwitz-Riley lowpass is two Butterworth lowpasses in a row, and lowpass + highpass
// is a 2nd-order allpass, so each split needs two filters: the highpass is allpass - lowpass.
const F1 = 0, F2 = 1, F3 = 2;
const K = Math.SQRT2;   // Butterworth damping (1 / Q)

class Svf {
  ic1 = 0; ic2 = 0; v1 = 0; v2 = 0; a1 = 0; a2 = 0; a3 = 0;
  set(g) { this.a1 = 1 / (1 + g * (g + K)); this.a2 = g * this.a1; this.a3 = g * this.a2; }
  run(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.v1 = v1; this.v2 = v2;
    return v2;
  }
  flush() { if (Math.abs(this.ic1) < 1e-20) this.ic1 = 0; if (Math.abs(this.ic2) < 1e-20) this.ic2 = 0; }
}

// Filters for one channel: two per split, then the allpasses for the lower bands.
class Channel {
  a1 = new Svf(); a2 = new Svf();      // split at f1
  b1 = new Svf(); b2 = new Svf();      // split at f2
  c1 = new Svf(); c2 = new Svf();      // split at f3
  p2 = new Svf(); p3 = new Svf();      // low band: allpass at f2, then f3
  q3 = new Svf();                      // lmid band: allpass at f3
  all = [this.a1, this.a2, this.b1, this.b2, this.c1, this.c2, this.p2, this.p3, this.q3];

  set(g1, g2, g3) {
    this.a1.set(g1); this.a2.set(g1);
    this.b1.set(g2); this.b2.set(g2); this.p2.set(g2);
    this.c1.set(g3); this.c2.set(g3); this.p3.set(g3); this.q3.set(g3);
  }

  // x in; the four bands come out in `out` (indices 0 to 3)
  run(x, out, i) {
    const lp1 = this.a2.run(this.a1.run(x));
    const r1 = x - 2 * K * this.a1.v1 - lp1;                 // allpass - lowpass = highpass
    const lp2 = this.b2.run(this.b1.run(r1));
    const r2 = r1 - 2 * K * this.b1.v1 - lp2;
    const lp3 = this.c2.run(this.c1.run(r2));
    const hp3 = r2 - 2 * K * this.c1.v1 - lp3;
    // phase alignment: the low band passes the f2 and f3 allpasses, the lmid band the f3 allpass
    this.p2.run(lp1); const low = lp1 - 2 * K * this.p2.v1;
    this.p3.run(low); out[0][i] = low - 2 * K * this.p3.v1;
    this.q3.run(lp2); out[1][i] = lp2 - 2 * K * this.q3.v1;
    out[2][i] = lp3;
    out[3][i] = hp3;
  }
}

export default {
  type: 'split',
  inputs: ['in'],
  outputs: ['low', 'lmid', 'hmid', 'high'],
  category: 'Effects',
  kinds: { in: 'stereo', low: 'stereo', lmid: 'stereo', hmid: 'stereo', high: 'stereo' },
  shape: 'box',
  glyph: 'split',
  params: [
    { name: 'f1', min: 30, max: 2000, def: 120 },
    { name: 'f2', min: 100, max: 8000, def: 800 },
    { name: 'f3', min: 500, max: 18000, def: 5000 },
  ],
  create({ sampleRate }) {
    const ch = [new Channel(), new Channel()];
    let f = null;
    return {
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0];
        const f1 = params[slots[F1]], f2 = Math.max(params[slots[F2]], f1 * 1.1), f3 = Math.max(params[slots[F3]], f2 * 1.1);
        if (!f) f = [f1, f2, f3];
        const slew = 1 - Math.exp(-n / (sampleRate * 0.02));
        f[0] += (f1 - f[0]) * slew; f[1] += (f2 - f[1]) * slew; f[2] += (f3 - f[2]) * slew;
        const g = f.map(v => Math.tan(Math.PI * Math.min(Math.max(v, 10), sampleRate * 0.45) / sampleRate));
        for (let c = 0; c < 2; c++) {
          const channel = ch[c], x = ins[c];
          channel.set(g[0], g[1], g[2]);
          const bands = [outputs[0][c], outputs[1][c], outputs[2][c], outputs[3][c]];
          for (let i = 0; i < n; i++) channel.run(x[i], bands, i);
          for (const s of channel.all) s.flush();
        }
      },
    };
  },
};
