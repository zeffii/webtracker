// The graph's toolbar strip: a narrow column of icon switches along the left edge of the instrument graph. Every switch is a setting
// that already exists in Config (grid, snap, wire looks, node look, the parameter view's command parameters), so this strip only
// presents them: it owns no state, and it follows Config when a setting is changed there. Hovering (or focusing) a button shows
// what it does and whether it is on.
//
// createGraphRail({ host, config, repaint }): puts the strip into `host` (a positioned element over the graph's left edge).
//   repaint() redraws the graph after a switch.
const ICONS = {
  grid: '<svg viewBox="0 0 16 16"><circle cx="3" cy="3" r=".6"/><circle cx="8" cy="3" r=".6"/><circle cx="13" cy="3" r=".6"/><circle cx="3" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="13" cy="8" r=".6"/><circle cx="3" cy="13" r=".6"/><circle cx="8" cy="13" r=".6"/><circle cx="13" cy="13" r=".6"/></svg>',
  snap: '<svg viewBox="0 0 16 16"><path d="M3 9V4.5a5 5 0 0 1 10 0V9"/><path d="M3 9h3v3H3zM10 9h3v3h-3z"/></svg>',
  dashed: '<svg viewBox="0 0 16 16"><path d="M1.5 8h2.5M6.7 8h2.6M12 8h2.5"/></svg>',
  straight: '<svg viewBox="0 0 16 16"><path d="M2 12 14 4"/><circle cx="2.5" cy="11.5" r="1.3"/><circle cx="13.5" cy="4.5" r="1.3"/></svg>',
  compact: '<svg viewBox="0 0 16 16"><rect x="2" y="5" width="12" height="6" rx="1"/></svg>',
  pull: '<svg viewBox="0 0 16 16"><path d="M2 8h4M10 8h4"/><rect x="6" y="3" width="4" height="4" rx=".6"/><path d="M8 9v4"/></svg>',
  cc: '<svg viewBox="0 0 16 16"><path d="M6 5.5a3 3 0 1 0 0 5M13 5.5a3 3 0 1 0 0 5"/></svg>',
};

// Each switch: how to read it from Config, how to flip it, and the words for its hover text.
const SWITCHES = config => [
  { id: 'grid', name: 'Grid', what: 'the dot grid behind the nodes', get: () => config.get('graphGrid'), flip: () => config.set('graphGrid', !config.get('graphGrid')) },
  { id: 'snap', name: 'Snap', what: 'nodes land on the grid dots when moved (hold Ctrl while dragging to move freely)', get: () => config.get('graphSnap'), flip: () => config.set('graphSnap', !config.get('graphSnap')) },
  { id: 'dashed', name: 'Dashed wires', what: 'control and parameter wires drawn dashed, audio wires solid', get: () => config.get('wireDashed'), flip: () => config.set('wireDashed', !config.get('wireDashed')) },
  { id: 'straight', name: 'Straight short wires', what: 'wires between close nodes go straight instead of in an S-curve', get: () => config.get('wireStraight') > 0, flip: () => config.set('wireStraight', config.get('wireStraight') > 0 ? 0 : config.schemaOf('wireStraight').def) },
  { id: 'compact', name: 'Compact nodes', what: 'the small flat node look; off is the classic tiles', get: () => config.get('nodeLook') === 'compact', flip: () => config.set('nodeLook', config.get('nodeLook') === 'compact' ? 'classic' : 'compact') },
  { id: 'pull', name: 'Pull out', what: 'dragging a node far out of its chain takes it out of the wires', get: () => config.get('graphPullOut'), flip: () => config.set('graphPullOut', !config.get('graphPullOut')) },
  { id: 'cc', name: 'Hide command parameters', what: 'leaves out, in the parameter view, the parameters a CC command writes from a pattern', get: () => config.get('pvHideCc'), flip: () => config.set('pvHideCc', !config.get('pvHideCc')) },
];

export function createGraphRail({ host, config, repaint = () => {}, doc = document }) {
  const rail = doc.createElement('div');
  rail.className = 'gr-rail'; rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', 'Graph view');
  const buttons = SWITCHES(config).map(sw => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'gr-btn'; b.tabIndex = -1; b.dataset.id = sw.id;   // (tabIndex -1: the strip is for the mouse; the graph keeps the keyboard)
    b.innerHTML = `${ICONS[sw.id]}<span class="gr-tip"></span>`;
    b.addEventListener('mousedown', e => e.preventDefault());   // a click does not take the focus from the graph
    b.addEventListener('click', () => { sw.flip(); sync(); });   // (the repaint comes with the setting's change, below)
    rail.append(b);
    return { sw, b };
  });
  function sync() {
    for (const { sw, b } of buttons) {
      const on = !!sw.get();
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${sw.name}: ${on ? 'on' : 'off'}`);
      b.querySelector('.gr-tip').textContent = `${sw.name} · ${on ? 'on' : 'off'} · ${sw.what}`;
    }
  }
  sync();
  host.append(rail);
  // Centred on the graph's height (by the stylesheet), and out of sight when there is no room: the graph is lower than the strip,
  // or the strip would sit over the exposed-parameters dock or the parameter panel.
  const MARGIN = 6;
  function fit() {
    const canvas = host.querySelector('canvas');
    if (!canvas) return;
    rail.style.top = `${canvas.offsetTop + canvas.offsetHeight / 2}px`;   // the middle of the canvas (the host also holds the grip under it)
    rail.classList.remove('gr-away');
    const c = canvas.getBoundingClientRect(), r = rail.getBoundingClientRect();
    let room = c.height >= r.height + 2 * MARGIN;
    for (const other of host.querySelectorAll('#patch-exposed, #patch-params')) {
      const o = other.getBoundingClientRect();
      if (!o.width || !o.height || getComputedStyle(other).display === 'none') continue;
      if (o.left < r.right && o.right > r.left && o.top < r.bottom + MARGIN && o.bottom > r.top - MARGIN) room = false;
    }
    rail.classList.toggle('gr-away', !room);
  }
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(fit);
    watch.observe(host);
    for (const el of host.querySelectorAll('canvas, #patch-exposed, #patch-params')) watch.observe(el);
  }
  host.addEventListener('transitionend', fit);
  fit();
  const mine = new Set(['graphGrid', 'graphSnap', 'wireDashed', 'wireStraight', 'nodeLook', 'graphPullOut', 'pvHideCc']);
  config.onChange(key => { if (mine.has(key)) { sync(); repaint(); } });   // a change made in Config shows here too
  return { el: rail, sync, fit };
}
