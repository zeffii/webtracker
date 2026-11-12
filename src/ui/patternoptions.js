// The Pattern screen's options, shown under the browser list (see browser.js): the few switches that used to need a shortcut or
// a trip to Config. Each one is a setting that already exists (follow, note preview, tint) or an action the view already has
// (hide the empty columns of the cursor's lane), so this block only presents them; it owns no state of its own.
//
// createPatternOptions({ el, config, view, focusGrid }): fills `el`. focusGrid() gives the keyboard back to the pattern grid
// after a click, so typing carries on where it was. openRoll() opens the pattern roll window (a button shows when it is given).
const FONT = { min: 8, max: 40, normal: 13 };

export function createPatternOptions({ el, config, view, focusGrid, openRoll, openPatternWindow, doc = document }) {
  const make = (tag, text, className) => { const e = doc.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  const title = make('h4', 'Pattern view');

  // A switch bound to a boolean setting; it follows the setting when a key or the Config panel changes it.
  const checks = [];
  const setting = (key, label, hint) => {
    const box = make('input'); box.type = 'checkbox';
    const row = make('label', undefined, 'po-row'); row.title = hint; row.append(box, doc.createTextNode(` ${label}`));
    box.addEventListener('change', () => { config.set(key, box.checked); focusGrid(); });
    checks.push(() => { box.checked = !!config.get(key); });
    return row;
  };

  const tools = make('div', undefined, 'po-row');
  const button = (label, hint, run) => { const b = make('button', label); b.type = 'button'; b.title = hint; b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', () => { run(); focusGrid(); }); return b; };
  const hide = button('Hide empty columns', 'Hide or show the empty columns of the lane the cursor is in (Ctrl+Shift+H)', () => view.toggleEmptyColumns());
  tools.append(hide);
  if (openPatternWindow) tools.append(button('Pattern window', 'Show the pattern you are in, in a window of its own (Ctrl+Alt+W); the window has a menu for another instrument or pattern', openPatternWindow));
  if (openRoll) tools.append(button('Pattern roll…', 'Open the notes of this pattern as a piano roll in a window of its own, to see chords and voice leading', openRoll));

  // Text size: smaller, bigger, back to normal (Ctrl+minus, Ctrl+plus, Ctrl+0 do the same).
  const size = make('div', undefined, 'po-row'), sizeText = make('span', '', 'po-size');
  const step = d => config.set('fontSize', Math.max(FONT.min, Math.min(FONT.max, config.get('fontSize') + d)));
  size.append(make('span', 'Text size'), button('−', 'Smaller (Ctrl+minus)', () => step(-1)), sizeText, button('+', 'Bigger (Ctrl+plus)', () => step(1)), button('reset', 'Back to normal (Ctrl+0)', () => config.set('fontSize', FONT.normal)));

  el.replaceChildren(title,
    setting('follow', 'Follow the playing row', 'The grid scrolls with the playing row (F9)'),
    setting('notePreview', 'Note preview', 'Typed notes sound while the key is held (\\)'),
    setting('patternTint', 'Tint patterns by colour', 'A faint patchwork behind each pattern (Alt+T)'),
    tools, size);

  const sync = () => { for (const f of checks) f(); sizeText.textContent = String(config.get('fontSize')); };
  config.onChange(sync); sync();
  return { sync };
}
