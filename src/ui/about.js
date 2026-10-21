// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'webtracker is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['290', ['Samples: Shift+E auto-slices: a marker on every hit of the sample (or of the selection), found by spectral-flux onset detection. Sensitivity and the shortest gap are in Config (Sample).']],
  ['289', ['Pattern editor: fills the window height (Config: pattern editor fills the window height), and its cursor rows (position, column name, value meter, range) moved into the main status bar. The page\'s bottom space follows the status bar\'s height. On Pages the service worker now revalidates files, so a new build is never held back by the browser\'s cache.']],
  ['288', ['Arrangement: V switches the pattern minimaps on and off; H and V are in the shortcut list.']],
  ['287', ['Arrangement side panel: a one-row draggable line between the pattern list and the lane controls sets the list\'s height (Up/Down on the line when it has focus, double-click for automatic). It is remembered.']],
  ['286', ['Arrangement: the lane, insert-silence and add-lane controls moved under the pattern list, the lane\'s status line is now a row of its own above the status bar, and the arrangement fills the window height (Config: arrangement fills the window height; off brings the drag bar back).']],
  ['285', ['Hosted on GitHub Pages: every push to master runs the tests and publishes the app. A service worker supplies the cross-origin isolation headers there, and the header shows "build NNN · commit" (version.json, made from git by serve.mjs, with a + for uncommitted changes).']],
  ['284', ['Fixed: m283 did not start (a stray quote in the About text). The smoke test now loads that file.']],
  ['283', ['Parameter view: a parameter that a CC command writes has a blue stripe and tint on its name and the command\'s id in the bar (2C, 31...). A small cc button in the panel title (and Config, Graph) hides all of them.']],
  ['282', ['Sampler commands from UnwieldyTracker: stretch (2B to 2D, the whole sample spread over a length by granular repeats), jumps in the wave (60 to 67), a filter on each sound (30 to 35: type, cutoff, resonance, slides, step per repeat), vibrato and cutoff LFO (40 to 45) with phase sync (50 to 53), humanizing the cutoff and timing (38, 39), resets (A0 to AF) and settings slots (70 save, 71 load). See the Sampler help. Shuffle (80 to 83) is not in yet.']],
  ['281', ['Graph: a very faint dot grid (a brighter dot every 12) and nodes snap to it while you drag; hold Ctrl to move freely. Config (Graph) has the on/off switches, the spacing and the bright-dot interval. The tick lines on time sliders are light blue now.']],
];
