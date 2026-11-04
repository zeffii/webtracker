// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['626', ['Fix: the pattern editor selection box and playhead line no longer drift off the rows when the line height is fractional']],
  ['625', ['The pattern editor selection is a thin box with a faint fill laid over the grid, so selecting no longer rewrites the rows']],
  ['624', ['Frame-timing panel (Ctrl+Alt+F); the pattern editor on big songs is several times faster (no more whole-grid re-layout every frame)']],
  ['623', ['Node Sequencer: a modulo node that works on the song tick (every n ticks, beats or bars from an offset), with hit, rem and phase outputs']],
  ['622', ['Quiet machines sleep: no CPU until a note, parameter change or sidechain wakes them, state kept (Sleep switch per machine, zz in the Stream Manager)']],
  ['621', ['Piano roll over the sample display (Shift+P): mark a virtual pattern, draw notes, hear chords per row, overtone guides, master tuning, write to a "NN transcribe N" pattern']],
  ['620', ['Sidechain node: listening to a meta machine hears the machines it plays, added together; tick the ones to leave out']],
  ['619', ['Meta machine: the floating parameters window (Ctrl+Alt+P) shows the parameters it plays, as sliders on the machines they belong to']],
  ['618', ['Bounce to sample (Ctrl+Shift+B in the Sequence Editor): a pattern, selection, loop or lane rendered offline, with its tails and a slice marker where the range ends']],
  ['617', ['Fix: the meta machine Selections list no longer jumps to the top when you click a parameter in a long list']],
                    ];
