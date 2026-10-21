// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['312', ['Pattern view: on an empty velocity cell the status bar now shows the value that is in effect there, held from the last velocity written above it in that column (or default FF = 100% before any), the same way parameter columns already do.']],
  ['311', ['The loop is now two thin light-red lines running the full width of the pattern and arrangement views, one where it starts and one where it ends, instead of the yellow marks in the tick column. A loop that is switched off keeps its lines, faded.']],
  ['310', ['Sequence editor: Insert pushes the patterns from the caret down by 16 ticks, and Delete on an empty spot pulls the patterns below up towards the caret (16 ticks, or as far as the gap allows). Delete on a pattern still removes it.']],
  ['309', ['Pattern colours follow the theme: in the arrangement, the pattern list and the tinted pattern editor, the hue still tells patterns apart but the brightness, saturation and strength are set per theme, so dark themes get deep muted tints instead of washed-out pastels, and the amber, phosphor and synthwave themes keep the colours in their own family. Bright is unchanged.']],
  ['308', ['Blob first screen: back in the original card size, and the banding that moved with the view is fixed (the translucency was measured with a short stepped march, which left diagonal contours; each pixel now starts its measurement at a slightly different depth, so they turn into fine grain).']],
  ['307', ['Blob first screen: the diagonal banding is gone (a hash that used sin() made diagonal patterns on some graphics cards; the shader now dithers the slow gradients instead).']],
  ['306', ['Blob first screen: a few quiet lights instead of one even glow: a soft warm key from the upper left, a cooler fill from the right, and a faint light from behind and below that shows through the thin parts.']],
  ['305', ['First screen: a slow translucent blob (WebGL metaballs with a subsurface-style shader) drifts behind the Wax wordmark, follows the pointer a little and brightens when you click in. Config > First screen look switches back to the turning logo, which is also used when WebGL is not available; reduced-motion keeps it still.']],
  ['304', ['Graph editor: Insert opens the machine menu, and Ctrl+D (duplicate), Ctrl+X and Delete (remove) work on the selected node wherever the focus is on the instrument screen, not only on the canvas. The Duplicate node and Delete node buttons are gone.']],
  ['303', ['Graph editor: a node\'s preset row and its Duplicate and Delete buttons now sit in the bar above the graph, beside Add node, instead of under it.']],
];
