// Trance gate: the sound is switched on and off by a pattern of steps (levels you draw in the panel), locked to the
// song's tempo. Each step lasts `div` ticks (a tick is a sixteenth with the usual 4 per beat; `div` can be a half or a quarter
// tick for rolls), the pattern is `steps` (up to 64) long, and `shift` rotates it, so a command can slide the rhythm along. `depth` is how far the gate closes (1 fully,
// less leaves some of the sound through) and `smooth` is how long the gate takes to open and close in ms (short is
// choppy, long is a soft swell). While the song is not playing the gate runs on its own, at the same tempo.
// The pattern is stored on the node as a list of up to 64 levels from 0 to 1. A shorter list (a pattern drawn when
// there were only 16 steps) repeats to fill the rest, so raising `steps` plays the same rhythm again, ready to be edited.
export const GATE_STEPS = 64;
export const DEFAULT_GATE = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0];
// The step lengths `div` can take, in ticks; whatever the knob says snaps to the nearest, so a step always lands on a musical grid.
export const DIVISIONS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];
export function snapDiv(v) {
  let best = 1;
  for (const d of DIVISIONS) if (Math.abs(d - v) < Math.abs(best - v)) best = d;
  return best;
}
export function normalizeGate(points) {
  if (!Array.isArray(points) || !points.length || !points.every(Number.isFinite)) points = DEFAULT_GATE;
  return Array.from({ length: GATE_STEPS }, (_, i) => Math.min(1, Math.max(0, points[i % points.length])));
}

const DIV = 0, STEPS = 1, SHIFT = 2, DEPTH = 3, SMOOTH = 4;

export default {
  type: 'gater',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'gater',
  editor: 'gate',
  params: [
    { name: 'div', min: 0.25, max: 8, def: 1 },                // ticks per step; quarter and half ticks give rolls and stutters
    { name: 'steps', min: 1, max: GATE_STEPS, def: 16, int: true },
    { name: 'shift', min: 0, max: GATE_STEPS - 1, def: 0, int: true },
    { name: 'depth', min: 0, max: 1, def: 1 },
    { name: 'smooth', min: 0.1, max: 50, def: 4 },             // ms
  ],
  create({ sampleRate, data, clock }) {
    let gate = normalizeGate(data?.gate);
    let gain = 1, free = 0;
    return {
      message(msg) { if (msg.type === 'gate') gate = normalizeGate(msg.points); },
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const div = snapDiv(params[slots[DIV]]), steps = Math.min(GATE_STEPS, Math.max(1, Math.round(params[slots[STEPS]])));
        const shift = Math.round(params[slots[SHIFT]]), depth = params[slots[DEPTH]];
        const coef = 1 - Math.exp(-1 / (sampleRate * Math.max(0.1, params[slots[SMOOTH]]) * 0.001));
        const tickSamples = clock?.tickSamples ?? sampleRate * 0.125;
        const perSample = 1 / (tickSamples * div);   // steps per sample
        const playing = clock?.playing === true;
        let pos = playing ? (clock.songPos ?? 0) / div : free;
        for (let i = 0; i < n; i++) {
          const k = ((Math.floor(pos) + shift) % steps + steps) % steps;
          const target = 1 - depth * (1 - gate[k]);
          gain += (target - gain) * coef;
          outL[i] = inL[i] * gain;
          outR[i] = inR[i] * gain;
          pos += perSample;
        }
        free = playing ? free : pos;
        if (!playing) free %= 1024;
      },
    };
  },
};
