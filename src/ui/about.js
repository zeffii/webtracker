// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['724', ['The first screen blob\'s background gradient is the complement of the blob\'s colour (yellow on blue, cyan on red).']],
  ['723', ['No purples or pinks on the first screen: the random colours skip that part of the colour wheel, and the blob keeps to yellow, blue and orange colourways.']],
  ['722', ['A new first screen: reaction diffusion and flowing plasma join the blob and the logo, in new random colours on every start (the old teal is gone). Pick one, or leave Config "First screen look" on random.']],
  ['721', ['The mixer\'s button column sits 5 px clear of the dB tick marks (strips are 5 px wider).']],
  ['720', ['The pattern roll has an Edit switch (off by default): with it off, nothing you do in the roll changes the pattern.']],
  ['719', ['The pattern roll edits notes: click to add (length set in the roll\'s bar), drag to move or stretch, drag a velocity dot, right-click or Delete to remove, Ctrl+Z to undo. Everything is written into the pattern\'s own cells.']],
  ['718', ['The pattern roll shows the playhead: a green line on the playing row, scrolling with it when Follow mode is on.']],
  ['717', ['A pattern roll window: the notes of the pattern under the cursor as a piano roll turned on its side (rows run down like the tracker), with chord names, an optional velocity lane and a minimap. Open it from Pattern view options.']],
  ['716', ['The arrangement\'s last row no longer flickers when the mixer is dragged: the rows that fit are measured, not counted.']],
  ['715', ['No more scrollbars flashing in the arrangement while the mixer is dragged up or down.']],
                    ];
