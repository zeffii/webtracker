# 4. Patterns

A **pattern** is a block of rows. A **row** is a tick, and the song runs at a set number of ticks per beat. You type into patterns on the Pattern screen (F2).

## Lanes and columns

A **lane** plays one instrument. Its columns are made from that instrument:

- **Note** and **velocity** (`C-4 20`): one or more pairs per lane. A note off is `===`; a note cut is a backtick.
- **Trigger** columns, one hex digit: for machines that fire named hits, such as the two hats of the 808 hat. The digit is the velocity; 0 is nothing.
- **Parameter** columns, two or four hex digits: any node parameter you chose to expose. The value runs across the parameter's whole range. A column that never gets a value leaves the parameter alone.
- **Command** column (`01 0EPP`): a command id and its value. Command `00` recalls a preset by number; `10` starts a sample at a slice.

The **master lane** is always first. Its columns set tempo, swing, ticks per beat and volume, so a project can be empty apart from it and still change speed mid-song.

Column headers are short so lanes stay narrow. The status bar under the grid gives the long name of the column under the cursor, a meter for where the value sits in its range, the value in real units, and the hex it is written as.

## Typing

Edit from the keyboard while the song plays. Left and Right move one character at a time, so you can change a single digit; Ctrl+Left and Ctrl+Right jump to the start of the next or previous column, and Ctrl+Shift+Left and Right to the next or previous lane. (Config, Editing, *Left and Right move by* can make them move by whole cells instead.) Typing a digit advances the cursor through the cell.

Space writes the live value of the parameter under the cursor into its cell and steps down; Ctrl+Space does it for every parameter column of the row. This is the quickest way to record a knob move: turn the knob until it sounds right, then press Space. (Chapter 1 again.)

## Selections and editing

Shift+arrows (or the mouse) select a block. Then:

| keys | what it does |
|---|---|
| Ctrl+C, Ctrl+X, Ctrl+V | copy, cut, paste with its top left at the cursor |
| Ctrl+D | copy the selection straight below itself, again and again by the same number of rows |
| Delete, `>` | clear the cells |
| Ctrl+Delete | delete the cells and pull the rows below up |
| Ctrl+Insert | push the rows down from the cursor |
| Ctrl+Alt+Up / Down | rotate the contents of the selected rows |
| Ctrl+I | interpolate between the filled cells |
| Ctrl+R | randomize menu: shuffle, scatter and so on; Alt+R rolls again |
| Ctrl+K | the next colour for the pattern under the cursor (Ctrl+Shift+K the previous) |
| Alt+T | tint each pattern in its own colour |

Rows never cross into the next pattern: a selection over several patterns is handled one pattern at a time.

### Interpolation

Ctrl+I works column by column: the first and last filled cells in the selection are the ends, and the filled cells between them get values by row position (notes by semitone). The popup picks a shape (linear, ease in or out, s-curve, exponential, steps), bends it, adds a wave, and lets you paint your own curve. **bezier** turns the shape into a spline you can drag: square anchors, round handles. Double-click the curve to add an anchor.

## Playing notes from a MIDI keyboard

In Config, MIDI (Chrome, Edge and Brave): the keyboard plays the machine under the cursor on every screen. In the pattern editor a note, or a chord struck within the chord window, goes into the note columns from the cursor; the chord is written lowest note first however you struck the keys.

## Scripts

The **Script** tab (Ctrl+Alt+S) holds one script per project. A script fills pattern data; its changes are applied only if it finishes without an error, as one undo step. For example `tbin('x... x.x. x...', 'C-3')` writes a rhythm: `x` is a hit, `.` a rest, `?` a hit half of the time. Rests leave the cell alone, so a kick and a hat can share a column. `euclid(5, 16)`, `scale('minor', 'A', 2)` and `ramp(a, b)` are among the helpers. Ctrl+Enter runs the selected code, or all of it.
