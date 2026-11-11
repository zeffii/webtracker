# 5. The song

The Song screen (F1) lays patterns out in time. Each lane is a column, time runs down, and a pattern is placed as a block of 16-tick rows.

## Placing patterns

Place, clone, slice, resize, move and remove patterns with the mouse or the keyboard. Undo and redo work as everywhere. Patterns have colours, and Alt+T in the pattern editor tints the grid with them, so you can see where one pattern ends and the next begins.

- **Ctrl+G** gives the placement under the cursor its own copy of its pattern, in a new colour, so you can change that one without changing the others.
- **Ctrl+Enter** (or Alt+Enter in the pattern editor) opens one pattern on its own, *solo-edit*: edits and pastes cannot reach anything else. Alt+Enter or Esc leaves it. **Tab** flips between the one pattern (rows counted from 0) and the whole song with the rest greyed out.

## Loops and markers

Ctrl+B and Ctrl+E set the loop start and end. A note-off marker (Ctrl+1) tells the lane to let go of its notes at that row. You can mute a lane from a row onward, or silence it whole.

## Blocks

Select a block of lanes and rows (Shift+arrows or drag), then copy, cut and paste it, or press Ctrl+D to copy it straight below itself.

**G** merges the block: every lane in it gets one new pattern made of what plays inside, cut at the block's edges, so nothing overlaps. One undo step.

**Insert silence** (under the grid): type a tick count, or press 16, 32 and so on up to 512, to push everything from the cursor row down. The song grows and the loop follows.

## Following

**F9** makes the grids scroll with the playing row. Move the cursor to another row and the following pauses, so you can edit elsewhere while the song plays.

## Solo and mute

**Alt+S** solos the lane under the cursor: the other lanes let go of their notes, which ring out naturally, and play nothing. Alt+S again, or soloing another lane, changes it. Solo is not saved with the song.

## Under the grid

Rename, reorder, duplicate or remove the lane under the cursor (optionally with its instrument), and add a lane for any instrument.
