---
name: wax
description: Write, edit, check and judge music in Wax (webtracker) .wax project files: the JSON format, pattern row syntax, instruments built from nodes, and the wax MCP tools that validate, outline, render and measure a song. Use when the user asks for a song, a pattern, an instrument or a mix change in Wax, or opens a .wax file.
---

# Writing music in Wax

Wax is a browser tracker. A project is one JSON file (`.wax`); Claude writes and edits it directly. The `wax` MCP tools
(`tools/wax-mcp/server.mjs`) are how you hear what you wrote: they render with the same engine as the page, without a browser.

## The loop

1. Read the project (or start from `src/project/demo.wax` for a complete example).
2. Edit the JSON with a script (Python or Node) rather than by hand: patterns are lists of text rows, and a script keeps them consistent.
3. `wax_validate` after every edit. Problems mean the file will not load; warnings are worth reading.
4. `wax_outline` to see what plays when (notes per window per lane).
5. `wax_analyse` (use `solo` / `mute` with lane ids to judge one lane, or the mix without it). Check: peak (keep under about -1 dB with the limiter off), LUFS, band balance per section, onsets per second, stereo correlation. No clipping, nothing not-finite.
6. Listen in numbers, then carve as much as you add: a part that doesn't earn its place goes.
7. `wax_nodes` (optionally with a name or category) to see every node and parameter range before using one.

The user plays the result in the page (`?demo=NAME` opens `src/project/demos/NAME.wax`). Tell them what changed, briefly.

## File shape

```json
{ "format": "webtracker", "version": 1,
  "song": { "name": "..", "bpm": 120, "ticksPerBeat": 4, "length": 1104, "loop": { "start": 0, "end": 992 }, "info": "free text shown in the Info tab" },
  "instruments": { "<id>": { "graph": { "nodes": [], "connections": [], "voices": 3 }, "noteColumns": 1, "exposed": [], "commands": [] } },
  "samples": {},
  "lanes": [ { "id": "master", "instrument": "master", "patterns": {}, "placements": [] },
             { "id": "pad", "instrument": "pad", "patterns": { "a": { "name": "a", "index": 0, "rows": ["C-4 60", "... ..", "..."] } },
               "placements": [ { "puid": "a", "start": 0, "length": 64 } ] } ] }
```

- Time is in ticks. One row of a pattern is one tick. With `ticksPerBeat` 4 a tick is a sixteenth, a bar is 16 ticks. Seconds per tick = 60 / bpm / ticksPerBeat (0.125 s at 120 bpm).
- A lane plays one instrument (`lane.instrument` is an id in `instruments`; the lane id may differ). The `master` lane (instrument `master`) holds tempo and volume and has no notes.
- A pattern is a list of rows. A placement puts a pattern at `start` for `length` ticks (never more than the pattern has rows; fewer cuts it short). A later placement overwrites earlier ones where they overlap. Reuse short patterns many times; cut patterns where the notes start; vary the timing between placements (some early, some late, some much later), not a grid.
- `song.length` is the total ticks; `loop` is where playback repeats.

## Pattern rows

A row is cells separated by spaces, one per column, in this order:

1. For each note column (`noteColumns`, up to 8): a note cell and a velocity cell.
2. Trigger columns, if the machine has them (one hex digit each).
3. One cell per entry of the instrument's `exposed` list, in order.
4. A `Cmd` cell if the instrument has `commands`.

Cells (a row may be shorter: missing cells are blank):
- Note: `C-4`, `C#4`, `F#3` (three characters, octave digit; C-4 is middle C, midi 60), `...` nothing, `===` note off (release), `^^^` note cut (stops at once).
- Velocity: two hex digits `00`..`FF` (FF full), `..` unchanged. Around `40`-`70` is a normal range.
- Exposed parameter: two hex digits, `00` the parameter's minimum to `FF` its maximum (logarithmic if the exposure says `"scale": "log"`; for whole-number parameters the digits are the integer itself, offset from the minimum). `bits: 4` makes it one hex digit, `bits: 16` four. Blank is `..` (`.` or `....`). A value stays until the next one: write ramps as one value every row or two.
- Cmd: six characters, two hex for the command id and four for the value (`010800`), `......` blank.
- A note holds until the next note in its column, a `===` or a `^^^`. A note column plays one voice at a time; for a chord use several note columns (and make sure `graph.voices` is at least `noteColumns`).

## Instruments

An instrument is a graph of nodes (`wax_nodes` lists them): `{ "id": "synth", "type": "subsynth", "params": { "cutoff": 1100 }, "x": 20, "y": 108 }`, and wires `["synth.out", "poly.in"]` (`node.port`). Rules that matter:
- Sound goes `generator -> voices -> effects -> out`. The `voices` node (with `graph.voices` = how many) makes a generator polyphonic. Exactly one `out` node (its `gain` is the instrument's level). A node with no wire changes nothing.
- A control node (lfo, env, ctrl) is wired to another node's parameter: `["lfo1.out", "filter1.mod"]`, or `["env.out", "echo.@mix"]` for a parameter that has no port of its own (the `@` form, and the target node lists the parameter in its `ports`).
- The `arp` node has no wires: it sits in the graph and turns the notes the instrument is given into an arpeggio. Write the chord into the note columns and hold it; expose its `rate` (`bits: 4`) to move the step from the pattern.
- `exposed` makes parameters into pattern columns: `{ "node": "synth", "param": "cutoff", "label": "Cut", "scale": "log" }`. Labels are three or four letters. `commands` are the Cmd column's ids.
- Parameters are numbers in their own units (Hz, ms, 0..1). Anything not set keeps its default. Time-based effects can be set to the song: at 120 bpm a tick is 125 ms, a dotted eighth is 375 ms.
- Wax ships no preset banks. Build each sound from the nodes; do not reach for named presets or name machines after commercial products.
- To copy a known-good instrument, take it from `src/project/demo.wax`, from another project, or from `synthKinds` in `src/instruments.js` (each has `make()` returning a full definition).

## Taste

- Short, reused patterns; uneven spacing; a few well-placed events beat many.
- Chords that agree with what is playing underneath. Minor 7th, 9th and 11th voicings carry well.
- Leave room: when the mix feels full, mute lanes with `wax_analyse` and see which ones are missed.
- Keep the master limiter off unless asked (it is off by default).
