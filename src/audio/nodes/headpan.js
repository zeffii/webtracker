// Head pan: places a sound around the head, not only left to right. The far ear hears it later (the time difference, from the size of the head),
// quieter and duller (the head shadows it), and a sound from behind loses its top in both ears. Mono in (the two sides are summed), a pair of
// ears out: best on headphones. The cost is two delays and three one-pole filters.
import { headOf } from '../spacecore.js';

const ANGLE = 0, DISTANCE = 1, HEAD = 2, SHADOW = 3, MIX = 4;
const MAX_S = 0.002;

export default {
  type: 'headpan',
  inputs: ['in'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', out: 'stereo' },
  shape: 'box',
  glyph: 'headpan',
  editor: 'headpan',
  params: [
    { name: 'angle', min: -180, max: 180, def: 40 },    // degrees: 0 in front, 90 on the right, 180 behind
    { name: 'distance', min: 0.5, max: 20, def: 1.5 },  // m: farther is quieter
    { name: 'head', min: 14, max: 22, def: 17.5 },      // cm, the width of the head
    { name: 'shadow', min: 0, max: 1, def: 1 },         // how much the head dulls the far ear and the back
    { name: 'mix', min: 0, max: 1, def: 1 },
  ],
  create({ sampleRate }) {
    const size = Math.ceil(sampleRate * MAX_S) + 4;
    const buf = new Float32Array(size);
    let w = 0, l = 0, r = 0, init = false;
    let dl = 0, dr = 0, gl = 1, gr = 1, cl = 1, cr = 1, rear = 1;
    const slew = 1 - Math.exp(-1 / (sampleRate * 0.04));
    const coef = hz => 1 - Math.exp(-2 * Math.PI * Math.min(hz, sampleRate * 0.45) / sampleRate);
    return {
      process(inputs, outputs, n, params, slots) {
        const [inL, inR] = inputs[0], [outL, outR] = outputs[0];
        const h = headOf({ angle: params[slots[ANGLE]], distance: params[slots[DISTANCE]], head: params[slots[HEAD]], shadow: params[slots[SHADOW]] });
        const mix = params[slots[MIX]];
        const farL = h.far === 'l', tdl = farL ? h.itd * sampleRate : 0, tdr = farL ? 0 : h.itd * sampleRate;
        const tgl = h.gain * (farL ? h.farGain : 1), tgr = h.gain * (farL ? 1 : h.farGain);
        const tcl = coef(farL ? h.farCut : 20000), tcr = coef(farL ? 20000 : h.farCut), trear = coef(h.rearCut);
        if (!init) { dl = tdl; dr = tdr; gl = tgl; gr = tgr; cl = tcl; cr = tcr; rear = trear; init = true; }
        for (let i = 0; i < n; i++) {
          dl += (tdl - dl) * slew; dr += (tdr - dr) * slew; gl += (tgl - gl) * slew; gr += (tgr - gr) * slew;
          cl += (tcl - cl) * slew; cr += (tcr - cr) * slew; rear += (trear - rear) * slew;
          const x = (inL[i] + inR[i]) * 0.5;
          buf[w] = Math.abs(x) < 1e-20 ? 0 : x;
          const at = d => { let p = w - d; if (p < 0) p += size; const j = p | 0, f = p - j; return buf[j] + (buf[j + 1 === size ? 0 : j + 1] - buf[j]) * f; };
          l += (at(dl) - l) * Math.min(cl, rear); r += (at(dr) - r) * Math.min(cr, rear);
          outL[i] = (inL[i] + (l * gl - inL[i]) * mix); outR[i] = (inR[i] + (r * gr - inR[i]) * mix);
          if (++w === size) w = 0;
        }
      },
    };
  },
};
