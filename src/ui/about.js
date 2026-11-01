// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['601', ['DX panel redesign: a bank of all 32 algorithms as thumbnails, named operators, per-operator envelope and wave strips, an output scope and spectrum, and a draggable envelope on the Voice tab']],
  ['600', ['Fix: the listen node now sounds (it was silent, and stopped the audio engine while it was in a graph)']],
  ['599', ['DX panel in a box with keyjazz; sample editor: Select all button, Delete over the waveform, Save sample to disk, auto-slice on the whole sample']],
  ['598', ['Listen node: an instrument plays the notes of another (transpose, level, on/off), to audition other machines on the same notes']],
  ['597', ['DX-style synth: six more built-in voices (four pianos, a reed-and-vibe key sound, a harpsichord-vibraphone)']],
  ['596', ['Mosh: a lost keyframe as sound. A held chord wears the movement of another sound (louder, quieter, sliding up or down), until a keyframe puts it back; with a ?demo=mosh demo']],
  ['595', ['Detect chords: click a chord to hear it for half a second on the chosen lane, with or without the extra notes']],
  ['594', ['Arrangement: a pattern that starts or ends between two rows is drawn at its true position, not snapped to the row']],
  ['593', ['Chord finder: names a chord even without an exact match (Cmaj7(add9), C7(b9)) with alternatives, and spells with flats in flat keys']],
  ['592', ['^^^ is a kill (120 ms fade, machine reset, asleep until the next note); Clone with machine copies a lane and its instrument, with or without patterns and automation']],
                    ];
