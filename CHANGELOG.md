# webtracker changelog

Full history, newest first. The About page shows only the latest 10 builds.

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
