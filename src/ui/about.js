// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['701', ['The ladder filter has a phase parameter for its LFO.']],
  ['700', ['Space on the Sample screen plays from the playhead.']],
  ['699', ['Sample screen: click the waveform to place the playhead; Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste at it (Ctrl+Shift+V pastes over), also between samples.']],
  ['698', ['Sympathetic strings pan by distance from the played note (subtle by default); parameter ports hang as dots under a node tile; port tips appear after half a second.']],
  ['697', ['Envelope editors can show time in log mode (button under the drawing): the transient gets most of the room.']],
  ['696', ['? in a Cmd column lists the commands in effect at the cursor row that are not at their defaults, with their values.']],
  ['695', ['DX7 randomise keeps the last five rolls: ◂ ▸ steps back and forward through them.']],
  ['694', ['The Sample screen has a Speed field: type a rate or step it with Left/Right (Shift 100, Ctrl 1000).']],
  ['693', ['The follow panel can pop out into a window of its own and keeps following the machine under the cursor; pop-out windows are no longer indented.']],
  ['692', ['Pattern screen options under the browser list: follow, note preview, tint, hide empty columns, text size.']],
                    ];
