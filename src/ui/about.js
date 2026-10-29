// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['506', ['Picture colours: eleven palettes plus Custom in Config. Samples screen: a folder browser with arrow-key audition, waveform and sample rate, Enter loads a new sample. Files over 10 MB ask before anything is read.']],
  ['505', ['Shader screen: seven new light shaders (Ripples, Marble, Truchet, Sunburst, Moire, Lissajous, Waves) and a guide under the editor: how it works, writing one step by step, the built-in functions, what things cost and where to read more. The examples have a Try it button.']],
  ['504', ['Shader screen: dragging a number slider no longer makes the picture stutter. A changed shader is compiled in the background and the old picture keeps running until the new one is ready.']],
  ['503', ['Code node: several assignments in one line, a, b, c = x, y, z; All values on the right are worked out first, so a, b = b, a; swaps them.']],
  ['502', ['The code node (GenExpr) can now make sound from notes: new names freq, gate, vel, note and trig. A Templates list above the code box loads working examples: sine voice, detuned pad, FM bell, plucked string, kick, hi-hat, echo, bitcrusher, ring modulator and soft clipper. New Code instrument in the new-instrument list. Fixed: sin, cos, min, max, abs, round, tanh and the other math functions did not compile. Full help page for the node.']],
  ['501', ['Top row: the thin line under the value fields (len, bpm, swing, tpb, bar) is gone. A field that you are editing still shows a faint highlight.']],
  ['500', ['New time readout at the right of the top row (after tpb and bar): the estimated length of the song at the current tempo, as minutes and seconds, from the song length in ticks, or from the loop when the loop is on (then it says loop). A tempo set in the master lane is not counted.']],
  ['499', ['Sequence editor: the outlines of the patterns are 50 percent more transparent (their opacity went from 45 to 22 percent). Nothing else changes.']],
  ['498', ['A sampler node added to any instrument (Basic, sampler) now has the cc button in its parameter panel, and Parameter view: hide command parameters hides its 70 or so repeat, retrigger, vibrato, jump and jitter parameters, as it does for a sampler instrument. They come back with the same button.']],
  ['497', ['New Amp node (Effects, Distortion group): a valve guitar amplifier in one node. A preamp of 1 to 4 valve stages (gain, bias for the even harmonics, a bright lift), a tone stack with bass, mid and treble in three voicings (scooped, cutting, chiming), a power stage with master and sag (the supply gives under load), depth and presence, and a speaker cabinet (open 1x12, closed 2x12, stack 4x12, or none for use with a Convolver), then level and mix. The two distortion stages run at 1x, 2x or 4x oversampling. It has a help page (F1) and a glyph.']],
];
