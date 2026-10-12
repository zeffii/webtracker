import sampler from './sampler.js';
import osc from './osc.js';
import env from './env.js';
import lfo from './lfo.js';
import gain from './gain.js';
import filter from './filter.js';
import delay from './delay.js';
import out from './out.js';

// Node type registry. Adding a node type means adding a module and listing it here.
export const NODE_TYPES = { sampler, osc, env, lfo, gain, filter, delay, out };
