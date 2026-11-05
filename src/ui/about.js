// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['652', ['Random: picks a new value on every trigger, and takes a range (low, high) with a lean and a focus to favour one value']],
  ['651', ['Env 2: a sustain knot you set on the drawing, a smooth fade for notes that end early, and an optional note length']],
  ['650', ['Envelope drawing edits like the glyph editor: point types, insert on a curve, line/curve, snap, undo']],
  ['649', ['New node: Env 2, a control envelope you draw as a Bezier spline, with a handle on its first anchor']],
  ['648', ['New Drum synth 2 instruments start as NatKick']],
  ['647', ['Drum synth 2: a harm control for thump on small speakers, and punchier starting settings']],
  ['646', ['New node: drum synth 2 with pitch, volume and noise envelopes you draw as Bezier splines, a rate for each, more noise colours, the same click, and a bass boost']],
  ['645', ['West coast softer and alive: band-limited saw and square, a longer vactrol tail, drift on the voice, and a new random node']],
  ['644', ['New demo: west coast (?demo=westcoast), a hand-patched voice and the westcoast node playing jazz chords']],
  ['643', ['West-coast synthesis: a wavefolder, a pluck gate (vactrol), phase modulation on the oscillator, and a complete voice built from them']],
                    ];
