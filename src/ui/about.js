// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['588', ['Fix: the line over every 512th tick is now visible']],
  ['587', ['Mixer: small lane names and the retroslate look']],
  ['586', ['Fix: the page failed to start with the mixer on (and projects failed to load)']],
  ['585', ['Arrangement: a faint line over every 512th tick; the File menu opens over every panel']],
  ['584', ['Mixer: strips as wide as their lanes, the meter inside the fader, and a test button that turns the fader into a temporary test gain']],
  ['583', ['Arrangement: a Mixer under the lanes with a vertical fader, M, S and mix per lane, standing in for each instrument\'s Out node']],
  ['582', ['Node Sequencer: hold Shift over a wire to see its last messages (tick, value, note name, volume, length); the vocoder demo is the tuned version']],
  ['581', ['Node Sequencer: the Chord keyboard is in the bar under the graph, parameters stack four to a column, and a selected node is drawn with a glow and brackets']],
  ['580', ['Steps nodes: a list of probabilities (click a step to cycle it); the Node Sequencer properties are a bar under the graph']],
  ['579', ['Out node: a master switch; off, the instrument is heard only by sidechain nodes (the vocoder demo is now only the vocoder)']],
                    ];
