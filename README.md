# webtracker

Run `node serve.mjs`, open http://localhost:8080, press Start, then Play.
Run `npm test` for the offline smoke test of the graph, nodes and sequencer.

Milestone 1 gate: a tone changes live with no zipper noise.
Milestone 2 gate: a preset instrument (sampler, filter, delay, out) plays notes
and the filter and delay can be tweaked live.
Milestone 3 gate: two lanes play at once, and a parameter column moves the filter.
Milestone 4a gate: edit pattern cells from the keyboard while the song plays, including
4hex and CCXXYY cells.
Milestone 4b gate: a song can be written, saved to a .wtrk file and loaded again.
Characters of a filled cell can be edited one at a time.
