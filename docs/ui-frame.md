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

Step 3, popup stack (`src/ui/kit/popups.js`): on the stack now are the context menu, the machine
menu, the curve popup, the chord palette, the File menu, Backups, machine help, node help, the
stream manager, the shortcut list and the bounce dialog. Each was checked in a browser against
master (same keys, same results). Two kinds of popup: the ones that take over hear Escape
wherever the focus is; floating panels you work beside are `focusScoped` and hear it only
while the focus is inside them.

Still to move: the graph's insert menu and parameter menus, the shader slider popup, the node
sequencer palette, the command bar, and the inline editors (rename box and friends, where Escape
is a local "cancel the edit"). Then the focus owner proper: the active view and the shortcut table
as the layers below the popups.
