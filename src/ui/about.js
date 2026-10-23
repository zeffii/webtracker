// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['417', ['Duette is polyphonic: a note column keeps one voice, so glide and slide work per column.']],
  ['416', ['Duette: a two-oscillator mono lead voice with sync, ring, one envelope and one LFO. Waveform redraws after Normalise and the other in-place edits.']],
  ['415', ['Detect chords: the notes of a recording written into a pattern (Samples, Shift+H).']],
  ['414', ['OSC out machine: notes as OSC, Renoise addresses, with a relay script.']],
  ['413', ['Insert lane goes left or right of the lane; New instrument lists kinds with default names.']],
  ['412', ['Insert lane: New instrument and Instruments without a lane.']],
  ['411', ['Insert lane: New instrument and Unassigned instruments entries.']],
  ['410', ['The arrangement selection drag survives the pointer leaving the grid.']],
  ['409', ['Resizing the graph view redraws it at once instead of flashing blank.']],
  ['408', ['A clap synth: burst train and tail through a band-pass.']],
];
