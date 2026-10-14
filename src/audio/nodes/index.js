import sampler from './sampler.js';
import osc from './osc.js';
import env from './env.js';
import lfo from './lfo.js';
import gain from './gain.js';
import filter from './filter.js';
import delay from './delay.js';
import out from './out.js';
import mix from './mix.js';
import sum from './sum.js';
import sumst from './sumst.js';
import fold from './fold.js';
import pan from './pan.js';
import chorus from './chorus.js';
import multitap from './multitap.js';
import waveshaper from './waveshaper.js';
import exciter from './exciter.js';
import transient from './transient.js';
import split from './split.js';
import compressor from './compressor.js';
import hall from './hall.js';
import subsynth from './subsynth.js';
import addsynth from './addsynth.js';

// Node type registry. Adding a node type means adding a module and listing it here.
export const NODE_TYPES = { sampler, osc, env, lfo, gain, mix, pan, filter, delay, chorus, multitap, waveshaper, exciter, transient, split, compressor, hall, subsynth, addsynth, out, sum, sumst, fold };
