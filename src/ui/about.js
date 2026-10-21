// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['321', ['Right-click a pattern in the arrangement for a small menu: open it in the pattern editor (or on its own), give it its own copy, slice, remove, and Params, which opens the floating parameters of that lane (Rename is a greyed placeholder). The Open button now sits beside Play, and the params button in the status bar is an icon.']],
  ['320', ['Rail: the divider between the rail and the page is a faint line, and the icon outlines are gone (a soft outline appears on hover, the open screen stays filled).']],
  ['319', ['Header tidy: the file icons (save, open, export, backups, new) sit next to the song display, and the meters, scope, cut and panic buttons, the build number and the theme moved to the right end of the bottom status bar. The Arrangement icon now shows vertical lanes.']],
  ['318', ['New top layout: a slim icon rail down the left edge holds the logo (still the Start button), one icon per screen (Patterns, Samples, Instruments, Arrangement, Script, Dock, Info; hover for the name and key) and Shortcuts, About and Config at the foot. The top bar is one row: transport, the song numbers (len, bpm, swing, bar) as a dark green display you edit in place, then file and tool icons, then the theme.']],
  ['317', ['Note preview is on by default: typed notes in the pattern editor sound while the key is held (Insert or \\ still switches it off; a choice you already made is kept).']],
  ['316', ['The Start button is gone from the top bar: the Wax logo on the left is the Start button until the audio is running (click it, or Enter when focused), then it is just the name.']],
  ['315', ['Pattern shortcut list: the zoom keys are written with spaces around the plus (Ctrl + Plus, Ctrl + Minus) so the key and the joining plus can be told apart.']],
  ['314', ['Pattern shortcut list: Ctrl+plus / Ctrl+minus is spelled out as zoom (with Ctrl+0 to reset and Ctrl+wheel), so it is not mistaken for the transpose keys, which are Ctrl+Up / Down and Ctrl+, / Ctrl+.']],
  ['313', ['Pattern shortcut list corrected: the doubled Left/Right entry is merged, Tab now mentions what it does in solo-edit, Backspace is listed with Delete, and the missing keys are added (Home/End, Shift+arrows selection, copy/cut/paste/select-all, undo/redo, the loop keys).']],
  ['312', ['Pattern view: on an empty velocity cell the status bar now shows the value that is in effect there, held from the last velocity written above it in that column (or default FF = 100% before any), the same way parameter columns already do.']],
];
