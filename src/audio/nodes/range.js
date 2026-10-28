// Range: scales a 0..1 signal onto real values you type in, and hands the port it feeds the 0..1 it expects.
// Wire its output to a parameter port and `lo` and `hi` are in that parameter's own units (Hz, ms, dB ...), the panel
// reads the limits from the port. Input 0 is the bottom (lo), 1 the top (hi). With nothing on the input, `at` (0..1) stands in,
// so the node is also a knob in real units. Not wired to a port, it just outputs the number between lo and hi.
// The compiler gives every outgoing wire its own copy of the node (the copies share their parameters), so each port is scaled to its own range.
const LO = 0, HI = 1, AT = 2;
export default {
  type: 'range',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Control',
  shape: 'rounded',
  glyph: 'range',
  kinds: { in: 'control', out: 'control' },
  params: [
    { name: 'lo', min: -100000, max: 100000, def: 0 },
    { name: 'hi', min: -100000, max: 100000, def: 1 },
    { name: 'at', min: 0, max: 1, def: 0.5 },
  ],
  create({ connected, target }) {
    const wired = connected?.[0] === true;
    let lastX = NaN, lastLo = NaN, lastHi = NaN, last = 0;
    const map = (x, lo, hi) => {
      const v0 = target?.log && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, x) : lo + x * (hi - lo);   // a log port (a frequency) sweeps evenly across octaves
      if (!target) return v0;
      const v = target.int ? Math.round(v0) : v0;
      let r;
      if (target.log) r = v > 0 ? Math.log(v / target.min) / Math.log(target.max / target.min) : 0;
      else r = (v - target.min) / (target.max - target.min);
      return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
    };
    return {
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], inp = inputs[0], lo = params[slots[LO]], hi = params[slots[HI]];
        if (!wired) {
          const x = params[slots[AT]];
          if (x !== lastX || lo !== lastLo || hi !== lastHi) { lastX = x; lastLo = lo; lastHi = hi; last = map(x, lo, hi); }
          out.fill(last, 0, n);
          return;
        }
        for (let i = 0; i < n; i++) {
          const x = Math.min(1, Math.max(0, inp[i]));
          if (x !== lastX || lo !== lastLo || hi !== lastHi) { lastX = x; lastLo = lo; lastHi = hi; last = map(x, lo, hi); }
          out[i] = last;
        }
      },
    };
  },
};
