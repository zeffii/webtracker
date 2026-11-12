// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['740', ['The floating parameter panel is no longer covered by the arrangement\'s minimaps: its top-right buttons can be clicked.']],
  ['739', ['The picture window\'s parameter rows use the same small monospace text as the regular parameter view.']],
  ['738', ['The picture window\'s parameter rows fill the window and follow it when it is resized.']],
  ['737', ['The picture window\'s Parameters tab shows the whole graph in its map (click a node to go to it), and always shows the expose, port and width switches, for any machine.']],
  ['736', ['The pattern window opens on the pattern under the cursor (Ctrl+Alt+W, a button, or the arrangement\'s right-click menu) and has its own Instruments → Patterns menu (I) to change pattern.']],
  ['735', ['A pattern can be shown in a window of its own: pick it from Instruments → Patterns (button in the Pattern options). One pattern at a time, read-only, with the playing row marked.']],
  ['734', ['The strip of pictures in a node panel has its scroll bar on top, shown only when something is cut off.']],
  ['733', ['Node panels lay their pictures and editors side by side in one strip that scrolls sideways when they do not fit, instead of stacking them. Pogue\'s panel is four pictures in a row.']],
  ['732', ['Pogue has a panel: its voices moving between the shortest and longest delay, live, with the band to drag, plus pictures of its filters, saturation and bit reduction, and feedback.']],
  ['731', ['Keyjazz plays whichever node is selected, so you can tweak a filter or an effect while you play. Typing a value still keeps the keys.']],
                    ];
