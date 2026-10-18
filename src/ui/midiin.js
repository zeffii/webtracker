// MIDI input through the Web MIDI API: every connected input, optionally one channel. Calls
// onNote({ on, note, vel, time, channel }) for note on and off (a note on with velocity 0 is a note off), with the
// event's time stamp (the same clock as performance.now()). Inputs that are plugged in later are picked up.
export function createMidiInput({ onNote, onState = () => {}, nav = globalThis.navigator, channel = () => 0 }) {
  let access = null, on = false, names = [];
  const handle = e => {
    const [status, note, vel] = e.data;
    const kind = status & 0xf0, ch = (status & 0x0f) + 1;
    if (kind !== 0x90 && kind !== 0x80) return;
    const want = channel();
    if (want && want !== ch) return;
    onNote({ on: kind === 0x90 && vel > 0, note, vel, time: e.timeStamp, channel: ch });
  };
  const attach = () => {
    names = [];
    for (const input of access.inputs.values()) { input.onmidimessage = on ? handle : null; names.push(input.name); }
    onState({ on, names });
  };
  return {
    get supported() { return typeof nav?.requestMIDIAccess === 'function'; },
    get names() { return names; },
    async enable(value) {
      on = value;
      if (!on) { if (access) attach(); onState({ on: false, names: [] }); return true; }
      if (!this.supported) { onState({ on: false, names: [], error: 'This browser has no MIDI input (use Chrome or Edge).' }); return false; }
      try {
        if (!access) { access = await nav.requestMIDIAccess(); access.onstatechange = () => attach(); }
        attach();
        return true;
      } catch (err) {
        on = false;
        onState({ on: false, names: [], error: `MIDI access was refused: ${err.message ?? err}` });
        return false;
      }
    },
  };
}
