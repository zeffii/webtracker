# webtracker

Run `node serve.mjs`, open http://localhost:8080, press Start, then Play.
Run `npm test` for the offline smoke test of the graph, nodes and sequencer.

Milestone 1 gate: a tone changes live with no zipper noise.
Milestone 2 gate: a preset instrument (sampler, filter, delay, out) plays notes
and the filter and delay can be tweaked live.
Milestone 3 gate: two lanes play at once, and a parameter column moves the filter.
Milestone 4a gate: edit pattern cells from the keyboard while the song plays, including
4hex and CCXXYY cells.
Milestone 4b gate: a song can be written, saved to a .wax file and loaded again.
Characters of a filled cell can be edited one at a time.
Milestone 4c gate: patterns can be placed, cloned, sliced, resized, moved and removed in the
arrangement, with undo and a waypoint. Project files use the .wax extension.

## WASM DSP core

The filter and delay run as WASM kernels (`assembly/dsp.ts`), one instance and memory per node. The JS
versions in `src/audio/nodes/` stay as the reference, and `npm test` checks both give the same samples.
The compiled module is committed as `src/audio/wasm/dsp.wasm.js`, so running the app needs no build.
Only after editing `assembly/dsp.ts`: `npm install` then `npm run build:wasm`. If WASM fails to compile in
the browser, the engine logs a warning and falls back to the JS nodes.
