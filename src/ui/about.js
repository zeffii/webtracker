// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['609', ['File, Reload app: fresh code, same song. Fix: the DX panel columns now really sit side by side']],
  ['608', ['DX panel: the Voice tab in four columns (bank and algorithm, operators, envelope and output)']],
  ['607', ['DX panel: hairline sliders, underlined inputs, and lines that stop short of the operator names']],
  ['606', ['DX panel: the two columns sit side by side and the drawings lose their frames']],
  ['605', ['DX panel redrawn without boxes (dots, circles, thin lines, round knobs), sharper wave sketches (128 samples to a cycle), no status message from the colours button']],
  ['604', ['DX panel: the ice colour set (light blue carriers, dark blue modulators) is the default']],
  ['603', ['DX panel: two columns (half the height), sharp drawings instead of blurry ones, no overlapping operators, and a colours button with four colour sets']],
  ['602', ['F3 from the pattern editor or the arrangement opens the graph of the lane you are in']],
  ['601', ['DX panel redesign: a bank of all 32 algorithms as thumbnails, named operators, per-operator envelope and wave strips, an output scope and spectrum, and a draggable envelope on the Voice tab']],
  ['600', ['Fix: the listen node now sounds (it was silent, and stopped the audio engine while it was in a graph)']],
                    ];
