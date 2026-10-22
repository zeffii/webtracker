// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['365', ['Header: a project name field and a * for unsaved changes; Ctrl+S saves from any field.']],
  ['364', ['Ctrl+S saves as: a save dialog for name and folder where the browser has one, otherwise a download.']],
  ['363', ['Script tab: the script and the scratch grid sit side by side with a draggable splitter, and the help column is resizable; widths are remembered.']],
  ['362', ['Scratch pattern: a template menu of rhythm starting points (techno, house, breakbeat, trap, clave, bossa, dembow, reggae) to edit from.']],
  ['361', ['Script tab: a scratch pattern, a grid to fill with triggers and look at (and play) before anything is written to a real pattern; it reads from and writes back to the script.']],
  ['360', ['First screen: the click-anywhere line sits halfway between its two earlier heights (40 px above the original).']],
  ['359', ['First screen: the click-anywhere line unrolls a fifth faster and sits 80 px higher.']],
  ['358', ['First screen: the click-anywhere line unrolls from its first letter and is a little lighter.']],
  ['357', ['Config tab tidied: every group is now one card (the same description was repeated beside most settings), settings sit in the card they belong to (First screen look under Look, the graph ones under Graph, the vectorscope ones under Meters, the recording latency under MIDI, resynthesis in its own card), the group name is dropped from labels that began with it, every group has a short description, and the settings-file buttons at the bottom are headed Settings file instead of a second Backup.']],
  ['356', ['Script help, when the script panel is docked beside the pattern editor, now opens the tutorial as a column to the right of the script editor (the dock widens to make room) instead of squeezing it in below.']],
];
