// OSC out: sends the notes played on its instrument as Open Sound Control messages (through the relay, see tools/osc-relay.mjs).
// It makes no sound and has no ports; put it in an instrument of its own and give that instrument a lane.
//   mode        0: Renoise's own addresses, so Wax can play a Renoise song's instruments (/renoise/trigger/note_on and note_off:
//               instrument, track, note, velocity). 1: Wax's addresses, /wax/NAME/note_on and /wax/NAME/note_off with the
//               MIDI note and velocity, NAME being this instrument's id.
//   instrument  Renoise's instrument number to play (counted from 0, as the OSC server counts).
//   track       Renoise's track number (from 0), or -1 for the current track.
//   transpose   semitones added to every note.
// The notes arrive here already timed to the sample; the page sends the messages as soon as it hears of them.
export default {
  type: 'oscout',
  inputs: [],
  outputs: [],
  category: 'Control',
  generator: true,   // the keys of the computer play it in the graph view, and it is the node shown first
  shared: true,
  shape: 'rounded',
  glyph: 'oscout',
  params: [
    { name: 'mode', min: 0, max: 1, def: 0, int: true },
    { name: 'instrument', min: 0, max: 254, def: 0, int: true },
    { name: 'track', min: -1, max: 254, def: -1, int: true },
    { name: 'transpose', min: -48, max: 48, def: 0, int: true },
  ],
  create({ emit }) {
    const held = new Set();
    let p = [0, 0, -1, 0];
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          held.add(msg.note);
          emit({ type: 'osc', on: true, note: msg.note, vel: Math.max(0, Math.min(1, msg.vel ?? 1)), p });
        } else if (msg.type === 'noteOff') {
          if (!held.delete(msg.note)) return;
          emit({ type: 'osc', on: false, note: msg.note, vel: 0, p });
        } else if (msg.type === 'allOff' || msg.type === 'noteCut') {
          for (const note of held) emit({ type: 'osc', on: false, note, vel: 0, p });
          held.clear();
        }
      },
      process(inputs, outputs, n, params, slots) {
        p = [params[slots[0]], params[slots[1]], params[slots[2]], params[slots[3]]];   // read each block, so the last settings go out with the next note
      },
    };
  },
};
