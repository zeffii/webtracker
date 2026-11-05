// Pluck gate: loudness and brightness under one control. A strike envelope lights a vactrol (a lamp and a photocell:
// quick to open, slow to let go), and the vactrol opens the gain and a low-pass filter together, so a sound dies with
// its top end first, like a struck object. mode 0 opens both, 1 the gain alone, 2 the filter alone.
// Without a cv input the gate strikes on each note (the strike envelope, per instrument, like the env node). With one,
// that signal (0..1) lights the lamp instead, so any envelope, LFO or gate pattern can play it.
// `open` is how quickly the lamp opens and `close` how slowly it lets go (ms). `track` moves the open cutoff with the note.
import { Adsr } from './adsr.js';
import { PluckGate } from '../westcore.js';

const MODE = 0, BRIGHT = 1, RES = 2, TRACK = 3, OPEN = 4, CLOSE = 5, ATK = 6, DEC = 7, SUS = 8, REL = 9, VEL = 10, LEVEL = 11;

export default {
  type: 'pluckgate',
  inputs: ['in', 'cv'],
  outputs: ['out'],
  category: 'Effects',
  kinds: { in: 'stereo', cv: 'control', out: 'stereo' },
  shape: 'rounded',
  glyph: 'pluckgate',
  adsr: [{ atk: 'atk', dec: 'dec', sus: 'sus', rel: 'rel' }],
  params: [
    { name: 'mode', min: 0, max: 2, def: 0, int: true },
    { name: 'bright', min: 0, max: 1, def: 0.8 },
    { name: 'res', min: 0, max: 0.9, def: 0.1 },
    { name: 'track', min: 0, max: 1, def: 0.5 },
    { name: 'open', min: 0.2, max: 200, def: 2 },
    { name: 'close', min: 10, max: 5000, def: 300 },
    { name: 'atk', min: 0.1, max: 5000, def: 1 },
    { name: 'dec', min: 1, max: 5000, def: 350 },
    { name: 'sus', min: 0, max: 1, def: 0 },
    { name: 'rel', min: 1, max: 5000, def: 200 },
    { name: 'vel', min: 0, max: 1, def: 0.6 },
    { name: 'level', min: 0, max: 2, def: 1 },
  ],
  create({ sampleRate, connected }) {
    const cvOn = connected[1];
    const env = new Adsr(sampleRate), gates = [new PluckGate(sampleRate), new PluckGate(sampleRate)];
    let note = 60, velocity = 1;
    return {
      note(msg) {
        if (msg.type === 'noteOn') { note = msg.note; velocity = msg.vel ?? 1; env.on(); }
        else if (msg.type === 'noteOff' || msg.type === 'allOff') env.off();
        else if (msg.type === 'noteCut') { env.cut(); gates.forEach(g => g.reset()); }
      },
      process(inputs, outputs, n, params, slots) {
        const ins = inputs[0], outs = outputs[0], cv = inputs[1];
        const g = i => params[slots[i]];
        env.set(g(ATK), g(DEC), g(SUS), g(REL));
        const settings = { mode: Math.round(g(MODE)), bright: g(BRIGHT), res: g(RES), openMs: g(OPEN), closeMs: g(CLOSE), semis: (note - 60) * g(TRACK) };
        gates.forEach(x => x.set(settings));
        const strike = 1 - g(VEL) + g(VEL) * velocity, level = g(LEVEL);
        for (let i = 0; i < n; i++) {
          const target = cvOn ? Math.max(0, Math.min(1, cv[i])) : env.next() * strike;
          outs[0][i] = gates[0].run(ins[0][i], target) * level;
          outs[1][i] = gates[1].run(ins[1][i], target) * level;
        }
      },
    };
  },
};
