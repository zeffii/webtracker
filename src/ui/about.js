// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['385', ['Several shaders per song: the shader lane\'s Shd column switches between them.']],
  ['384', ['The picture\'s shader is saved with the project.']],
  ['383', ['Expose a shader number from the Knobs panel: the shader machine gets a hatched lane with a pattern column for it, so patterns can animate the picture.']],
  ['382', ['A Pause button (and the Pause key): stop in place, carry on from the same row.']],
  ['381', ['Shader view: sliders for the numbers (hover or caret, or drag a number) and a Knobs panel.']],
  ['380', ['Live picture: choose its resolution, up to 1080 x 1080 (Config > Visual).']],
  ['379', ['New shader template: Flock.']],
  ['378', ['Shader view (Ctrl+Alt+G): the picture\'s GLSL in an editor of its own, with syntax colours and the failing line marked.']],
  ['377', ['Live picture: pop it out into its own always-on-top window; four more shader templates.']],
  ['376', ['Live picture: five shader templates to start from (Config > Visual).']],
  ['375', ['MP4 export always uses AAC sound (a built-in encoder where the browser has none), so X accepts it.']],
];
