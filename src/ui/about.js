// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['344', ["Volume curves now drive a hidden channel stage after each machine's output node: a 0 to 1 level (1 is the machine as it is set) applied smoothly to every sample, instead of moving the output node's gain. The output node's own gain setting is left alone, and stopping returns the stage to 1. The parameter block is four times larger (a big song was within a few slots of the old limit)."]],
  ['343', ['With the first screen on, the tracker is hidden from the very first paint, so it is no longer seen for a moment before the splash.']],
  ['342', ['A small infinity symbol in the header shows whether the song loop is on (lit) or off (dim), and clicking it switches the loop, like Ctrl+L.']],
  ['341', ['Opening a project (a file, the demo, or a new one) now lands on the arrangement (sequencer) screen instead of the pattern editor.']],
  ['340', ['Volume curves are now a final amplifier: the curve (0 to 1) multiplies the level the machine is set to, so 1 is exactly as set and a curve can never make it louder (before, 1 meant the gain\'s maximum, three times a 0.5 setting, which could overload the sound). Stopping puts the machine back at its own level, and changing that level while playing still works. Existing Volume curves will sound quieter.']],
  ['339', ['First screen: the start-up report now sits inside the card, growing up from its bottom-left corner, and the status words (ok, ready) all line up in one column.']],
  ['338', ['Sampler: new command 1F nnaAll. At 1, a new note also fades out a one-shot sample that is still playing (over the 06 nnaFade time, 0 cuts it), so hits cut each other; at 0, one-shots ring on over the next note as before (nnaFade has only ever acted on looping samples). The command help now says so.']],
  ['337', ['The arrangement cursor no longer carries the small pattern colour swatch: the pattern list shows the colour.']],
  ['336', ['The shortcut window has a find box: type words or parts of words and only the shortcuts that contain all of them stay (the window title says which screen). The lane menu in the arrangement now says Add automation curve: Volume (or another parameter), and the arrangement shortcut list describes the curve keys.']],
  ['335', ['Lane curves: click a line to switch that segment on, then C, L or G make it a curve, a straight line or a gap (with an anchor selected the keys act on the segment after it). Double-click the line to add an anchor; Esc lets go. The icon box still cycles the three.']],
];
