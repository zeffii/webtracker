// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['686', ['One look for every slider: a hairline, a faint fill up to the value and one thin accent bar at the value, on parameter bars, mixer faders and all plain sliders.']],
  ['685', ['Parameter panels open at most half the window wide (drag to go wider); floating panels are at most half the window tall and scroll when long.']],
  ['684', ['The look pass: plain buttons are flat text (accent colour and underline when on), fields have a faint fill, state colours (record red, warning amber, info blue) are theme tokens, and parameter bars and mixer faders share one slider drag.']],
  ['683', ['The new frame: F1 Song, F2 Pattern, F3 Instrument, F4 Sample (Song opens first; node help is Shift+F1). A collapsible browser down the left (patterns, machines, samples, with the options of the view under the list), the mixer docked along the bottom of every view, and pinned floating parameter panels that can pop out into their own window.']],
  ['682', ['Fix: npm test failed on Windows (a file path built from a URL); test only, the app is unchanged']],
  ['681', ['Fix: the graph view redraws at the new pixel density after a page zoom or a move to another screen, and its text sits on whole pixels (it was soft)']],
  ['680', ['The opening song is the newest Plethora']],
  ['679', ['Manual: the Voices node page and README say that everything before a poly is done per voice and everything after it on the summed signal']],
  ['678', ['Song overview: no outline round the shown part, and its light fill is a little fainter']],
  ['677', ['Fix: the playhead and loop lines in the sequence editor stop at the song overview instead of running over it']],
                    ];
