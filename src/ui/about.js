// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['595', ['Detect chords: click a chord to hear it for half a second on the chosen lane, with or without the extra notes']],
  ['594', ['Arrangement: a pattern that starts or ends between two rows is drawn at its true position, not snapped to the row']],
  ['593', ['Chord finder: names a chord even without an exact match (Cmaj7(add9), C7(b9)) with alternatives, and spells with flats in flat keys']],
  ['592', ['^^^ is a kill (120 ms fade, machine reset, asleep until the next note); Clone with machine copies a lane and its instrument, with or without patterns and automation']],
  ['591', ['The flask button also hides the Script view and the Dock toggle (shortcuts still work)']],
  ['590', ['Presets: moving a slider empties the preset name box ("> Enter new preset name <") so a named preset is not changed by accident']],
  ['589', ['The arrangement line is every 256 ticks; no error in the graph editor of an empty song']],
  ['588', ['Fix: the line over every 512th tick is now visible']],
  ['587', ['Mixer: small lane names and the retroslate look']],
  ['586', ['Fix: the page failed to start with the mixer on (and projects failed to load)']],
                    ];
