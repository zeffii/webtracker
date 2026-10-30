// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['543', ['New demo, ?demo=nodes: a song for the Node Sequencer with chord lists driving a pad, a bass and an arpeggio, groups, an lfo and an envelope']],
  ['542', ['Node Sequencer: a Pchord node steps through chords written like the Chord machine, one a line; the note node has a poly setting so a chord sounds together']],
  ['541', ['Two saturators (Effects, Distortion): a simple one and a multiband one, with four curves (soft, tape, tube, clip) and a quality switch.']],
  ['540', ['Cardinal: a quality switch, standard or eco. Standard is the sound as it was; eco uses about a fifth less CPU on a busy lead.']],
  ['539', ['Drum synth: its click fades in over a few samples, so a hit no longer starts with a small random tick.']],
  ['538', ['Pattern editor: the playhead and loop lines sit on the real rows, so the line follows the playing tick whatever the font, zoom or screen scaling.']],
  ['537', ['Three spectral effects (Effects, Spectral): the harmonic/percussive split, a spectral compressor with tilt, and cross synthesis.']],
  ['536', ['Equaliser: drag the dots in its response picture for frequency and gain, the wheel for Q, and the triangles for the cuts. Renaming an instrument or lane no longer stops playback.']],
  ['535', ['First screen: the metaballs are centred under the logo.']],
  ['534', ['Pattern editor: the undo trail now shows above the status bar, as in the arrangement.']],
];
