# 6. Instruments

An instrument is a **graph of nodes**, stored in the project as data. A lane plays one instrument. You can start from a ready-made synth or from nothing.

## New instrument

In the Instrument screen's options, the **New instrument** box makes a kick synth, any of the synths, a sampler on a chosen sample, or an *Empty* graph (just the output and the voices node) to build from. Wax ships with no factory presets: every instrument starts plain, so every sound is yours.

## The graph

Add a node with the menu (double-click an empty place; it is a cascading menu with underlined hotkeys, and `/` searches). Wire one node's output to another's input by dragging. A node that is not wired to anything is ignored, and adding or removing such a node does not interrupt a playing song.

Everything *before* the **voices** node runs once per voice (up to 16 copies of the graph, for polyphony). Everything *after* it runs once, on the summed signal.

Useful gestures:

- **Shift+drag** a node takes it out of its chain (its neighbours are wired together) and moves it.
- **Alt+drag** makes a copy and moves the copy.
- **Ctrl+X** removes the selected node.
- The **eye** under a node shows its output as a waveform, a spectrum or an XY picture.

## Parameters

Click a node and its parameters list on the right: a name, and a bar with the value written on it. Drag the bar, click it, or use Left and Right (Shift for more, Ctrl for less). Double-click puts it back to its default. Right-click a row for its menu.

Three small switches show when the panel is wide. **e** exposes the parameter as a column in the pattern; **p** gives it a port, so another node can be wired into it; the third sets the column's width.

A parameter in milliseconds or Hz can be read in ticks: its bar shows a faint line wherever a tick of the song falls, and the value in ticks beside the hex. Use it to put an echo exactly on the beat. Sound still decides: if it sounds better off the grid, leave it off the grid.

## The nodes

- **Sources:** sampler, oscillator, envelope, LFO, subtractive synth, an Oberheim-style synth, piano (a physical model), FM, additive, wavetable, granular, spectral, plucked string, DX bank loader, 808 hi-hat, a comb-resonator percussion machine, and a MOD channel.
- **Mix and level:** gain (with a VU meter), mix, pan, voices.
- **Effects:** filter, delay, multitap, chorus, phaser, flanger, distortion, waveshaper, fold, crusher, frequency shifter, gater, exciter, transient, compressor, gate, EQ, three reverbs (hall, plate, shimmer), vocoder, and more.
- **Control:** ctrl (glides and parameter ports), note trigger, envelope follower, tempo.

Select a node and press **Shift+F1** for its help page: a summary, what it is best at, and where it runs out.

## Presets

A preset keeps a sound. Save one under a name, and recall it from a pattern with command `00`. A preset library (`.wxpr`) holds many. An instrument can be exported and imported on its own (`.waxi`).

## Heavy nodes

Some nodes have a quality setting. The default sounds as it always did; the cheaper mode is for when a song asks too much of the processor. The footer shows the load (average, worst block, blocks that ran late), and Ctrl+Alt+E opens the stream manager, which shows the load per lane.
