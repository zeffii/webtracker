// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['630', ['Node Sequencer: section can follow the number of the events (a counter, a modulo rem) instead of the song tick, so a looping count can have parts of its own']],
  ['629', ['Chord machine: a slot starting with > holds plain notes (>G-4 A-5 C-5) played at exactly those pitches']],
  ['628', ['Flanger, chorus and phaser: a phase parameter a pattern can write to restart the sweep at a chosen point and let it run on']],
  ['627', ['Pattern editor: Ctrl+Alt+Up / Down (nothing selected) add or remove a Note + Vol column pair for the lane under the cursor']],
  ['626', ['Fix: the pattern editor selection box and playhead line no longer drift off the rows when the line height is fractional']],
  ['625', ['The pattern editor selection is a thin box with a faint fill laid over the grid, so selecting no longer rewrites the rows']],
  ['624', ['Frame-timing panel (Ctrl+Alt+F); the pattern editor on big songs is several times faster (no more whole-grid re-layout every frame)']],
  ['623', ['Node Sequencer: a modulo node that works on the song tick (every n ticks, beats or bars from an offset), with hit, rem and phase outputs']],
  ['622', ['Quiet machines sleep: no CPU until a note, parameter change or sidechain wakes them, state kept (Sleep switch per machine, zz in the Stream Manager)']],
  ['621', ['Piano roll over the sample display (Shift+P): mark a virtual pattern, draw notes, hear chords per row, overtone guides, master tuning, write to a "NN transcribe N" pattern']],
                    ];
