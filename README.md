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

## The four screens

| key | screen | what it is |
|---|---|---|
| F1 | **Patterns** | The grid. One column group per lane; notes, velocities, trigger columns, parameter columns and commands. |
| F2 | **Samples** | Load audio, set loop and sustain-loop points and crossfades, mark slices, view the waveform or spectrogram. |
| F3 | **Instruments** | The node graph of one instrument, its parameters, presets, and the preset library and instrument files. |
| F4 | **Arrangement** | Patterns placed on a timeline, one column per lane; lane controls sit under the grid. |

Playback: F5 plays from the start (or the loop), F6 from the cursor, F7 plays just the row under the cursor once (all lanes together), F8 stops. In the pattern editor Space plays the row once and steps down.

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
redo; set a loop (Ctrl+B / Ctrl+E) and waypoints; mute a lane from a row, or silence it whole; colour patterns.
Select a block of lanes and rows (Shift+arrows or drag), copy, cut and paste it (Ctrl+C/X/V, pasted with its top left at the cursor), or press Ctrl+D to copy it straight below itself, again and again by the same number of rows; Ctrl+D does the same for cells in the pattern editor. **Follow** (F9) makes the grids scroll with the playing row, which is highlighted. The mouse wheel scrolls. Under the grid: rename, reorder, duplicate or remove the lane under the cursor (optionally
with the instrument it plays), and add a lane for any instrument.

## Instruments

An instrument is a graph of nodes, stored in the project as data. Add nodes with the menu (or double-click), wire
them up, expose parameters to the pattern, and set the number of voices (polyphony, up to 16 copies of the graph).
Ready-made synths can be added with a lane in one step. Sources, mixing, effects and control nodes:

- **Sources:** sampler, oscillator, envelope, LFO, subtractive synth, Oberheim-style synth, piano (physical model),
  FM, additive, wavetable, granular, spectral, plucked string, DX7 bank loader, 808 hi-hat, MOD channel.
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
