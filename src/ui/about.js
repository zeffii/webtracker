// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['641', ['The page opens with raens; the old song is kept as ?demo=original']],
  ['640', ['New demo: raens (?demo=raens)']],
  ['639', ['First screen: moving the pointer brings up a shimmer of wireframe (edges and vertices) on the blob under it']],
  ['638', ['Samples: Islands → new sample runs the island pass on a sample or its selection and writes the result to a new slot']],
  ['637', ['New node: islands (spectral): keeps the peak of every note and turns down the smear and hiss between them']],
  ['636', ['Piano roll: contrast and islands sliders sharpen the spectrogram, with a bright ridge on each note\'s peak']],
  ['635', ['Trance gate: steps run down to quarter-ticks and patterns up to 64 steps long']],
  ['634', ['Flanger, chorus, phaser: writing phase slides the sweep (new glide parameter, default 20 ms) instead of clicking']],
  ['633', ['Piano roll: the overtone lines are thicker, with a dark rim, so they stand out on bright backgrounds']],
  ['632', ['Fix: the piano roll bar\'s Hear list now follows instruments added, removed or renamed (it needed the roll switched off and on)']],
                    ];
