// The About box: how this came about, and what changed in each build, newest first.
export const ABOUT = [
  'Wax is a tracker that lives in the browser: patterns you type on a grid, played by instruments you build out of a graph of nodes. It is the successor of ztracker, a tracker built in Max/MSP, and it grew up looking at the machines that made tracking worth doing: the grid and the speed of the old trackers, the machines-and-wires thinking of Buzz and Buze, and the patching of modular synths and Reaktor.',
  'It is made in conversation. One of us has the ear and the ideas, tries each build in the browser and says what is wrong or missing; the other writes the code, checks it against a test suite and sends the next build back. Big features are talked through first, with no code until the idea is right; small polish goes round in minutes. Most of these features come from the author\'s longstanding wish-list, but some emerged in conversation and in reflection after implementation.',
  'It is meant for making real music, techno especially, and it is experimental on purpose.',
  'I think you\'ll like it.',
];

export const CHANGELOG = [
  ['693', ['The follow panel can pop out into a window of its own and keeps following the machine under the cursor; pop-out windows are no longer indented.']],
  ['692', ['Pattern screen options under the browser list: follow, note preview, tint, hide empty columns, text size.']],
  ['691', ['Compact node look: ports are half the radius, plain dots in their signal colour.']],
  ['690', ['Thinner wires in the compact node look.']],
  ['689', ['Compact node tiles are the default now; Config, Graph: Node look brings the classic ones back.']],
  ['688', ['Compact node tiles, opt-in (Config, Graph: Node look): smaller and flatter, no labels on a lone input or output, L and R for left and right.']],
  ['687', ['The manual, first draft: ten chapters, read inside Wax (the book button in the left rail, or Ctrl+Alt+B) or printed as an A5 booklet.']],
  ['686', ['One look for every slider: a hairline, a faint fill up to the value and one thin accent bar at the value, on parameter bars, mixer faders and all plain sliders.']],
  ['685', ['Parameter panels open at most half the window wide (drag to go wider); floating panels are at most half the window tall and scroll when long.']],
  ['684', ['The look pass: plain buttons are flat text (accent colour and underline when on), fields have a faint fill, state colours (record red, warning amber, info blue) are theme tokens, and parameter bars and mixer faders share one slider drag.']],
                    ];
