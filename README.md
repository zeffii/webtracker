# webtracker

A tracker that runs in the browser: patterns you type on a grid, played by instruments you build from a graph of
nodes. The audio runs in an AudioWorklet (with WASM kernels for the heavy parts), the interface is plain JavaScript
on canvas and DOM, and there are no runtime dependencies.

It is the spiritual successor of a Max/MSP tracker, and a prototype for a dedicated device (see `PORTING.md`).

## Run it

```
node serve.mjs
```

Open http://localhost:8080, press **Start**, then **Play**. The demo song loads when you press Start.

The page needs cross-origin isolation (SharedArrayBuffer carries the parameters to the audio thread). `serve.mjs`
sends the two headers for it; any other static server must send
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

`npm test` runs the offline smoke test (nodes, graphs, sequencer, file formats, importers, parts of the UI).

## The screens

| key | screen | what it is |
|---|---|---|
| F1 | **Patterns** | The grid. One column group per lane; notes, velocities, trigger columns, parameter columns and commands. |
| F2 | **Samples** | Load audio, set loop and sustain-loop points and crossfades, mark slices, view the waveform or spectrogram. |
| F3 | **Instruments** | The node graph of one instrument, its parameters, presets, and the preset library and instrument files. |
| F4 | **Arrangement** | Patterns placed on a timeline, one column per lane; lane controls sit under the grid. |

Playback: F5 plays from the start (or the loop), F6 from the cursor, F7 plays just the row under the cursor once (all lanes together), F8 stops. In the pattern editor Space plays the row once and steps down.

F10 is **Info**: a plain text page for notes and greetings, saved with the project.

Every screen has a shortcut panel on the right (hide it with the Shortcuts button).

## Patterns

A **lane** plays one instrument. A row is a tick; the song runs at a set number of ticks per beat. The columns of a
lane are made from its instrument:

