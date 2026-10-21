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

Every push to `master` runs the tests and publishes the app to GitHub Pages (`.github/workflows/pages.yml`). Pages cannot send the isolation headers, so `coi-serviceworker.js` adds them there, and the page reloads once on the first visit. `version.json` (the build number, commit and date) is stamped by the workflow; `serve.mjs` makes it from git, with a `+` after the commit while there are uncommitted changes.

`npm test` runs the offline smoke test (nodes, graphs, sequencer, file formats, importers, parts of the UI).

## The screens

| key | screen | what it is |
|---|---|---|
| F1 | **Patterns** | The grid. One column group per lane; notes, velocities, trigger columns, parameter columns and commands. |
| F2 | **Samples** | Load audio, set loop and sustain-loop points and crossfades, mark slices, view the waveform or spectrogram. |
| F3 | **Instruments** | The node graph of one instrument, its parameters, presets, and the preset library and instrument files. |
| F4 | **Arrangement** | Patterns placed on a timeline, one column per lane; lane controls sit under the grid. |

Pattern editor: Space writes the live value of the parameter under the cursor into its cell and steps down; Ctrl+Space writes the live values of every parameter column of the row (not notes, velocities or commands). Ctrl+Enter and Ctrl+Shift+Enter are free for something better.

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
Ctrl+Enter opens the pattern under the cursor on its own (solo-edit): edits and pastes cannot reach anything else. Tab flips the view between the pattern alone (rows counted from 0) and the whole song with the rest greyed, hatched and locked; Esc returns to the whole song. Select a block of lanes and rows (Shift+arrows or drag), copy, cut and paste it (Ctrl+C/X/V, pasted with its top left at the cursor), or press Ctrl+D to copy it straight below itself, again and again by the same number of rows; Ctrl+D does the same for cells in the pattern editor, and Ctrl+G gives the placement under the cursor its own copy of its pattern. **Follow** (F9) makes the grids scroll with the playing row, which is highlighted; moving the caret to another row pauses the following (so you can edit elsewhere while the song plays) and F9 or the Follow button follows again (Config can turn the roaming off). The mouse wheel scrolls. Under the grid: rename, reorder, duplicate or remove the lane under the cursor (optionally
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

### Transport icons and tempo keys
Play is a right-pointing triangle (a square while playing, to stop) and Rec is a red dot, which turns white on a red button while armed. Alt+Up / Alt+Down change the song tempo by 1 bpm, Alt+Shift+Up / Down by 10.

### About box
The About button in the header opens a short note on how the project is made and a changelog, newest build first. The text and the changelog live in `src/ui/about.js`: add a line there with each build.

### Arrow keys in the pattern editor
Left and Right move by whole cells: to the first character of the next or previous column. Typing still advances the caret through the cell. Ctrl+Left / Ctrl+Right move one character inside the cell, for editing a single digit. Config, Editing: "Left and Right move by" can be set back to one character at a time (a held key jumps by column). Lowering and raising the selected values moved from Ctrl+Left/Right to Ctrl+, and Ctrl+. (Ctrl+< and Ctrl+> for the bigger step).

### Chord order and note off for the row
MIDI step entry writes a chord from the lowest note to the highest, rewriting the columns as each key joins so the order is right however the keys were struck (Config, MIDI: "A chord goes into the columns" can keep the order played). Shift+1 writes a note off (===) into every note column of the cursor's row of that lane and moves down a row.

### Drawing
Only the screen that is showing is drawn each frame (the others have nothing to paint, and the instrument graph's layout check was forcing a re-measure of the page every frame while it was hidden). The pattern grid and the arrangement are rewritten into the page only when their markup actually changes.


## Squelch (m207)
A monophonic 303-style bassline instrument (New instrument > Squelch). Columns: Note, Vel, Acc, Sld, plus Cut, Res, Env, Dec, Acl, SlT, Wav, Drv. Acc and Sld count for the note on their row only (blank = off). Sld 1 glides from the previous pitch to this note without retriggering the envelope, only while a note is sounding. Acc 1..F adds strength on top of normal level: louder, sharper, wider filter sweep; accents in a row build up. Commands 01-0D set cutoff, res, envmod, decay, accent, slide, wave, drive, tune, release, vel, level, out gain.

## Graph pull-out setting (m207)
Config > Editing: "Graph: dragging a node far out of its chain takes it out" (on by default). Turn it off to move nodes without the dashed detach line.

## filterPro (m208)
Filter & EQ > filterpro. Modes: lowpass, bandpass, highpass, notch, peak, allpass, morph (lowpass > notch > highpass by `morph`), lowpass 24, ladder, vowel (a e i o u by `vowel`, cutoff slides the formants), comb + and comb - (cutoff is the pitch, resonance the feedback, `damp` darkens). `drive` and `bias` saturate before the filter, `mix` blends dry and wet, the `mod` input is in octaves and applied sample by sample. Resonance 1 self-oscillates.

## Graph and pattern shortcuts (m209)
Graph: Shift+drag a node takes it out of its chain (its neighbours are wired together) and moves it, whatever the pull-out setting says; a Shift+click without moving still adds to the group. Alt+drag makes a copy and moves the copy. Ctrl+X removes the selected node. Pattern editor: `>` clears the cell under the cursor, like Delete.

## Gobble, rotate, randomize (m210)
Pattern editor. Ctrl+Delete deletes the selected cells and pulls the cells below up; Ctrl+Insert pushes them down from the cursor; rows never cross into the next pattern (a selection over several patterns is handled one pattern at a time). Ctrl+Alt+Up/Down rotates the contents of the selected rows, column by column. Ctrl+K opens the randomize menu: shuffle the values (filled cells stay put), shuffle the cells (empties move too), redraw from the column's own spread, nudge by small steps, or redraw with empty cells too (keeping the density). Every new value comes from the column itself, so the selection stays valid. Ctrl+Shift+K rolls again from the original cells; any other key accepts; the rolls undo as one step.

## Snappier grid, subtler playhead (m211)
The pattern grid keeps one element per row and rewrites only the rows whose markup changed. The playhead is now a faint overlay band by default (Config > Playhead: band, line or the old > marker), so playback never rewrites the grid text.

## Interpolation curve, nugget mode (m212)
Ctrl+I: per column of the selection the first and last filled cells are the ends, and the filled cells between them get values by row position (notes by semitone). The popup picks a shape (linear, ease in/out, s-curve, exponential, steps), bends it, adds a wave (cycles, depth), lets you paint your own curve, and can include empty cells. Dots on the curve are the cells that will change. The grid updates live; Enter applies, Esc cancels; one undo step. Nugget mode: Ctrl+Left/Right goes inside a cell; then plain Left/Right stay inside until the next step would cross its edge, and Up/Down keep the character position.

## Vocoder (m217)
Filter & EQ > vocoder. Wire a voice (or any busy sound: drums work well) into `voice` and a held synth or chord into `carrier`: the voice's spectrum, band by band, is imposed on the carrier. With nothing wired to `carrier` a built-in buzz (a band-limited saw plus a little noise, `tune` sets its pitch) is used. `bands` (4 to 32) between `low` and `high`, `q` for band sharpness, `attack` and `release` for how quickly the bands follow, `shift` moves the carrier bands against the voice bands (formant shift), `sibilance` passes the voice's own highs so consonants stay clear.

## Bezier interpolation (m218)
Ctrl+I > bezier turns the current shape into a spline you can drag: square anchors, round handles. Anchors stay in time order, a handle cannot reach past its neighbouring anchor and values stay inside the range, so the curve is always a function of time. The first and last anchors are the cells' own values (they only have handles to move). Double-click the curve adds an anchor, double-click an anchor removes it, Alt-click an anchor breaks or joins its two handles. Picking another shape, bending or painting leaves bezier mode.

Pattern editor: Ctrl+Shift+Delete removes the pattern under the cursor from the arrangement (m219); the pattern stays in the list and Ctrl+Z brings the placement back.

## Icon (m221)
icon.ico (16, 24, 32, 48, 64, 128, 256 px) and icon.png (1024 px) are the round pink burst mark, linked as the tab icon in index.html.

## Recording samples (m222)
The Samples screen has a Record button with a source box. **Another tab or screen** opens the browser's share picker (Chrome or Edge): pick a tab and tick Also share tab audio, or on Windows pick Entire screen with Share system audio to capture everything the computer plays. Firefox and Safari do not give tab audio. The other sources are the machine's audio inputs (a microphone, an interface, or a loopback device such as BlackHole). A meter and the time are shown; **start on sound** holds the take until something louder than about -40 dB arrives. Stop (or Esc) keeps the take as a new sample, mono when both sides are identical, at most five minutes. Audio with copy protection records as silence.

## Tap node and the tap pool (m223)
Effects > Routing > tap records the signal passing through it into a sample, started and stopped from a pattern. It passes the audio on unchanged, so it can sit anywhere in a chain. Expose its parameters as pattern columns: `trig` (1 starts a take on that row, 0 ends the current one; every write counts), `len` (ticks; the take ends exactly on a tick boundary, so a 16 tick take of a loop is tempo-exact; 0 records until trig 0 or the song stops), `smp` (1 to 16 for tap01 to tap16; 0 records nothing), `ch` (1 or 2), `fade` and `fadein` (ms, raised-cosine fades at the end and the start of the take, so it never clicks) and `copy` (a normal sample number that also receives the take; a number past the end adds a new sample; 0 for none). The node shows the slot it writes to below its box.

The pool is sixteen slots, tap01 to tap16, always present (a sampler can be pointed at one before its first take, and both ends are explicit: the writer names its slot and the reader picks the same one). Slots with a take appear at the end of the Samples screen list; they are not saved with the project and come back empty when it is loaded. Delete empties a slot. K copies the sample under the cursor into a new normal sample. Takes loop by default. Taking a mono take into a sampler that was built for mono, or stereo into stereo, is seamless; a change of channel count reloads that instrument once.

Ctrl+G (m224): the copy always gets a colour different from the original's, so the clone is visible at once; before, a colour set with K was copied as it was, and an automatic colour (one of six, by pattern index) could come out the same.

Instrument editor (m225): switching to an instrument selects the node that was selected when you left it, else its first generator node, so keyjazz works without clicking first.

Panic button (m226): a small skull and crossbones instead of the word; same action, and it turns red under the pointer.

## Scripts (m227)

The Script tab (Ctrl+Alt+S, or click it) holds one script per project, saved in the `.wax` file. A script fills pattern data: it works on a copy of the pattern under the pattern editor's cursor (or the selected rows and columns), and only when it finishes without an error are its changes applied, as one undo step. It runs in a Worker; a script that takes longer than the time limit (Config, Script, 2000 ms) is stopped and changes nothing. Nothing runs by itself: a loaded project's script only runs when you press Run. It is not a security sandbox, so only run scripts you trust. A pattern placed more than once is refused unless Config allows writing into shared patterns, as for MIDI.

Ctrl+Enter runs the selected code, or all of it; Ctrl+Alt+R in the pattern editor runs the whole script on the pattern there. The line under the output is a playground: `scale('minor', 'A', 2)` shows its value. Tab indents, Shift+Tab outdents.

**Bit patterns.** `tbin('x... x.x. x...', 'C-3')`: x or 1 is a hit, . or 0 a rest, ? a hit half of the time; spaces and | are ignored. One character is one row, or `step` rows (`step(8)` for the rest of the script, or `{ step: 8 }` for one call). The pattern is tiled over the selection or the pattern (`{ loop: false }` writes it once). Rests leave the cell alone, so a kick and a hat can share a column one call after the other. A number works too: `tbin(0xA92C, 16, 'C-3')`. A string with digits 2-9 or letters a-f is read as levels and writes the velocity column: `tbin('9..5 ..7.', 'C-3')`.

**Notes.** The second argument is one note or a list; the hits step through it. An entry with spaces or + is a chord, one note a note column: `['C-3 E-3 G-3', 'A-2+C-3+E-3']`. `'==='` is a note off, `'...'` skips. `voices('C-3 E-3', 'A-2 C-3')` gives each note column its own sequence instead. Options: `{ step, at, to, loop, vel, prob, clear }`.

**Helpers.** `euclid(5, 16)`, `rot`, `inv`, `rev`, `both`, `either`, `xor` (on bit strings), `bitsOf(n, len)`, `scale('minor', 'A', 2, count)`, `ramp(a, b)` and `sine(lo, hi, cycles)` for `pat.col('cutoff').fill(...)`, `rnd`, `pick`, `shuffle`, `chance`, `seed(n)` (a run prints its seed, so a good one can be kept), `log(...)`. `pat.col('N1')`, `pat.set(row, col, value)`, `pat.get`, `pat.clear()`, and `sel` (r0, r1, c0, c1, rows) reach the cells directly; a column is found by index, label or parameter name, a number is a MIDI note in a note column and a hex value elsewhere.

**MIDI.** With the cursor in the script, keys struck within the chord window are typed as one entry: `'C-4 E-4 G-4'`, with a comma before it after another entry, and just the names inside a string.

Not yet: the function table (`0x01: acidLine`) for running functions from the pattern editor or a script node, first-play hooks, and scripting the arrangement.

Pattern editor (m228): the status bar has two lines. The cursor's place (lane, row, pattern, character, octave, selection, messages) is small on top; under it the name of the column is large, with a meter for where the value sits in its range, the value in real units, and the range and the hex it is written as. Ctrl+K steps the colour of the pattern under the cursor through the 16 colours and back to automatic (Ctrl+Shift+K backwards); the randomize menu is Ctrl+R, and Alt+R rolls it again from the cells as they were before the first roll. Arming MIDI recording is Ctrl+Shift+R (it was Alt+R). The built-in demo song is the updated one.

Tick lines (m229): a parameter in ms or s (a delay time, an attack, a decay) and the speed of an LFO or similar (Hz) can be read as ticks at the song's tempo. Its slider shows a faint red line wherever a tick falls, the beat (every ticks-per-beat) stronger, and the value in ticks beside the hex ("3.02t"). A log slider bunches the ticks at the short end, so it marks a half, a quarter and an eighth of a tick and then 1, 2, 4, 8... ticks, leaving out lines closer than a few pixels; a rate is marked where its period is a whole number of ticks. A mouse drag snaps to a line when it is within a few pixels; hold Alt to drag freely. The arrow keys and typing are not snapped. Config, Time sliders: the lines and the snap can each be switched off. The hex is shown, as before, for parameters exposed as pattern columns. Also fixed: dragging a slider in the exposed dock stopped after the first step.

Sample screen mouse (m230): click a sample or a field; click a field again to type a value (digits typed straight after the first click do the same); click a loop switch or the display choice to change it, or a level bar to set it. Ctrl+W asks before the tab closes (browsers do not let a page block it outright).

Spectral panner (m231): ten bands from 150 Hz to 10 kHz, each panned by a shape (alternate, sweep, wave, custom b1..b10). `spread` 0 leaves the sound alone; `rotate` moves the pattern along the bands; `lowMono` makes everything below it mono (a 24 dB/oct split). Bands bleed into each other near the crossovers, so the pattern is smooth rather than sharp. Check a widened mix in mono.

Node help (m232): F1 with a node selected on the instrument screen, or the ? on its parameter window, shows its help page; F1 or Esc closes it. Pages are in src/graph/help.js (`PAGES`: summary, best, limits); a node with no page shows its ports and the hint of every parameter.

Spectral panner view (m233): the node's panel draws the pan of each band against frequency (src/graph/specpaneditor.js); it only displays, the sliders (b1..b10 for the custom shape) change it.

Backups (m234): src/project/backup.js keeps rolling snapshots in IndexedDB (unchanged projects are not stored twice) and can write each one to a folder chosen with the browser's directory picker (Chrome and Brave; the permission is asked again after a restart, with an Allow button). Panel: src/ui/backuppanel.js. Config: backupOn, backupMinutes, backupKeep, backupFolderMode.

Brave (m235): Brave keeps the folder picker off by default; the Backups panel says to enable brave://flags/#file-system-access-api and relaunch.

Download backups (m236): Config > Backup > Download a backup file; `takeDownload()` in src/project/backup.js hands the project over once per change. Off by default. In Brave, turn off "Ask where to save each file" or every download prompts.

Pattern minimaps (m244): `src/seq/minimap.js` draws, on one canvas over the arrangement, the notes (pitch ticks, lengths, off/cut caps) and parameter cells of the 16 ticks in each cell, from the lane's flattened rows; rows are cached by identity (rows are replaced, never edited in place). Config > Arrangement.

Meter band (m243): `src/ui/meters.js` draws the panels, `src/ui/meterdsp.js` has the arithmetic (K-weighted LUFS, correlation, a 4096-point spectrum in 96 log bands and the side share of the spectral panner's ten bands). It reads the same ring as the vectorscope, each reader with its own on-bit. Ctrl+Alt+M, Config > Meters.

Vectorscope (m241): `src/audio/vring.js` is a shared ring of the last output samples, written by the worklet only while the overlay is on; `src/ui/vectorscope.js` draws it (L/R turned 45 degrees, glow and fade). Ctrl+Alt+O, Config > Scope.

Export WAV (m240): the Export WAV button renders the song once, offline (src/audio/export.js: the same runtime and sequencer, fed the messages the engine kept in `sent`), adds a tail (Config > Export) and downloads a stereo WAV, 16/24-bit or 32-bit float.

New demo (m238): a three-minute interstellar soundscape (Shepard glide, chords, delayed stars, swells with long wide tails).

Noise colours (m237): `tilt` in dB/oct (-6 brown, -3 pink, 0 white, +3 blue, +6 violet), loudness-matched; `free` runs without notes.
