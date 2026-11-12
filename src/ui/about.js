// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['730', ['FilterPro has a panel: the sound going in, the sound coming out and the filter curve between them, with frequency marks, the cutoff to drag, and formants or comb teeth for the vowel and comb voicings. The vowel voicing no longer drifts.']],
  ['729', ['Low Pulsar notes keep their release tail instead of cutting off when the key is let go.']],
  ['728', ['The Pulsar synth is in the Shift+I menu (synths, digital): a ready-made instrument with formant, track, mask and scatter on its panel.']],
  ['727', ['Mixer meters turn grey for lanes whose Mix button is off, since those do not reach the output.']],
  ['726', ['Click a note in the pattern roll (or a row number) to put the pattern editor\'s cursor there, with Edit mode on or off.']],
  ['725', ['A plain first screen: the Wax logo and a thin loader bar, and the app starts by itself after about a second (sound switches on at your first click or key press). The effect looks and their setting are gone.']],
  ['724', ['The first screen blob\'s background gradient is the complement of the blob\'s colour (yellow on blue, cyan on red).']],
  ['723', ['No purples or pinks on the first screen: the random colours skip that part of the colour wheel, and the blob keeps to yellow, blue and orange colourways.']],
  ['722', ['A new first screen: reaction diffusion and flowing plasma join the blob and the logo, in new random colours on every start (the old teal is gone). Pick one, or leave Config "First screen look" on random.']],
  ['721', ['The mixer\'s button column sits 5 px clear of the dB tick marks (strips are 5 px wider).']],
                    ];
