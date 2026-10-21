// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['325', ['The WAX logo: your glyphs are now the logo on the start screen and at the top of the rail (still the Start button until the audio runs). They take the theme\'s text colour.']],
  ['324', ['The start screen\'s report no longer jumps around as lines are typed: it is left-aligned from a fixed edge instead of centred.']],
  ['323', ['Chord palette (Alt+C): put the cursor on a row of notes, or select rows, and a palette shows the chord on a small piano roll with its name. Voicings (inversions, drops, spread), One note (change a single voice by a semitone or a scale step, with the interval and the chord it makes), Quality (major, minor, 7ths, sus, dim, aug, 9ths) and Smooth rows (each chord revoiced to move as little as possible from the one above). Every variation has an ear button that plays it for one second. Pick the key and scale so changes stay in key; Enter writes it as one undo step.']],
  ['322', ['The empty tap slots (tap01 to tap16) no longer clutter the sample pickers: a slot shows once it holds a take or an instrument plays it. Config has a switch to show them all again.']],
  ['321', ['Right-click a pattern in the arrangement for a small menu: open it in the pattern editor (or on its own), give it its own copy, slice, remove, and Params, which opens the floating parameters of that lane (Rename is a greyed placeholder). The Open button now sits beside Play, and the params button in the status bar is an icon.']],
  ['320', ['Rail: the divider between the rail and the page is a faint line, and the icon outlines are gone (a soft outline appears on hover, the open screen stays filled).']],
  ['319', ['Header tidy: the file icons (save, open, export, backups, new) sit next to the song display, and the meters, scope, cut and panic buttons, the build number and the theme moved to the right end of the bottom status bar. The Arrangement icon now shows vertical lanes.']],
  ['318', ['New top layout: a slim icon rail down the left edge holds the logo (still the Start button), one icon per screen (Patterns, Samples, Instruments, Arrangement, Script, Dock, Info; hover for the name and key) and Shortcuts, About and Config at the foot. The top bar is one row: transport, the song numbers (len, bpm, swing, bar) as a dark green display you edit in place, then file and tool icons, then the theme.']],
  ['317', ['Note preview is on by default: typed notes in the pattern editor sound while the key is held (Insert or \\ still switches it off; a choice you already made is kept).']],
  ['316', ['The Start button is gone from the top bar: the Wax logo on the left is the Start button until the audio is running (click it, or Enter when focused), then it is just the name.']],
];
