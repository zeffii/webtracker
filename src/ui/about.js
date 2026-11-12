// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['719', ['The pattern roll edits notes: click to add (length set in the roll\'s bar), drag to move or stretch, drag a velocity dot, right-click or Delete to remove, Ctrl+Z to undo. Everything is written into the pattern\'s own cells.']],
  ['718', ['The pattern roll shows the playhead: a green line on the playing row, scrolling with it when Follow mode is on.']],
  ['717', ['A pattern roll window: the notes of the pattern under the cursor as a piano roll turned on its side (rows run down like the tracker), with chord names, an optional velocity lane and a minimap. Open it from Pattern view options.']],
  ['716', ['The arrangement\'s last row no longer flickers when the mixer is dragged: the rows that fit are measured, not counted.']],
  ['715', ['No more scrollbars flashing in the arrangement while the mixer is dragged up or down.']],
  ['714', ['The arrangement fills its whole height with rows; a few rows at the bottom were missing (leaving only the automation curve).']],
  ['713', ['The mixer buttons are fully opaque.']],
  ['712', ['Mixer channels are about half as wide, with the buttons stacked in one column.']],
  ['711', ['A new mixer look: a dB scale with ticks, a level well that turns red toward the top and a clip dot; the fader is now in dB.']],
  ['710', ['The mixer dock sits beside the browser panel: dragging it up no longer shortens the browser.']],
  ['709', ['The pattern editor and arrangement refit when the mixer dock or meter band opens, closes or is resized, and run down to where it starts.']],
                    ];
