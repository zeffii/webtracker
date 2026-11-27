# Adding a node or an instrument

For anyone, human or AI, who wants to contribute a sound. Read this first, then open `src/audio/nodes/gain.js` (the smallest
node) and `src/audio/nodes/piano2.js` (a large one) to see the same shape at both ends.

## The picture

- A **node** is one block of DSP with ports and parameters: an oscillator, a filter, a reverb, a whole physical model.
  One file in `src/audio/nodes/`.
- An **instrument** (a *machine* in the menus) is a graph of nodes plus what a pattern can reach: how many note columns it
  has, which parameters become columns (`exposed`) and which commands the Cmd column understands. The graph's voice count
  and `voices` node make a generator polyphonic. Instruments are defined in `src/instruments.js`.
- The web app is the reference. The native app (github.com/zeffii/wax-core) ports every node and must sound **identical**;
  see "The native port" at the end.

## House rules

- **No brand or model names** in node names, labels, hints or code comments, even when a node is modelled on a real machine.
  Describe what it does; name it for that.
- **No factory presets.** An instrument starts plain so each sound is made fresh. (The one exception is the convolver's
  built-in rooms.)
- **A heavy node gets a `quality` parameter** (0 standard, 1 eco). The default keeps the sound as it is; the cheaper mode
  is opt-in.
- Write non-DSP code (anything but the sample loop) for someone who will maintain it for years: clear names, a comment
  where the reason is not obvious, files that do one thing.
- Envelopes matter: prefer a drawn Bezier envelope to four ADSR sliders when the shape is part of the character.
- Measure, don't guess. You cannot listen from a script, so check the sound with numbers (below).

## A node in four pieces

This is a complete tremolo. Put it in `src/audio/nodes/trem.js`:

```js
// Tremolo: the level swells and falls at `rate`, as deep as `depth`.
const RATE = 0, DEPTH = 1;   // the slot of each parameter, in the order of `params`

export default {
  type: 'trem',
  inputs: ['in'],
  outputs: ['out'],
  dual: true,              // runs as a left/right pair when a stereo signal arrives
  category: 'Effects',     // Effects get a bypass switch for free
  shape: 'box',            // sources 'rounded', processors 'box', mixers 'circle'
  glyph: 'gain',           // the picture inside the tile (a key of GLYPHS in src/graph/glyphs.js)
  params: [
    { name: 'rate', min: 0.1, max: 20, def: 5 },
    { name: 'depth', min: 0, max: 1, def: 0.5 },
  ],
  create({ sampleRate }) {
    let phase = 0;         // state lives here, one copy per voice
    return {
      process(inputs, outputs, n, params, slots) {
        const input = inputs[0], out = outputs[0];
        const step = params[slots[RATE]] / sampleRate, depth = params[slots[DEPTH]];
        for (let i = 0; i < n; i++) {
          phase += step; if (phase >= 1) phase -= 1;
          out[i] = input[i] * (1 - depth + depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * phase)));
        }
      },
    };
  },
};
```

What to know:

- `process` is called once per block of `n` samples. Read a parameter with `params[slots[INDEX]]`: it can change every
  block, so ramp anything that clicks when it jumps (see `gain.js`).
- Keep state inside `create`, never at module level: every voice gets its own `create`.
- A **generator** (an oscillator, a synth) sets `generator: true`, has the output as `[left, right]` when stereo
  (`kinds: { out: 'stereo' }`) and receives notes through `note(msg)` (`noteOn` with `note` and `vel`, `noteOff`, `allOff`,
  `noteCut`). `piano2.js` is the complete example.
- A port is audio unless you say otherwise: `kinds: { cv: 'control' }` for a control signal.
- Randomness must be seeded and the same every run (a small xorshift, as in `piano2.js`); the tests render twice and
  compare.

Then register it:

| where | what |
| --- | --- |
| `src/audio/nodes/index.js` | `import trem from './trem.js'` and add it to `TYPES` |
| `src/graph/menu.js` | its place in the node picker (a test checks every node is in the tree exactly once) |
| `src/graph/hints.js` | one sentence per parameter, in words, saying what it does to the sound; it is the tooltip and the node's help page |
| `src/graph/units.js` | how a value is shown (`trem: { depth: '%' }`; a parameter named like a common one, `rate` or `cutoff`, already has its unit) |
| `src/graph/glyphs.js` | optional: a new picture; without one the tile has none |

## Checking the sound

Add a block to `test/smoke.mjs` next to the others (search for `125b. Piano 2` for a full one). Render a note offline,
then assert what must be true:

- it is in tune (measure the pitch), and the level is even across the keyboard;
- no DC offset, no NaN or Infinity, and nothing past about ±8 even with every parameter at an extreme;
- it is silent when it should be (after a note-off, with the output at zero);
- the same note rendered twice is identical;
- every parameter changes the sound (compare two renders).

Run `npm test`. The `wax` MCP tools (`wax_validate`, `wax_outline`, `wax_analyse`, `wax_nodes`) render a whole `.wax`
song without a browser and report peak, loudness and spectrum; the `wax` skill in `.claude/skills/wax` explains the file.

## An instrument in three pieces

An instrument is an entry in `synthKinds` in `src/instruments.js`. It returns a graph, and says what a pattern can reach:

```js
trembass: {
  label: 'Tremolo bass',
  make: () => ({
    graph: {
      nodes: [{ id: 'synth', type: 'subsynth' }, { id: 'poly', type: 'voices' }, { id: 'trem', type: 'trem' },
              { id: 'out', type: 'out', params: { gain: 0.5 } }],
      connections: [['synth.out', 'poly.in'], ['poly.out', 'trem.in'], ['trem.out', 'out.in']],
      voices: 6,
    },
    noteColumns: 1,
    exposed: [{ node: 'trem', param: 'depth', label: 'Dep' }],   // a column in the pattern: 00 to FF
    commands: [{ id: 0x01, node: 'trem', param: 'rate' }],       // Cmd column: 01 then four hex digits
  }),
},
```

Rules: sound goes `generator -> voices -> effects -> out`; there is exactly one `out`; labels are three or four letters;
exposed parameters are what a pattern edits fast, commands are everything else worth reaching. Then give it a place in
`MACHINE_TREE` in the same file so it shows in the Shift+I menu. Where it makes sense, offer **both** the complete
one-node machine and its building blocks as separate nodes, so people can assemble their own.

## Finishing

1. `npm test` passes.
2. Add a numbered entry to `CHANGELOG.md` (`## NNN · date`, newest first) saying what it is and what it sounds like, and
   bump `version` in `package.json`.
3. Commit with a message that says what the node is for.

## The native port

The native app must render the same samples. For each new node (details and conventions in the wax-core repository,
`docs/ADDING_NODES.md`):

1. `src/nodes/NAME.cpp` with `registerNAME`, listed in `all_nodes.h`/`all_nodes.cpp` and `CMakeLists.txt`. Same
   parameters, same defaults, same order.
2. Use the `js::` maths (`js::pow`, `js::sin`, `js::exp`, ...), `jsRound` and double precision exactly where the web
   uses `Math.*`, and write the output as float32. That is what makes the two renders match to the bit.
3. A small song in `tests/songs/NAME.wax`, its reference from here (`node tools/render-ref.mjs song.wax out.wav`), and the
   song listed in `tests/render_tests.cpp`. `wax-compare` should say -300 dB.
4. Regenerate the tables the app reads (`tools/gen-machines.mjs`, `gen-node-help.mjs`, `gen-node-looks.mjs`,
   `gen-insert-menu.mjs`); the units table is edited by hand.
