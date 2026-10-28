// genexpr: a node whose sound is code. The text on the node is a GenExpr program (see src/genexpr/); it is compiled to
// JavaScript once, when it changes, never per block. If an edit has mistakes the last working program keeps running.
// in1 and in2 come in, out1 and out2 go out. A `Param` in the code becomes a knob: p1 to p8, in the order they are
// declared. Each knob is 0 to 1 here and is stretched to the Param's own min and max.
// The notes played on the instrument reach the code as freq (Hz), gate (1 while a key is held), vel, note and trig (1 for the
// first sample of a note). Placed in front of a Voices node, each voice is a separate copy of the code and has its own notes,
// state and delay lines; placed after it (or with no Voices node) it hears every note of the instrument once, as one voice.
import { compile, DEFAULT_CODE, MAX_PARAMS, NOTE_DEFAULTS } from '../../genexpr/compile.js';

export default {
  type: 'genexpr',
  inputs: ['in1', 'in2'],
  outputs: ['out1', 'out2'],
  category: 'Effects',
  shape: 'box',
  glyph: 'braces',
  editor: 'genexpr',   // the patcher panel offers the code editor for this node
  params: Array.from({ length: MAX_PARAMS }, (_, i) => ({ name: `p${i + 1}`, min: 0, max: 1, def: 0.5 })),
  create({ sampleRate, data }) {
    let run = null, meta = [], built = null;
    const P = new Float64Array(MAX_PARAMS);
    const N = Float64Array.from(NOTE_DEFAULTS);   // freq, gate, vel, note, trig
    const held = [];                              // the keys down, the latest last
    const load = text => {
      const r = compile(typeof text === 'string' ? text : DEFAULT_CODE, { sampleRate });
      if (r.ok) { built = r; run = r.build(sampleRate); meta = r.params; }
    };
    load(data?.code);
    const aim = () => {   // the note the code hears: the latest key still down, else the last one that was
      const n = held[held.length - 1];
      if (n !== undefined) { N[3] = n; N[0] = 440 * 2 ** ((n - 69) / 12); }
      N[1] = held.length ? 1 : 0;
    };
    return {
      message(msg) { if (msg.type === 'code') load(msg.text); },
      note(msg) {
        if (msg.type === 'noteOn') {
          const at = held.indexOf(msg.note); if (at >= 0) held.splice(at, 1);
          held.push(msg.note); N[2] = msg.vel ?? 1; N[4] = 1; aim();
        } else if (msg.type === 'noteOff') {
          const at = held.indexOf(msg.note); if (at >= 0) held.splice(at, 1);
          aim();
        } else if (msg.type === 'allOff') { held.length = 0; aim(); }
        else if (msg.type === 'noteCut') { held.length = 0; aim(); if (built) run = built.build(sampleRate); }   // a cut starts the code again from nothing
      },
      process(inputs, outputs, n, params, slots) {
        if (!run) { outputs[0].fill(0, 0, n); outputs[1].fill(0, 0, n); return; }
        for (let i = 0; i < meta.length; i++) P[i] = meta[i].min + params[slots[i]] * (meta[i].max - meta[i].min);
        run(inputs[0], inputs[1], outputs[0], outputs[1], n, P, N);
        N[4] = 0;
      },
    };
  },
};
