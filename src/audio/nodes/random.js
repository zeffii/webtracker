// Random: a control source that wanders. mode 0 picks a new value `rate` times a second; mode 1 picks one on each note.
// `smooth` is how far it slides to each new value: 0 jumps (sample and hold), 1 takes the whole time to arrive. Values
// are between -1 and 1 times `amount` (bipolar 1), or between 0 and `amount` (bipolar 0). Wire it to a fold, an index,
// a cutoff: a little of it keeps repeated notes from being the same note.
const MODE = 0, RATE = 1, SMOOTH = 2, AMOUNT = 3, BIPOLAR = 4;
let instances = 0;   // each node gets its own sequence, the same every time the song is rendered

export default {
  type: 'random',
  inputs: [],
  outputs: ['out'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'random',
  kinds: { out: 'control' },
  params: [
    { name: 'mode', min: 0, max: 1, def: 0, int: true },        // 0: free running, 1: a new value on each note
    { name: 'rate', min: 0.05, max: 40, def: 1 },                // Hz
    { name: 'smooth', min: 0, max: 1, def: 0.7 },
    { name: 'amount', min: 0, max: 10, def: 1 },
    { name: 'bipolar', min: 0, max: 1, def: 1, int: true },
  ],
  create({ sampleRate }) {
    let seed = (0x9e3779b9 * ++instances) >>> 0 || 1;
    const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    let target = 0, value = 0, left = 0, fresh = false;
    return {
      note(msg) { if (msg.type === 'noteOn') fresh = true; },
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], mode = Math.round(params[slots[MODE]]), rate = params[slots[RATE]], smooth = params[slots[SMOOTH]];
        const amount = params[slots[AMOUNT]], bipolar = params[slots[BIPOLAR]] >= 0.5;
        const period = sampleRate / rate;
        const time = Math.max(1, smooth * (mode === 0 ? period : sampleRate * 0.25) * 0.5);   // how long the slide takes, about
        const coef = smooth <= 0 ? 1 : 1 - Math.exp(-1 / time);
        for (let i = 0; i < n; i++) {
          if (mode === 0 ? --left <= 0 : fresh) { target = rand() * 2 - 1; left = period; fresh = false; }
          value += (target - value) * coef;
          out[i] = (bipolar ? value : value * 0.5 + 0.5) * amount;
        }
      },
    };
  },
};
