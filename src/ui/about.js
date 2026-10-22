// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['349', ['Config: new card De-normal diagnostics with two switches, both off by default: Output dither (a whisper of noise on the output) and Volume curve floor (a Volume curve never goes below 0.003). Note preview is on by default (an older stored off is lifted once).']],
  ['348', ['First screen: the start-up report text is lighter still and a tenth smaller.']],
  ['347', ['First screen: the build and revision show small in off-white at the top right of the card, and the start-up report text is a little lighter.']],
  ['346', ['A Volume curve now never goes below 0.003 (about -50 dB), so a fade-in from 0 no longer holds the output at digital silence, where some sound devices click as they wake.']],
  ['345', ['Config: Output dither (on by default) adds a whisper of noise (about -96 dB) to the sound going out, so very quiet sound, like the start of a slow fade-in, is not rounded into crackle by the sound card. Exports are unchanged.']],
  ['344', ["Volume curves now drive a hidden channel stage after each machine's output node: a 0 to 1 level (1 is the machine as it is set) applied smoothly to every sample, instead of moving the output node's gain. The output node's own gain setting is left alone, and stopping returns the stage to 1. The parameter block is four times larger (a big song was within a few slots of the old limit)."]],
  ['343', ['With the first screen on, the tracker is hidden from the very first paint, so it is no longer seen for a moment before the splash.']],
  ['342', ['A small infinity symbol in the header shows whether the song loop is on (lit) or off (dim), and clicking it switches the loop, like Ctrl+L.']],
  ['341', ['Opening a project (a file, the demo, or a new one) now lands on the arrangement (sequencer) screen instead of the pattern editor.']],
  ['340', ['Volume curves are now a final amplifier: the curve (0 to 1) multiplies the level the machine is set to, so 1 is exactly as set and a curve can never make it louder (before, 1 meant the gain\'s maximum, three times a 0.5 setting, which could overload the sound). Stopping puts the machine back at its own level, and changing that level while playing still works. Existing Volume curves will sound quieter.']],
];
