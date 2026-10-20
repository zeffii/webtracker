// The quick start shown under the script editor, as markdown (rendered by ui/markdown.js). Click an example to put it in
// the try-a-line box.
export const TUTORIAL = `
## Scripting quick start

A script writes notes and values into the **pattern under the cursor** in the pattern editor, or into just your selection if you have made one. Nothing changes until the script finishes without an error, and each run is one undo step.

### Try it
1. In the pattern editor (F1), click in the note column you want to fill.
2. Come back here and type a line in the box below the output, then press **Enter**. Or write in the big box and press **Ctrl+Enter**, which runs the selected code, or all of it.
3. **Ctrl+Alt+R** in the pattern editor runs the whole script on that pattern without switching tabs.

### Notes from bit patterns
\`x\` is a hit, \`.\` is a rest, spaces are ignored. The pattern repeats down the whole selection.

\`\`\`
tbin('x... x... x... x...', 'C-2')
\`\`\`

Step through a scale on each hit, with the velocities alternating:

\`\`\`
tbin('x.x. ..x. x..x ..x.', scale('minor', 'A', 3), { vel: [0xC0, 0x80] })
\`\`\`

A Euclidean rhythm of 5 hits in 16 steps, rotated by 2, every step 2 rows long:

\`\`\`
tbin(euclid(5, 16, 2), 'C-4', { step: 2 })
\`\`\`

A chord on each hit needs that many note columns in the lane (sharps are written like \`F#3\`):

\`\`\`
tbin('x... ....', 'C-3 E-3 G-3')
\`\`\`

One sequence per note column, with \`voices\`:

\`\`\`
tbin('x.x.', voices('C-3 E-3', 'G-3 B-3'))
\`\`\`

A \`?\` in the pattern plays half the time. Use \`seed(5)\` to get the same result every run, and leave it out for a new one each time.

\`\`\`
tbin('x?x? x?x?', 'F#3')
\`\`\`

### Other helpers
- \`pat.col('Vel1').fill(ramp(0x30, 0xFF))\` fills a column with a ramp, for example the velocity.
- \`pat.set(0, 'Note1', 'C-4')\` writes one cell. \`pat.clear()\` empties the selection.
- \`rnd(a, b)\`, \`pick(list)\`, \`shuffle(list)\`, \`chance(p)\` and \`log(...)\` do what they say; the output appears under the editor.
- \`rot\`, \`inv\`, \`rev\`, \`both\`, \`either\` and \`xor\` work on bit patterns.
- \`scale('minor', 'A', 2)\` gives a list of notes; the scale names are major, minor, dorian, phrygian, lydian, mixolydian, locrian, harmonicminor, melodicminor, majpent, minpent, blues, chromatic and whole.

If a script fails, the error says which line, and nothing is changed.
`;
