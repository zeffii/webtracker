import sampler from './sampler.js';
import filter from './filter.js';
import delay from './delay.js';
import out from './out.js';

// Node type registry. Adding a node type means adding a module and listing it here.
export const NODE_TYPES = { sampler, filter, delay, out };
