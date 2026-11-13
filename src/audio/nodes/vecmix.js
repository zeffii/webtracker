// Vector mix: four sounds mixed by one position on a diamond (see vectorcore.js). a sits at the left point, b at the top,
// c at the right and d at the bottom; in the middle a quarter of each is heard, and the four shares always add up to 1.
// The x and y inputs are added to the `x` and `y` settings, so a vecpath node (or two LFOs) can move the mix.
// It is the mixer inside the compass synth.
import { diamondWeights } from './vectorcore.js';

const X = 0, Y = 1, LEVEL = 2;

export default {
  type: 'vecmix',
  inputs: ['a', 'b', 'c', 'd', 'x', 'y'],
  outputs: ['out'],
  category: 'Mix & level',
  shape: 'box',
  glyph: 'vecmix',
  editor: 'vecmix',
  kinds: { x: 'control', y: 'control' },
  params: [
    { name: 'x', min: -1, max: 1, def: 0 },
    { name: 'y', min: -1, max: 1, def: 0 },
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ connected }) {
    const xOn = connected[4], yOn = connected[5];
    const target = new Float32Array(4), weights = new Float32Array([0.25, 0.25, 0.25, 0.25]), step = new Float32Array(4);
    let fresh = true;
    return {
      process(inputs, outputs, n, params, slots) {
        const out = outputs[0], level = params[slots[LEVEL]];
        // the position is read once per block and the shares slide to it, so a moving mix never steps
        const x = params[slots[X]] + (xOn ? inputs[4][n - 1] : 0), y = params[slots[Y]] + (yOn ? inputs[5][n - 1] : 0);
        diamondWeights(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)), target);
        if (fresh) { weights.set(target); fresh = false; }
        for (let k = 0; k < 4; k++) step[k] = (target[k] - weights[k]) / n;
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) { weights[k] += step[k]; if (connected[k]) sum += inputs[k][i] * weights[k]; }
          out[i] = sum * level;
        }
      },
    };
  },
};
