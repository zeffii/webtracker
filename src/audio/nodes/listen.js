// Listen: plays the notes of another instrument. Put it in an instrument's graph (it has no wires, like the chord and the
// arp), choose in its panel which instrument it listens to, and every note that instrument is given (from its patterns,
// the Node Sequencer, the keyboard or MIDI) is played here too, with its velocity, its note off and its cut. So any
// machine can be tried on the notes of another, without touching the other lane or using the replace function.
// A ^^^ kill on the other instrument kills this one as well. The instrument keeps its own lanes: notes written on it play
// as usual, alongside the ones it hears.
//   on        1 listens, 0 does not. A note that is already sounding still ends, so nothing sticks
//   transpose semitones added to every note heard (the note off follows the same note, even if transpose changes meanwhile)
//   level     scales the velocity of the notes heard
// The work is done by the runtime, which sends the notes on; this node only holds the settings.
export default {
  type: 'listen',
  inputs: [],
  outputs: [],
  category: 'Control',
  shared: true,   // one for the instrument, never copied for each voice
  instrumentSource: true,   // the patcher panel offers a list of instruments for it
  shape: 'rounded',
  glyph: 'listen',
  params: [
    { name: 'on', min: 0, max: 1, def: 1, int: true },
    { name: 'transpose', min: -48, max: 48, def: 0, int: true },   // semitones
    { name: 'level', min: 0, max: 2, def: 1 },                     // velocity, as a factor
  ],
  create() { return { process() {} }; },   // (the runtime runs every node each block)
};
