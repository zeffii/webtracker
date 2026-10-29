// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['510', ['Samples screen: numbered slots with Load on empty ones and Replace on filled ones (instruments follow a replace). Record and Browse are tabs under the list.']],
  ['509', ['Samples screen: Load, Record and Browse restyled to match the sample editor (slate panel, flat buttons, readout with exact frame count).']],
  ['508', ['Sample browser: a thin red playhead while a sample plays, and the waveform can be dragged bigger with the grip in its corner.']],
  ['507', ['Sample browser: Choose folder now works in Brave too (it lists subfolders), without remembering the folder.']],
  ['506', ['Picture colours: eleven palettes plus Custom in Config. Samples screen: a folder browser with arrow-key audition, waveform and sample rate, Enter loads a new sample. Files over 10 MB ask before anything is read.']],
  ['505', ['Shader screen: seven new light shaders (Ripples, Marble, Truchet, Sunburst, Moire, Lissajous, Waves) and a guide under the editor: how it works, writing one step by step, the built-in functions, what things cost and where to read more. The examples have a Try it button.']],
  ['504', ['Shader screen: dragging a number slider no longer makes the picture stutter. A changed shader is compiled in the background and the old picture keeps running until the new one is ready.']],
  ['503', ['Code node: several assignments in one line, a, b, c = x, y, z; All values on the right are worked out first, so a, b = b, a; swaps them.']],
  ['502', ['The code node (GenExpr) can now make sound from notes: new names freq, gate, vel, note and trig. A Templates list above the code box loads working examples: sine voice, detuned pad, FM bell, plucked string, kick, hi-hat, echo, bitcrusher, ring modulator and soft clipper. New Code instrument in the new-instrument list. Fixed: sin, cos, min, max, abs, round, tanh and the other math functions did not compile. Full help page for the node.']],
  ['501', ['Top row: the thin line under the value fields (len, bpm, swing, tpb, bar) is gone. A field that you are editing still shows a faint highlight.']],
];
