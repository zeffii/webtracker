// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['376', ['Live picture: five shader templates to start from (Config > Visual).']],
  ['375', ['MP4 export always uses AAC sound (a built-in encoder where the browser has none), so X accepts it.']],
  ['374', ['Export shows a progress bar at the right of the status bar.']],
  ['373', ['The bugsong demo no longer has a stray loop set.']],
  ['372', ['New demo: bugsong. Open the page with ?demo=bugsong (and ?demo=arp for the arp demo).']],
  ['371', ['The live picture shows a skeleton of the patterns around the playhead, with lane names, in one muted blue; cell(\'kick\', dx) reads it from your own shader.']],
  ['370', ['A live picture driven by the lanes (Ctrl+Alt+V; your own GLSL in Config). Fix: a lane added in the session can have automation at once.']],
  ['369', ['Export to MP4: your album art as a 300 x 300 picture with the song as stereo AAC (Config, Export).']],
  ['368', ['The Arp node shows its step mask and settings on the node itself, selected or not.']],
  ['367', ['New Arp node: 21 modes, rate, gate, swing, octaves, hold, retrigger, seeded random and a 16-step velocity mask; open ?demo=arp for a demo song.']],
];
