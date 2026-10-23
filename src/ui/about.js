// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['399', ['Granular scopes: cloud (where the grains read) and grain (the grains laid over each other).']],
  ['398', ['A woodblock synth: struck modes that lose energy as they ring, with drawn volume and pitch envelopes.']],
  ['397', ['DSP tab: diode icon; the parameter panel runs down the window\'s right edge and the source fills the rest.']],
  ['396', ['The DSP view folds code: gutter arrows, Fold all and Unfold all.']],
  ['395', ['A DSP view (Ctrl+Alt+I): read the code of an instrument\'s nodes, with live parameters.']],
  ['394', ['Sample screen: a hide / show switch for the selection as well.']],
  ['393', ['Waveform: drag selects, Alt+drag sets the loop, Ctrl+drag the sustain loop; hide switches on the Loop lines.']],
  ['392', ['Sample screen: Space over the waveform plays from the start, Alt+Space from the slice marker left of the mouse.']],
  ['391', ['Auto-slice previews the hits on the waveform as you move its settings; Slice makes them real markers.']],
  ['390', ['Auto-slice is a dialog with a live count of the hits it finds.']],
];
