// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['571', ['The CPU readout is cleared each time Play starts']],
  ['570', ['A latency? button on the status bar switches latency compensation on and off']],
  ['569', ['CPU meter ignores the first second after Play (start-up cost, not playing cost)']],
  ['568', ['Arrangement boxes drawn on whole pixels: no more thicker outlines in places']],
  ['567', ['Top bar: a File menu replaces Open, New, Save, Export and Backups buttons']],
  ['566', ['New shader template, Holey torus: a perforated ring that tumbles while its tube twists, glowing on hits']],
  ['565', ['New effect, Pogue (Effects, Modulation): a grubby multi-voice chorus with wandering voices, feedback, filters, saturation and bit degrade']],
  ['564', ['New machine Clang: struck metal from a thin cymbal-like plate to a big hollow barrel, with damping and thump']],
  ['563', ['Open a SunVox file (.sunvox): its notes and arrangement come in, a lane per module that plays notes, on plain synths']],
  ['562', ['Shift and mouse wheel moves the pattern editor one row at a time']],
                  ];
