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

- top bar: transport, view tabs
- left: browser (patterns, samples, machines), collapsible
- centre: the view (pattern grid, graph, sample, arrangement)
- right: inspector (sliders for what is selected), collapsible; the popout is this panel torn off
- bottom: mixer with a drag handle, hidden under 20 px, mouse-only, never takes keyboard focus
- last line: command bar and status

## The kit (`src/ui/kit/`, one small file per part)

- `tokens` spacing, line width, type sizes, canvas pixel density helper
- `focus` exactly one keyboard owner at a time; layers: popup, then view, then global
- `popups` one stack for menus, dialogs, tooltips (0.5 s hover); one Escape rule
- `splitter` drag to resize, collapse threshold, remembered size
- `tabs`, `tree`
- `slider`, `knob` one implementation for inspector, node faces, mixer

## Steps (each leaves the app working and the tests green)

1. Tokens: add the new ones, no visual change.
2. `focus`: wrap the existing listeners behind it, then remove them view by view.
3. `popups`: move the ten popups over, one at a time.
4. `splitter` and the frame shell: mixer docked first (Sample screen, the smallest).
5. `slider` and `knob`; the inspector.
6. Move the views over: Sample, Instrument, Pattern, Arrange.
7. Delete what the kit replaced.

## Open questions

- browser and inspector collapsible so the tracker grid can go wide?
- Sample and Instrument keep full-width canvases, frame only adds mixer and inspector?
- Arrange: a tab in the frame, or in the mixer area?
