// Vector path: a control source that travels a drawn path across a diamond after each note starts, and puts out where it
// is as x and y (each -1 to 1). Wire them into a vecmix node, or into anything else that wants two linked movements.
// One trip along the path takes `pathms`; `pmode` says what happens at its end (see vectorcore.js). `amount` scales the
// movement, `x` and `y` shift it. It is the path inside the compass synth. Kept on the node (data): path, the points.
import { cleanPath, pathAt } from './vectorcore.js';

const PATHMS = 0, PMODE = 1, AMOUNT = 2, X = 3, Y = 4;

export default {
  type: 'vecpath',
  inputs: [],
  outputs: ['x', 'y'],
  category: 'Sources',
  shape: 'rounded',
  glyph: 'vecpath',
  editor: 'vecpath',
  kinds: { x: 'control', y: 'control' },
  params: [
    { name: 'pathms', min: 10, max: 60000, def: 4000 },     // ms for one trip
    { name: 'pmode', min: 0, max: 2, def: 1, int: true },   // once, loop, back and forth
    { name: 'amount', min: 0, max: 1, def: 1 },
    { name: 'x', min: -1, max: 1, def: 0 },
    { name: 'y', min: -1, max: 1, def: 0 },
  ],
  create({ sampleRate, data }) {
    let path = cleanPath(data?.path), age = 0, lastX = 0, lastY = 0, fresh = true;
    const position = [0, 0];
    return {
      message(msg) { if (msg.type === 'path') path = cleanPath(msg.points); },
      note(msg) { if (msg.type === 'noteOn') age = 0; },
      process(inputs, outputs, n, params, slots) {
        const [outX, outY] = outputs;
        age += n;
        pathAt(path, Math.round(params[slots[PMODE]]), age / (params[slots[PATHMS]] * 0.001 * sampleRate), position);
        const amount = params[slots[AMOUNT]];
        const x = params[slots[X]] + amount * position[0], y = params[slots[Y]] + amount * position[1];
        if (fresh) { lastX = x; lastY = y; fresh = false; }
        // a straight line from where it was at the end of the last block
        for (let i = 0; i < n; i++) { const t = (i + 1) / n; outX[i] = lastX + (x - lastX) * t; outY[i] = lastY + (y - lastY) * t; }
        lastX = x; lastY = y;
      },
    };
  },
};
