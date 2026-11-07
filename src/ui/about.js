// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['677', ['Fix: the playhead and loop lines in the sequence editor stop at the song overview instead of running over it']],
  ['676', ['Fix: a Cardinal machine sleeps when it is quiet (it kept running at about 23 % CPU after the song was paused)']],
  ['675', ['The opening song is the newest Plethora']],
  ['674', ['Fix: Sympathetic strings has a DC blocker in each string, so an offset in the input no longer piles up in them']],
  ['673', ['Fix: with the piano roll on, the sample display starts to the right of the key strip, so the start of the sample is no longer covered']],
  ['672', ['Song overview: a strip at the right of the sequence editor showing the whole song scaled to fit (click to jump, drag the box to scroll)']],
  ['671', ['Shift+L in the sequence editor sets the loop round the pattern under the cursor']],
  ['670', ['The opening song is the newest Plethora']],
  ['669', ['Note pan: every note placed in the stereo field by style (keyboard, fan, alternate ...), with real-time swing or orbit round the listener and an orbit panel; help pages for the new space effects']],
  ['668', ['Sympathetic strings: follow notes, tuned to what the instrument plays (note, octave, twelfth ...)']],
                    ];
