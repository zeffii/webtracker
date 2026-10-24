// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['454', ['Dropdown lists: darker background and full-contrast text when open.']],
  ['453', ['New sweep filter node: one knob, lowpass below 0, highpass above, untouched at 0, no dry/wet seam.']],
  ['452', ['New ladder filter node: 24 dB lowpass with a built-in LFO (log-scale rate) and a smooth dry/wet mix.']],
  ['451', ['Instruments tab: Voices and Tracks line up with the node preset box.']],
  ['450', ['Instruments tab: NoteCols is Tracks; the preset box is headed "selected node preset".']],
  ['449', ['Instruments tab: Voices and NoteCols stacked, the node preset box right-aligned beside them.']],
  ['448', ['Graph: undo and redo (Ctrl+Z, Ctrl+Y); wires are easier to hit.']],
  ['447', ['Graph: right-click a wire to put a node into it; the nodes to its right move over.']],
  ['446', ['Dark themes: the pattern colours are solid, not mixed with the background.']],
  ['442', ['Instruments tab: list and instrument controls in one panel on the left; the graph starts at the top.']],
];
