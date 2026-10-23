// The master lane's parameters. It has no ports and makes no sound: the sequencer reads bpm, swing and ticksPerBeat
// from it every tick (so a pattern can change the tempo), and applies volume to the whole mix, then the limiter. The numbers in the
// pattern cells are the values themselves, in hex (007D is 125 bpm, 0032 is 50 percent swing).
export default {
  type: 'tempo',
  hidden: true,   // part of the master lane, not something to add to a graph
  inputs: [],
  outputs: [],
  category: 'Control',
  shape: 'box',
  params: [
    { name: 'bpm', min: 0, max: 999, def: 120, int: true },        // beats per minute (never below 20 when played)
    { name: 'swing', min: 0, max: 100, def: 50, int: true },       // percent: 50 is straight, 75 the most
    { name: 'tpb', min: 0, max: 48, def: 4, int: true },           // ticks per beat (at least 1)
    { name: 'volume', min: 0, max: 1, def: 1 },                    // the whole mix
    { name: 'limit', min: 0, max: 1, def: 1, int: true },          // the master limiter after the volume: 1 on, 0 off
    { name: 'ceiling', min: -12, max: 0, def: -0.3 },              // dB: nothing leaves above this
    { name: 'boost', min: 0, max: 18, def: 0 },                    // dB into the limiter: louder, with the peaks held under the ceiling
    { name: 'release', min: 10, max: 1000, def: 120 },             // ms for the limiter to let go after a peak
  ],
  create() { return { process() {} }; },
};
