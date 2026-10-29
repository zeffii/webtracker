// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['516', ['New demo: ?demo=concrete, 64 ticks of techno from five percussion machines, with parameter changes on all of them.']],
  ['515', ['Meta machine, engine only: a lane whose columns play other instruments (notes, relative notes with a root, velocities, triggers, parameters). Its editor comes next.']],
  ['514', ['Shader knobs list: the row you last used stays shaded until you use another.']],
  ['513', ['Shader screen: two new piano-roll shaders for all lanes at once, one flat and one stacked in space as sheets, each lane in its own colour.']],
  ['512', ['Samples screen: (whole sample) moved to the left of the hide button on the Select row.']],
  ['511', ['Samples screen: a red Record button, and a wider slot list so the remove button fits.']],
  ['510', ['Samples screen: numbered slots with Load on empty ones and Replace on filled ones (instruments follow a replace). Record and Browse are tabs under the list.']],
  ['509', ['Samples screen: Load, Record and Browse restyled to match the sample editor (slate panel, flat buttons, readout with exact frame count).']],
  ['508', ['Sample browser: a thin red playhead while a sample plays, and the waveform can be dragged bigger with the grip in its corner.']],
  ['507', ['Sample browser: Choose folder now works in Brave too (it lists subfolders), without remembering the folder.']],
];
