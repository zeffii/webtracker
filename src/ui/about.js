// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['464', ['GenExpr code box: full syntax colours (operators, constants, declared names by kind), bracket pairing, hover help, and it now shows on every theme. Config: the default shader box sits under its text.']],
  ['463', ['Sample screen: a playhead (thin translucent red line) while a sample plays; the slice button "to the next marker" really stops there; a held looping sample is released when the key is let go.']],
  ['462', ['Slice marker list: two buttons per marker, play to the next marker and play to the end of the sample.']],
  ['461', ['Instrument list: the hover colour is a quiet tint with readable text on the light themes.']],
  ['460', ['New tpb (ticks per beat) field: changing it rescales the bpm readout so the tempo stays the same.']],
  ['459', ['Sample editor: the cursor shows when a slice marker can be moved; with every region hidden no Alt is needed.']],
  ['458', ['Rename an instrument with Ctrl+F2 or a right-click on it; the Name row is gone.']],
  ['457', ['Graph: wires run behind nodes. Node preset box: "(preset list)" with the delete cross beside it.']],
  ['456', ['Envelope drawing: corner ticks instead of a box, a faint fill under the curve, a tighter layout.']],
  ['455', ['New genexpr node: a node whose sound is code, compiled once per edit, with every mistake underlined and explained.']],
];
