// Ensemble: the chorus of a string machine. The sound runs through three short delays whose lengths are moved by two
// wobbles at once, a slow one and a fast one, and each delay is a third of a turn behind the last in both. Three copies
// that are never in tune with each other at the same moment turn one plain sawtooth into a section of players.
//
//   slow, fast   the speeds of the two wobbles, in Hz        depth     how far the delays swing
//   shimmer      how much of the swing is the fast wobble     width     the first delay to the left, the second to the
//   tone         the delays are a little dull, as the old       right, the third in the middle
//                chips were                                   mix       dry against the three delays
// The sound is mixed to mono on the way in. It works on anything, not only on strings.
const BASE_MS = 6, SLOW_MS = 1.6, FAST_MS = 0.22, MAX_MS = 12;
export const LINES = 3;

const SPEC = [
  { name: 'slow', min: 0.05, max: 2, def: 0.6 },      // Hz
  { name: 'fast', min: 2, max: 10, def: 6 },          // Hz
  { name: 'depth', min: 0, max: 1, def: 0.6 },
  { name: 'shimmer', min: 0, max: 1, def: 0.5 },
  { name: 'width', min: 0, max: 1, def: 0.8 },
  { name: 'tone', min: 1000, max: 16000, def: 8000 }, // Hz
  { name: 'mix', min: 0, max: 1, def: 1 },
];
const P = {};
SPEC.forEach((s, i) => { P[s.name] = i; });

// The length of delay `line` (0, 1 or 2) in ms, when the slow wobble is at `slowPhase` and the fast one at `fastPhase`
// (both in turns). The panel draws these; the node plays them.
export function delayMs(line, slowPhase, fastPhase, depth, shimmer) {
  const turn = 2 * Math.PI, behind = line / LINES;
  return BASE_MS + depth * (SLOW_MS * Math.sin(turn * (slowPhase + behind)) + 2 * shimmer * FAST_MS * Math.sin(turn * (fastPhase + behind)));
}

export default {
  type: 'ensemble',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'ensemble',
  editor: 'ensemble',
  params: SPEC,
  create({ sampleRate }) {
    const size = Math.ceil((sampleRate * MAX_MS) / 1000) + 4, line = new Float32Array(size);
    const heard = new Float32Array(LINES), dull = new Float32Array(LINES);
    let write = 0, slowPhase = 0, fastPhase = 0;
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const g = name => params[slots[P[name]]];
        const slowInc = g('slow') / sampleRate, fastInc = g('fast') / sampleRate, depth = g('depth'), shimmer = g('shimmer');
        const width = g('width'), mix = g('mix'), toneRate = 1 - Math.exp((-2 * Math.PI * g('tone')) / sampleRate);
        const near = (1 + width) / 2, far = (1 - width) / 2, toSamples = sampleRate / 1000;
        for (let i = 0; i < n; i++) {
          const dry = 0.5 * (inL[i] + inR[i]);
          line[write] = Math.abs(dry) < 1e-20 ? 0 : dry;
          slowPhase += slowInc; if (slowPhase >= 1) slowPhase -= 1;
          fastPhase += fastInc; if (fastPhase >= 1) fastPhase -= 1;
          for (let k = 0; k < LINES; k++) {
            let at = write - delayMs(k, slowPhase, fastPhase, depth, shimmer) * toSamples; if (at < 0) at += size;
            const j = at | 0, f = at - j, next = j + 1 === size ? 0 : j + 1;
            dull[k] += (line[j] + (line[next] - line[j]) * f - dull[k]) * toneRate;
            heard[k] = dull[k];
          }
          // the first delay leans left, the second right, the third sits in the middle
          const wetL = (heard[0] * near + heard[1] * far + heard[2] * 0.7) * 0.62, wetR = (heard[0] * far + heard[1] * near + heard[2] * 0.7) * 0.62;
          outL[i] = inL[i] + (wetL - inL[i]) * mix; outR[i] = inR[i] + (wetR - inR[i]) * mix;
          if (++write === size) write = 0;
        }
      },
    };
  },
};
