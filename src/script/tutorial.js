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
\`x\` is a hit, \`.\` is a rest and empties its cell (add \`keep: true\` in the options to leave what is there), spaces are ignored. The pattern repeats down the whole selection.

\`\`\`
tbin('x... x... x... x...', 'C-2')
\`\`\`

Step through a scale on each hit, with the velocities alternating:

\`\`\`
tbin('x.x. ..x. x..x ..x.', scale('minor', 'A', 3), { vel: [0xC0, 0x80] })
\`\`\`

Under the editor, every \`euclid(hits, steps, rotate)\` written with plain numbers, and every \`'x..x'\` string, is drawn as a ring and a row of steps as you type, before anything runs; the one on the caret's line is outlined.

### Euclidean rhythms, in plain words
Pick how many **hits** you want and how many **steps** (rows) to spread them over. A Euclidean rhythm puts the hits as evenly apart as it can. Five hits in eight steps comes out as:

::euclid 5 8::

The ring is the pattern as a clock: the top is step one, and the dots are the hits. The row of boxes is the same thing laid out in time, in groups of four steps. Hits are filled in.

**Shift** slides the whole pattern along without changing it, so one pair of numbers gives you a family of related grooves. Try it here, and press the button to put it in the try-a-line box:

::euclid-lab::

Many traditional rhythms are Euclidean. Click one to load it into the builder above:

::euclid-gallery::

Ideas to try: kick on 4 of 16, hat on 7 of 16, and a percussion lane on 5 of 12. Because the lengths do not line up, the layers drift in and out of phase.

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

### Chords and progressions
\`chord('Am7')\` is the notes of one chord, ready for \`tbin\`. \`chords('Am7 Fmaj7 C G')\` is one chord per hit, round and round; the lane needs a note column for each note of the biggest chord (a smaller chord switches the spare columns off). Under the editor, every \`chords('...')\` written with plain text shows the names and the notes they play.

\`\`\`
tbin('x... x... x... x...', chords('Am F C G'), { lead: true })
\`\`\`

\`lead: true\` turns each chord to the inversion that moves the fewest notes from the one before, so the progression glides. \`octave\`, \`inversion\`, \`max\` (the most notes in a chord: a seventh chord with max: 3 drops its fifth) and \`spread\` (\`'close'\`, \`'open'\` or \`'drop2'\`) shape the voicing. Chord names are the ones the Chord node reads: \`F#13sus\`, \`Cm7b5\`, \`E min9 (11)\`, \`C/E\`. Put a \`|\` between names when a name has spaces.

**Roman numerals** say where in the key a chord sits, so the same progression works in any key. Capitals are major, lower case is minor, \`°\` is diminished, \`ø\` half-diminished, \`b\` or \`#\` in front moves a numeral, and \`V7/ii\` is the dominant of the ii chord.

\`\`\`
tbin('x... x... x... x...', chords(prog('i VI III VII', 'A', 'minor')), { lead: true })
\`\`\`

The **circle of fifths** puts the keys a fifth apart, so the keys next to each other share nearly all their chords. Click a chord in the wheel to build a progression, click a key to move round, and press the button to put the line in the try-a-line box:

::chord-lab::

The same moves are in the script: \`fifths('C', 4)\` is C G D A (a negative count goes the flat way), \`cycle('C', 4, '7')\` is C7 F7 Bb7 Eb7, \`relative('C')\` is Am, \`parallel('C')\` is Cm, \`triads('C')\` the seven chords of a key, \`neighbours('C')\` the chords next to it on the circle, \`dom('D')\` is A7, \`tritone('G7')\` is Db7 and \`pivot('C', 'G')\` the chords two keys share.

**Suggest a progression, and circle back:** \`progression(8, 'A', 'minor', { style: 'pop', seed: 3 })\` walks the likely moves from chord to chord. By default the last chord leads **back into the first**, so when the progression plays again it circles round without the home chord sounding twice; \`end: 'home'\` makes it finish on the home chord instead, a full stop. The styles are \`'pop'\`, \`'jazz'\` (ii-V-I chains, with sevenths) and \`'techno'\` (one or two chords and the home chord between). \`sevenths: true\` adds sevenths and \`spice: 0.3\` swaps some chords for the dominant of the next. The same seed gives the same progression. In the lab, **Suggest next** does the same one chord at a time, steering from the chords you already have so that the length you chose comes round; a dashed arrow on the wheel shows the last chord returning to the first. In a script, \`nextChord(list, 8, 'A', 'minor')\` gives the next chord of your own list, and \`leadsHome('E7', 'A', 'minor')\` says whether a chord leads back to the home chord.

\`\`\`
seed(4);
tbin('x... x... x... x... x... x... x... x...', chords(progression(8, 'A', 'minor', { style: 'jazz' }), { lead: true, max: 3 }))
\`\`\`

### Scatter samples at random
\`scatter\` puts hits at random rows of the selection. Every option is a value, a list (one is picked each time), \`{ min, max }\` or a function. In a sampler lane, \`samples\` fills the Smp column, \`offset\` and \`retrig\` the Off and Rtg columns (0 to 65535), and \`cmd\` is a command cell, or a list of them, that goes on some of the hits (\`cmdChance\`).

\`\`\`
scatter({ samples: [0, 1, 2, 3], density: 0.4, note: ['C-4', 'D#4', 'G-4'], vel: { min: 0x60, max: 0xFF }, offset: { min: 0, max: 0xFFFF }, retrig: [0, 0, 0x0800, 0x1000], cmd: ['0B0800', '0D6000', '2C8020'], cmdChance: 0.3, clear: true })
\`\`\`

With \`seed(7)\` first you get the same pattern every run; leave it out for a new one each time. Use \`hits: 12\` instead of \`density\` for an exact count, and \`step: 2\` to use only every second row.

### Other helpers
- \`pat.col('Vel1').fill(ramp(0x30, 0xFF))\` fills a column with a ramp, for example the velocity.
- \`pat.set(0, 'Note1', 'C-4')\` writes one cell. \`pat.clear()\` empties the selection.
- \`rnd(a, b)\`, \`pick(list)\`, \`shuffle(list)\`, \`chance(p)\` and \`log(...)\` do what they say; the output appears under the editor.
- \`rot\`, \`inv\`, \`rev\`, \`both\`, \`either\` and \`xor\` work on bit patterns.
- \`scale('minor', 'A', 2)\` gives a list of notes; the scale names are major, minor, dorian, phrygian, lydian, mixolydian, locrian, harmonicminor, melodicminor, majpent, minpent, blues, chromatic and whole.

If a script fails, the error says which line, and nothing is changed.
`;
