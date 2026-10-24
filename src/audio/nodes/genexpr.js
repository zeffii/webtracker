// genexpr: a node whose sound is code. The text on the node is a GenExpr program (see src/genexpr/); it is compiled to
// JavaScript once, when it changes, never per block. If an edit has mistakes the last working program keeps running.
// in1 and in2 come in, out1 and out2 go out. A `Param` in the code becomes a knob: p1 to p8, in the order they are
// declared. Each knob is 0 to 1 here and is stretched to the Param's own min and max.
import { compile, DEFAULT_CODE, MAX_PARAMS } from '../../genexpr/compile.js';

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
    let run = null, meta = [];
    const P = new Float64Array(MAX_PARAMS);
    const load = text => {
      const r = compile(typeof text === 'string' ? text : DEFAULT_CODE, { sampleRate });
      if (r.ok) { run = r.build(sampleRate); meta = r.params; }
    };
    load(data?.code);
    return {
      message(msg) { if (msg.type === 'code') load(msg.text); },
      process(inputs, outputs, n, params, slots) {
        if (!run) { outputs[0].fill(0, 0, n); outputs[1].fill(0, 0, n); return; }
        for (let i = 0; i < meta.length; i++) P[i] = meta[i].min + params[slots[i]] * (meta[i].max - meta[i].min);
        run(inputs[0], inputs[1], outputs[0], outputs[1], n, P);
      },
    };
  },
};
