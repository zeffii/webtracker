# 7. Samples

The Sample screen (F4) loads audio, and the sample data is stored inside the project, so a `.wax` file carries its sounds with it.

## Loading

**Load…** a slot, or drop audio files on the screen. Any format the browser can decode works. The list shows the slots on the left; select one to see its waveform.

## Recording

The **Record** button has a source box. *Another tab or screen* opens the browser's share picker (Chrome and Edge): pick a tab and tick *Also share tab audio*, or on Windows pick Entire screen with *Share system audio* to capture everything the computer plays. The other sources are the machine's audio inputs.

## Per sample

Volume and pan; a **loop** and a **sustain loop**, each with a crossfade; **slice markers**; and a waveform or a spectrogram view. Click a field to select it, click it again to type a value, or click a level bar to set it. Command `10` in a pattern starts the sample at a slice.

## Editing

Right-click the waveform for the edits: trim to selection, cut, silence, reverse, normalise, fades, remove DC, bake the crossfades. Select all, clear, mark a slice at the mouse, undo and redo are there too.

Other tools on the same menu: **auto-slice** finds the hits and marks slices; **detect chords** reads a held chord out of a sample; **post-transient resynthesis** keeps the first few milliseconds as real sample data and rebuilds the rest as a small synth, in a new instrument with its own lane.

## The tap pool

The **tap** node records whatever passes through it into one of sixteen slots (`tap01` to `tap16`), started and stopped from a pattern column. The slots show up at the end of the sample list. They are not saved with the project.