- **Note** and **velocity** (`C-4 20`): one or more pairs per lane, `1` is note off, `` ` `` is note cut.
- **Trigger** columns (one hex digit): for machines that fire named hits, such as the two hats of the 808 hat. The digit
  is the velocity, 0 is nothing.
- **Parameter** columns (2 or 4 hex digits): any node parameter you expose. The value runs across the parameter's
  range, and a column that never gets a value leaves the parameter alone.
- **Command** column (`01 0EPP`): a command id and its value. `00` recalls a preset by number.

Column headers are short so lanes stay narrow; the status bar under the grid gives the long name, the real range, and
the hex value as a real number (or the default, for a column that has never been written). Edit from the keyboard
while the song plays; edits are heard on the next tick. Selections can be transposed, nudged, interpolated, and
empty columns hidden.

The **master lane** is always first. Its columns set tempo, swing, ticks per beat and volume from the pattern. A
project can be empty apart from it.

## Arrangement

Patterns are placed on a timeline in blocks of 16 ticks. Place, clone, slice, resize, move and remove them; undo and
redo; set a loop (Ctrl+B / Ctrl+E) and waypoints; mute a lane from a row, or silence it whole; put a note-off marker on a row (Ctrl+1), so the lane lets go of its notes there; colour patterns.
Ctrl+Enter opens the pattern under the cursor on its own (solo-edit): edits and pastes cannot reach anything else. Tab flips the view between the pattern alone (rows counted from 0) and the whole song with the rest greyed, hatched and locked; Esc returns to the whole song. Select a block of lanes and rows (Shift+arrows or drag), copy, cut and paste it (Ctrl+C/X/V, pasted with its top left at the cursor), or press Ctrl+D to copy it straight below itself, again and again by the same number of rows; Ctrl+D does the same for cells in the pattern editor, and Ctrl+G gives the placement under the cursor its own copy of its pattern. **Follow** (F9) makes the grids scroll with the playing row, which is highlighted. The mouse wheel scrolls. Under the grid: rename, reorder, duplicate or remove the lane under the cursor (optionally
with the instrument it plays), and add a lane for any instrument.

## Instruments

An instrument is a graph of nodes, stored in the project as data. Add nodes with the menu (or double-click; it is a cascading menu with underlined hotkeys, and `/` searches), wire
them up, expose parameters to the pattern, and set the number of voices (polyphony, up to 16 copies of the graph).
Ready-made synths can be added with a lane in one step. Sources, mixing, effects and control nodes:

- **Sources:** sampler, oscillator, envelope, LFO, subtractive synth, Oberheim-style synth, piano (physical model),
  FM, additive, wavetable, granular, spectral, plucked string, DX7 bank loader, 808 hi-hat, comb-resonator percussion (metal hits and zapping toms), MOD channel.
- **Mix & level:** gain (with a VU meter), mix, pan, voices.
- **Effects:** filter, delay, multitap, chorus, phaser, flanger, distortion, waveshaper, fold, crusher, frequency
  shifter, gater, exciter, transient, compressor, gate, EQ, three reverbs (hall, plate, shimmer), shiva, blur, and
  more.
- **Control:** ctrl (glides and parameter ports), note trigger, envelope follower, tempo.

Any node's output can be watched with the eye under it: waveform, spectrum, XY, or (for the gain node) level meters.
Presets keep a sound; a preset library (`.wxpr`) holds many. An instrument can be exported and imported on its own
(`.waxi`).

## Samples

Load audio files (any format the browser decodes); sample data is stored in the project. Per sample: volume, pan, a
loop and a sustain loop with crossfades, slice markers (command `10` in a pattern starts the sample at a slice) and a spectrogram view.
The waveform height is draggable.

## Files and importers

| extension | what |
|---|---|
| `.wax` | The project: plain JSON, version 1 (song, instruments as graphs, samples, lanes and patterns). Files are small until samples go in. |
| `.waxi` | One instrument. |
| `.wxpr` | A preset library. |
| `.mid` | Imported as lanes and patterns. |
| `.mod` | ProTracker modules: the order list is played out, tempo changes go to the master lane, each channel becomes a lane on a MOD channel machine, and the samples come along. |

## Layout of the code

```
index.html          the page and its styles (themes in themes.css)
src/audio/          engine (main thread), worklet + runtime (audio thread), sequencer, nodes/ (one file per node)
src/graph/          the node editor: patcher, compile, editors, scopes, parameter panels
src/seq/            lanes and columns, pattern and arrangement views, editing, names
src/project/        file formats, importers (MOD, MIDI), sample screen and waveform, operations on the project
assembly/dsp.ts     WASM kernels for the filter and delay (AssemblyScript)
test/smoke.mjs      the smoke test
tools/              small helpers (node memory sizes)
PORTING.md          notes for a future native device
```

A node is a small module: its ports and parameters, and a `create()` that returns a `process(inputs, outputs, n,
params, slots)` function. Adding one means a file in `src/audio/nodes/`, an entry in `index.js`, and (for the editor)
a menu entry, units, a glyph and parameter hints.

### The WASM core

The filter and delay run as WASM kernels (`assembly/dsp.ts`), one instance and memory per node. The JavaScript versions
in `src/audio/nodes/` stay as the reference, and `npm test` checks both give the same samples. The compiled module is
committed (`src/audio/wasm/dsp.wasm.js`), so running the app needs no build. After editing `assembly/dsp.ts` only:
`npm install`, then `npm run build:wasm`. If WASM fails to compile in the browser, the engine logs a warning and
falls back to the JavaScript nodes.

## Notes

- The footer shows the audio load: average, the worst block, blocks that ran late, and output latency. Click it to
  reset the peak; the **copy** button puts the line, with the build and song name, on the clipboard.
- Themes are chosen top right. Display size of the grids can be changed (Ctrl and the wheel); the height of the graph,
  pattern, arrangement and waveform views is set by the dotted bar under each.
- Project, view sizes and similar settings live in the file or in the browser's local storage; nothing is sent
  anywhere.

- **Insert silence** (Arrangement tab, under the grid): type a tick count or press 16/32/48/64/128/256/512 to push everything from the cursor row down by that much; the song grows, the loop follows, a pattern across the point is left whole by default, while only patterns starting at or after the cursor row move (tick "cut patterns across the cursor" to cut it in two there instead).

- **Config** (F11): a panel of settings (theme, shortcut panels, pattern font size, follow, note preview, solo-edit style, insert-silence defaults), kept in this browser; Export… / Import… move them as a JSON file, Reset puts the defaults back. Settings live in `src/ui/config.js` (one schema list: add a row there and it appears in the panel).

- **Playhead** (Config tab): the playing row can be shown as a ">" in the tick column (default) or as a thin red line across the grid; in the arrangement the line moves smoothly through each 16-tick row.

- The instrument editor follows the cursor: moving into another lane (pattern editor or arrangement) shows that lane's machine; switch it off on the Config tab.

- **Merge block** (Arrangement, G): with a block selected (Shift+arrows), every lane in it gets one new pattern made of what plays inside the block; patterns crossing the top or bottom edge are cut there (head and tail stay), so nothing overlaps. One undo step.

  (Merge block: a lane with no pattern in the block gets an empty pattern spanning it.)
  (With several lanes selected and some of them empty, G asks "Create patterns in the empty lanes?": Y/Enter yes, N no (only lanes with patterns are merged), Esc cancels. A single selected lane is never asked.)

- **Alt+Enter** in the pattern editor solo-edits the pattern under the cursor (the same view as Ctrl+Enter in the arrangement); Alt+Enter or Esc leaves it.
- **Sample display menu**: right-click the waveform for the edits (trim to selection, cut, silence, reverse, normalise, fades, remove DC, bake crossfades), select all / clear, mark a slice at the mouse, undo and redo. Clicking the display now also gives the sample screen the keyboard focus, so Shift+C and the other edit keys work straight after a drag.
- **Alt+T** in the pattern editor tints each pattern faintly in its own colour (the arrangement's palette), a patchwork to orient by; again switches it off. Also a row in the Config panel (Tint patterns by colour).
- **MIDI keyboard** (Config, MIDI; Chrome and Edge): the keyboard plays the machine under the cursor in every view. In the pattern editor a note, or a chord (notes struck within the chord window, or while another is held) goes into N1, N2, N3 from the cursor column; the cursor stays unless the setting moves it down a row. **Alt+V** switches velocity sensitivity: on, the velocity is played and written to the vl column; off, nothing is written and the default volume plays. **Rec / Alt+R** records into the pattern under the playhead of the cursor lane while the song plays, quantised to the nearest tick with the output latency taken off (plus an offset setting); a release writes a note off unless the tick is taken, a pass is one undo step, and a pattern used more than once is refused unless the setting allows it. `src/seq/midiwrite.js` holds the logic, `src/ui/midiin.js` the Web MIDI side.
- **LFO range**: the LFO node has Range, Min and Max. Range 0 (default, as before) swings either side of zero by Amount; Range 1 runs the wave between Min and Max, so it can sit on any parameter within the range you want.
- **LFO steps**: how many times per tick the LFO is worked out (0, the default, is every sample); it holds its value between updates. A wire into a parameter only reads the end of each block, so 8 to 24 sounds the same and is much cheaper.
- **Pinned parameters**: the thumb-tack on a node's title strip in the graph view's parameter panel keeps that node's rows in the panel when you select another node; pinned nodes stack under the selected one, and the tack on them unpins. Pins are per instrument and not saved with the project.

- **New instrument** (Instruments tab): one box makes a Kick synth, any of the synths, a Sampler on a chosen sample, or an Empty graph (just out and voices, to build from the Add node menu).

- **Solo lane** (Alt+S, arrangement or pattern editor): the other lanes (not the master) let go of their notes, which ring out naturally, and play nothing; they are drawn darker, fading over half a second. Alt+S again, or soloing another lane, adjusts it; with no lane soloed everyone plays at once and the fade back is quick. Not saved with the song.

### Playback is not interrupted by an unconnected node
Adding a node to a graph (or removing one) that is not wired to anything no longer reloads the instrument, so a playing song keeps its notes and tails. Wiring it in, or changing a wired node or a parameter, still reloads as before.

### Post-transient resynthesis
Right click in the sample display, "Post-transient resynthesis". The first few milliseconds of the sample (or of the selection) stay as real sample data, a new small sample; the rest is rebuilt as a tree of synth branches running side by side into one output, in a new instrument with its own lane. A branch is either tonal (a sine with its own pitch sweep and decay) or noise (a noise source through a filter, with a decay). The fit adds branches one at a time, each explaining the biggest part of what is left, and stops at the most allowed or when a new branch would explain less than the tolerance, so a plain kick comes out as one branch and a bell as one per partial. The result is made of ordinary osc, noise, filter, env and gain nodes, so it can be opened and edited like any instrument. Settings (Config, Sample): most branches (8), tolerance in % (5; lower is closer and uses more branches) and the attack kept in ms (0 finds it from the sound). Partials below about 45 Hz or above the pitch range follow the note only as far as the oscillator's tune allows; very high ones are fixed in pitch. New node: `noise` (white noise, restarts from its seed on every note).
