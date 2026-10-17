// Envelope follower: listens to a signal and outputs how loud it is as a control signal (0 to 1), for a parameter
// port. The level is smoothed with `attack` (how fast it rises) and `release` (how fast it falls), then laid on a
// window: `floor` dB and below is 0, `gain` dB above that reaches 1. `peak` follows the loudest sample, `rms` the
// average power, which is closer to what you hear. `invert` flips the result, so a loud input pulls the target down:
// wire the follower into the level of an effect on the same signal to duck it, or into a filter's cutoff for an
// auto-wah. The audio itself passes through nothing; only the control signal comes out. It listens inside its own
// instrument, so it follows the sound of that instrument's graph.
const SPEC = [
  { name: 'attack', min: 0.1, max: 500, def: 5 },      // ms
  { name: 'release', min: 1, max: 5000, def: 150 },    // ms
  { name: 'floor', min: -80, max: -6, def: -48 },      // dB at the bottom of the window
  { name: 'gain', min: -24, max: 24, def: 0 },         // dB added before the window
  { name: 'mode', min: 0, max: 1, def: 0, int: true }, // 0 peak, 1 rms
  { name: 'invert', min: 0, max: 1, def: 0, int: true },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

export default {
  type: 'follower',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Control',
  shape: 'rounded',
  glyph: 'follower',
  kinds: { in: 'stereo', out: 'param' },
  params: SPEC,
  create({ sampleRate }) {
    let env = 0, last = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0];
        const out = outputs[0];
        const g = name => params[slots[P[name]]];
        const ca = Math.exp(-1 / (sampleRate * g('attack') * 0.001)), cr = Math.exp(-1 / (sampleRate * g('release') * 0.001));
        const rms = g('mode') >= 1;
        for (let i = 0; i < n; i++) {
          const l = inL[i], r = inR ? inR[i] : l;
          const x = rms ? (l * l + r * r) * 0.5 : Math.max(Math.abs(l), Math.abs(r));
          env = x > env ? ca * env + (1 - ca) * x : cr * env + (1 - cr) * x;
        }
        // the level in dB at the end of the block, ramped from the last one so a parameter port hears no steps
        const level = Math.max(env, 1e-12);
        const db = (rms ? 10 : 20) * Math.log10(level) + g('gain');
        let v = Math.min(1, Math.max(0, (db - g('floor')) / -g('floor')));
        if (g('invert') >= 1) v = 1 - v;
        for (let i = 0; i < n; i++) out[i] = last + (v - last) * ((i + 1) / n);
        last = v;
      },
    };
  },
};
