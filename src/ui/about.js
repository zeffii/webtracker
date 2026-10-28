// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['482', ['Graph editor: Tab over a port with several wires now always chooses the wire (it was swallowed when the canvas did not have the keyboard focus or a node panel took the key).']],
  ['481', ['Graph editor: the pulse of a hovered port is gentler (about a pixel instead of up to three and a half).']],
  ['480', ['Arrangement: the top edge of the grid now lines up with the top edge of the pattern list panel (it was 8 pixels lower).']],
  ['479', ['Arrangement: the grid and the pattern list beside it now start at the same height.']],
  ['478', ['The line under the toolbar at the top, running across the whole window, is much fainter.']],
  ['477', ['Arrangement and pattern grids: the frame shown while the grid has the keyboard focus (the lines along its top and left edge) is much fainter.']],
  ['476', ['Graph editor wires: the port under the mouse pulses slowly. Drag from an input port to pick its wire up and drop it on another input, or anywhere else to unplug it (Esc puts it back); Shift+drag does the same from an output port (a plain drag from an output still makes a new wire). With several wires on a port, Tab (Shift+Tab back) chooses which one is lit and picked up.']],
  ['475', ['Insert menu: searching for scale (or map) finds the Range node.']],
  ['474', ['Range node: a picture under the sliders shows which port it feeds, the whole span of that port (in Hz, ms ...) and the stretch lo..hi lit up on it; unwired it says so.']],
  ['473', ['Graph editor: control operators in the Control menu. Range scales a 0..1 signal onto real values (type Hz, ms, dB ...) and hands the port it feeds the 0..1 it expects: lo and hi take the port\'s own limits and units, a frequency port sweeps evenly across octaves, and each wire out of a Range is scaled to its own port. With nothing on its input, Range is a knob in real units. Add and Times work at control rate (lower an LFO, scale it, multiply two controls). Int is a number box with slider, typing and + / - buttons; Float is the same without the buttons.']],
];
