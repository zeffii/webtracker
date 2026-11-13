// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['768', ['The pattern view\'s tick column now starts to the right of the scope strip, so the strip no longer covers the row numbers.']],
  ['767', ['The sampler playhead moves with the keys: after a click on the waveform, Left and Right step it one frame (Shift: one pixel), Home and End jump to the start and end.']],
  ['766', ['A scope overlay for the pattern view: one big oscilloscope of the master output (trace, phosphor or XY), with an icon strip at the left edge showing its switch and sliders. Ctrl+Alt+L. Off by default.']],
  ['765', ['Spectral panner: a punch slider keeps attacks in the centre (a sweeping kick no longer splits and crunches), with punchTime for how long until the image opens again. Off by default.']],
  ['764', ['Khufu, a string machine: three sawtooth registers an octave apart with a drawn amplitude envelope, played through the new ensemble effect (three wobbling delays), which is a node of its own.']],
  ['763', ['Rotary, a rotating speaker cabinet: a spinning horn and drum heard by two microphones, with a stop, slow and fast switch whose glide you can write in a pattern.']],
  ['762', ['Compass, a vector synth with wave sequencing: four lanes of stepped waves at the points of a diamond, a drawn path that moves the mix, drawn amplitude and filter envelopes. Its blocks are nodes too: waveseq, vecmix and vecpath.']],
  ['761', ['Songs open from a gist by id: ?gist=ID in the address, or File, Open from link with an id, a gist address or a link to a .wax file.']],
  ['760', ['Carve in the mixer: a spectral stage for mastering where the loudest lane in a band keeps its level and quieter overlapping lanes dip (Amt, Depth, Focus, and a lead button per lane). Off by default; about 85 ms of delay while on.']],
  ['759', ['The graph toolbar strip is centred on the graph\'s height and hides itself when there is no room for it.']],
                    ];
