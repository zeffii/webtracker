// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['575', ['The Shader and DSP buttons start hidden; a flask button in the status bar shows them']],
  ['574', ['Node Sequencer: Pattern, switch, pick, gate, counter, compare, flip, once, ratchet, latch and drunk nodes; a demo made of nodes (?demo=interstellar-nodes); straight wires between ports that line up']],
  ['573', ['The Node Sequencer is a line drawing that runs top to bottom: one-line nodes, dim outlines, ports shaped by kind, a new rail icon']],
  ['572', ['Chord tiles grow a keyboard on hover: click keys to play a chord in; the tile names the chord and marks stray notes']],
  ['571', ['The CPU readout is cleared each time Play starts']],
  ['570', ['A latency? button on the status bar switches latency compensation on and off']],
  ['569', ['CPU meter ignores the first second after Play (start-up cost, not playing cost)']],
  ['568', ['Arrangement boxes drawn on whole pixels: no more thicker outlines in places']],
  ['567', ['Top bar: a File menu replaces Open, New, Save, Export and Backups buttons']],
  ['566', ['New shader template, Holey torus: a perforated ring that tumbles while its tube twists, glowing on hits']],
                    ];
