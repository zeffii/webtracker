# ui-frame: one frame, one small UI kit

Branch `ui-frame`. Master stays live and keeps receiving fixes; they get merged
into this branch. Nothing here is merged until it has been tested and agreed.

## Why

The app feels disjointed: every view is its own little program. From a quick
scan of master (build 681):

- 10 tabs, `tabNow`/`tabBefore` in `main.js`, with side effects chained in `onChange`
- ~60 key listeners (36 in `main.js`), 70 `stopPropagation` calls, 36 Escape handlers:
  who gets a key depends on listener order
- about ten popups, each with its own open flag, position and Escape handling
- 52 canvas contexts, each setting up its own pixel density and drawing its own controls
- a `drag` variable in roughly ten files, each its own tiny state machine

## Look

Cardinal-minimal plus retroslate: thin lines, text, dots, round knobs and
sliders. No boxes with outlines. Colours come only from the tokens already in
`themes.css` (`--bg --fg --panel --hi --field --accent --line --glow --radius`);
the kit adds spacing, line width and type size tokens next to them.

## Layout

See `ui-frame-layout.png`. One frame for every view; only the centre changes.

- top bar: transport, view tabs in this order: F1 Song (the arrangement), F2 Pattern,
  F3 Instrument, F4 Sample. Song is the first-class view and the one the app opens on.
- left: browser (patterns, samples, machines), collapsible
- centre: the view, full width
- parameter views float over the centre until closed (the Buzz way): draggable,
  position remembered, several can be open at once, and any of them can be popped
  out into its own window. No docked inspector.
- bottom: mixer with a drag handle, hidden under 20 px, mouse-only, never takes keyboard focus
- last line: command bar and status

## The kit (`src/ui/kit/`, one small file per part)

- `tokens` spacing, line width, type sizes, canvas pixel density helper
- `keys` chords and the table of global shortcuts (can be listed for a shortcut page)
- `focus` exactly one keyboard owner at a time; layers: popup, then view, then global
- `popups` one stack for menus, dialogs, tooltips (0.5 s hover); one Escape rule
- `splitter` drag to resize, collapse threshold, remembered size
- `tabs`, `tree`
- `slider`, `knob` one implementation for floating parameter panels, node faces, mixer
- `floating` the draggable panel: hairline edge, close button, remembered position

## Steps (each leaves the app working and the tests green)

1. Tokens: add the new ones, no visual change. (done: `themes.css`)
2. `keys`: chords and one table of the global shortcuts, replacing the scattered
   `e.ctrlKey && e.altKey && ...` listeners in `main.js`. (done: `src/ui/kit/keys.js`)
3. (in progress) `popups` and `focus` together: one stack of popups, and the focus owner that decides who
   gets a key (popup first, then the view, then the shortcut table). They are built
   together because the popups are the focus owner's first users; moving the ten popups
   over one at a time.
4. `splitter` and the frame shell: mixer docked first (Sample screen, the smallest).
5. `slider`, `knob` and `floating`; the parameter panels.
6. Move the views over: Sample, Instrument, Pattern, Arrange.
7. Delete what the kit replaced.

## Decided

- browser collapsible
- parameter views float until closed; canvases run full width
- F1 Song, F2 Pattern, F3 Instrument, F4 Sample (the old F-key order is dropped)

## Open

- none at the moment

## Progress notes

Step 3, popup stack (`src/ui/kit/popups.js`): done for everything that pops up over the app. On the
stack: the context menu, the machine menu, the curve popup, the chord palette, the File menu,
Backups, machine help, node help, the stream manager, the shortcut list, the bounce dialog, the
graph's insert menu, the node sequencer palette, and recording (Escape stops it). Each was checked
in a browser against master: same keys, same results.

Two kinds of popup: the ones that take over hear Escape wherever the focus is; floating panels
you work beside are `focusScoped` and hear it only while the focus is inside them. The second
kind is exactly what the floating parameter panels will be.

Left alone on purpose, because they belong to a view rather than to a popup: the parameter view's
own menu and typing box, the shader view's number slider, the command bar and the inline rename
editors (Escape there is a local "cancel the edit").

## The focus owner: after the frame, not before

The routing today is: popup stack, then the shortcut table, then each view's own key handler on
the element that has the focus. The plan was a focus owner that makes the last layer explicit
(views register with it instead of listening on their own). Deferred until the frame exists,
because who owns the keyboard depends on the frame's regions (browser, centre view, floating
panels, mixer: mouse-only, never takes focus), and building it first would mean doing it twice.

## Step 4, the frame shell: proposed sub-steps (to agree before any code)

a. Tab order, labels and F-keys: F1 Song (the arrangement, now F4), F2 Pattern, F3 Instrument,
   F4 Sample; the app opens on Song. Small and visible; touches `main.js` tabs and the help text.
b. The mixer docked in every view, with the splitter (drag to resize, hidden under 20 px, size
   remembered). Open design point: in the arrangement and the pattern view the strips line up with the
   lane columns; in the graph and sample views there are no lane columns, so the strips would be a
   plain row of fixed width.
c. The browser panel (patterns, samples, machines), collapsible.
d. The floating parameter panels: draggable, remembered position, several at once, pop-out.
e. Delete what the frame replaces (the old docks and the separate lists).
