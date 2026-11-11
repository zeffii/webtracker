# 10. Rules of thumb

Short things that are usually true. They come from using the machine; add your own in the margin.

## Sound

- **Listen first, read second.** If you are looking at a number to decide how something sounds, stop and listen. (Chapter 1.)
- **Check a widened mix in mono.** Anything that widens the stereo image (the spectral panner, chorus) can thin out when it is summed. Sum it to mono and listen; if it is still good, it is good.
- **Noise has colours.** The `tilt` of a noise source is in dB per octave: -6 is brown, -3 pink, 0 white, +3 blue, +6 violet. Pick by ear.
- **Gentle wins.** If the effect is obvious on the first listen, it is probably too much by the tenth.

## Rhythm

- **Cut patterns where the notes start**, and reuse them. Several short patterns placed many times beat one long pattern per lane.
- **Vary the timing a little.** Some events earlier than expected, some later, one or two much later. A machine that is exactly on the grid sounds like a machine.
- **Let a kick and a hat share a column.** In a script a rest leaves the cell alone, so layered rhythms do not erase each other.

## Processor

- **An LFO does not need to run every sample.** Set its *steps* to 8 to 24 per tick: it sounds the same and costs far less.
- **Do not polish what you cannot hear.** If switching a node off changes nothing you can hear, delete it.
- **Watch the footer.** The load line (average, worst block, late blocks) is the early warning. Ctrl+Alt+E shows which lane is the expensive one.

## Working

- **Edit while it plays.** Changes are heard on the next tick. The song is the best instrument for trying things.
- **Record a knob move with Space.** Turn until it sounds right, press Space.
- **Save under a new name before something big.** The file is small, so keep versions.
