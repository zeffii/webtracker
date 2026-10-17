// Plucked string (Karplus-Strong). A note strikes a delay line the length of one period with a burst of noise; the
// line feeds back on itself through a gentle lowpass, so the sound rings at the note's pitch and the high harmonics
// die first, as on a real string. `decay` is how long the note takes to fall by 60 dB (it holds for every pitch),
// `damp` is how fast the highs die away relative to the lows, `bright` is how bright the strike is (a soft finger
// to a hard pick) and `pos` is where along the string it is plucked (0.5 is the middle, which loses the even
// harmonics; near the end it is thin and nasal). Velocity adds loudness and brightness. Note off damps the string
// over `release` ms. Monophonic, a new note strikes the string again; the voices node makes it polyphonic.
const SPEC = [
  { name: 'decay', min: 0.05, max: 30, def: 3 },        // seconds to fall 60 dB
  { name: 'damp', min: 0, max: 1, def: 0.3 },
  { name: 'bright', min: 0, max: 1, def: 0.6 },
  { name: 'pos', min: 0.02, max: 0.5, def: 0.15 },
  { name: 'tune', min: -48, max: 48, def: 0 },
  { name: 'vel', min: 0, max: 1, def: 0.5 },
  { name: 'level', min: 0, max: 1, def: 0.5 },
  { name: 'release', min: 5, max: 3000, def: 150 },     // ms
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

const SIZE = 1 << 16, MASK = SIZE - 1;

export default {
  type: 'string',
  inputs: ['pitch'],
  outputs: ['out'],
  category: 'Sources',
  generator: true,
  shape: 'rounded',
  glyph: 'string',
  kinds: { pitch: 'control', out: 'stereo' },
  params: SPEC,
  create({ sampleRate, connected }) {
    const pitchOn = connected[0];
    const buf = new Float64Array(SIZE);
    let w = 0, note = 60, velocity = 1, active = false, held = false, amp = 0, pending = false, gain = 1;
    let seed = 0x9e3779b9;
    const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 * 2 - 1; };
    const period = (tune, octaves) => Math.max(2.5, Math.min(SIZE / 2 - 4, sampleRate / (440 * Math.pow(2, (note + tune - 69) / 12 + octaves))));

    // Fill the last `len` samples of the line with the strike.
    const strike = (len, bright, pos) => {
      const n = Math.max(2, Math.round(len));
      const c = Math.max(0.03, bright);   // one pole lowpass on the noise: smaller is duller
      const e = new Float64Array(n);
      let y = 0;
      for (let i = 0; i < n; i++) { y += c * (rand() - y); e[i] = y; }
      const d = Math.max(1, Math.round(pos * n));
      const comb = new Float64Array(n);
      for (let i = 0; i < n; i++) comb[i] = e[i] - e[(i - d + n) % n];   // plucking at a point cancels the harmonics with a node there
      let mean = 0; for (let i = 0; i < n; i++) mean += comb[i];
      mean /= n;
      let peak = 1e-9; for (let i = 0; i < n; i++) { comb[i] -= mean; peak = Math.max(peak, Math.abs(comb[i])); }
      buf.fill(0);
      for (let i = 0; i < n; i++) buf[(w - n + i) & MASK] = comb[i] / peak;
    };

    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; pending = true; held = true; active = true; }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') held = false;
        else if (msg.type === 'noteCut') { active = false; held = false; buf.fill(0); amp = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        const [outL, outR] = outputs[0];
        if (!active) { outL.fill(0, 0, n); outR.fill(0, 0, n); return; }
        const g = name => params[slots[P[name]]];
        const T = period(g('tune'), pitchOn ? inputs[0][0] : 0);
        const s = g('damp') * 0.5;                 // weight of the older sample in the loop filter: a delay of s samples at low frequencies
        const D = Math.max(1.5, T - s);            // the read delay; with the filter's own delay the loop adds up to one period
        if (pending) {
          pending = false;
          const vm = 1 - g('vel') + g('vel') * velocity;
          const hard = Math.min(1, g('bright') * (1 - g('vel') * 0.5 * (1 - velocity)));
          strike(T, hard, g('pos'));
          gain = vm;
        }
        // loop gain from the decay time: the line is passed through once per period
        const roundTrip = T / sampleRate;
        let loop = Math.pow(10, -3 * roundTrip / g('decay'));
        if (!held) loop *= Math.pow(10, -3 * roundTrip / (g('release') * 0.001));
        loop = Math.min(0.99995, loop);
        const out = g('level') * gain * 0.7;
        const di = Math.floor(D), df = D - di;
        for (let i = 0; i < n; i++) {
          // two taps D and D+1 samples back, each linearly interpolated, then the lowpass (1-s, s)
          const a0 = buf[(w - di) & MASK], a1 = buf[(w - di - 1) & MASK], a2 = buf[(w - di - 2) & MASK];
          const t0 = a0 + (a1 - a0) * df, t1 = a1 + (a2 - a1) * df;
          const y = ((1 - s) * t0 + s * t1) * loop;
          buf[w & MASK] = y;
          w = (w + 1) & MASK;
          outL[i] = outR[i] = y * out;
          const ay = Math.abs(y);
          amp = ay > amp ? ay : amp * 0.999;
        }
        if (amp < 1e-5) { active = false; buf.fill(0); amp = 0; }
      },
    };
  },
};
