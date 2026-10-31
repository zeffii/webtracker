// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['580', ['Steps nodes: a list of probabilities (click a step to cycle it); the Node Sequencer properties are a bar under the graph']],
  ['579', ['Out node: a master switch; off, the instrument is heard only by sidechain nodes (the vocoder demo is now only the vocoder)']],
  ['578', ['Node Sequencer: click a key on a Chord tile to hear the note, double-click the tile (or Play chord) to hear the whole chord']],
  ['577', ['A vocoder demo (?demo=vocoder): long chords as the carrier, short percussive stabs as the voice']],
  ['576', ['A section node passes the clock\'s ticks on only between a start and an end tick; the node demo uses it']],
  ['575', ['The Shader and DSP buttons start hidden; a flask button in the status bar shows them']],
  ['574', ['Node Sequencer: Pattern, switch, pick, gate, counter, compare, flip, once, ratchet, latch and drunk nodes; a demo made of nodes (?demo=interstellar-nodes); straight wires between ports that line up']],
  ['573', ['The Node Sequencer is a line drawing that runs top to bottom: one-line nodes, dim outlines, ports shaped by kind, a new rail icon']],
  ['572', ['Chord tiles grow a keyboard on hover: click keys to play a chord in; the tile names the chord and marks stray notes']],
  ['571', ['The CPU readout is cleared each time Play starts']],
                    ];
