// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['748', ['Effects on the master, before the limiter: the new master effects row in Machines opens the Master graph; a Mix node brings in the whole song, and what you wire from it into Out replaces the mix before volume and limiter.']],
  ['747', ['New effect Groove, what a record does to a sound: warp, wear, tracing, dust, scratches (that can come round again), pops, surface noise and rumble, each with its own level and skipped at zero, and an oversampled simulation mode.']],
  ['746', ['Randomize (Ctrl+R) has Diverge the parameters: filled parameter cells jump anywhere in their range, notes stay, and Alt+R rolls again.']],
  ['745', ['Testing A or B in the pattern window stops the song, so only the pattern you test is heard.']],
  ['744', ['The pattern window has a B side: a scratch copy to try chords on, played separately from A, changed freely, reset to A, or kept over A or as a new pattern.']],
  ['743', ['The live picture can be parked at the bottom left: the arrows button on the picture swaps sides.']],
  ['742', ['The live picture is no longer covered by the arrangement\'s overview strip.']],
  ['741', ['The build number is shown again: small at the bottom right of the first screen, under the logo in the rail, in the footer and in the window title.']],
  ['740', ['The floating parameter panel is no longer covered by the arrangement\'s minimaps: its top-right buttons can be clicked.']],
  ['739', ['The picture window\'s parameter rows use the same small monospace text as the regular parameter view.']],
                    ];
