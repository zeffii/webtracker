// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['548', ['Node Sequencer: hover a wire for a pair of arrows, then drag that stretch sideways to move the wire away from tiles; double-click the arrows to reset']],
  ['547', ['Node Sequencer: a schematic look, outlined boxes in one ink with right-angle wires told apart by dashes; the Chord tile is wider and holds its keyboard. Fixes wires missing in 546']],
  ['546', ['Node Sequencer: route dots (double-click a wire), wires that can be switched off (Alt+click, M), live note volumes under Chord nodes, a length input on the Phrase node']],
  ['545', ['Node Sequencer: nodes are small tiles, a glyph and a short value with port names shown when you rest the pointer on a port; existing graphs are moved closer together once']],
  ['544', ['Node Sequencer: Chord, Phrase and Voicing nodes: chords with a volume for every note, a Phrase node that plays the chord at its index, a keyboard under each Chord node; new demo ?demo=voicing']],
  ['543', ['New demo, ?demo=nodes: a song for the Node Sequencer with chord lists driving a pad, a bass and an arpeggio, groups, an lfo and an envelope']],
  ['542', ['Node Sequencer: a Pchord node steps through chords written like the Chord machine, one a line; the note node has a poly setting so a chord sounds together']],
  ['541', ['Two saturators (Effects, Distortion): a simple one and a multiband one, with four curves (soft, tape, tube, clip) and a quality switch.']],
  ['540', ['Cardinal: a quality switch, standard or eco. Standard is the sound as it was; eco uses about a fifth less CPU on a busy lead.']],
  ['539', ['Drum synth: its click fades in over a few samples, so a hit no longer starts with a small random tick.']],
];
