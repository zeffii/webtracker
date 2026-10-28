// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['490', ['Pattern editor: the Insert key no longer switches note preview on and off (the backslash key still does).']],
  ['489', ['New synth node and instrument kind, Cardinal: a monophonic virtual-analogue lead (behind the voices node for chords). Two oscillators (triangle, saw, pulse, sine, noise) with semitone and fine tune, key tracking, hard sync, fm from osc 1 into osc 2, ring modulation, a mix, noise and 1 to 5 unison voices; a filter that is lowpass 24 or 12, bandpass, highpass or notch with cutoff, resonance, key tracking and distortion; an amp envelope and a mod envelope (sweeping cutoff, osc 2 pitch, fm and pulse width); two LFOs with five waves and six destinations; glide and slide. Beside it are pictures of the oscillators (the real output), the filter response, both envelopes and both LFOs.']],
  ['488', ['Shader view: choosing Built-in (the button or the dropdown) now stores a real copy of the built-in metaballs in the project shader, so it can no longer turn into whatever the Config default shader holds, and editing it changes only that copy.']],
  ['487', ['Live picture: if the browser drops the graphics context (after a long idle, a sleep or a driver reset) the picture now comes back by itself instead of staying blank until the page is reloaded.']],
  ['486', ['Audio: after a long idle the browser can suspend the audio context, and Play then seemed to do nothing. Play now wakes the context first (and coming back to the tab does too); if the audio device still does not answer, the status line says so.']],
  ['485', ['Graph editor: Alt+V on a selected node (or group) keeps the picture beside it (a filter response, an envelope shape) showing when it is not selected; a small dot marks such nodes. Alt+V again stops.']],
  ['484', ['Graph editor: dragging from a free input port now draws a wire from it (drop it on an output) instead of moving the node; Shift+drag on a port that already has wires also starts a new wire. Grab the node by its body to move it.']],
  ['483', ['Graph editor: dragging from an output port that has wires now picks a wire up too (Tab chooses which); Shift+drag from it starts a new wire. Wires being dragged are drawn as curves like the others.']],
  ['482', ['Graph editor: Tab over a port with several wires now always chooses the wire (it was swallowed when the canvas did not have the keyboard focus or a node panel took the key).']],
  ['481', ['Graph editor: the pulse of a hovered port is gentler (about a pixel instead of up to three and a half).']],
];
