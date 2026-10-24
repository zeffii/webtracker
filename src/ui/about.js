// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['433', ['Live picture: a Cells (Voronoi) shader template.']],
  ['432', ['Alt+S solos and Alt+M mutes the lane under the cursor, in both editors.']],
  ['431', ['Sequence editor: Alt+M silences the whole lane (was Shift+M).']],
  ['430', ['A player: <wax-player> plays a .wax song with no tracker around it; player.html lists songs from tracks.yaml.']],
  ['429', ['Graph: Alt+R takes a node out and joins the wires; R stays a keyjazz key.']],
  ['428', ['Wax tools for Claude: validate, outline, render offline and measure a song (an MCP server and a skill, in the repository).']],
  ['427', ['The demo: a later, slower Shepard tone, the Arp node plays the arpeggio, plus a woodblock and Detroit-style Duette stabs.']],
  ['426', ['The first-screen line sits in an off-white cartouche.']],
  ['425', ['The first screen reads "musical spreadsheet - click to enter".']],
  ['424', ['Prisma Canyon: a four-head tape echo with a pan and a damp per line, and a view in ticks.']],
];
