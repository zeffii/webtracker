// Random: a control source that wanders. mode 0 picks a new value `rate` times a second; mode 1 picks one on each note;
// mode 2 picks one each time the `trig` input fires (a rise through 0.5, or a change between two values above 0, which is
// how notetrig's `trig` repeats), so any gate, envelope, lfo or notetrig can drive it.
// `smooth` is how far it slides to each new value: 0 jumps (sample and hold), 1 takes the whole time to arrive. Values
// are between -1 and 1 times `amount` (bipolar 1), or between 0 and `amount` (bipolar 0). Wire it to a fold, an index,
// a cutoff: a little of it keeps repeated notes from being the same note.
// `low` and `high` set the range the picks fall in (0 to 1), `lean` is the value inside it they favour, and `focus` is how
// strongly: 0 is even, 1 crowds most picks close to `lean` while still reaching both ends now and then. Low 0.2, high 0.9,
// lean 0.7, focus 0.6 is "between 0.2 and 0.9, mostly near 0.7" (set bipolar to 0 so the output is that range itself).
const MODE = 0, RATE = 1, SMOOTH = 2, AMOUNT = 3, BIPOLAR = 4, LOW = 5, HIGH = 6, LEAN = 7, FOCUS = 8;

// An even pick u (0 to 1) bent so the values bunch up around c (0 to 1) without leaving the ends out.
function lean(u, c, focus) {
  const g = 1 + focus * 4;
  return u < 0.5 ? c * (1 - Math.pow(1 - 2 * u, g)) : c + (1 - c) * Math.pow(2 * u - 1, g);
}
let instances = 0;   // each node gets its own sequence, the same every time the song is rendered

export default {
  type: 'random',
  inputs: ['trig'],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'random',
  kinds: { trig: 'control', out: 'control' },
  params: [
    { name: 'mode', min: 0, max: 2, def: 0, int: true },        // 0: free running, 1: a new value on each note, 2: on each trigger
    { name: 'rate', min: 0.05, max: 40, def: 1 },                // Hz
    { name: 'smooth', min: 0, max: 1, def: 0.7 },
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'bipolar', min: 0, max: 1, def: 1, int: true },
    { name: 'low', min: 0, max: 1, def: 0 },
    { name: 'high', min: 0, max: 1, def: 1 },
    { name: 'lean', min: 0, max: 1, def: 0.5 },
    { name: 'focus', min: 0, max: 1, def: 0 },
  ],
  create({ sampleRate }) {
    let seed = (0x9e3779b9 * ++instances) >>> 0 || 1;
    const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    let target = 0, value = 0, left = 0, fresh = false, prev = 0;
    return {
      note(msg) { if (msg.type === 'noteOn') fresh = true; },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], mode = Math.round(params[slots[MODE]]), rate = params[slots[RATE]], smooth = params[slots[SMOOTH]];
        const amount = params[slots[AMOUNT]], bipolar = params[slots[BIPOLAR]] >= 0.5;
        const low = Math.min(params[slots[LOW]], params[slots[HIGH]]), high = Math.max(params[slots[LOW]], params[slots[HIGH]]);
        const focus = params[slots[FOCUS]], c = high > low ? Math.min(1, Math.max(0, (params[slots[LEAN]] - low) / (high - low))) : 0.5;
        const period = sampleRate / rate;
        const time = Math.max(1, smooth * (mode === 0 ? period : sampleRate * 0.25) * 0.5);
        const trig = inputs[0];   // how long the slide takes, about
        const coef = smooth <= 0 ? 1 : 1 - Math.exp(-1 / time);
        for (let i = 0; i < n; i++) {
          let fired = false;
          if (mode === 2) {
            const t = trig ? trig[i] : 0;
            fired = (t > 0.5 && prev <= 0.5) || (t > 0.001 && prev > 0.001 && Math.abs(t - prev) > 1e-4);
            prev = t;
          }
          if (mode === 0 ? --left <= 0 : mode === 1 ? fresh : fired) { target = low + (high - low) * lean(rand(), c, focus); left = period; fresh = false; }
          value += (target - value) * coef;
          out[i] = (bipolar ? value * 2 - 1 : value) * amount;
        }
      },
    };
  },
};
