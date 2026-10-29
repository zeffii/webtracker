// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['531', ['Live picture: the built-in shader is now an orange and red lava lamp of five metaballs that swell on hits.']],
  ['530', ['First screen: pink to green lava lamp backdrop; the metaballs turn pink near the top and green near the bottom.']],
  ['529', ['Drum synth: no more random clicks when a hit lands on a voice that is still ringing.']],
  ['528', ['Script: chords, roman numerals, circle of fifths helpers and a progression generator, a chord lab in the tutorial, and the ?demo=progression song.']],
  ['527', ['Arrangement: hold Shift over a pattern to see its name; let go and it hides.']],
  ['526', ['Pattern name label follows whichever of the mouse and the caret moved last, so it no longer pops up for the highlighted pattern.']],
  ['525', ['Arrangement: patterns show only their number; the name of the pattern under the mouse or caret appears on a dark label (H shows all names).']],
  ['524', ['Pattern name chips: larger, regular weight, easier to read.']],
  ['523', ['Arrangement: pattern names on a small dark chip, readable over the minimaps.']],
  ['517', ['The ?demo=concrete techno now runs on one meta machine lane that plays all five percussion machines.']],
];
