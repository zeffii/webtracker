// Note trigger: turns the notes played on its instrument into trigger signals for parameter ports, mainly the `trig`
// parameter of an envfx, so an effect envelope fires every time a note starts. It has no input; it listens to the
// notes themselves, for the whole instrument (not per voice), so the envelope works on the finished sound.
//   trig  starts the envelope on every note and releases it when the last held note ends. Wire it to the port of envfx's
//         `trig` parameter. (envfx restarts its attack when `trig` changes between two non-zero values, so successive
//         notes alternate between 1 and 2.)
//   gate  1 while any note is held, else 0, for any parameter you want to open with the notes.
//   vel   the velocity of the latest note, 0 to 1, and it stays after the note ends.
// With `legato` on, a note played while another is still held does not start the envelope again.
const LEGATO = 0;

export default {
  type: 'notetrig',
  inputs: [],
  outputs: ['trig', 'gate', 'vel'],
  category: 'Control',
  shared: true,   // one for the instrument, never copied for each voice
  shape: 'rounded',
  glyph: 'notetrig',
  kinds: { trig: 'param', gate: 'param', vel: 'param' },
  params: [
    { name: 'legato', min: 0, max: 1, def: 0, int: true },   // 1: only the first of overlapping notes triggers
  ],
  create() {
    const held = new Set();
    let k = 0, velocity = 0, legato = false;
    return {
      note(msg) {
        if (msg.type === 'noteOn') {
          const overlapping = held.size > 0;
          held.add(msg.note);
          velocity = msg.vel ?? 1;
          if (!(legato && overlapping)) k = k === 1 ? 2 : 1;
        } else if (msg.type === 'noteOff') {
          held.delete(msg.note);
          if (held.size === 0) k = 0;
        } else if (msg.type === 'allOff' || msg.type === 'noteCut') { held.clear(); k = 0; }
      },
      process(inputs, outputs, n, params, slots) {
        legato = params[slots[LEGATO]] >= 1;
        outputs[0].fill(k / 15, 0, n);   // a parameter port maps 0..1 onto the parameter's range: envfx.trig runs 0..15
        outputs[1].fill(held.size > 0 ? 1 : 0, 0, n);
        outputs[2].fill(Math.max(0, Math.min(1, velocity)), 0, n);
      },
    };
  },
};
