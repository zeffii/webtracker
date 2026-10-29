// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['521', ['New demo: ?demo=acid, eight bars of acid techno played by one meta machine, with accents, slides and a filter that opens up.']],
  ['520', ['Arrangement minimaps of a meta machine lane stay inside their pattern, and show relative notes as notes.']],
  ['519', ['Meta machine: spacer columns (a rule with an optional group name) between groups of columns, and the machines it plays lose their empty lanes.']],
  ['518', ['Meta machine editor: pick which notes, triggers and parameters of other instruments its columns play, and change them later. 00 in a relative note column is a note off, in the accent colour.']],
  ['517', ['The ?demo=concrete techno now runs on one meta machine lane that plays all five percussion machines.']],
  ['516', ['New demo: ?demo=concrete, 64 ticks of techno from five percussion machines, with parameter changes on all of them.']],
  ['515', ['Meta machine, engine only: a lane whose columns play other instruments (notes, relative notes with a root, velocities, triggers, parameters). Its editor comes next.']],
  ['514', ['Shader knobs list: the row you last used stays shaded until you use another.']],
  ['513', ['Shader screen: two new piano-roll shaders for all lanes at once, one flat and one stacked in space as sheets, each lane in its own colour.']],
  ['512', ['Samples screen: (whole sample) moved to the left of the hide button on the Select row.']],
];
