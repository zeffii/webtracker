// Ctrl: a control object that glides a value from one point to another, timed in subticks (a sixteenth of a tick,
// so it follows the tempo). Wire its output to a parameter port (tick "port" next to a parameter in the node panel and
// the node gets an input dot named @parameter): while connected, the parameter takes this value, mapped from 0 to 1 onto
// its own range and scale (a frequency glides evenly across octaves). Until the first event the parameter keeps the
// value its slider had.
//
// Expose `to`, `time` (and `from`, `curve`, `seed`) as pattern columns, and a row only needs the events:
//   to    write it and the value glides to it from where it is now, over `time` subticks (00 is a jump).
//         Writing the same value again glides again (the pattern's own write counts, not just a changed number),
//         and moving the slider in the panel does it too, so a sweep can be tried by hand.
//   from  write it and the value jumps there at once (a glide in progress stops); the next `to` starts from it.
//   time  length of the glide in subticks, 00 to FF (16 subticks are one tick). Read when `to` is written.
// `curve` is the shape of the glide: 0 linear, 1 log (fast start, a long soft end), 2 fast in slow out (ease out),
// 3 slow in fast out (ease in), 4 random stagger: the value climbs to its destination in `steps` random steps at
// random moments, `wobble` letting the steps stray from the straight path. The stagger's randomness comes from
// `seed`: the same seed makes the same stagger on every glide, a different seed another one, so it is reproducible.
// One copy runs for every voice of an instrument, so the sweep is the same for all of them.
const TO = 0, FROM = 1, TIME = 2, CURVE = 3, SEED = 4, STEPS = 5, WOBBLE = 6;
const MAX_STEPS = 32;
export const CURVES = ['linear', 'log', 'fast in slow out', 'slow in fast out', 'random stagger'];

// Shape of a glide at t (0 to 1), for the curves that are plain functions of time.
export const shape = (curve, t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (curve) {
    case 1: return Math.log10(1 + 9 * t);
    case 2: return Math.sin(t * Math.PI / 2);
    case 3: return 1 - Math.cos(t * Math.PI / 2);
    default: return t;
  }
};

// The random stagger for a seed: the moments (0 to 1, rising, the last at 1) at which the value steps, and where it
// stands after each (0 to 1, the last at 1). Plain numbers in, plain numbers out, so it can be tested and drawn.
export function stagger(seed, steps, wobble) {
  let s = (Math.imul(Math.floor(seed) + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const count = Math.max(2, Math.min(MAX_STEPS, Math.round(steps)));
  const times = Array.from({ length: count }, () => 0.04 + rand() * 0.96).sort((a, b) => a - b);
  const top = times[count - 1];
  for (let i = 0; i < count; i++) times[i] /= top;
  const weights = Array.from({ length: count }, () => 0.25 + rand() * 0.75), total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const levels = weights.map((w, i) => {
    acc += w;
    return i === count - 1 ? 1 : Math.min(1.5, Math.max(-0.5, acc / total + (rand() - 0.5) * wobble));
  });
  return { times, levels };
}

export default {
  type: 'ctrl',
  inputs: [],
  outputs: ['out'],
  category: 'Control',
  shared: true,   // one copy for all voices
  shape: 'rounded',
  glyph: 'ctrl',
  kinds: { out: 'param' },
  params: [
    { name: 'to', min: 0, max: 1, def: 0.5 },
    { name: 'from', min: 0, max: 1, def: 0.5 },
    { name: 'time', min: 0, max: 255, def: 16, int: true },   // subticks
    { name: 'curve', min: 0, max: 4, def: 0, int: true },
    { name: 'seed', min: 0, max: 255, def: 0, int: true },
    { name: 'steps', min: 2, max: MAX_STEPS, def: 8, int: true },
    { name: 'wobble', min: 0, max: 1, def: 0 },
  ],
  create({ clock, init }) {
    const stamps = clock?.stamps ?? new Uint32Array(1024);
    let value = Number.isFinite(init) ? init : 0.5, ready = false;
    let seenTo = 0, seenFrom = 0, seenToValue = 0, seenFromValue = 0;
    let gliding = false, pos = 0, len = 0, start = 0, target = 0, curve = 0, plan = null;
    return {
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0];
        const to = params[slots[TO]], from = params[slots[FROM]];
        const toStamp = stamps[slots[TO]], fromStamp = stamps[slots[FROM]];
        if (!ready) { ready = true; seenTo = toStamp; seenFrom = fromStamp; seenToValue = to; seenFromValue = from; }
        if (fromStamp !== seenFrom || from !== seenFromValue) {   // from: jump there
          seenFrom = fromStamp; seenFromValue = from;
          value = from; gliding = false;
        }
        if (toStamp !== seenTo || to !== seenToValue) {   // to: glide there
          seenTo = toStamp; seenToValue = to;
          const subticks = Math.max(0, Math.round(params[slots[TIME]]));
          len = subticks * (clock?.tickSamples ?? 6000) / 16;
          start = value; target = to; pos = 0; curve = Math.round(params[slots[CURVE]]);
          plan = curve === 4 ? stagger(params[slots[SEED]], params[slots[STEPS]], params[slots[WOBBLE]]) : null;
          if (len < 1) { value = target; gliding = false; } else gliding = true;
        }
        for (let i = 0; i < n; i++) {
          if (gliding) {
            pos += 1;
            const t = pos / len;
            if (t >= 1) { value = target; gliding = false; }
            else if (plan) {
              let k = -1;
              while (k + 1 < plan.times.length && plan.times[k + 1] <= t) k++;
              value = start + (target - start) * (k < 0 ? 0 : plan.levels[k]);
            } else value = start + (target - start) * shape(curve, t);
          }
          out[i] = value;
        }
      },
    };
  },
};
