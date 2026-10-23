// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['408', ['A clap synth: burst train and tail through a band-pass.']],
  ['407', ['urugraVerb: the Arguru-inspired reverb, ported from your gendsp.']],
  ['406', ['An impulse-response reverb (convolver): any sample is the response, with a list of free IR sources in its help.']],
  ['405', ['Arrangement view: right-click > Insert lane… adds a lane for an instrument at the end.']],
  ['404', ['A comb filter: tuned resonator with feedback, feedforward, damping and stereo spread.']],
  ['403', ['Arrangement view: no wrap at the ends (a Wrap button turns it on), and the master lane is half as wide.']],
  ['402', ['Graph view: R removes the selected node and joins the wires round it.']],
  ['401', ['Granular: every note starts the cloud at Position.']],
  ['400', ['A node\'s envelope box and its scope sit side by side, level at the middle.']],
  ['399', ['Granular scopes: cloud (where the grains read) and grain (the grains laid over each other).']],
];
