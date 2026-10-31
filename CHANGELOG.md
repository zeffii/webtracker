# webtracker changelog

Full history, newest first. The About page shows only the latest 10 builds.

## 574 · 2026-10-31

- **New Node Sequencer nodes.** **Pattern** is a row of cells like a small pattern editor: each event steps one cell, a number is sent on, a dot is a rest (the rest port fires instead). Click a cell to change it (a dot, then 0 up to "max", then a dot again; Shift goes backwards), or write the list in the panel. **switch** sends an event out of one of four outputs (by a number at pick, or by the event's own value); **pick** lets one of four inputs through; **gate** is and / or / a-unless-b of two event streams; **counter** counts and wraps (and fires wrap); **compare** sends yes or no by a test against x; **flip** alternates between two outputs; **once** passes only the nth event; **ratchet** repeats an event; **latch** remembers a number and sends it again when asked; **drunk** is a random walk. (A merge node is not needed: any number of event wires can go into one input.)
- **A new demo made of nodes:** open it with ?demo=interstellar-nodes. A pattern of chord numbers moves a Phrase for the pad, sub and wind; a pattern of section numbers brings in the stab, arp, stars, wood, ping and dust through pick nodes; the Shepard glide is a bar counter into a ramp; swells and drops are patterns; the arp and stab ask a latch for the chord that is sounding.
- A wire between two ports that are less than 30 pixels apart across is a straight line.
- A project opened while the Node Sequencer is hidden is fitted to the window when it first shows (it came up tiny before).

## 573 · 2026-10-31

- **The Node Sequencer is drawn as a line drawing, and runs from the top down.** Inputs are along the top of a node and outputs along the bottom; wires run vertically. A node is a thin box with its word in it and its value after it ("EVERY ÷4", "NOTE pad"), as wide as its words; the nodes that draw something (steps, euclid, lfo, Voicing, Chord) keep a title band with a dashed line under it. Outlines, corner squares and wires are drawn dim until something happens on them. Ports are smaller outlines whose shape says the kind: square event, circle control, diamond chord, triangle weights.
- Projects from before are turned a quarter once when they open (what ran left to right now runs down); wires you had bent find their own way again.
- An empty Node Sequencer says what to do in a readable page over the canvas, which goes as soon as there is a node.
- The Node Sequencer's rail icon is a tree of boxes now, so it no longer looks like the Instruments icon.

## 572 · 2026-10-31

- **Chord tiles have a keyboard.** Rest the pointer on a Chord tile (nearly still, for half a second: Config, Editing, "Chord keyboard opens after...", 0 for at once) and a three-octave keyboard grows over it. Click a key to add or take away that note, drag across keys to paint, drag the bar under a lit key for its volume, the arrows or the wheel move the octaves, Esc or moving away closes it. The tile's text becomes the plain note list; if the notes make a chord the tile names it ("A min7"), and notes that are not part of it follow in the accent colour (also on the keys). Notes added past the node's notes setting raise that setting (up to 8). New in `nodeseq/chordkeys.js`; the naming and editing are in `chordtext.js`.
- The Chord tile's label now shows the chord the notes make (and the stray notes) instead of the typed text cut short.

## 571 · 2026-10-31

- The CPU readout (average, peak, late) is cleared each time Play starts, so it only describes the run you are listening to.

## 570 · 2026-10-31

- A **latency?** button on the status bar switches latency compensation on and off (the same setting as Config, Playing, Delay compensation). Its tooltip explains what it does.

## 569 · 2026-10-31

- The CPU meter ignores the first second after Play. Starting a song builds voices and fills buffers, which showed up as a false peak and late blocks.

## 568 · 2026-10-31

- Arrangement: pattern boxes no longer get thicker outlines in places. The lane columns were 14 characters wide, which is a fractional number of pixels, so box edges landed between pixels and snapped unevenly. Column, header and tick-number widths are now whole device pixels (measured again when the font or the screen's pixel ratio changes), and the lane names in the header sit in boxes of the same width so they stay above their cells.

## 567 · 2026-10-31

- The top bar is simpler: the Open button is now a **File** menu with Open, New, and New From Existing (Clear Arrangement, Clear Patterns and Arrangement), then Save, Export and Backups. The Save, Export, Backups and New buttons are gone from the bar; the project name stays. Arrow keys, Enter and Esc work in the menu, and the submenu opens when the pointer rests on it. The menu is in `ui/filemenu.js`.

## 566 · 2026-10-31

- New shader template, **Holey torus**: a ray-marched thin-walled ring with staggered rows of round holes, tumbling on two axes; the tube has a half turn round the ring and a wave of twist travels round it, so the rows of holes writhe. It glows on lane hits and keeps to C1/C2. Three numbers to expose: `twist`, `holes` (size) and `speed`. A ray-marcher, so one of the heavier templates.

## 565 · 2026-10-31

- New effect, **Pogue** (Effects, Modulation): a grubby multi-voice chorus. Up to eight voices read the sound back at delays that wander between `mindelay` and `maxdelay`, each at its own speed up to `rate`; `change` blends their smooth sines towards random targets, `resolution` is how many times a second they move (low values step) and `inertia` how slowly they glide. The wet sound goes through a high-pass and a low-pass (each with Q), `saturation` and `degrade` (bit depth, with `dither` as error feedback and `errormix` blending towards the rounding error), and is fed back to its own side (`feedback`) and the other (`xfeedback`). Stereo is mono, wide (each side its own voices) or spread (voices panned across); interpolation is none, linear or cubic; `pregain` and `postgain` in dB. About the cost of the plain chorus at its defaults.

## 564 · 2026-10-31

- New machine **Clang**: struck metal. The body rings through 28 resonances; `shape` morphs from a thin round plate (cymbal, ride: bright, uneven, long) to a large hollow barrel (low, dull, boomy). `damping` is the damping ratio of the ring, `highdamp` how much faster the highs die, `thump` a falling-pitch body push with a little saturation, `strike` the beater (soft mallet to hard stick), `position` where it is hit, `stretch` bell-like or pipe-like spacing, `wash` the cymbal sizzle, `width` stereo spread. Note off damps it like a hand on a cymbal. Instruments menu: Clang; node menu: Synths.

## 563 · 2026-10-31

- **SunVox import.** Open a `.sunvox` file (Open, like a MOD) and its notes and arrangement replace the project: each module that plays notes gets a lane on a plain synth named after it, each SunVox pattern becomes a pattern on the lanes it plays, and every placement, clones included, sits where it was on the SunVox timeline. Tracks a module plays on become its note columns (up to eight); velocity comes across, a note off with no module stops whatever its track last played, and effects and controllers are left out. One SunVox line is one tick; at speed 6 that is four to the beat at the same BPM, and a speed that does not divide 24 keeps the tempo through the BPM instead. The parser is `src/project/sunvox.js`.

## 562 · 2026-10-30

- Shift + mouse wheel in the pattern editor moves one row per notch.

## 561 · 2026-10-30

- The pattern editor now runs down to the top of the status bar: it measures again until no more rows fit, refits when the font size changes (rows were left over after a smaller font), and the spare margin and page padding under it are gone.
- Scrolling the pattern editor is lighter: rows that did not change are remembered by tick, rows that only moved are moved in the page instead of rewritten, and a wheel notch now moves about an eighth of the rows shown (at least four) instead of always four.

## 560 · 2026-10-30

- Stream Manager columns no longer jump: the table has fixed column widths, and the voice count and load percent sit in right-aligned fixed-width numerals, so a longer string or an extra digit stays inside its own column.

## 559 · 2026-10-30

- **Delay compensation moves the playhead.** With the setting on, the position every view shows (the pattern and arrangement playheads, the visuals, recording) is where the sound is, not where the song is: it is the `chain` time behind the sequencer. Recording needs no extra offset as a result.
- Fix: Snarl could keep sounding when a note on and its note off arrived in the same audio block, and a late note off for an older note could stop a newer note. Both are fixed, and every envelope now lets go whenever the key is up.

## 558 · 2026-10-30

- **Delay compensation, stage 3: between instruments.** With the setting on, each machine's total delay is known and the quicker machines are delayed to match the slowest before they are mixed, so a drum machine with no delay stays on the beat with a pad that has a spectral effect. The whole mix then comes out as late as the `chain` figure in the status bar (live playing and the sound of the first beat come that much later too); recorded notes take it into account, and an export trims it off the start, so the file lines up with the beat. The one **Delay compensation** setting (Settings, Playing) switches all of it, inside machines and between them, off entirely.
- (The playhead followed in 559.)

## 557 · 2026-10-30

- **Delay compensation, stage 2: inside an instrument.** Where audio paths of different delay meet at a node (a dry sound and a spectral or oversampled branch going into a mixer, say), the quicker ones are delayed by whole samples to match the slowest, so everything arrives together. The delay is a hidden node the compiler inserts (`compdelay`), recomputed whenever the machine is loaded, so changing a node's `size` or `quality` is followed. New setting **Delay compensation** (Settings, Playing; on by default) switches it; with it off a machine is compiled as before. Next stage: lining the instruments up with each other.

## 556 · 2026-10-30

- **Delay compensation, stage 1: nodes say how late they are.** Spectral nodes (blur, harmonic/percussive split, spectral dynamics, cross synthesis, Body blur) declare one frame (1023 to 4095 samples, by `size`); the oversampled ones (saturator, multiband saturator, distortion, waveshaper, amp) declare the delay of their oversampling filters by quality. A graph's delay is the longest audio path to its output (`src/audio/latency.js`). The status bar now shows `chain N ms`: how late the slowest instrument's sound comes out, when it is 1 ms or more. Nothing is delayed yet: the next stages line up the branches inside an instrument and the instruments with each other, behind one general toggle.

## 555 · 2026-10-30

- New synth, **Snarl** (Synths, and in the new instrument list): a monophonic, semi-modular style voice built round **two resonant filters in a row**, a high-pass then a low-pass, each with its own cutoff and peak. With both peaks up and the cutoffs close together the peaks meet and it screams; `edge` drives the second filter harder so it bites. Oscillator 1 is saw, triangle, pulse or noise; oscillator 2 is saw, square, pulse or **ring** (multiplied with oscillator 1, for bells and clangs); plus a noise generator. Envelope 1 (delay, attack, release) moves the pitch and both cutoffs; envelope 2 (attack, hold, decay, sustain, release) is the amplifier; a modulation generator (triangle, saw, ramp, square, random) moves pitch, both cutoffs and level. Portamento, key tracking and velocity. Polyphonic through the voices node (it starts with one voice).

## 554 · 2026-10-30

- New synth, **Jaw harp** (Synths, and in the new instrument list as "Jaw harp"): a plucked steel reed drones at the note's pitch and the mouth, three resonances at the formants of a vowel, picks out its harmonics. `vowel` sweeps u, o, a, e, i (the wah, and the tune); `mouth` makes the cavity bigger or smaller; `track` makes the vowel follow the note; `focus` is how sharply it picks harmonics. `drive` narrows the puff of air for each swing of the reed (more harmonics), `twang` is the pluck (a sharp start and a slap), `breath` adds noise, `body` lets some of the plain reed through, `decay`/`release` are the reed's ring and damping. Polyphonic through the voices node; vowel, mouth, focus and drive are exposed as the instrument's first four knobs, and the vowel and the rest answer pattern commands.

## 553 · 2026-10-30

- New effect, **Body blur** (Effects, Spectral): smooths the body of a sound and leaves its hits alone. Each frame is split into held tones and attacks (as the harmonic/percussive split does); the tones are blurred across frequency (`smooth`), followed by a running average (`time`) and given a gentle high cut (`round`), while the attacks pass straight through in time. A crushed pad turns silky and the snare keeps its snap. `split` sets how firmly body and hits are told apart, `quality` (standard or eco) works the split out every other frame for about half the CPU, `size` is the frame length, `mix` is dry against smoothed.
- The harmonic/percussive split and Body blur now share their body/hit detection (`src/audio/hpmask.js`); the split sounds the same as before.

## 552 · 2026-10-30

- New demo, `?demo=weights` ("weights of a chord", your version): four Chord nodes into a Phrase node whose index is stepped by a sequence of bar numbers from a euclid pulse, a tilt sweep from an lfo, and the pad's cutoff and resonance moved by two more lfos.

## 551 · 2026-10-30

- Node Sequencer: the **scroll wheel zooms** about the pointer (it scrolled before, and zoomed only with Ctrl); holding the middle button pans.
- Fix: switching theme repaints the Node Sequencer at once, instead of only after the pointer moved into it.

## 550 · 2026-10-30

- Node Sequencer: tile borders are the theme's accent colour, almost see-through (a node that is selected, playing or just got an event is drawn solid).
- Fix: tiles now hide wires that run behind them (the fill used the canvas's own see-through background; it now uses the page colour).

## 549 · 2026-10-30

- Node Sequencer: colour returns, quietly. Wires are a deep tint of their kind (amber events, teal controls, violet chords, olive weights), close to the ink, and ports are rings in the same colour. Dashes and port shapes stay, so kinds can still be told apart without colour. Note volume bars, weight bars and step cells take the same tints.
- Fix: the editor could pick the dark palette on a light page.

## 548 · 2026-10-30

- Node Sequencer: **drag a wire's straight stretches away from tiles**. Rest the pointer on a wire and a pair of arrows appears in the middle of the stretch nearest to it; press near the arrows and drag to slide that stretch sideways (snaps to the grid). A wire that runs backwards has three stretches to move. Double-click the arrows to let the wire find its own way again. Positions are saved with the project and kept when nodes are duplicated.

## 547 · 2026-10-30

- Node Sequencer: a new **schematic look**. Nodes are outlined boxes, everything is drawn in one ink colour, and wires run in right angles with rounded corners. Wire kinds are told apart by their dashes (solid events, dotted controls, long dashes chords, dots weights). The playing chord gets a heavy outline.
- The Chord tile is wider and holds its keyboard inside the body, with the chord name on top.
- Fix: in build 546 wires were not drawn at all (a stray comment swallowed the stroke call). They are drawn again.

## 546 · 2026-10-30

- Node Sequencer: **route points**, a dot that passes on what comes in (one for events, controls, chords and weights), for bending a wire around other nodes. Double-click a wire to put one on it, or drop a wire on empty space and pick "route". Drag from the middle of a dot to wire out of it; drag its rim to move it.
- Wires can be **switched off** without deleting them: Alt+click a wire, or select it and press M, or right-click it. A wire that is off is grey and dashed and carries nothing (a chord wire that is off drops that chord from its Phrase node).
- The keyboard under a Chord node now follows the volumes as they are while playing: tilt, level and a Voicing node moving show in the bars as they happen.
- **Phrase** has a `length` input and a length knob: how many ticks its chords last. A number arriving at `length` stays in force until the next one (a Pseq of lengths gives every chord its own). The Chord node has the same knob. Events can now carry a length for the note they play, which the note node uses unless its own length is wired.
- The lights that run along wires after an event were drawn on the wrong wire when control wires came before event wires in the graph; fixed.

## 545 · 2026-10-30

- Node Sequencer: nodes are now small tiles. A glyph and one short value (the chord, the instrument, the parameter, the division) replace the header, the port names and the parameter lines; the group colour is the stripe on the left edge, and the parameters are in the panel as before. Ports are dots spread along the edges (events square, controls round, chords diamond, weights triangle), and resting the pointer on one shows its name and kind; on a node, its type and id. Steps, euclid, lfo and Voicing draw their own picture in the tile; a Chord node keeps its keyboard under it. A patch takes about a tenth of the room it did.
- Existing graphs are moved closer together once, the first time they are loaded (the graph records this as `ui: 2`).

## 544 · 2026-10-30

- Node Sequencer: three new nodes in a Chords group. A **Chord** node holds one chord, written as a name (`A min7`) or as notes (`A2 C3 E3 G3`, each with an optional volume: `A2@100 C3@60`), and has a volume for every note (drag the bars in its panel), plus level, variation (a random nudge to every note each time) and tilt (bass-heavy to top-heavy) as knobs or as control inputs. It draws two octaves of keyboard under it with the notes lit and a bar under each for its volume. A **Phrase** node plays the chord whose number arrives at its index port (it wraps round); a new chord port appears as you wire chords in, and the chord being played lights up, with the wire into it. A **Voicing** node is a row of note volumes (lowest note first) that can feed the weights port of any number of Chord nodes.
- Two new wire kinds: chords (violet diamonds) and weights (green triangles). They are pulled by the node they go into, so a chord can feed a Phrase node without an event.
- New demo, `?demo=voicing` ("weights of a chord"): four Chord nodes into a Phrase node, a tilt sweep from an lfo, bass from the chord root, and the group B arpeggio.

## 543 · 2026-10-30

- New demo, `?demo=nodes` ("chords in the nodes"): a sixteen-bar song for the Node Sequencer. Pchord lists drive a rolled pad (poly note), a bass that echoes its root through delay and chance nodes, and an arpeggio in group B that a run node starts at bar four; an lfo sweeps the pad filter and an ad envelope plucks the arpeggio filter. Kick and hats are ordinary pattern lanes.

## 542 · 2026-10-30

- Node Sequencer: a **Pchord** node (Values) steps through a list of chords, one name a line, written as in the Chord machine ("C maj7", "F# 13sus", "E min9(11)"; a dot is a rest). Each event sends every note of the chord out of `note` (and the root out of `root`). Parameters: octave, inversion, notes (most notes kept), strum (subticks between notes) and direction (up, down, alternate). Names it cannot read are listed in red.
- The `note` node has a new **poly** setting (default mono, as before): the notes of a chord then sound together and each ends on its own.

## 541 · 2026-10-30

- Two saturators (Effects, Distortion in the node menu), sharing one curve stage (`audio/nodes/saturation.js`). The curve is chosen by `type`: soft (tanh), tape (a gentler arctangent), tube (lopsided, so it adds even harmonics) or clip (a cubic soft clip). `drive` is in dB and the level is kept about the same, so you hear what the curve does and not only that it is louder; `bias` leans on the curve for even harmonics; `mix` and `out` as usual.
- **Saturator** (`saturator`): one curve for the whole sound, with `bass` (everything below it stays out of the curve, so a kick or bass stays clean; 20 Hz is off) and `tone` (a lowpass after the curve).
- **Multiband saturator** (`mbsat`): the sound is split in four bands at three crossovers (the same phase-aligned split as `split` and `mbcomp`), and each band has its own drive and gain, so the lows can be warmed gently while the highs get a bite. `solo` hears one band.
- Both have a `quality` switch: standard runs the curve at 2x oversampling, eco at 1x, hq at 4x. In a quick offline timing the saturator costs about 0.4%, 4% and 9% of real time and the multiband one about 3%, 16% and 39% (eco, standard, hq), so eco is the way to save CPU in a busy song.
- Tests check the harmonics each curve makes, that the loudness stays about level as drive goes up, that bass keeps a low tone out of the curve, that mix 0 is the dry sound, and that the multiband bands solo and take their own drive.

## 540 · 2026-10-30

- Cardinal: a new `quality` choice, standard or eco. Standard is the sound exactly as it was (it is the default, so no song changes). Eco works out the slow pitch, fm and pulse-width moves every 8 samples instead of every sample, which saves two powers a sample for every voice: in a nine-voice lead from a real song its cost fell by about a fifth, and the output differs from standard by about -56 dB. No HQ mode yet. A test checks that standard is bit for bit the default and that eco stays close to it.

## 539 · 2026-10-30

- Drum synth: the click is a short burst of noise, and its first sample started at full level, so every hit began with a small step that was different each time (a tick that seemed to come and go at random, and that the picture of the sound hides). The click now fades in over about 0.15 ms. In an offline render of a hollow kick, hit onsets with a step that stood out of the waveform went from about half of them to almost none.
- Looked at, not changed: a song with a nine-voice Cardinal lead spends about three quarters of its audio time in that one node, which leaves little room when the screen is busy (the Stream Manager shows each instrument's cost). Cardinal itself is untouched.

## 538 · 2026-10-30

- Pattern editor: the playhead (line or band) and the loop lines were placed from a calculated row height and top edge; they are now placed from the rows themselves (each row is an element, and the line goes to its offsetTop). Reported as a playline stuck at the top of the grid while playing with the loop on, which could not be reproduced here; a row height measured at the wrong moment (or off by the font, the browser zoom or the screen's pixel ratio) is the likely cause, and this no longer depends on one. The playhead does not depend on Follow: with Follow off the grid stays still and the line travels down it. The arrangement already worked this way.

## 537 · 2026-10-30

- Three new spectral effects (Effects, Spectral in the node menu), all working in overlapping FFT frames of 1024, 2048 or 4096 samples, so each adds one frame of delay (the dry sound of `mix` is delayed to match). They share a small frame helper, `audio/nodes/stft.js`.
- **Harmonic / percussive split** (`hpss`): one input, two outputs. `harm` gets the held tones, `perc` gets the hits. A median along time keeps the horizontal lines of the spectrum, a median along frequency keeps the vertical stripes, and the two decide, bin by bin, where each part of the sound goes; the masks add up to one, so both outputs wired together give the sound back. `length` (ms) is how long a tone must last, `width` (Hz) how broad a hit must be, `sharp` how hard the two are told apart.
- **Spectral compressor / tilt** (`specdyn`): a compressor for every frequency bin. Threshold, ratio, attack and release per bin, smoothed across neighbouring bins so it does not whistle, make-up gain, and `tilt` in dB per octave about 1 kHz to lean the whole spectrum brighter or darker.
- **Cross synthesis** (`xsynth`): the broad spectral shape of the `mod` input is laid over the sound at `in`, which keeps its own phases. `amount`, `smooth` (how broad a shape) and `detail` (also lend the modulator's harmonics).
- Tests: the split's outputs add up to the input, a tone goes to `harm` and clicks to `perc`; spectral dynamics at ratio 1 is the sound, a loud bin is pressed, a 6 dB tilt makes two octaves four times louder; noise takes a sine's colour, a silent modulator gives silence, amount 0 is the carrier.

## 536 · 2026-10-30

- Equaliser: the response picture beside the node is now something to grab. Drag a band's dot sideways for its frequency and up or down for its gain (the gain allows for the other bands, so the dot stays under the mouse); turn the wheel over a dot to widen or narrow it (Q); drag the small triangles at the top edge for the low and high cut. The parameter panel follows as you drag.
- Renaming an instrument (Ctrl+F2) or a lane no longer stops the song: it reloads and carries straight on from the row it was on. (Copy, move, remove and import still stop it.)

## 535 · 2026-10-30

- First screen: the lava metaballs are centred. The shader kept the camera and screen-centre offsets tuned for the square live picture (a nudge right and up); the splash copy now looks straight down the middle, so the blob mass sits under the WAX logo. The live picture is unchanged.

## 534 · 2026-10-30

- Pattern editor: the undo trail (the last five things done, newest a bright chevron, a "waypoint set" note) now shows in the row above the status bar in the pattern editor too, in the empty space under the grid, as the arrangement already did. Both views share one undo stack, so it is the same row; it was only the arrangement that drew it. The drawing moved into its own small file (seq/undotrail.js).

## 533 · 2026-10-30

- Script: progressions circle back. `progression(...)` now ends, by default, on a chord that leads back into the first one (`end: 'loop'`), so when it plays again the home chord does not sound twice; `end: 'home'` keeps the old full stop on the home chord. New `nextChord(list, length, key, mode, opts)` gives the next chord of a progression of your own, steered so that the length you choose comes round, and `leadsHome(name, key, mode)` says whether a chord leads back to the home chord. It is the same walk as `progression`, tried again until its end is right, so it still sounds like the style rather than being forced.
- Chord lab: Suggest next uses it, chord by chord, from the chords you have already clicked, and starts again once the length is reached. When the last chord leads back to the first, the wheel draws a dashed return arrow and the strip ends with ↺ and the first chord. Major and Minor now switch between a key and its relative minor (the same notes), so C and Am, rather than moving round the wheel.
- The ?demo=progression song's second half is regenerated with it: it ends on Dm7, which leads back into Am7 where the song starts.

## 532 · 2026-10-29

- First screen: the metaball backdrop now uses the same shader as the live picture (531): the orange to red background, five balls with the wider blend and the tuned lighting. There is no song on the first screen, so a click swells the balls a little, nothing is held, and the pointer still pulls the first ball. This replaces the pink and green version of 530.

## 531 · 2026-10-29

- Live picture: the built-in shader is now the lava lamp version: an orange to red background, five metaballs (one for each of the first five lanes) in a hot orange-red, bigger swells on a hit (a hit grows its ball a lot more), pitch lifting a ball further, a wider blend between them, and a slightly shifted camera. Pictures that use their own shader are untouched.

## 530 · 2026-10-29

- First screen: the metaball backdrop sits in a lava lamp's room. The background fades from light pink at the top, through a pale warm white, to light green at the bottom, with a soft glow where each lamp bulb would be. The blobs are lit by them: near the top they turn pink, near the bottom green (more the closer to the edge), and in the middle they keep their teal. Their shading and glowing thin necks are unchanged.

## 529 · 2026-10-29

- Drum synth: no more clicks when a hit lands on a voice that is still ringing (a long decay, or a sustain above 0, with a hit before the last one has died away). The sine restarts at phase 0 on every hit, so the output jumped from wherever the old tone was to zero, by an amount that depended on where in its cycle the old tone happened to be; that is the click that came and went. The old output now carries on into the new hit and fades in about 1.5 ms, so the step is no bigger than a fresh hit's own start.

## 528 · 2026-10-29

- Script: chords and progressions. `chord('Am7')` and `chords('Am7 Fmaj7 C G')` give chords for `tbin`, one per hit (names as the Chord node reads them; options `octave`, `inversion`, `spread` close/open/drop2, `max`, and `lead: true` to turn each chord to the inversion that moves the fewest notes from the one before; a smaller chord switches the spare note columns off). `prog('I vi IV V', 'C', 'major')` turns roman numerals into chord names (any mode, sevenths, `bVII`, `vii°`, `V7/ii`). The circle of fifths: `fifths`, `cycle`, `relative`, `parallel`, `triads`, `neighbours`, `dom`, `tritone`, `pivot`. `progression(8, 'A', 'minor', { style, sevenths, spice, seed })` suggests chords by likely moves (styles pop, jazz, techno) and bends to end back on the home chord.
- Script tab: chords(...) calls written with plain text get a preview under the editor (the chord names and the notes they play, or the reason a name is wrong). The tutorial has a Chords section with a chord lab: the circle of fifths as a clickable wheel, a strip for the progression, Suggest next (a progression that comes home), smooth voicing, sevenths, and a button that puts the tbin line in the try-a-line box.
- New demo: ?demo=progression, "round the circle": a pad, bass and arpeggio written with these helpers (the script is in the Script tab), eight bars down the circle of fifths in A minor and eight bars of a suggested progression.

## 527 · 2026-10-29

- Arrangement: the pattern name label shows only while Shift is held. Hover a pattern, hold Shift, and its name appears on the dark label; let go and it disappears. With the mouse outside the view, Shift shows the caret pattern's name. Shift on its own does nothing else in the view (modifier-only presses are ignored and keep the selection), so Shift+arrows, Shift+click and the other shortcuts work as before; the label just shows while Shift is down.

## 526 · 2026-10-29

- Arrangement: the pattern name label belongs to whichever of the mouse and the caret moved last. Moving the mouse over the edge of a pattern, or between patterns, no longer makes the label of the highlighted (caret) pattern pop up; the mouse leaving the view hides the label, and moving the caret (keys, click) shows its pattern's name.

## 525 · 2026-10-29

- Arrangement: the pattern name chip (523, 524) is gone again, and pattern names are off by default: a pattern's cell shows its two-digit number, in the left four characters that the minimap leaves clear. The name of the pattern under the mouse, or under the caret when the mouse is elsewhere, shows on a dark label at regular size at the top of that pattern. H (or "Sequence editor: show pattern names" in Config) puts every name in the cells; the statusbar always gives the name.

## 524 · 2026-10-29

- Arrangement: the pattern name chip is easier to read: 11 px regular instead of 9 px bold (small bold text blurred on Windows), white on near-black, a little taller. It covers a bit more of the minimap behind it.

## 523 · 2026-10-29

- Arrangement: a pattern's number and name sit on a small dark chip in a small bold font (as wide as the name), so the minimap behind it no longer clutters them.

## 522 · 2026-10-29

- Arrangement minimaps: the first four characters of every pattern cell are left alone (the pattern's number and name are written there), and the picture uses the space from there to the right edge: notes, note lengths, caps and the parameter strip are all scaled into it, so even a lane with dozens of parameter columns stays inside its pattern. A cell with less than one character left shows no picture.

## 521 · 2026-10-29

- New demo, open it with `?demo=acid`: "acid rain", eight bars (128 ticks) of acid techno at 138 bpm. One meta machine plays five machines (kick, hat, clap, a 303-style squelch and a comb-resonator metal), with a spacer carrying the machine's name between the groups of columns. The drums start alone, the squelch line comes in at bar 3 with accents and slides and its filter opens up through the song, claps and metal join at bar 5, and a hat and clap roll closes the loop.

## 520 · 2026-10-29

- Arrangement minimaps of a meta machine's lane: the parameter strip no longer runs out of the pattern's cell (with 29 parameter columns it drew past the right edge, over the next lane); it squeezes all columns inside. Relative notes are drawn as notes (80 is the root, 00 a note off) and spacers are left out.

## 519 · 2026-10-29

- Meta machine, third build: spacer columns. "+ Spacer" at the top of the Selections editor adds a gap between groups of columns; it is drawn as a thin rule in the pattern editor and the cursor skips it. Give it a header and the name is written over it, naming the group that follows. It is a column like the others in the list (move, duplicate, remove; "ticking adds after the selected column" puts it where you want).
- A machine that a meta machine plays for the first time loses its lane if that lane is empty, so the bound machines do not take up room in the arrangement. A lane that holds patterns stays (remove it by hand if you want it gone).

## 518 · 2026-10-29

- Meta machine, second build: the Selections editor. Select a meta machine on the Instruments screen and it stands where the graph would. On the left the other instruments of the song, unfold one to see what it offers (note, note relative to a root, velocity, triggers, exposed parameters) and tick a thing to add a column for it; untick to remove it. On the right the columns in order, with a header of your own, the kind of a note (as it is, or relative; switching clears that column's cells), the width of a parameter, and the root of a relative note (80 is the root), and ◀ ▶ Remove Duplicate (two columns may drive one parameter). Removing a column that holds data asks first. A new column is empty in every existing pattern and nothing moves.
- In the pattern editor 00 in a relative note column is drawn in the accent colour (a note off), the status line says which column of a meta lane the cursor is in ("grid · col 3 t1") with its full name, and a relative note reads as the note it plays ("81 = C#4"). Renaming an instrument keeps the meta machine playing it; removing one takes its columns away.

## 517 · 2026-10-29

- The `?demo=concrete` techno is now played by one meta machine: a single "grid" lane whose 29 columns proxy the kick, hat, clap, metal and tom (their notes, velocities, hits and parameters), and the five machines have no lanes of their own. The metal and the tom are 2hex notes relative to a root (E-5 and C-3, 80 is the root). The patterns are four rows long and placed where the music goes. (The first version's hat tone sweep at tick 51 was lost to two overlapping patterns; it now plays.)

## 516 · 2026-10-29

- New demo, open it with `?demo=concrete`: four bars (64 ticks) of techno at 134 bpm from five percussion machines, a kick, a hi-hat, a clap, a comb-resonator metal percussion and a tuned tom. Each pattern holds only one hit or a few rows and is placed again and again, some early, some late; the sound moves through parameter cells on every machine.

## 515 · 2026-10-29

- Meta machine, first build (the engine; its editor comes next): a new instrument kind, "Meta machine (plays other instruments)", whose pattern columns are proxies of other instruments. A column can play an instrument's notes as they are, or as a 2hex cell relative to a root note (80 is the root, 81 a semitone above, 7F one below, 00 a note off), or carry its velocity, a trigger (the hat's Cl and Op) or any exposed parameter. Two columns may drive the same parameter. Headers are short and numbered per kind in column order: n1 n2 (notes), v1 (velocity), t1 (trigger), p1 p2 (parameters); a column can have a header of its own. Columns of a machine that has been removed are left out. There is no screen for choosing the columns yet.

## 514 · 2026-10-29

- Shader screen, Knobs list: the row you last used (dragged, ticked, reset, exposed) is shaded, with an accent bar on its left, and stays shaded until you use another row, also when the list is rebuilt after you edit the code.

## 513 · 2026-10-29

- Shader screen: two piano-roll shaders that show every lane at once, each lane in its own colour. "Roll, all lanes" is one roll, time left to right and pitch up, where notes of different lanes overlap and glow. "Roll, stacked" draws each lane as a see-through sheet, the sheets stacked in space one behind the other, so overlapping notes of several machines stay visible. Notes last until the next note or note off of their lane (at most the "note length" knob). Knobs: note length, octaves, centre, and for the stack the view angle (30 is isometric, 90 stacks them straight up) and spread. Turn off Pattern skeleton to hide the lane names drawn beside the picture.

## 512 · 2026-10-29

- Samples screen: "(whole sample)" now stands to the left of the Select row's hide button, so the slice list no longer runs into it.

## 511 · 2026-10-29

- Samples screen: the Record button is red again (with a dot, and a pulsing Stop while it records). The slot list is wider, so the × button has room.

## 510 · 2026-10-29

- Samples screen: the sample list is now a row of numbered slots, like Impulse Tracker's. A filled slot has ▶ (hold to hear it), Replace and × buttons; an empty slot is dimmed and has a Load… button (the files fill that slot and the next empty ones). The separate Load samples button is gone (L still works, and you can drop files on the screen).
- Replace puts a new audio file into the slot and keeps its name, level and pan, so every instrument that plays the sample follows (and is rebuilt when it goes between mono and stereo). The sample's loop points and slice markers are cleared, as they belonged to the old audio. The sample browser does the same with Shift+Enter.
- Record has its own tab, next to Browse, under the slots; the last tab used is remembered. The mouse wheel scrolls the slot list.

## 509 · 2026-10-29

- Samples screen: Load, Record and Browse now share one slate panel in the style of the sample editor above it: dim labels, flat tinted buttons, a `>` selection bar in the list, and a Name / Speed / Length / Size readout (exact frame count for WAV files) beside the waveform. Load and Record sit on one line. Same keys, playhead and resizable waveform as before; the waveform is drawn in the text colour.

## 508 · 2026-10-29

- Sample browser: a thin red playhead runs across the waveform while a sample plays. The waveform can be dragged bigger or smaller with the grip in its bottom-left corner (drag left and down to grow it; double-click the grip to reset); the size is remembered.

## 507 · 2026-10-29

- Sample browser: in browsers without the folder picker (Brave switches it off by default) Choose folder now opens the ordinary folder chooser and lists everything below it, subfolders included. It cannot remember the folder between visits; a small Choose files button is still there. To get the remembered folder in Brave, turn on brave://flags/#file-system-access-api.

## 506 · 2026-10-29

- Picture colours: the picture on the splash and the shader screen now has eleven palettes (Teal as before, Ember, Sunset, Rose, Gold, Lime, Forest, Aurora, Ice, Violet, Mono) and a Custom choice with two colour boxes, all in Config.
- Samples (F2): a Browse section. Choose a folder once (Chromium keeps it, with one Reopen click after a restart; other browsers get a multi-file chooser). Up and Down move and play each sample; Enter, or a double click, loads it as a new sample; Right opens a folder, Left or Backspace goes up, Space replays, Esc stops, letters jump to a name. A small waveform shows beside the file with its size, native sample rate, channels, bits and length.
- Browser: a file bigger than 10 MB (Config: Sample browser ask limit) is not read at all until you say so; Space or the Preview button plays it, Enter twice or the Load button loads it.

## 505 · 2026-10-29

- Shader screen: seven new light shaders in the template list (Ripples, Marble, Truchet, Sunburst, Moire, Lissajous, Waves). Most cost a tenth or less of the built-in metaballs.
- Shader screen: a guide under the editor (open it from the line below the status bar). What the shader is given, the look-ups, writing one in small steps, the rules of GLSL ES 1.00, the built-in functions, what things cost, what each template teaches, and where to read more. The whole examples have a "Try it in the editor" button (Ctrl+Z gets your own text back).

## 504 · 2026-10-29

- Shader screen: dragging a number slider (or typing) no longer makes the picture stutter. A changed shader is now compiled in the background (KHR_parallel_shader_compile, where the browser has it) and the old picture keeps running until the new one is ready; only one build is in flight at a time, so a slider cannot pile them up. A mistake in the text still falls back to the built-in picture, as before. Browsers without the extension build as they did.

## 503 · 2026-10-28

- Code node: tuple assignment, `a, b, c = x, y, z;`. All values on the right are worked out first, so `a, b = b, a;` swaps. A wrong count gives an error.

## 502 · 2026-10-28

- Code node (GenExpr): plays from notes. New read-only names freq (Hz), gate (1 while a key is held), vel, note and trig (1 for the first sample of a new note). In front of a Voices node every voice is its own copy of the code.
- Templates list above the code box: sine voice, detuned saw pad, FM bell, plucked string, kick drum, hi-hat, echo, bitcrusher, ring modulator, soft clipper. "The code I had before" undoes a template.
- New instrument kind Code: the code node (sine voice) into Voices, with four knobs exposed as columns.
- Fixed a compiler bug: sin, cos, tan, abs, min, max, round, floor, tanh and other math functions failed with an internal compiler error.
- Help page for the code node with the language, the note inputs, recipes and the limits.

## 501 · 2026-10-28

- Top row: the thin line under the value fields (len, bpm, swing, tpb, bar) is gone. A field that you are editing still shows a faint highlight.

## 500 · 2026-10-28

- New time readout at the right of the top row (after tpb and bar): the estimated length of the song at the current tempo, as minutes and seconds, from the song length in ticks, or from the loop when the loop is on (then it says loop). A tempo set in the master lane is not counted.

## 499 · 2026-10-28

- Sequence editor: the outlines of the patterns are 50 percent more transparent (their opacity went from 45 to 22 percent). Nothing else changes.

## 498 · 2026-10-28

- A sampler node added to any instrument (Basic, sampler) now has the cc button in its parameter panel, and Parameter view: hide command parameters hides its 70 or so repeat, retrigger, vibrato, jump and jitter parameters, as it does for a sampler instrument. They come back with the same button.

## 497 · 2026-10-28

- New Amp node (Effects, Distortion group): a valve guitar amplifier in one node. A preamp of 1 to 4 valve stages (gain, bias for the even harmonics, a bright lift), a tone stack with bass, mid and treble in three voicings (scooped, cutting, chiming), a power stage with master and sag (the supply gives under load), depth and presence, and a speaker cabinet (open 1x12, closed 2x12, stack 4x12, or none for use with a Convolver), then level and mix. The two distortion stages run at 1x, 2x or 4x oversampling. It has a help page (F1) and a glyph.

## 496 · 2026-10-28

- The bpm box in the top row is wide enough for five digits and the decimals (such as 128.25) while you edit it, and the tempo now follows every nudge, spinner step and typed digit at once instead of when you leave the box.

## 495 · 2026-10-28

- Pattern editor: Up on the first row and Down on the last row now stop there instead of jumping to the other end of the song. A new Config option, Up and Down wrap round the ends, brings the wrapping back.

## 494 · 2026-10-28

- Help (F1) page for the Chord node: how to use it, the full list of what can be typed in a chord name, how the notes are placed, the Chd, Oct and Str columns, how to put a Chord node into any instrument (for example one built on Cardinal), and its limits.

## 493 · 2026-10-28

- New demo song for the Chord node, chords (open it with ?demo=chords): 84 bpm, 24 bars. One Chord node holds your seventeen chords in slots 00 to 10; every chord row is a single trigger note plus the Chd, Oct and Str columns. A bass comes in at bar 4 and the drums at bar 8, and the last eight bars move down an octave.

## 492 · 2026-10-28

- New Chord node and instrument kind (Chords). Type chord names into 256 hex slots (00 to FF), such as F# 13sus, Eb 9sus4, E min9(11), G Major 7th, Db 7#9(no5), Db 7(#9#5), Cm7/Bb, plus the classical symbols for major, diminished and half-diminished, bass notes after a slash, sus, add, altered and left-out notes. The Chd column picks the slot a note plays (an empty slot plays the note as it is) and the one-digit Oct column sets the octave of the root. Also inversion, a limit on the number of notes, a strum in ms from the lowest or highest note, and a follow switch that moves the chord with the note. The editor lists every slot in pages of 16 with the notes it makes (bad names are marked) and a reference of what can be typed.

## 491 · 2026-10-28

- The New menu item that cleared everything is now called New file.

## 490 · 2026-10-28

- Pattern editor: the Insert key no longer switches note preview on and off (the backslash key still does).

## 489 · 2026-10-28

- New synth node and instrument kind, Cardinal: a monophonic virtual-analogue lead (behind the voices node for chords). Two oscillators (triangle, saw, pulse, sine, noise) with semitone and fine tune, key tracking, hard sync, fm from osc 1 into osc 2, ring modulation, a mix, noise and 1 to 5 unison voices; a filter that is lowpass 24 or 12, bandpass, highpass or notch with cutoff, resonance, key tracking and distortion; an amp envelope and a mod envelope (sweeping cutoff, osc 2 pitch, fm and pulse width); two LFOs with five waves and six destinations; glide and slide. Beside it are pictures of the oscillators (the real output), the filter response, both envelopes and both LFOs.

## 488 · 2026-10-28

- Shader view: choosing Built-in (the button or the dropdown) now stores a real copy of the built-in metaballs in the project shader, so it can no longer turn into whatever the Config default shader holds, and editing it changes only that copy.

## 487 · 2026-10-28

- Live picture: if the browser drops the graphics context (after a long idle, a sleep or a driver reset) the picture now comes back by itself instead of staying blank until the page is reloaded.

## 486 · 2026-10-28

- Audio: after a long idle the browser can suspend the audio context, and Play then seemed to do nothing. Play now wakes the context first (and coming back to the tab does too); if the audio device still does not answer, the status line says so.

## 485 · 2026-10-28

- Graph editor: Alt+V on a selected node (or group) keeps the picture beside it (a filter response, an envelope shape) showing when it is not selected; a small dot marks such nodes. Alt+V again stops.

## 484 · 2026-10-28

- Graph editor: dragging from a free input port now draws a wire from it (drop it on an output) instead of moving the node; Shift+drag on a port that already has wires also starts a new wire. Grab the node by its body to move it.

## 483 · 2026-10-28

- Graph editor: dragging from an output port that has wires now picks a wire up too (Tab chooses which); Shift+drag from it starts a new wire. Wires being dragged are drawn as curves like the others.

## 482 · 2026-10-28

- Graph editor: Tab over a port with several wires now always chooses the wire (it was swallowed when the canvas did not have the keyboard focus or a node panel took the key).

## 481 · 2026-10-28

- Graph editor: the pulse of a hovered port is gentler (about a pixel instead of up to three and a half).

## 480 · 2026-10-28

- Arrangement: the top edge of the grid now lines up with the top edge of the pattern list panel (it was 8 pixels lower).

## 479 · 2026-10-28

- Arrangement: the grid and the pattern list beside it now start at the same height.

## 478 · 2026-10-28

- The line under the toolbar at the top, running across the whole window, is much fainter.

## 477 · 2026-10-28

- Arrangement and pattern grids: the frame shown while the grid has the keyboard focus (the lines along its top and left edge) is much fainter.

## 476 · 2026-10-28

- Graph editor wires: the port under the mouse pulses slowly. Drag from an input port to pick its wire up and drop it on another input, or anywhere else to unplug it (Esc puts it back); Shift+drag does the same from an output port (a plain drag from an output still makes a new wire). With several wires on a port, Tab (Shift+Tab back) chooses which one is lit and picked up.

## 475 · 2026-10-28

- Insert menu: searching for scale (or map) finds the Range node.

## 474 · 2026-10-28

- Range node: a picture under the sliders shows which port it feeds, the whole span of that port (in Hz, ms ...) and the stretch lo..hi lit up on it; unwired it says so.

## 473 · 2026-10-28

- Graph editor: control operators in the Control menu. Range scales a 0..1 signal onto real values (type Hz, ms, dB ...) and hands the port it feeds the 0..1 it expects: lo and hi take the port's own limits and units, a frequency port sweeps evenly across octaves, and each wire out of a Range is scaled to its own port. With nothing on its input, Range is a knob in real units. Add and Times work at control rate (lower an LFO, scale it, multiply two controls). Int is a number box with slider, typing and + / - buttons; Float is the same without the buttons.

## 472 · 2026-10-28

- Arrangement screen: the page no longer shows a scroll bar down the right edge when nothing is off screen (the arrangement already runs down to the status bar, and 6 pixels of extra padding below it made the page just taller than the window).

## 471 · 2026-10-28

- Add instrument list: a new group, Samplers, comes first and holds the Sampler and the MOD channel (ProTracker); Synths follow.

## 470 · 2026-10-28

- Drum synth, a new node for the Graph editor (and an instrument kind in Add instrument): a drum hit built from a body, noise and a click. The body is a sine whose pitch falls from a start pitch to an end pitch along its own ADSR pitch envelope, with a pitch multiplier and key tracking from a root note. The noise has an amount, a colour (white, pink, brown, blue, violet), a low-pass and its own volume envelope. The click is either synthesized or the start of a sample from the node's sample list; for a sample click, Click tail smoothing fades its end so it does not tick. The node panel draws the three envelopes, the click on its own (with the smoothed stretch shaded) and the whole root note as composed from the current settings, with its first 25 ms enlarged. The pictures are the node's own code run offline, so they show what is heard.

## 469 · 2026-10-25

- Sample editor: right-click with a selection offers "Copy selection to a new sample", which makes a sample of its own in the list from just that stretch (slice markers inside it come along) and leaves the original alone.

## 468 · 2026-10-25

- Stream Manager: an eye button in the bottom bar (or Ctrl+Alt+E) slides a drawer up from the bar's top border. Every lane shows its machine, live voices, level and its share of the audio block, with Reset and Cut buttons (and Reset all, Cut all, Resume all). Cut stops a machine and skips it, so it costs no CPU, until Play is pressed again; Reset rebuilds it (voices, delay tails, filter state). Hidden by default; nothing is timed while it is closed. Wax runs one AudioWorklet for everything, so the lanes are shown as parts of it.

## 467 · 2026-10-25

- Left rail: the Dock button sits at the bottom of the screen buttons, below a thin divider line.

## 466 · 2026-10-25

- Node Sequencer, a new screen (Ctrl+Alt+N): a graph of nodes that plays beside the pattern lanes, which can stay empty. Amber square ports carry events on ticks and subticks, cyan round ports carry controls at signal rate; wires are drawn behind the nodes and a light runs along one each time an event passes.
- Nodes: clock, steps, euclid, Pseq and Prand lists, random, math, probability, delay, gate, counter, lfo, envelope, scale and more, a script node (a few lines of JavaScript per event), and the outputs: note (plays any instrument) and set (moves any exposed parameter). Press A or right-click for the palette; drag a wire onto empty space to add a node for it.
- Subticks are set per project (1 to 16). Nodes belong to one of eight groups (A to H); "Pattern lane" adds a lane whose G1 to G8 columns start and stop the groups from a pattern. With Rec armed, the notes the graph plays are written into the lanes of their instrument. The graph is saved in the .wax file and is part of WAV export.

## 465 · 2026-10-25

- Test: Note preview must default to on. The smoke test fails if the setting's default is anything but true, if a fresh start (nothing saved) has it off, or if its definition in config.js says `def: false`.

## 464 · 2026-10-25

- GenExpr code box: a full syntax suite. Declarations, control words, built-in operators, constants, inputs and outputs, numbers, operators, punctuation and comments each have a colour, and the names you declare are coloured by what they are (a Param, a History, a Data or Delay) wherever they are used. The colours are mixed toward the theme's text colour, so they read on the dark and the light themes alike.
- The bracket beside the caret and its partner are outlined, a bracket with no partner is underlined, and the other uses of the word under the caret are shaded.
- Rest the pointer on a word for its help: an operator's signature and what it does, or what a name in the code is (a knob shows its number, range and default).
- Fixed: on every named theme the theme's textarea colour put the plain text over the colours, so the highlighting was hidden; the code box now keeps its text transparent.
- Config, Picture: default shader: the explanation runs the full width with the code box under it, instead of the box being squeezed beside the text.

## 463 · 2026-10-25

- Sample screen: a playhead, a thin translucent red line over the waveform, runs while a sample plays (keys, Space, the slice buttons). It follows the sample's loops and is an estimate from the clock, so it is not exact if the sound is tuned or has effects that change its speed.
- The slice button "play to the next marker" now stops at the next marker (a one-shot ignored the stop and played to the end). Clicking a playing button cuts it at once.
- Fixed: letting go of a key in the sample screen never released a looping sample (the note-off was lost in a comment); it is released now.

## 462 · 2026-10-25

- Sample screen: every slice marker in the list has two icon buttons. The first plays from that marker to the next one (to the end of the sample for the last marker); the second plays from the marker to the end of the sample. Clicking a button that is playing stops it, and the clicked marker becomes the active one.

## 461 · 2026-10-25

- Instruments tab: hovering an instrument in the list tints the row quietly and keeps its text colour, instead of the bright highlight that was hard to read on the light themes.

## 460 · 2026-10-25

- New `tpb` field (ticks per beat) beside bpm. Changing it rescales the bpm readout so a tick keeps its length and the music its tempo: a kick every 8 ticks at tpb 8 sounds like one every 4 ticks at tpb 4, and reads half the bpm. The bpm field now takes decimals (rescaling 125 bpm to tpb 8 gives 62.5) and a wider range, 1 to 800.

## 459 · 2026-10-25

- Sample editor: the cursor says what a drag would do. Over a slice marker (within a few pixels) it turns to the move cursor when Alt is held, or whenever the loop, sustain loop and selection are all hidden, and then a plain drag moves the marker without Alt. Away from the markers it is a regular pointer.

## 458 · 2026-10-25

- Instruments tab: the Name box and Rename button are gone. Ctrl+F2, or a right-click on an instrument in the list (a menu with one item, Rename), opens a small box over its row; Enter renames, Escape leaves it.

## 457 · 2026-10-25

- Graph: wires always run behind the nodes; a node is filled with the graph's background first, so a wire under it no longer shows through.
- Instruments tab: the node preset drop-down reads "(preset list)", with the delete cross beside it and the name box and Save button on the row below.

## 456 · 2026-10-25

- Envelope drawing beside a selected node: no box, only four corner ticks close around the drawing, so nodes under it show through; a faint fill under the curve; the A D S R letters are gone and the readout sits right under the graph. About a third shorter.

## 455 · 2026-10-24

- New `genexpr` node (Effects > Code): a node whose sound is code. A GenExpr-style language (History, Param, Data and Delay declarations, assignments, if / else, `?:`, around fifty operators including phasor, cycle, noise, delta, slide, mix, scale, wrap, fold, peek, poke and delay `.read` / `.write`) is compiled to JavaScript once per edit, never per block. `in1` `in2` come in, `out1` `out2` go out; each `Param` becomes a knob (p1 to p8) scaled to its own min and max.
- The code panel has line numbers, highlighting, and every mistake underlined where it is, listed with line, column and a hint ("did you mean sin?"). A bad edit keeps the last working code playing.

## 454 · 2026-10-24

- Dropdown lists (the New instrument picker and every other select): the open list has a darker background and full-contrast text in every theme.

## 453 · 2026-10-24

- New `sweep` node (Filter & EQ): a one-knob filter that starts out of the way. 0 leaves the sound untouched, below 0 closes a lowpass from the top, above 0 opens a highpass from the bottom; resonance grows in with the distance from the middle and the first few percent fade the filter in, so there is no dry/wet seam. 12 or 24 dB, and a `mod` input (a full swing is 1.0) for auto-filtering.

## 452 · 2026-10-24

- New `ladder` node (Filter & EQ): a 24 dB resonant ladder lowpass that sings at full resonance, with a built-in LFO (log-scale rate 0.01–20 Hz, depth in octaves, four shapes), a `mod` input in octaves, drive, and a smoothed dry/wet `mix` to morph the filter in and out of a chain.

## 451 · 2026-10-24

- Instruments tab: Voices lines up with the "selected node preset" heading and Tracks with its list.

## 450 · 2026-10-24

- Instruments tab: NoteCols is now called **Tracks**, the numbers sit next to their words, the preset box is headed "selected node preset", and its two boxes (the list and the name field) start at the same edge.

## 449 · 2026-10-24

- Instruments tab: Voices and NoteCols are stacked with narrow number boxes, and the node preset box (shown when a node is selected) sits to their right, right-aligned.

## 448 · 2026-10-24

- Graph: **undo and redo** (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) for nodes, wires, parameter values and exposed columns, with a history of up to 100 steps for each instrument. A finished edit (mouse up, key up, a field changed) is one step.
- Graph: wires are easier to hit with the mouse (the whole length of a long wire now counts, not just a few points along it).

## 447 · 2026-10-24

- Graph: right-click on a wire opens the node menu to put a node into that wire. The node is placed in the middle of the wire, connected to both ends, and the nodes to its right move over to make room.

## 446 · 2026-10-24

- Dark and Black themes (and System when the system is dark): the pattern colours in the arrangement are solid instead of a tint over the editor's background, so they no longer mix with it. The other themes are unchanged.

## 445 · 2026-10-24

- Arrangement: the grid and the side panel now run all the way down to the top of the status bar instead of stopping short (the window-fit rows use the whole height).

## 444 · 2026-10-24

- Sequencer: the undo line under the grid is a trail of chevrons. The most recent undoable operation is bright, the older ones fade to the right, "undo" has even space on both sides, and a set waypoint shows after the trail.

## 443 · 2026-10-24

- Instruments tab: the Add node button is gone from the left panel (double-click the graph for the node menu).

## 442 · 2026-10-24

- Instruments tab: the instrument list and the selected instrument's controls (name, Rename, voices, note columns, Add node, node presets) are one retroslate panel on the left, with New instrument, Presets, Preset library and Instrument file in a second panel below. The graph now starts at the top of the page.

## 441 · 2026-10-24

- The flat-panel look of the Sample screen and the Instruments tab's left panel now has a name: **retroslate** (a note in the stylesheet, for applying it to other panels).

## 440 · 2026-10-24

- Instruments tab: the left panel is styled like the Sample screen: one flat panel, flat text-like buttons, a brighter instrument list with a faint border, brighter text fields, and the four preset buttons (Save new, Overwrite, Rename, Remove) on one line.

## 439 · 2026-10-24

- New node **route** (Effects, Routing): a small dot that passes a signal through unchanged, to branch a wire to any number of places or gather a tidy path. It is its own port: wires enter at its left edge and leave from its right, and its name shows only when selected. Stereo stays stereo.

## 438 · 2026-10-24

- New demo **phase** (`?demo=phase`), written by Claude from a brief of Aphex Twin, Curtis Roads, Stockhausen and Philip Glass: a Glass-style cell that grows one note at a time and is then eaten from the front; serial "points" (durations 1 2 3 5 8 13 21) through a frequency shifter and spatial rotation; microsound clouds that thicken into texture; a broken beat in sevens with an acid line, a warm pad and a tempo rush; and the cell again, thinned to one note.

## 437 · 2026-10-24

- New demo **suite** (`?demo=suite`), written by Claude with the Wax tools and no direction: five short atonal studies, each with its own set of nodes and silences between. Plucked strings through tape; FM bells through a frequency shifter and plate; woodblock, comb percussion, clap and hat with echoes, crusher and gating; a wavetable drone through phaser, shimmer and spectral pan with a broken acid line; and a coda of ghosts.

## 436 · 2026-10-24

- DSP view: the DSP circle sits halfway down the code with a thin arrow pointing left, to show the circuit unfolds that way.

## 435 · 2026-10-24

- DSP view: the circuit starts hidden; a small **DSP** circle at the right of the code opens it (× or the Circuit button closes it). The divider between code and circuit drags to any width, and the width is remembered.

## 434 · 2026-10-24

- DSP view: a **Circuit** beside the code. A node's per-sample loop is read as plain arithmetic and drawn as a signal flow: the streams in on the left, a symbol for each operation (+ − × ÷, a function such as tanh, a ?: switch), a one-sample delay (z⁻¹, dashed wire back) for every variable read before it is written, orange blocks for what was set before the loop, and the output on the right. Hover a symbol to light its line in the code. Where a node has several loops each gets a tab, and what cannot be read (an if, a nested loop) is left out and counted. Switch it off with the Circuit button.

## 433 · 2026-10-24

- Live picture: a new shader template, **Cells** (a Voronoi mosaic). Every cell belongs to one lane; a hit lights its cells, the pitch picks the colour, a held note keeps them warm, and the walls between the cells flash with the beat. Choose it from Config > Visual > Start from a template.

## 432 · 2026-10-24

- **Alt+M** now works in the pattern editor too, as the pair of Alt+S: Alt+S solos the lane under the cursor, Alt+M mutes it (both in the sequence editor and the pattern editor).

## 431 · 2026-10-24

- Sequence editor: **Alt+M** silences the whole lane (it was Shift+M), so the Alt shortcuts sit together; M still starts a mute from the row.

## 430 · 2026-10-24

- A player: `<wax-player src="song.wax" art="cover.png" title="Name">`, a web component that plays a `.wax` song with the real engine and no tracker around it (square artwork, play/pause, a progress line you can click to seek, the length and tempo; one plays at a time). `player.html` is a page of them built from a small `tracks.yaml` in the root (title, `.wax` file, picture), and plays the list in order. It is published with the app.

## 429 · 2026-10-24

- Graph view: taking a node out and joining the wires round it is now **Alt+R**; plain R is the keyjazz key it always was on a generator, so the two no longer collide.

## 428 · 2026-10-24

- Wax tools for Claude: an MCP server (`tools/wax-mcp`, named in `.mcp.json`) that validates a `.wax` file, outlines it (what plays when), renders it offline with the engine the page uses (no browser, no sound card) and measures the result: peak, LUFS, clipping, level, band balance, onsets and stereo correlation per section, with `solo` / `mute` per lane. A skill (`.claude/skills/wax`) teaches the file format, the pattern row syntax and the working loop.

## 427 · 2026-10-24

- The demo song, from your edited version: the Shepard tone now comes in after 8 s and fades in over 30 s (a ramp written in a new Lvl column of its lane); the arp lane holds each chord in four note columns and the Arp node plays it (up and down over three octaves, its step quickening from quarters to sixteenths in a new Rate column); a new woodblock lane (E minor pentatonic hits at uneven distances, through a Prisma Canyon echo and a hall); and a new Duette lane of Detroit-style stabs (minor 9th, major 9th and minor 11th voicings of the chord that is playing, a 3-3-2 syncopation, five voices).

## 426 · 2026-10-24

- The first-screen line sits in an off-white, filled cartouche.

## 425 · 2026-10-24

- The first screen now reads "musical spreadsheet - click to enter".

## 424 · 2026-10-24

- New delay node, **Prisma Canyon**: a tape echo with four playback heads at 1, 2, 3 and 4 times the repeat time. Each head has its own level, its own pan and its own damp: a negative multiplier on the cutoff, so every line is darker than the one before (cutoff × 2^(−4·damp)). The loop has intensity (feedback, up to self-oscillation), tape saturation, wow and flutter, bass and treble shelves, an echo/dry/reverb mix, and the repeat time glides like a tape's.
- Its panel shows a canyon view: a row per delay line in its own colour, each echo fainter than the last, laid out on a ruler in tracker ticks (or milliseconds when there is no tempo), with each line's pan and cutoff beside it.

## 423 · 2026-10-24

- Duette (and any machine that keeps a note column on one voice): a column now finds its voice by its column number instead of by the pitch of its last note, so two columns playing the same pitch (a unison, an octave doubling written as the same note) can never fall onto one voice and leave the other column silent. Notes that carry no column (the keyboard, a trigger) are allocated as before.

## 422 · 2026-10-23

- **Limiter switch** on the status bar (the "Lim" button beside the meters button): switches the master limiter on and off. It is the master lane's `Lim` parameter, so it is saved with the project, follows the pattern column and the parameter panel, and lights up when the limiter is on.
- **Multiband compressor** (Effects > Dynamics > "Multiband compressor", or the `mbcomp` node): four bands (low, low mid, high mid, high) split at three crossovers with the same phase-aligned 24 dB per octave filters as the band splitter, each compressed on its own with its own threshold, ratio, attack, release and gain; the knee is shared and each band is stereo-linked, so the image does not shift. With nothing to compress the bands add back to the original level. `solo` plays one band alone to set it up, `mix` blends with the dry sound for parallel compression, and `out` is the gain at the end. The low band starts with a slow attack to let the front of a kick through, the high band with a quick one for hats.

## 421 · 2026-10-23

- The master limiter starts **off** (`Lim` 0): it changes the sound of the mix more than a safety net should, so it is there when you ask for it. Switch it on with the `Lim` column of the master lane, or the Limiter parameter of the master lane. A project that was saved with it on keeps it on. The limiter meter shows the level either way, with nothing held back while it is off.

## 420 · 2026-10-23

- **Master limiter**, after the master volume, on by default: a lookahead peak limiter (1.5 ms) that keeps the whole mix under a ceiling so nothing clips, with one gain for both channels so the stereo image stays put. New master lane parameters and columns: `Lim` (on or off), `Ceil` (the ceiling in dB, default -0.3), `Gain` (dB into the limiter, up to +18: louder and denser, with the peaks held at the ceiling) and `Rel` (the release in ms). A project saved earlier gets the columns when it is opened. It also applies to the exported file. Peaks are sample peaks, not true peaks, so keep the ceiling a little under 0.
- **Limiter meter** in the meter band (Config > Meters > limiter, on by default): the level going in (grey), the level going out (green), the ceiling (dashed), and how much the limiter held back, hanging from the top, with the current and the highest value.

## 419 · 2026-10-23

- Duette: fixed clicks. A note started while the last one was still sounding or dying (a column's next note, a note after a `===` that was still fading, a stolen voice) sent the envelope back to zero in one step, which clicks. The envelope now starts again from where it is. A note cut (all notes off) fades over a few ms instead of stopping dead.

## 418 · 2026-10-23

- **Tape** effect (Effects > Distortion > "Tape", or the `tape` node): what a recording on tape does to a sound, in six qualities (`type`): studio reel, chrome cassette, ferric cassette, worn cassette, dictaphone and dubbed copy, each with its own brightness, low cut, head bump, hiss, wobble and dropout habits. `age` wears any of them: darker, more wobble, more hiss, more dropouts. `drive` is the tape saturation (squashes loud parts, adds warm harmonics), `wow` is the slow pitch drift (shared by both channels) and `flutter` the fast shiver (a little different in each), `hiss` and `dropouts` (short dips in level and brightness, each channel on its own) scale those, `tone` moves the loss of highs, and `mix` blends with the clean sound, which is delayed by 4.5 ms to match.

## 417 · 2026-10-23

- **Duette is polyphonic**: a new Duette instrument starts with 3 voices and 3 note columns (set both in the Instruments screen; at 1 voice it is the mono lead as before). Every note column keeps to one voice, so portamento and the Sld slide work along each column, from that column's own last note, and the columns together play chords. A new `columnVoice` flag on a node type asks the voice allocator for this; other polyphonic machines still let a note ring out through its release while the next one takes another voice.

## 416 · 2026-10-23

- **Duette**, a monophonic two-oscillator lead voice (Sources > Synths > "Duette", or New instrument > "Duette (two-oscillator mono lead)"). Oscillator 1 is saw, triangle or square, oscillator 2 saw, triangle or noise (16' to 2', detune up to an octave, and a Mod switch for sync or ring modulation); each has a Shape that folds a saw or triangle into more harmonics, or narrows a square. A resonant two-pole low-pass filter that rings by itself, then Drive. One envelope is also the amplifier: A/D (a note is a blip), A/G/D (held while the note is held) or gate, and it moves the pitch of both oscillators, of oscillator 2 alone, or the cutoff, in either direction. One LFO (saw, triangle, square; fast up into the audio range, slow, or one shot per note) moves the pitch, the shapes or the cutoff. Portamento (always, or only when notes overlap), a per-note slide in the Sld column, key tracking, and velocity to level and cutoff. It is the sound only; the pattern is the sequencer. The instrument has Sld, Cut, Res, Int, Dec, Sh1, Sh2 and Drv columns and commands 01 to 12.
- Fixed: Normalise, the fades, Reverse, Silence and the other edits that change a sample without changing its length did not redraw the waveform until something else did. It redraws at once now, and on undo and redo.

## 415 · 2026-10-23

- **Detect chords** (Samples screen: the "Detect chords…" button in the bottom line, or Shift+H): listens to the sample, or the selection, and finds the notes of each chord, made for a piano playing chords. The recording is cut at every onset (or into steps of 1, 2 or 4 beats at the recording's tempo), and in each part the notes are found from the spectrum by their harmonics (the hammer's first 40 ms are skipped, and a note's partials are not counted again as notes of their own). The dialog lists the chords with their names and notes (C, Am, G7 ... named as the chord palette names them) before anything is written; the settings are the most notes in a chord, the weakest note kept, and the recording's tempo (0 is the song's), which decides where the chords land. **Write to pattern** makes a new pattern in the lane you pick, at a tick you pick: the notes of each chord go across the lane's note columns, with note-offs where each chord ends. It is one undo step; if a pattern is in the way it says so and writes nothing. Octave doublings are found when the octave's own partial is clearly there. A mix with drums, or a single-note line, will not come out well.

## 414 · 2026-10-23

- **OSC out**, a machine that sends the notes of its lane as Open Sound Control (Sources > Synths > "OSC out (Renoise, Max, ...)", or the `oscout` node). It makes no sound: it sends `/renoise/trigger/note_on` (instrument, track, note, velocity) and `note_off` with Renoise's own numbering, so Wax can play a Renoise song's instruments (switch on Renoise's OSC server in Preferences > OSC, UDP). Parameters: `instrument`, `track` (-1 is the current track) and `transpose`; `mode` 1 sends Wax's own `/wax/NAME/note_on` and `note_off` (MIDI note, velocity) for Max, SuperCollider and the like. The computer keys play it in the graph view like any other machine.
- A browser cannot send UDP, so the messages go to a small relay: `node tools/osc-relay.mjs [--port 8765] [--to 127.0.0.1:8000] [--log]` (no packages needed; Settings > OSC relay port must match). Wax connects when the first note is sent and says in the status line if no relay is listening. Messages go out as soon as the page hears of them, with no time tags yet.

## 413 · 2026-10-23

- "Insert lane…" in the arrangement view now places the new lane **to the left or to the right of the lane you right-clicked**: two rows at the top of the menu (● marks the side, and it is remembered for the session; nothing goes before the master lane). **New instrument…** no longer sends you to the instrument screen: it lists the kinds (synths, sampler, blank) right there and makes the instrument with a default name, a number added when the name is taken (clap, clap2, clap3), and its lane. **Instruments without a lane…** puts a lane for an existing instrument on the chosen side. Lane names count up the same way (clap2, clap3, not clap22).

## 412 · 2026-10-23

- "Insert lane…" in the arrangement view is down to two entries: **New instrument…** (takes you to the instrument screen's new-instrument box, with the name field ready; Add makes the instrument and its lane) and **Instruments without a lane…** (greyed out when every instrument has one). The kind list and the list of all instruments are gone from the menu.

## 411 · 2026-10-23

- The arrangement view's right-click "Insert lane…" now opens with two entries before the instrument list: **New instrument…** (every synth kind, the sampler and the blank graph; it makes the instrument and puts its lane at the end) and **Unassigned instruments…** (the instruments that have no lane yet, greyed out when there are none). Below them the list of all instruments stays as it was. Menus taller than the window now scroll.

## 410 · 2026-10-23

- Dragging a selection in the arrangement view no longer stops when the pointer strays out of the grid (into the side menu, say). The drag now ends only when the button is let go, so coming back into the grid carries on growing the same block. The same fix applies if the button is released outside the window.

## 409 · 2026-10-23

- Dragging the graph view's size no longer leaves it blank until you let go. Changing the size clears the canvas, and the repaint waited for the next animation frame; the resize observer fires after a frame's callbacks, so a cleared canvas was sometimes shown first. The graph is now drawn in the same call that resizes it.

## 408 · 2026-10-23

- A clap synth (Sources > Synths, and in the new-instrument list as "Clap (burst noise)"): noise through a band-pass, shaped by a run of quick bursts (the hands: `bursts`, `spacing`, `burstDecay`) and a longer tail (`tailDecay`, `tailLevel`) that starts with the last one, in the 808 and 909 manner. `tone` and `q` set the band-pass, `spread` gives the two channels different noise for width, `drive` rounds the peaks. Like the hat it has no notes: the Cl column triggers it and the digit is the velocity. The instrument has Ton, Tai, Bur and Spc columns and ten commands.

## 407 · 2026-10-23

- **urugraVerb** (Effects > Reverb): your ArguruInspiredReverb3Opto gendsp, ported as it is. Four damped feedback combs per channel (the right channel read a little further back), six all-pass diffusers in series, a gentle low-pass and a mid/side width stage, with the very slow 0.11 Hz modulation of the delay times and the pre-delay inside the comb loops. Parameters keep the names and defaults of the gendsp: predelay, size, decay, damp, mod, dry, wet, width. Two small differences: the delay times glide for 10 ms when a parameter moves, so turning size or predelay does not click, and the buffers grow with the sample rate so the longest delay plus pre-delay always fits.

## 406 · 2026-10-23

- An impulse-response reverb, **convolver** (Effects > Reverb). Any sample in the project is the response (mono or stereo, up to 8 seconds): add one under the graph with Add sample, and it is saved inside the project. Controls: `size` stretches the room, `decay` fades the response out sooner, `predelay`, `lowcut`, `highcut`, `width`, `level` and `mix`; a pattern's Smp column can switch between several responses. It is partitioned FFT convolution in three stages (128, 1024 and 4096 samples) with the slow stage spread over the blocks between, so a long response stays cheap (about 8 percent of a block's time in my test with an 8 second stereo response); the sound is about 3 ms late. A new response, size or decay is rebuilt in the background while the old one plays on. The node's F1 help page lists where to find free impulse responses (OpenAIR, EchoThief, Voxengo, Airwindows, Samplicity and more).

## 405 · 2026-10-23

- Arrangement view: right-click anywhere on the grid, on a pattern or an empty cell, and **Insert lane…** lists the instruments. Picking one adds a lane for it at the end of the arrangement (the same as "Add lane for" under the list).

## 404 · 2026-10-23

- A comb filter (Effects > Filter & EQ): the signal is mixed with a copy delayed by one period of `freq`, which puts peaks at that frequency and its multiples. `feedback` rings them (a tuned resonator; feed it noise or clicks and it plays a string-like pitch; negative values drop it an octave), `ff` mixes in the delayed input once for notches, `damp` darkens the loop so the highs die first, `spread` detunes the two channels for width. The loop level is evened out, so more feedback does not mean louder.

## 403 · 2026-10-23

- Arrangement view: Left and Right no longer wrap round the ends. At the last lane Right stays put (and Left at the first). A small **Wrap** button beside "Add lane for" turns the wrapping back on, and the same switch is in Config (Editing). The master lane, which has no notes, is half as wide as the others; a Config switch (Editing) makes it full width again. Tab still cycles through the lanes.

## 402 · 2026-10-23

- Graph view: **R** with a node (or a lasso group) selected takes it out and joins the wires round it, so what fed the node now feeds what it fed. A mixer's inputs all go on to what it fed; control inputs and parameter ports go with the node. The out node stays, and a join that would make a loop is refused and changes nothing. On a generator R still plays a note, so use Delete there. Delete and Ctrl+X still remove without joining.

## 401 · 2026-10-23

- Granular: every note now starts the cloud at Position. Before, a note that arrived while the instrument's last note was still sounding or fading (a voice reused during its release) carried on from wherever Scan had moved the cloud, so where it started was hard to predict. The Position hint now says what it is: where the cloud starts when a note starts. Scan moves it on from there and Spray scatters the grains around it.

## 400 · 2026-10-23

- In the graph view, when a selected node shows both its envelope box and a scope, the two now sit side by side, level at their middles, a few pixels apart (the scope used to start at the node and could hide behind the envelope box).

## 399 · 2026-10-23

- Two new scopes for the granular node (click its eye, then pick them in the scope header, which now reads wave, cloud, grain, spec): **cloud** draws the sample it reads, the position line, the spray band and a bracket for each grain that is sounding, with a dot where it is reading now; **grain** lays the last 14 grains over each other, aligned at their start, inside the window they share (so size, shape, pitch scatter and reverse show directly). The grains are reported by the node only while a scope is open on it, so a granular node nobody watches costs nothing extra. The wave scope is the same triggered trace as before.

## 398 · 2026-10-23

- A woodblock synth (Sources > Synths, and in the new-instrument list). A noise strike rings four inharmonic modes whose energy leaks away as they sound: `damping` is how long the lowest mode lasts, `loss` makes the higher modes die faster so a click turns into a knock, `hardness` is the stick (velocity adds to it) and `inharm` spreads the modes. Two ADSRs are drawn beside the node, volume and pitch; the pitch one moves every mode by `bend` semitones and falls back. Pitch follows the note when `keytrack` is on. The instrument has three voices, one note column and Ton, Har, Dmp, Los and Bnd columns.

## 397 · 2026-10-23

- The DSP tab has a diode icon instead of the word. The Parameters, Ports and Kernel panel now runs down the right edge of the whole window, and the source area fills the space that is left, in width and height.

## 396 · 2026-10-23

- The DSP view folds code: a small arrow in the gutter closes or opens a block (the params list, the create function with its per-sample loop, and anything nested), leaving a grey "… 35 lines, per-sample loop …" marker you can click to open again. "Fold all" closes the top-level blocks so a big node reads as an outline; "Unfold all" opens everything. Folds are remembered per node while the page is open.

## 395 · 2026-10-23

- A DSP view (Ctrl+Alt+I, the pixel "DSP" icon in the rail): the code behind the sound, read only. A strip across the top lists an instrument's nodes in the order they run; picking one shows its own source file (fetched from the site, so it is exactly what runs), highlighted for keywords, calls, strings, numbers, operators and punctuation, with each per-sample loop shaded and numbered in the gutter. At the right: its parameters with their live values, its ports, and whether it has a WASM kernel. It opens on the instrument the Instruments screen is on.

## 394 · 2026-10-23

- The Select line of the sample screen has a hide / show switch too, in the same column as the Loop and SusLoop ones: it keeps the grey selection off the waveform (the edit tools still act on it, and dragging a new selection shows it again). Saved in Config (Sample).

## 393 · 2026-10-23

- Sample waveform mouse, reassigned: a plain drag (or Shift+drag) is the selection (grey); Alt+drag sets the loop region (A to B); Ctrl+drag sets the sustain loop region (a to b). Each loop's edges can be grabbed with its own modifier to move them. Alt+click without a drag still adds a slice marker, and Alt+drag on a marker moves it. Double-click clears the selection, Alt+double-click (away from a marker) the loop, Ctrl+double-click the sustain loop.
- The Loop and SusLoop lines of the sample screen end in a hide / show switch: it keeps that region off the waveform (starting to drag it shows it again). The switches are saved in Config (Sample).

## 392 · 2026-10-23

- Sample screen: with the mouse over the waveform, Space plays the sample from the start (for as long as it is held), and Alt+Space plays from the slice marker nearest to the left of the mouse (Ctrl+Space does the same, for systems that keep Alt+Space for the window menu). The status line says which slice it started from.

## 391 · 2026-10-23

- Auto-slice shows what it would do before it does it: the hits are drawn on the waveform as dashed teal lines (a preview only, nothing is stored) and follow the sensitivity and gap while you change them. Slice turns them into real markers. With no selection it works on the whole sample; with one, only on that part. A new tick box, Replace the markers in range (on by default), decides whether the markers already inside that range are replaced (they are drawn faint in the preview) or kept with the new ones added; markers outside the range always stay.

## 390 · 2026-10-23

- Auto-slice is a dialog now (Shift+E, or the Auto-slice button above the status bar on the Sample screen). It holds the sensitivity (slider) and shortest gap, shows how many hits those find as you change them, and Slice puts the markers in. Before, a result such as "No onsets found" only appeared as a short line at the foot of the screen, which made it look as if nothing had happened. The other sample settings stay in Config.

## 389 · 2026-10-23

- The Sample screen's auto-slice settings are one line above the status bar (shown only on that screen) instead of a column beside the sample list, where it overlapped the Slices text. The live picture and meters move up with the taller footer.

## 388 · 2026-10-23

- Settings where you use them. The Shader view has a Picture row under its toolbar (resolution, hit fade, pattern skeleton), and the Sample screen has an Auto-slice column beside the sample list (sensitivity, shortest gap, marker hex value, resynthesis branches). They are the Config settings themselves, so changing one in either place changes it in both.

## 387 · 2026-10-23

- Clicking the tick column to set the playhead works with the sticky tick column too, however far the lanes are scrolled sideways.

## 386 · 2026-10-23

- The tick column of the sequence editor stays at the left edge when you scroll the lanes sideways (as the pattern editor's already did).

## 385 · 2026-10-23

- A song can have several shaders (up to 16, 0 to F). The Shader view has a picker with + (new, a copy of the current one), Copy, Name and Delete. The shader lane gets a permanent Shd column: the digit you write there switches the picture to that shader from that row on, until the next Shd cell. Starting or jumping into the middle of a song looks back up the lane for the last Shd value, so the right shader shows. Exposed inputs are matched by name across shaders (each shader uses its own low and high; unused names are ignored), and an input only counts as unused when no shader uses it. Each shader is built once and kept, so switching is instant. While the Shader screen is open the picture shows the shader being edited. Older projects with a shader lane get the Shd column.

## 384 · 2026-10-23

- The picture's shader is saved with the project (song.shaders, a list: only the first is shown for now), so a project keeps the shader its exposed numbers belong to. A project without one uses the text in Config, now called the default shader. Editing in the Shader view marks the project as changed.

## 383 · 2026-10-23

- Patterns can animate the shader. In the Knobs panel of the Shader view each ordinary number has an "expose" button: the number in the code becomes kn("name", start, low, high), named from the variable it belongs to, and the project gets a "shader" machine and lane (made the first time) with a pattern column of that name, 00 giving low and FF high, up to 16 of them. They can be written, ramped and given curves like any other column; the picture reads them every frame. An exposed number shows in blue in the code, its knob follows the song, "unexpose" turns it back into a plain number, and an input no code uses any more can be removed. The shader lane is drawn faintly hatched, in the pattern editor and the arrangement, and is left out of the picture's own lane list.
- Whole-number (int) literals can't be exposed, since the picture's inputs are floats.

## 382 · 2026-10-23

- A Pause button next to Play (also the Pause key). It stops where the song is and keeps the place; Pause again, or Play, carries on from that row. Stop (F8) still stops for good, and Play from the cursor (F6) starts from the cursor as before. Notes held across a pause start again from the row.

## 381 · 2026-10-23

- Shader view: numbers are drawn on a faint chip (orange for floats, green for ints). Hover one, or put the caret in it, and a small slider appears just above it that writes straight into the text; drag a number sideways to slide it without opening anything (Shift: a tenth as fast). Floats keep their point and ints stay whole; "±" lets the range go negative (written as (-.3) so it can follow a minus), and unticking "live" puts the number back as it was. One Ctrl+Z undoes a whole slide. The "Number sliders" tick box switches all of this off.
- Shader view: a Knobs panel (tick box "Knobs") lists every number in the shader with its own slider, tick box and reset; hovering a row marks the number in the code.

## 380 · 2026-10-23

- Live picture: Config > Visual > "Picture: resolution" (300, 480, 720 or 1080 pixels each way). The shader sees it as R, and the lane names scale with it. The picture keeps its 300 px box on the page; the pop-out window shows the extra pixels, so it stays sharp when enlarged.

## 379 · 2026-10-23

- Shader template "Flock": birds that follow a leader's path, each a little later than the one before, facing the way the path goes and swaying apart; three birds per lane, flung out and lit by that lane's hits. It is a closed-form flock, since a picture shader keeps nothing from one frame to the next.

## 378 · 2026-10-23

- A Shader view of its own (the cube tab, or Ctrl+Alt+G) for the live picture's GLSL: colours for keywords, types, built-in functions, Wax's own look-ups and uniforms, numbers, strings and comments; line numbers with the failing line marked in red; the picture follows a moment after you stop typing. Tab indents (Shift+Tab outdents a selection), Enter keeps the indent, and undo works. The template list and the pop-out button are there too, and the built-in picture's source is shown to start from. The Config box for the shader stays, pointing to the new view.

## 377 · 2026-10-23

- Live picture: a pop-out button (the arrow at the picture's top right, shown on hover) moves it into its own always-on-top window (Document Picture-in-Picture: Chrome, Edge, Brave) that can go to any screen. It keeps animating while Wax is covered by other programs. The button again, or closing the window, brings it back.
- Four more shader templates: LEDs (a lamp matrix of the pattern), Kaleidoscope, Stars and Lava.

## 376 · 2026-10-23

- Live picture: five shader templates (rings, bars, tunnel, piano roll, plasma). Config > Visual > "Picture: start from a template" copies one into the shader box for editing; "Built-in metaballs" empties the box again. Choosing one replaces the box's text.

## 375 · 2026-10-22

- MP4 export always has AAC-LC sound now, which is what X and most sites require. Browsers without an AAC encoder (Brave has none, so the export used Opus) use a built-in one: the Fraunhofer FDK AAC encoder as WebAssembly (src/vendor/fdk-aac.mjs, about 480 KB, loaded only when needed). The status line says "AAC (built-in encoder)" when it was used.

## 374 · 2026-10-22

- Export shows a progress bar at the right end of the status bar (the render is the first half of an MP4 export, the encoding the second). Pressing Export again still cancels. The button keeps its icon afterwards, and its tooltip now mentions MP4.

## 373 · 2026-10-22

- Demo: bugsong replaced with the version that has no accidental loop.

## 372 · 2026-10-22

- Demo: "bugsong" (273 bpm, 15 lanes, 7 samples) is now one of the demos. Open the page with ?demo=bugsong. Any saved project placed in src/project/demos/NAME.wax can be opened the same way, with ?demo=NAME.

## 371 · 2026-10-22

- Live picture: a pattern skeleton over it. Every lane is a thin row of its notes around the playhead (8 ticks behind, 23 ahead), scrolling past a fixed line; pitch is the height of a tick and velocity its strength, and a note off is a small dash. The lane names stand down the left edge. Everything the skeleton draws, text included, is one muted blue, the colour of the first screen's text; nothing cycles through colours. Config, Visual: "pattern skeleton" switches it off. For your own shader: `cell("kick", dx)` gives the row dx ticks from the playhead (note starts, pitch, velocity, note off), `NL` is the lane count and `SKEL` is 1 when the skeleton is on.

## 370 · 2026-10-22

- Fix: a lane added in the session ("Add lane for", for example for a cloned instrument) said "this lane lists no parameters" when you right-clicked it for an automation curve, until the project was saved and reloaded. New lanes now list their curve targets (Volume and the exposed parameters) at once.
- New: a live picture driven by what the lanes play. Ctrl+Alt+V or the button in the status bar opens a 300 x 300 picture in the corner (the size of a video frame). It is a WebGL shader that is told, for every lane, when a note hits (a value that jumps to 1 and fades), the pitch and velocity of the last note, and whether a note is held. These come from the pattern cells themselves, so they are exact. The built-in picture is the metaballs of the first screen, one for each of the first four lanes. Config, Visual: the fade time, and a box for your own GLSL (a whole `main`, with R, T, BEAT, HITS, C1, C2 and LANE[16] ready, and look-ups by lane name or number: hit("kick"), pitch("acid"), vel(2), held("pad"), hits()). A mistake in it shows with its line number under the picture and the built-in one keeps running.

## 369 · 2026-10-22

- Export to MP4: Config, Export, "file type" MP4. The file has your album art (Config, "album art": pick any picture; it is cropped square and scaled to 300 x 300; with none, a card with the project name) as its picture and the song as stereo AAC (H.264 for the picture). A browser without an AAC or H.264 encoder gets Opus and VP9 instead, which most players read. The picture costs almost nothing, so the file is about the size of the audio. Uses the browser's own encoders and the vendored mp4-muxer (MIT).

## 368 · 2026-10-22

- Arp: the node now shows its 16-step mask, mode, rate, octaves, hold and transpose on its own face, so you can read it without selecting it (it follows the settings live). The demo's arps are placed clear of the other nodes.

## 367 · 2026-10-22

- New node: Arp (Control). An arpeggiator for an instrument: held notes, from patterns, keyboard or MIDI, become a stepped pattern locked to the song's tempo. 21 modes (up, down, up/down and down/up with and without repeated ends, converge, diverge, converge/diverge, as played, random, random other, random once, chord, repeat x2 and x4, pinky and thumb up and up/down, and the tracker-style interval cycle), rate from 1/4 tick to 16 ticks, gate, swing, octaves, transpose, hold, retrigger (never, every note, every 4/8/16 steps), offset, repeats, a seed for the random modes, played or fixed velocity with humanize, and a "thru" switch. The 16-bar step mask under the node sets the velocity of each step; no bar is a rest. Every setting can be written from a pattern column or driven by a wire. A full help page (F1) covers the modes, timing, mask and recipes.
- Demo: open the page with ?demo=arp for a 32-bar techno sketch with three arps (trance, offbeat chord stab, acid).

## 366 · 2026-10-22

- Patcher: control and parameter wires are drawn dashed, audio and stereo wires stay solid (Config, Graph: "Control wires are dashed", on by default).

## 365 · 2026-10-22

- Header: a project name field beside Save (it is the file name), and a * after it as soon as the project differs from what was last saved or opened. Ctrl+S works from any field, and when the browser's save dialog is used, the file name you pick becomes the project name.

## 364 · 2026-10-22

- Ctrl+S saves (Save as): the browser's save dialog opens for a name and a folder where it has one, otherwise the file downloads as before. The Save button does the same.

## 363 · 2026-10-22

- Script tab: the script and the scratch grid sit side by side (stacked when the script is docked), with a draggable splitter between them (default about 84 characters wide), and the tutorial column can be dragged wider or narrower too. Both widths are remembered.

## 362 · 2026-10-22

- Scratch pattern: a template menu with rhythm starting points (techno, minimal, house, breakbeat, 2-step, trap, son and rumba clave, bossa, dembow, one-drop reggae). Each fills the grid and stays fully editable.

## 361 · 2026-10-22

- Script tab: a scratch pattern. A small grid (time down, a column per voice) to explore triggers in before anything goes near a real pattern: click or drag cells, invert, rotate, reverse, clear, 8 to 64 rows, up to 8 columns. "script → grid" runs the script into it (each tbin fills the next column; hatched cells are the script's), "to script" writes the grid back as tbin lines, "play" loops it on the instrument under the pattern cursor, and "send to pattern" is the only thing that writes to a pattern.

## 360 · 2026-10-22

- First screen: the click-anywhere line moved down to 40 px above its original spot (halfway between the two).

## 359 · 2026-10-22

- First screen: the click-anywhere line unrolls a fifth faster and sits 80 px higher.

## 358 · 2026-10-22

- First screen: the click-anywhere line unrolls from its first letter and is a little lighter.

## 357 · 2026-10-22

- Config tab tidied: every group is now one card (the same description was repeated beside most settings), settings sit in the card they belong to (First screen look under Look, the graph ones under Graph, the vectorscope ones under Meters, the recording latency under MIDI, resynthesis in its own card), the group name is dropped from labels that began with it, every group has a short description, and the settings-file buttons at the bottom are headed Settings file instead of a second Backup.

## 356 · 2026-10-22

- Script help, when the script panel is docked beside the pattern editor, now opens the tutorial as a column to the right of the script editor (the dock widens to make room) instead of squeezing it in below.

## 355 · 2026-10-22

- The shortcut window no longer lets a long key list squeeze the descriptions out of view: the key column wraps and the descriptions keep their width, with no sideways scrolling.

## 354 · 2026-10-22

- Sampler: a new note now cuts the one-shot its own column was still playing (over the 06 nnaFade time; 0000 cuts at once), with no extra command needed. 1F nnaAll is on by default; write 1F 0000 to let one-shots ring on over the next note as before. Chords and other columns are left alone. The sampler help says so.

## 353 · 2026-10-22

- Sampler help: a new section, Making a new note cut the old one, says what to write (1F nnaAll 0001 and the 06 nnaFade time), and the command list explains 06 and 1F in full.

## 352 · 2026-10-22

- Sample screen: every slice marker can be reached. The slice column is now a small scroll box as tall as the sample's fields; it keeps its place when the screen redraws and scrolls to the active slice.

## 351 · 2026-10-22

- Sample screen: the slice markers now stand in their own column at the right of the sample's fields, so they no longer push the page down, and up to 24 are listed at once (the list follows the active slice) instead of 8 and '... 5 more'.

## 350 · 2026-10-22

- Script tab: the Euclidean preview under the editor now has a grid view (next to cards): time runs down in square cells, one column per pattern, with a column marking the rows where two or more patterns hit together; 16, 32 or 64 virtual rows. It also draws inv(), rot(), rev(), both(), either() and xor() calls with plain arguments, such as inv(euclid(3, 8)), so an anti-pattern can be seen before it runs.

## 349 · 2026-10-22

- Config: new card De-normal diagnostics with two switches, both off by default: Output dither (a whisper of noise on the output) and Volume curve floor (a Volume curve never goes below 0.003). Note preview is on by default (an older stored off is lifted once).

## 348 · 2026-10-22

- First screen: the start-up report text is lighter still and a tenth smaller.

## 347 · 2026-10-22

- First screen: the build and revision show small in off-white at the top right of the card, and the start-up report text is a little lighter.

## 346 · 2026-10-22

- A Volume curve now never goes below 0.003 (about -50 dB), so a fade-in from 0 no longer holds the output at digital silence, where some sound devices click as they wake.

## 345 · 2026-10-22

- Config: Output dither (on by default) adds a whisper of noise (about -96 dB) to the sound going out, so very quiet sound, like the start of a slow fade-in, is not rounded into crackle by the sound card. Exports are unchanged.

## 344 · 2026-10-22

- Volume curves now drive a hidden channel stage after each machine's output node: a 0 to 1 level (1 is the machine as it is set) applied smoothly to every sample, instead of moving the output node's gain. The output node's own gain setting is left alone, and stopping returns the stage to 1. The parameter block is four times larger (your FINALLY8 song was within a few slots of the old limit).

## 343 · 2026-10-22

- With the first screen on, the tracker is hidden from the very first paint, so it is no longer seen for a moment before the splash.

## 342 · 2026-10-22

- A small infinity symbol in the header shows whether the song loop is on (lit) or off (dim), and clicking it switches the loop, like Ctrl+L.

## 341 · 2026-10-22

- Opening a project (a file, the demo, or a new one) now lands on the arrangement (sequencer) screen instead of the pattern editor.

## 340 · 2026-10-22

- Volume curves are now a final amplifier: the curve (0 to 1) multiplies the level the machine is set to, so 1 is exactly as set and a curve can never make it louder (before, 1 meant the gain's maximum, three times a 0.5 setting, which could overload the sound). Stopping puts the machine back at its own level, and changing that level while playing still works. Existing Volume curves will sound quieter.

## 339 · 2026-10-22

- First screen: the start-up report now sits inside the card, growing up from its bottom-left corner, and the status words (ok, ready) all line up in one column.

## 338 · 2026-10-22

- Sampler: new command 1F nnaAll. At 1, a new note also fades out a one-shot sample that is still playing (over the 06 nnaFade time, 0 cuts it), so hits cut each other; at 0, one-shots ring on over the next note as before (nnaFade has only ever acted on looping samples). The command help now says so.

## 337 · 2026-10-22

- The arrangement cursor no longer carries the small pattern colour swatch: the pattern list shows the colour.

## 336 · 2026-10-22

- The shortcut window has a find box: type words or parts of words and only the shortcuts that contain all of them stay (the window title says which screen). The lane menu in the arrangement now says Add automation curve: Volume (or another parameter), and the arrangement shortcut list describes the curve keys.

## 335 · 2026-10-22

- Lane curves: click a line to switch that segment on, then C, L or G make it a curve, a straight line or a gap (with an anchor selected the keys act on the segment after it). Double-click the line to add an anchor; Esc lets go. The icon box still cycles the three.

## 334 · 2026-10-22

- Lane curves: the hover box on a segment is now one small icon box showing what the segment is (a curve, a straight line, or dots for a gap); a click goes round curve, line, gap. No words.

## 333 · 2026-10-22

- Lane curves can now be intermittent. A curve acts only from its first to its last anchor and can have gaps, drawn dotted, where it leaves the parameter alone; when a section ends the parameter glides back to the curve's rest value (the parameter's normal value when the curve was made; right-click an anchor, Rest value, to change it). Click an anchor to select it, then: E extends the curve over the next pattern (an anchor at its end, pinned), Shift+E skips the next pattern and starts a new section over the one after, B breaks or joins the segment after the anchor, [ and ] move between anchors, Left and Right change its value (Shift for bigger steps), Delete removes it, Esc lets go. Right-click a pattern: Curve over this pattern, or Remove the curve over this pattern. The hover box on a gap says gap; tick it to join. Curves also ease into a section so steep parts do not click.

## 332 · 2026-10-22

- Lane curves: anchors keep the normal mouse pointer and fill with the highlight colour under it instead of showing a hand.

## 331 · 2026-10-22

- Lane curves: the hover tick box now goes away when you click elsewhere or leave the grid.

## 330 · 2026-10-22

- Lane curves: a hairline curve per lane that moves one of the machine's parameters over time, across patterns, without being pattern data: the lane's volume or any parameter in its Params list (a filter cutoff over many repeating patterns, say). Right-click in the arrangement: Curve: Volume (or another parameter) draws one over the pattern under the cursor, both ends pinned to its edges. Press on the line to add an anchor, drag anchors (they snap to pattern edges and rows; Alt moves them freely; landing on an edge pins them so they follow the pattern when it moves or is replaced, and let go when it is deleted). Hover a segment for a small tick box: ticked is a bezier, unticked a straight line. Right-click an anchor to pin, unpin or delete it; right-click a lane to switch the curve off or delete it. Curves are saved in the .wax file, undoable, and played smoothly by the engine.

## 329 · 2026-10-22

- Pattern editor: right-click offers cut, copy, paste, clear, transpose, interpolate, randomize and the chord palette, plus what does this command do? on a Cmd cell. New machine help window (Ctrl+Alt+H, or from that menu): small and floating, it follows the cursor lane and lists its columns and its commands with ranges and plain descriptions (every sampler command, cc14 included), with a find box. Click a command in it to type it into the Cmd cell under the cursor.

## 328 · 2026-10-22

- Arrangement: typing a pattern number (or pressing Space on the selected pattern) where a pattern already starts now replaces it with the other pattern, instead of refusing. The old pattern stays in the list; typing the same pattern again does nothing.

## 327 · 2026-10-22

- The vectorscope is now a panel of the meter band, a square the height of the band at its right end (Ctrl+Alt+O, or Config, Meters), instead of a floating overlay; the Scope button and the overlay's size and corner settings are gone. The spectrum colour option's description is short enough to fit its panel.

## 326 · 2026-10-21

- Arrangement: Ctrl+Up / Down steps through the pattern list (the selected one is outlined), and Space places the selected pattern at the cursor and moves on to where it ends.

## 325 · 2026-10-21

- The WAX logo: your glyphs are now the logo on the start screen and at the top of the rail (still the Start button until the audio runs). They take the theme's text colour.

## 324 · 2026-10-21

- The start screen's report no longer jumps around as lines are typed: it is left-aligned from a fixed edge instead of centred.

## 323 · 2026-10-21

- Chord palette (Alt+C): put the cursor on a row of notes, or select rows, and a palette shows the chord on a small piano roll with its name. Voicings (inversions, drops, spread), One note (change a single voice by a semitone or a scale step, with the interval and the chord it makes), Quality (major, minor, 7ths, sus, dim, aug, 9ths) and Smooth rows (each chord revoiced to move as little as possible from the one above). Every variation has an ear button that plays it for one second. Pick the key and scale so changes stay in key; Enter writes it as one undo step.

## 322 · 2026-10-21

- The empty tap slots (tap01 to tap16) no longer clutter the sample pickers: a slot shows once it holds a take or an instrument plays it. Config has a switch to show them all again.

## 321 · 2026-10-21

- Right-click a pattern in the arrangement for a small menu: open it in the pattern editor (or on its own), give it its own copy, slice, remove, and Params, which opens the floating parameters of that lane (Rename is a greyed placeholder). The Open button now sits beside Play, and the params button in the status bar is an icon.

## 320 · 2026-10-21

- Rail: the divider between the rail and the page is a faint line, and the icon outlines are gone (a soft outline appears on hover, the open screen stays filled).

## 319 · 2026-10-21

- Header tidy: the file icons (save, open, export, backups, new) sit next to the song display, and the meters, scope, cut and panic buttons, the build number and the theme moved to the right end of the bottom status bar. The Arrangement icon now shows vertical lanes.

## 318 · 2026-10-21

- New top layout: a slim icon rail down the left edge holds the logo (still the Start button), one icon per screen (Patterns, Samples, Instruments, Arrangement, Script, Dock, Info; hover for the name and key) and Shortcuts, About and Config at the foot. The top bar is one row: transport, the song numbers (len, bpm, swing, bar) as a dark green display you edit in place, then file and tool icons, then the theme.

## 317 · 2026-10-21

- Note preview is on by default: typed notes in the pattern editor sound while the key is held (Insert or \ still switches it off; a choice you already made is kept).

## 316 · 2026-10-21

- The Start button is gone from the top bar: the Wax logo on the left is the Start button until the audio is running (click it, or Enter when focused), then it is just the name.

## 315 · 2026-10-21

- Pattern shortcut list: the zoom keys are written with spaces around the plus (Ctrl + Plus, Ctrl + Minus) so the key and the joining plus can be told apart.

## 314 · 2026-10-21

- Pattern shortcut list: Ctrl+plus / Ctrl+minus is spelled out as zoom (with Ctrl+0 to reset and Ctrl+wheel), so it is not mistaken for the transpose keys, which are Ctrl+Up / Down and Ctrl+, / Ctrl+.

## 313 · 2026-10-21

- Pattern shortcut list corrected: the doubled Left/Right entry is merged, Tab now mentions what it does in solo-edit, Backspace is listed with Delete, and the missing keys are added (Home/End, Shift+arrows selection, copy/cut/paste/select-all, undo/redo, the loop keys).

## 312 · 2026-10-21

- Pattern view: on an empty velocity cell the status bar now shows the value that is in effect there, held from the last velocity written above it in that column (or default FF = 100% before any), the same way parameter columns already do.

## 311 · 2026-10-21

- The loop is now two thin light-red lines running the full width of the pattern and arrangement views, one where it starts and one where it ends, instead of the yellow marks in the tick column. A loop that is switched off keeps its lines, faded.

## 310 · 2026-10-21

- Sequence editor: Insert pushes the patterns from the caret down by 16 ticks, and Delete on an empty spot pulls the patterns below up towards the caret (16 ticks, or as far as the gap allows). Delete on a pattern still removes it.

## 309 · 2026-10-21

- Pattern colours follow the theme: in the arrangement, the pattern list and the tinted pattern editor, the hue still tells patterns apart but the brightness, saturation and strength are set per theme, so dark themes get deep muted tints instead of washed-out pastels, and the amber, phosphor and synthwave themes keep the colours in their own family. Bright is unchanged.

## 308 · 2026-10-21

- Blob first screen: back in the original card size, and the banding that moved with the view is fixed (the translucency was measured with a short stepped march, which left diagonal contours; each pixel now starts its measurement at a slightly different depth, so they turn into fine grain).

## 307 · 2026-10-21

- Blob first screen: the diagonal banding is gone (a hash that used sin() made diagonal patterns on some graphics cards; the shader now dithers the slow gradients instead).

## 306 · 2026-10-21

- Blob first screen: a few quiet lights instead of one even glow: a soft warm key from the upper left, a cooler fill from the right, and a faint light from behind and below that shows through the thin parts.

## 305 · 2026-10-21

- First screen: a slow translucent blob (WebGL metaballs with a subsurface-style shader) drifts behind the Wax wordmark, follows the pointer a little and brightens when you click in. Config > First screen look switches back to the turning logo, which is also used when WebGL is not available; reduced-motion keeps it still.

## 304 · 2026-10-21

- Graph editor: Insert opens the machine menu, and Ctrl+D (duplicate), Ctrl+X and Delete (remove) work on the selected node wherever the focus is on the instrument screen, not only on the canvas. The Duplicate node and Delete node buttons are gone.

## 303 · 2026-10-21

- Graph editor: a node's preset row and its Duplicate and Delete buttons now sit in the bar above the graph, beside Add node, instead of under it.

## 302 · 2026-10-21

- Script: in tbin, a . now empties its cell (note and velocity), so a pattern written over an older one replaces it instead of mixing with it; tbin(..., { keep: true }) leaves the old cells alone as before.

## 301 · 2026-10-21

- Script help: Euclidean rhythms explained in plain words with pictures: a ring and step row for an example, a builder with hits / steps / shift sliders and a button that puts the tbin line in the try-a-line box, and a gallery of twelve traditional rhythms to click. The help text can now carry such pictures (a line like ::euclid 5 8:: draws one).

## 300 · 2026-10-21

- The app is now called Wax (the page title, header, About and README); the repository, web address and your saved settings keep the webtracker name.

## 299 · 2026-10-21

- Nugget mode now stays in nugget mode when you type: after the last character of a cell (an octave, say) the cursor goes down a row on that same character and keeps the mode, instead of jumping to the first character of the next cell.

## 298 · 2026-10-21

- Config defaults: Follow mode (the red line) is on, and dragging a graph node far from its chain no longer takes it out (both still switchable on the Config page; a setting you already saved is kept).

## 297 · 2026-10-21

- New synth node: Fourpole (Synths in the add menu, and an instrument kind). After the design of Fuzzpilz's Buzz machine Orange Kid: two table oscillators with ten waves (sine, triangle, square, saws, three sawoids, two seeded noises), phase, transpose, detune, six mixes (1+2, 1-2, 2-1, 1*2, 1/2, 2/1) and a start/end window on the table; two linear ADSRs, the second a modulation envelope; four resonant lowpass/highpass filters that can slave to filter 1, eight routings, a cutoff limit (fixed Hz or relative to the note) and inertia; vibrato, glide, tuning; envelope amounts for vibrato rate and depth, cutoff, resonance, pitch and amplitude.

## 296 · 2026-10-21

- Script tab: a live Euclidean preview under the editor. Every euclid(hits, steps, rotate) written with plain numbers, and every 'x..x' string, is drawn as a ring and a row of steps while you type, before anything runs; the card of the caret's line is outlined.

## 295 · 2026-10-21

- The arrangement's shortcut window no longer repeats the lane controls and the pattern list's splitter; it lists only the keys.

## 294 · 2026-10-21

- Changing the song length no longer stops the song: the new length is sent to the running engine and the cursor stays where it was.

## 293 · 2026-10-21

- Recording sliders: with Rec armed (Ctrl+Shift+R) and the song playing, moving a slider in the floating window, the graph's exposed dock or the node panel writes its value into the lane on the nearest tick: into the parameter's own column, else into the Cmd column as CCXXYY. The last value of a tick stays, a take is one undo step, and Config (Recording sliders) can write only every 2nd, 4th... row.

## 292 · 2026-10-21

- Floating parameter window: Ctrl+Alt+P (or the params button in the status bar) shows the exposed sliders of the cursor lane's machine over the pattern editor and the arrangement. Drag its title to move it; the sliders work with the mouse or a MIDI knob while the song plays. Position and on/off are remembered.

## 291 · 2026-10-21

- Script: scatter({ samples, density or hits, note, vel, offset, retrig, cmd, cmdChance, step, clear }) writes a random pattern from a collection of samples: each option is a value, a list to pick from, { min, max } or a function. Documented in the Script tab's quick start.

## 290 · 2026-10-21

- Samples: Shift+E auto-slices: a marker on every hit of the sample (or of the selection), found by spectral-flux onset detection. Sensitivity and the shortest gap are in Config (Sample).

## 289 · 2026-10-21

- Pattern editor: fills the window height (Config: pattern editor fills the window height), and its cursor rows (position, column name, value meter, range) moved into the main status bar. The page's bottom space follows the status bar's height. On Pages the service worker now revalidates files, so a new build is never held back by the browser's cache.

## 288 · 2026-10-21

- Arrangement: V switches the pattern minimaps on and off; H and V are in the shortcut list.

## 287 · 2026-10-21

- Arrangement side panel: a one-row draggable line between the pattern list and the lane controls sets the list's height (Up/Down on the line when it has focus, double-click for automatic). It is remembered.

## 286 · 2026-10-21

- Arrangement: the lane, insert-silence and add-lane controls moved under the pattern list, the lane's status line is now a row of its own above the status bar, and the arrangement fills the window height (Config: arrangement fills the window height; off brings the drag bar back).

## 285 · 2026-10-21

- Hosted on GitHub Pages: every push to master runs the tests and publishes the app. A service worker supplies the cross-origin isolation headers there, and the header shows "build NNN · commit" (version.json, made from git by serve.mjs, with a + for uncommitted changes).

## 284

- Fixed: m283 did not start (a stray quote in the About text). The smoke test now loads that file.

## 283

- Parameter view: a parameter that a CC command writes has a blue stripe and tint on its name and the command's id in the bar (2C, 31...). A small cc button in the panel title (and Config, Graph) hides all of them.

## 282

- Sampler commands from UnwieldyTracker: stretch (2B to 2D, the whole sample spread over a length by granular repeats), jumps in the wave (60 to 67), a filter on each sound (30 to 35: type, cutoff, resonance, slides, step per repeat), vibrato and cutoff LFO (40 to 45) with phase sync (50 to 53), humanizing the cutoff and timing (38, 39), resets (A0 to AF) and settings slots (70 save, 71 load). See the Sampler help. Shuffle (80 to 83) is not in yet.

## 281

- Graph: a very faint dot grid (a brighter dot every 12) and nodes snap to it while you drag; hold Ctrl to move freely. Config (Graph) has the on/off switches, the spacing and the bright-dot interval. The tick lines on time sliders are light blue now.

## 280

- Sampler commands 20 to 2A: pitch slides (20 to 23, XX semitones over YY subticks), glide to the next note (24), shortest and longest repeat time (25, 26) and a repeat time curve (27), cut after and release after n ticks (28, 29) with a per-repeat scale (2A). See the Sampler help.
- Sequence editor: H hides the pattern names in the cells (Config: show pattern names); the statusbar gives the name of the pattern under the cursor and how many times it is placed in the lane, so you can clone it (N) before editing.

## 279

- The absolute offset parameter is called blockCount (the number of full 65536-frame blocks before the frame in Off). The sampler's About page has a section on FF and F0 with examples.

## 278

- Sampler: command FF makes the Off column absolute. Off holds the low four hex digits of a frame number and the value of FF the number of full 65536-frame blocks before it (the hh of hh:hhhh): Off 0300 with FF0002 starts at frame 2:0300. It stays until F0 (any value, F00000 will do) puts Off back to a fraction of the sample. Each sampler instrument has its own state. Saved sampler instruments get both commands on loading.

## 277

- Sample display: drag with the middle mouse button to move along a zoomed view. Slice markers show their place two ways (Config, Sample: Slice markers hex value): relative, from 0000 to FFFF across the whole sample as before, and absolute, the frame number in hex, as hh:hhhh for samples longer than 65536 frames (hh is how many full blocks of 0000 to FFFF were passed). Graph: right-click a node to replace it with another type; wires and shared parameters carry over, and sources and effects are not offered for each other.

## 276

- Fixed a stuck note: changing a machine's graph while the song plays (adding a node, even an unconnected one) rebuilds the machine, and the lane that plays it forgot which notes it had started, so a note that began in between never got its note off. A replaced lane now keeps what it was playing.
- Nugget mode: Up and Down move by a step (Config, Editing: Nugget mode rows to move, 1 by default) and stay on the same character.

## 275

- Arrangement: click a tick number to put the playhead on that tick (the row covers its ticks): while playing it jumps there, stopped it plays from there. Double-click a pattern to open it in the pattern editor (Ctrl+double-click: solo-edit). L switches the loop off and on (Ctrl+L is taken by the browser). The pattern list beside the arrangement has a drag bar: narrower, or all the way right to hide it (double-click toggles).
- Graph: hovering a wire or a port says what it carries in the status line under the graph, and the colours of the four kinds of wire are in Config (Graph).
- The demo song is your tweaked version.

## 274

- The demo song is two minutes now (it was three). The arp comes in just before the middle and its filter opens in about 25 seconds instead of a minute, with the choruses following close behind.

## 273

- Demo song: depth charges (a sine that falls from high to deep, through a long hall) at the tops of seven of the swells, and an arp from two thirds of the way in. The arp starts muted (its filter nearly shut), quickens from quarter notes to sixteenths while the filter opens, then drowns in two choruses in series. All of it is written in the pattern columns of the instrument (Cut, Res, Mix, Dep, Mx2), so it shows how to automate node parameters from a pattern.

## 272

- Sampler: command 1E sets the subdivide (subticks per tick, default 6), the unit of the volume slides' time, as in UnwieldyTracker. A slide to nothing stops at -120 dB. (Checked against the UnwieldyTracker 2 DLL: the level scale, the fine-slide unit and the timing match.)

## 271

- Sampler volume slides now follow the later UnwieldyTracker: in XXYY, XX is the time (in subticks, six to a tick) and YY the amount (levels in 40 hex = the sound's own level, dB in whole dB, fine slides in 256ths of a dB). New commands 90 to 93: the same slides as 1A to 1D with the time in tens of milliseconds, whatever the tempo.

## 270

- Sampler volume slides (commands 18 to 1D, after UnwieldyTracker): 18 linear slide to a level, 19 the same even in dB, 1A and 1B log slide down and up by XX dB, 1C and 1D fine slides by XX/16 dB. In XXYY, XX is the amount and YY the time in sixteenths of a tick. Written while a note plays they slide it; written before a note, they slide every sound of the note. The sampler's help page lists them.

## 269

- The keyboard shortcuts are now a small floating window instead of fixed panels: the Shortcuts button opens it for the screen you are on, Esc or the × closes it, and you can drag it by its title bar. The Hide-the-panels setting is gone (the panels always stay out of the way). The script tutorial and the arrangement's pattern list are where they were.

## 268

- Pattern editor: Left and Right no longer wrap round from the first column to the last (or back) by default. The old wrapping is an option in Config: Editing, Left and Right wrap round the ends. Tab still goes to the next lane and round.

## 267

- Sampler grains: twelve new commands for the sampler (0B to 0F, 11 to 17): grain length and edge, repeat speed-up, pitch step per repeat, pitch slide, flip direction, repeat chance, and jitter of offset, pitch, pan, timing and level. With a grain length the repeats overlap, so a short Rtg makes a cloud. All default to off, and older projects get the commands added when they load.
- The sampler's help page (F1 on the node in the instrument screen) now explains how notes, repeats and grains work, with recipes and the full command list.

## 266

- Docked Script panel: the script editor now starts at the same height as the pattern grid.

## 265

- Docked Script panel: a Script help button under the editor shows or hides the scripting help and tutorial inside the panel.

## 264

- Script panel can be docked to the right of the pattern editor: Ctrl+Alt+D or the Dock button next to the Script tab. Drag its left edge to resize; it is remembered. Scripts still act on the pattern under the pattern editor's cursor.

## 263

- Opening a pattern from the arrangement (Enter or double-click) scrolls the pattern editor sideways so all of that lane's columns are in view, when they fit.

## 262

- Sample screen: the display zooms. Shift+Z zooms to the selection, Shift+A zooms out, Shift+W shows the whole sample, Ctrl+wheel zooms about the mouse and the wheel scrolls a zoomed view (also in the right-click menu).
- A new sample loop starts switched off (drawn faint on the display); the Loop / SusLoop switch turns it on.
- A selection dragged out past the edge of the display (the start, the end, or the last sample) is no longer thrown away: the pointer past an edge holds it at the first or last frame.

## 261

- Sample screen: drag audio files onto it to load them (a dashed outline shows where they will land); several at once work. Dropping a file anywhere else on the page is refused, so a slip no longer makes the browser open the file and leave the page.

## 260

- Script tab: a quick-start tutorial under the editor, rendered from markdown (it folds away, and remembers that). Click an example in it to put it in the try-a-line box. There is a small markdown renderer in the app for help texts like this one.

## 259

- Arrangement: Ctrl+wheel changes the size of a row: a bar (16 ticks in 4/4), half a bar, a beat, and back; the choice is remembered. New "bar" field in the top bar: the beats in a bar (the top of the time signature, 4 unless you change it, saved with the project). The arrangement's rows are one bar tall, its shading marks every four and sixteen bars, and the row sizes on offer are the divisors of the bar that are at least a beat (3 beats: 12, 6, 4 ticks).

## 258

- Arrangement: Ctrl+E puts the loop end at the start of the cursor row, as Ctrl+B puts the start there, so the cursor row is the first row after the loop (before, the loop included it). The About window has a close button at its top right. Ctrl+L switches the loop off and on, in the arrangement and in the pattern editor: its marks stay, greyed, and playing runs through the song; the state is saved with the project.

## 257

- Node presets: every node's panel has a preset menu: the factory presets of the node type (the additive synth has organ, glass bell, hollow pad, formant choir and soft sine) and your own, which you save by typing a name and pressing Save (kept in this browser, for every project and every node of that type; the ✕ deletes the chosen one of yours). A preset sets every parameter and the drawn spectrum; whatever it leaves out goes back to the default. The pattern list in the arrangement panel has its lengths in a column of their own, right-aligned, with long names cut short.

## 256

- Top bar regrouped, with a thin rule between the groups: Save | Start, play, record, Follow | length, bpm, swing | Open, Export, Backups, New | meters, scope | Cut, panic. Load is now called Open and Export WAV is just Export.

## 255

- Arrangement: the list of the patterns of the lane under the cursor is now in the panel on the right, above the shortcuts, instead of under the grid. Hiding the shortcuts keeps the list.

## 254

- Graph: a wire between two close nodes loses its S-curve: its bend eases away as the ends come within 60 px of each other and it is a straight line at that distance (Config > Editing > Graph: wires between close nodes go straight; 0 keeps every wire curved). The "click anywhere to enter" text on the splash stays grey.

## 253

- First screen redone: a white card (1 : 1.6) with your logo, bigger than the card and cut off at its left, built from the fourteen identical slabs of your 3D model, all in one plane, and drawn as a slowly turning wireframe (plain canvas, no libraries); a very faint "webtracker" and a quiet "click anywhere to enter" (a click on the card, or Enter or Space, starts the engine), the logo swings a little further while a few grey lines report the real start-up steps, and the card fades away to show the tracker (about a second); the card takes about a fifth of the screen. Config > Look > First screen still turns it off.

## 252

- First screen: at start-up there is only a "click to initialize" button (big, green on black); a click starts the audio engine, a few lines of real start-up report type out (audio context, DSP, worklet, node types, project) and the screen folds away to show the tracker, about a second in all. Config > Look > First screen turns it off (then the tracker shows with its Start button as before).

## 251

- The list of console rules in Config has line numbers to its left, so "line 8 clashes with line 9" can be found at once; the numbers of rules that are switched off are red.

## 250

- Command console: press | in the pattern editor or the arrangement for a one-line box (Enter runs, Esc closes, Up recalls, ? lists the rules). It acts on the selection. What you can type is a list of rules in Config > Console, one per line, like `tp{n} -> transpose {n}`; the first set is cop (clone in place), tp12 / tp12- (transpose up / down), r4 / r4- (rotate rows down / up). Rules can have several steps (`up -> transpose 12; clone`). A rule that is wrong, or that could match the same typing as another, is switched off and flagged in Config until you fix it; typing that matches nothing is listed there as well, to show what to add next.
- Spectral panner: a built-in motion (rate in Hz, sweep, wave) moves the image by itself; it adds to rotate, so a wire or a pattern can still drive it.

## 249

- Fixed: after the demo song ended a faint, slow flutter (about 17 Hz) hung on and never died: the shimmer in the swells was set to a decay of 28 s while the node stops at 20 s, and beyond that the loop never lost energy. The hall now holds its decay at 20 s whatever it is given, and the demo uses 18 s.
- Fixed: after Cut the meters and the spectrum froze on their last picture; they now fall to silence.
- The layers of the spectrum by instrument show on and off plainly (a solid lane colour against a dim struck-through number) and have an all button. Config is a gear at the far right of the tab bar.
- The demo song has more variety in its chords: some are short, some long, and the second and third passes use inversions and wider voicings (Em7, Dmaj7, Cmaj7, Am11, Bm7 and a Cmaj9).

## 248

- Spectrum by instrument (Config > Meters > spectrum by instrument, off by default): the meter band's spectrum splits into one translucent layer per instrument, added together where they overlap, with the whole mix as a faint outline. Small numbered buttons at the panel's top right (the lane numbers) hide or show a layer; Shift+click hears only that one. Hidden layers cost nothing, and nothing is computed while the option is off.

## 247

- The Info page has a close button (×) at the top right; it returns to the tab you came from.

## 246

- The spectrum in the meter band is coloured by frequency like a light spectrum (dark violet at the bass, through blue, cyan, green, yellow and orange to red at the top); Config > Meters > spectrum colour switches back to plain green. The Meters and Scope buttons are icons now.

## 245

- The demo song is rebuilt as an arrangement: short patterns cut where the notes start and placed again where the music repeats (one pattern per chord for the pad, sub and wind, a melodic pattern per chord for the stars, sixteen-tick patterns for the clock, one per swell strength), entrances at different times (the Shepard tone alone first, the wind and the first stars before you expect them, a quiet teaser swell, a clock that drops out and returns off the beat), and two incidental lanes drowned in taps, echoes and verbs: glassy blips from a third of the way in, and crackle clusters only in the last third.

## 244

- Pattern minimaps in the arrangement (Config > Arrangement, off by default): every cell shows a small picture of the 16 ticks it stands for. Notes are ticks across the cell by pitch, as bright as their velocity, with a thin line for how long they sound down to the next note, a note off (cyan cap) or a note cut (magenta cap); parameter columns are grey cells at the right edge, darker the higher the value, empty ones left out. Note lengths, the off and cut caps and the parameters can each be switched off. Drawn on one canvas over the arrangement, redrawn only when something it shows changes.

## 243

- Meter band (Ctrl+Alt+M, or the Meters button): a strip along the bottom of the window, above the status bar, with a spectrum (peak hold), level meters with short-term and momentary loudness (LUFS) and peak, a stereo correlation bar, stereo width for the ten bands of the spectral panner, and a spectrogram of the last 30 seconds. Choose the panels and the height in Config under Meters. Nothing runs while it is hidden. The vectorscope and the meters can be on together.

## 242

- The vectorscope overlay can be dragged anywhere (it is remembered), resized by dragging its corner, and sent back to its corner by double-clicking it. It starts further from the window edge.

## 241

- Vectorscope overlay (Ctrl+Alt+O, or the Scope button): left against right of the master output, turned 45 degrees, in a corner of the window over any screen. A mono sound is a vertical line, a wide one spreads sideways, out-of-phase material lies flat. It draws a glowing line that fades; size, corner, linger and glow are in Config under Scope. Click-through, and it costs nothing while hidden.

## 240

- Export WAV (button in the top bar): renders the whole song once, offline and faster than real time, with progress, then a tail of silence-to-be (reverbs and delays dying out) and downloads a stereo .wav. Tail length (default 15 s) and format (16-bit, 24-bit, 32-bit float) are in Config under Export. Press the button again to cancel.

## 239

- Demo song retouched: the swells are much quieter (no clipping at their peak), and the tick runs through a Shiva multitap whose length drifts slowly.

## 238

- New demo song: an interstellar soundscape, three minutes of a Shepard-style glide under slow chords, delayed stars and seven swells that cut into long, wide Shiva-delay and shimmer tails. Load it with Demo.

## 237

- The noise node comes in every colour: tilt sets the slope of the spectrum from -6 dB/oct (brown) through pink and white (0) to +6 (violet), matched in loudness. New free switch: the noise runs by itself, without notes. White at tilt 0 is exactly as before. Help page for noise.

## 236

- Backups by download, for browsers that cannot write to a folder (Brave keeps that off): turn on Download a backup file in Config and the page downloads a time-stamped .wax every 15 minutes (adjustable) while the project has changed. Point the browser's download folder at a git folder to keep them.

## 235

- The Backups panel tells Brave users how to switch on folder backups (brave://flags/#file-system-access-api).

## 234

- Automatic backups. A snapshot of the project is kept in the browser every 3 minutes while it has changed, when you Save, when the tab is hidden, and before a load, a clear or a restore; the newest 30 are kept. The Backups button lists them with Restore and Save as file. Optionally choose a backup folder (a git folder works) and the page writes the project there too, as one overwritten file or a new file each time. Settings are in Config under Backup.

## 233

- Spectral panner shows its settings: a graph under the node with frequency along the bottom and each band's pan as a bar (up is left, down is right, as far as spread carries it), the mono region shaded, following every slider live. New demo song.

## 232

- Node help pages: F1 with a node selected on the instrument screen (or the ? on its parameter window) opens a page for it: what it is for, how to get the most out of it, its limits, its ports and every parameter. Pages are written for the spectral panner, compressor, hall, delay, filter, freqshift and blur; every other node shows its ports and parameters until it gets a page.

## 231

- New node: spectral panner (Effects, Spectral). The sound is split into ten bands and each band gets its own place in the stereo field: alternate, sweep, wave or custom (b1 to b10). Spread sets how far, rotate slides the pattern along the bands, and everything below low mono is made mono so kick and bass stay in the middle. It costs about as much as a chorus.

## 230

- Sample screen: click a sample to pick it, a field to move there (click again to type a value, or just type digits), a loop switch to flip it, a slider bar to set the level, Waveform or Spectrum to change the display.
- Ctrl+W no longer closes the tab silently: the page swallows it where it can and otherwise asks first.

## 229

- Time and rate sliders (delay times, attacks, decays, LFO speeds...) show faint red lines where song ticks fall at the current tempo, the beat stronger, and the value in ticks (3.02t) beside the hex. A mouse drag snaps to a line when it is close; hold Alt to drag freely. Config: Time sliders (lines, snap).
- Fixed: dragging a slider in the exposed-parameters dock stopped after the first step.

## 228

- Pattern editor status bar: two lines. The cursor's place is small on top; under it the column's name is large, with a meter showing where the value sits in its range, the value in real units, and the range and hex.
- Ctrl+K steps the colour of the pattern under the cursor (Ctrl+Shift+K backwards). The randomize menu moves to Ctrl+R, and rolling again to Alt+R. Arming MIDI recording moves to Ctrl+Shift+R.
- The built-in demo song is updated.

## 227

- Script tab (Ctrl+Alt+S): a small code editor with colouring. A script writes pattern data into the pattern under the cursor in the pattern editor (or its selection): tbin turns a bit pattern such as 'x... x.x.' into notes (one character a row, or every step rows), with chords, voices(...) for a sequence per column, euclid, ramp, sine, scale, a seeded random, and more. It runs in a Worker with a time limit and changes nothing if it fails; one undo step. Ctrl+Enter runs the selected code (or all), Ctrl+Alt+R in the pattern editor runs the script on the pattern there. MIDI keys fill a note list in the code. The script is saved with the project.

## 226

- The Panic button is now a small skull and crossbones (it turns red when you hover it).

## 225

- Instrument editor: switching to an instrument selects the node you left selected there, or else its first generator (oscillator, sampler, synth), so the piano keys play it at once.

## 224

- Ctrl+G (a placement gets its own copy of its pattern): the copy now always has a different colour from the original, so you can see it happened. Before, a pattern coloured with K in the sequencer was copied with the same colour, and an automatic colour could also come out the same.

## 223

- Tap node (Effects > Routing): records the signal passing through it into a sample while the song plays, started and stopped from pattern columns (trig, len in ticks, smp, ch, fade, fadein, copy). Takes go to a pool of 16 slots, tap01 to tap16 (never saved), which samplers can play; the node shows which slot it writes to. K on the Samples screen copies a sample out as a normal one.

## 222

- Recording on the Samples screen: record a new sample from another browser tab or screen audio (Chrome or Edge, through the share picker) or from any input device, with a level meter and an optional wait for sound. Esc or Stop keeps the take as a new sample.

## 221

- The tracker has an icon: the author's pink burst mark, round, as icon.ico (16 to 256 px) and icon.png, used as the browser tab icon.

## 220

- About text corrected: most features come from a longstanding wish-list; some emerged in conversation and after implementation.

## 219

- Pattern editor: Ctrl+Shift+Delete removes the pattern under the cursor from the arrangement, like Delete in the sequencer.

## 218

- Interpolation popup (Ctrl+I): a bezier shape. Drag anchors and handles; points cannot cross in time and values stay in range. Double-click adds or removes an anchor, Alt-click breaks or joins an anchor's handles.

## 217

- Vocoder node (Effects, Filter & EQ): up to 32 bands, a voice input and a carrier input (or a built-in buzz when nothing is wired to carrier), attack and release, formant shift, sibilance pass-through.

## 216

- Pattern editor: Space writes the live value of the parameter under the cursor and steps down; Ctrl+Space writes the live values of every parameter column of the row. Row audition is F7 only. Ctrl+Enter and Ctrl+Shift+Enter are free.

## 215

- The caret can roam while Follow is on: moving it to another row pauses the following (a message says so), and F9 or the Follow button picks it up again. Config: Allow the caret to roam while following can turn this off.
- The highlighted words in the shortcut lists now have a background fill so they jump out.

## 214

- The shortcut lists now pick out the important words of each description in a quiet accent colour.
- Demo song updated.

## 213

- Fixed: dragging with the mouse in the pattern grid also made a native text selection that smeared across whole lines (the faster redraw no longer destroyed it). The grids now refuse native text selection; the grid's own selection is unchanged.

## 212

- Interpolation along a curve (Ctrl+I): the first and last filled cells of the selection are the ends, filled cells in between get values by row position. A popup offers shapes, a bend, a wave on top, drawing your own curve with the mouse and including empty cells; the grid updates live, Enter applies and Esc cancels.
- Nugget mode: after Ctrl+Left/Right, plain Left/Right stay inside the cell until you step past its edge, Up/Down keep the character position.
- A new demo song.

## 211

- Snappier pattern editing: every row of the grid is its own element and only the rows that changed are rewritten, so a cursor move or an edit touches two rows instead of the whole grid (key-to-screen time in a test went from about 60 ms to the 33 ms floor of two frames).
- The playhead is an overlay by default now: a faint band across the playing row that never touches the grid text, so playing costs the grid nothing. Config: Playhead can still be the marker or the red line.

## 210

- Pattern editor: Ctrl+Delete deletes and pulls the rows below up, Ctrl+Insert pushes them down; neither crosses into the next pattern.
- Ctrl+Alt+Up/Down rotates the contents of the selected rows.
- Ctrl+K randomizes the selection (shuffle values or cells, redraw from the column's own spread, nudge, or redraw with empties); Ctrl+Shift+K rolls again from the original, and all the rolls undo in one step.

## 209

- Graph: Shift+drag a node takes it out of its chain, Alt+drag moves a copy, Ctrl+X removes the node.
- Pattern editor: > clears the cell under the cursor, like Delete.

## 208

- filterPro: a filter with twelve voicings (lowpass, bandpass, highpass, notch, peak, allpass, morph, 24 dB lowpass, Moog-style ladder, vowel formants, two tuned combs), per-sample cutoff modulation, drive with bias, self-oscillation at full resonance and a dry/wet mix.

## 207

- Squelch: a monophonic 303-style bassline instrument. One note column, plus Acc and Sld columns (1 on a row = accent / slide into that note), and every knob can be written from the pattern.
- Config: the graph can be told not to take a node out of its chain when you drag it away.

## 206

- Faster pattern editing: the grid is only redrawn when it changes, and only the screen you are looking at is drawn. Idle frames dropped from about 36 ms to 16 ms in a test, and holding an arrow key no longer queues behind needless work.

## 205

- MIDI step entry writes a chord from the lowest note to the highest, whatever order the keys were struck in (Config: or in the order played).
- Shift+1 writes a note off in every note column of the row, then moves down.

## 204

- Left and Right in the pattern editor move by whole cells, to the first character of the next or previous column; Ctrl+Left/Right move one character inside the cell. Config: Left and Right move by cells or characters.
- Raising and lowering values moved to Ctrl+, and Ctrl+. (Ctrl+< and Ctrl+> for bigger steps), since Ctrl+Left/Right are now the character keys.

## 203

- This About box.

## 202

- Play, stop and record are icons: a triangle, a square and a red dot.
- Alt+Up / Alt+Down change the tempo (Shift for 10).

## 201

- Post-transient resynthesis: right click a sample and keep its attack as real sample data while the rest is rebuilt as a few synth branches (as few as the sound needs).
- New noise node.

## 200

- Save sits at the far left and Load at the right.
- A new demo song.

## 199

- Adding a node that is not wired to anything no longer cuts the playing song.

## 198

- Save and Load moved apart.

## 197

- MIDI keyboard input: step entry with chords, optional velocity, and quantised recording into patterns while the song plays.

## 196

- Right-click menu on the sample display (trim, cut, silence, reverse, normalise, fades and more).

## 195

- Previewed notes now sound at the same octave they play back at.

## 193

- Pin a parameter view with the thumb-tack so it stays in the graph view while you click other nodes.

## 192

- LFO: steps, how many updates it makes per tick.

## 191

- LFO: range, min and max.

## 190

- Tint patterns by colour (Alt+T), a faint patchwork under the pattern editor.

## 189

- Comb-resonator percussion synth: toms, bells, pipes and industrial hits.

## earlier

- Everything up to m188: patterns, arrangement, the node graph with its synths and effects, the sample editor, importers and the file format. See the README.
