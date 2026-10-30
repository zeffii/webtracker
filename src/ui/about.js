// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['556', ['Delay compensation, first step: spectral and oversampled nodes declare how late they are, and the status bar shows the slowest instrument as chain N ms']],
  ['555', ['New synth, Snarl: two resonant filters in a row (high-pass, then low-pass), ring mod, two envelopes and a modulation generator, for screaming leads and growling basses']],
  ['554', ['New synth, Jaw harp: a plucked reed drones and the mouth picks out its harmonics; sweep the vowel for the wah and the tune']],
  ['553', ['New effect, Body blur (Effects, Spectral): smooths and rounds the body of a sound while its hits pass through untouched, in time; standard or eco quality']],
  ['552', ['New demo, ?demo=weights: chords with a volume for every note, played in turn by a Phrase node, with a pad moved by lfos']],
  ['551', ['Node Sequencer: the scroll wheel zooms and the middle button pans; a change of theme repaints the graph at once']],
  ['550', ['Node Sequencer: tile borders are the theme accent colour, almost see-through until a node is busy; tiles hide wires that run behind them']],
  ['549', ['Node Sequencer: wires in a deep tint of their kind and ports ringed in the same colour, amber events, teal controls, violet chords, olive weights']],
  ['548', ['Node Sequencer: hover a wire for a pair of arrows, then drag that stretch sideways to move the wire away from tiles; double-click the arrows to reset']],
  ['547', ['Node Sequencer: a schematic look, outlined boxes in one ink with right-angle wires told apart by dashes; the Chord tile is wider and holds its keyboard. Fixes wires missing in 546']],
];
