// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'webtracker is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Nothing here was planned in advance; every part is there because it was wanted while making music with it.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['m209', ['Graph: Shift+drag a node takes it out of its chain, Alt+drag moves a copy, Ctrl+X removes the node.', 'Pattern editor: > clears the cell under the cursor, like Delete.']],
  ['m208', ['filterPro: a filter with twelve voicings (lowpass, bandpass, highpass, notch, peak, allpass, morph, 24 dB lowpass, Moog-style ladder, vowel formants, two tuned combs), per-sample cutoff modulation, drive with bias, self-oscillation at full resonance and a dry/wet mix.']],
  ['m207', ['Squelch: a monophonic 303-style bassline instrument. One note column, plus Acc and Sld columns (1 on a row = accent / slide into that note), and every knob can be written from the pattern.', 'Config: the graph can be told not to take a node out of its chain when you drag it away.']],
  ['m206', ['Faster pattern editing: the grid is only redrawn when it changes, and only the screen you are looking at is drawn. Idle frames dropped from about 36 ms to 16 ms in a test, and holding an arrow key no longer queues behind needless work.']],
  ['m205', ['MIDI step entry writes a chord from the lowest note to the highest, whatever order the keys were struck in (Config: or in the order played).', 'Shift+1 writes a note off in every note column of the row, then moves down.']],
  ['m204', ['Left and Right in the pattern editor move by whole cells, to the first character of the next or previous column; Ctrl+Left/Right move one character inside the cell. Config: Left and Right move by cells or characters.', 'Raising and lowering values moved to Ctrl+, and Ctrl+. (Ctrl+< and Ctrl+> for bigger steps), since Ctrl+Left/Right are now the character keys.']],
  ['m203', ['This About box.']],
  ['m202', ['Play, stop and record are icons: a triangle, a square and a red dot.', 'Alt+Up / Alt+Down change the tempo (Shift for 10).']],
  ['m201', ['Post-transient resynthesis: right click a sample and keep its attack as real sample data while the rest is rebuilt as a few synth branches (as few as the sound needs).', 'New noise node.']],
  ['m200', ['Save sits at the far left and Load at the right.', 'A new demo song.']],
  ['m199', ['Adding a node that is not wired to anything no longer cuts the playing song.']],
  ['m198', ['Save and Load moved apart.']],
  ['m197', ['MIDI keyboard input: step entry with chords, optional velocity, and quantised recording into patterns while the song plays.']],
  ['m196', ['Right-click menu on the sample display (trim, cut, silence, reverse, normalise, fades and more).']],
  ['m195', ['Previewed notes now sound at the same octave they play back at.']],
  ['m193', ['Pin a parameter view with the thumb-tack so it stays in the graph view while you click other nodes.']],
  ['m192', ['LFO: steps, how many updates it makes per tick.']],
  ['m191', ['LFO: range, min and max.']],
  ['m190', ['Tint patterns by colour (Alt+T), a faint patchwork under the pattern editor.']],
  ['m189', ['Comb-resonator percussion synth: toms, bells, pipes and industrial hits.']],
  ['earlier', ['Everything up to m188: patterns, arrangement, the node graph with its synths and effects, the sample editor, importers and the file format. See the README.']],
];
