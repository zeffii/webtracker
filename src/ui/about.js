// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['754', ['Pogue draws the onset detector over its voices (only while onset is above 0), with the sensitivity line you can drag and a line at each trigger.']],
  ['753', ['Pogue can move its voices on a hit, a step in pitch or a step pattern (onset, pattern, moves, lookahead), with a Triggers picture in its panel.']],
  ['752', ['The pattern window has its own slate and orange colours (dark or light with the page theme), with green and rose marking what changed in B.']],
  ['751', ['The Master graph starts with a bus-in node, unconnected, ready to wire through effects into out; the tempo node is hidden (its columns are still there).']],
  ['750', ['The master bus node is now called bus-in; projects saved with it open as before.']],
  ['749', ['Groove starts with every part at zero: a new one passes the sound through until you turn a part up.']],
  ['748', ['Effects on the master, before the limiter: the new master effects row in Machines opens the Master graph; a Mix node brings in the whole song, and what you wire from it into Out replaces the mix before volume and limiter.']],
  ['747', ['New effect Groove, what a record does to a sound: warp, wear, tracing, dust, scratches (that can come round again), pops, surface noise and rumble, each with its own level and skipped at zero, and an oversampled simulation mode.']],
  ['746', ['Randomize (Ctrl+R) has Diverge the parameters: filled parameter cells jump anywhere in their range, notes stay, and Alt+R rolls again.']],
  ['745', ['Testing A or B in the pattern window stops the song, so only the pattern you test is heard.']],
                    ];
