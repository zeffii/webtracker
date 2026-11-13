// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['763', ['Rotary, a rotating speaker cabinet: a spinning horn and drum heard by two microphones, with a stop, slow and fast switch whose glide you can write in a pattern.']],
  ['762', ['Compass, a vector synth with wave sequencing: four lanes of stepped waves at the points of a diamond, a drawn path that moves the mix, drawn amplitude and filter envelopes. Its blocks are nodes too: waveseq, vecmix and vecpath.']],
  ['761', ['Songs open from a gist by id: ?gist=ID in the address, or File, Open from link with an id, a gist address or a link to a .wax file.']],
  ['760', ['Carve in the mixer: a spectral stage for mastering where the loudest lane in a band keeps its level and quieter overlapping lanes dip (Amt, Depth, Focus, and a lead button per lane). Off by default; about 85 ms of delay while on.']],
  ['759', ['The graph toolbar strip is centred on the graph\'s height and hides itself when there is no room for it.']],
  ['758', ['The instrument graph has a toolbar strip on its left edge: grid, snap, wire looks, compact nodes, pull out and hiding command parameters, with hover text.']],
  ['757', ['Parameter sliders show their full extent again, with a faint background behind the empty part.']],
  ['756', ['The parameter sliders lose the thin line under them: just the fill and the mark.']],
  ['755', ['The Pogue panel puts its Pattern picture last, after Feedback.']],
  ['754', ['Pogue draws the onset detector over its voices (only while onset is above 0), with the sensitivity line you can drag and a line at each trigger.']],
                    ];
