// The live picture's window (Document Picture-in-Picture) has two tabs: the Picture itself, and Parameters. Parameters is a panel to tweak
// a sound while watching the picture: the sliders of one node with every feature of the main parameter view, steppers to go through the
// nodes of a machine and through the machines, and above them a cropped map of the machine's graph with the current node lit.
//
//   ◂ ▸ beside the node name      the previous or next node of the machine (Alt+Left, Alt+Right)
//   ◂ ▸ beside the machine name   the previous or next machine (Alt+Up, Alt+Down)
//   click a node on the map       goes to it
// Opened with the machine and node that are selected in the graph (else the first node with parameters).
const MAP_H = 110;

export function createPictureWindow({ win, host, patcher, machineIds, say = () => {} }) {
  const doc = win.document;
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
  let tab = 'picture', machine = patcher.instrument, node = patcher.selectedNode;

  const tabs = el('div', { className: 'pw-tabs', role: 'tablist' });
  const picturePane = el('div', { className: 'pw-pane pw-picture' });
  const paramsPane = el('div', { className: 'pw-pane pw-params' });
  paramsPane.hidden = true;
  const buttons = {};
  for (const [id, label] of [['picture', 'Picture'], ['params', 'Parameters']]) {
    buttons[id] = el('button', { type: 'button', textContent: label, role: 'tab' });
    buttons[id].addEventListener('click', () => show(id));
    tabs.append(buttons[id]);
  }

  const map = el('canvas', { className: 'pw-map', height: MAP_H });
  const machineName = el('span', { className: 'pw-name' }), nodeName = el('span', { className: 'pw-name' });
  const stepper = (name, label, step) => el('div', { className: 'pw-step' },
    el('span', { className: 'pw-what', textContent: label }),
    Object.assign(el('button', { type: 'button', textContent: '◂', title: `Previous ${label}` }), { onclick: () => step(-1) }), name,
    Object.assign(el('button', { type: 'button', textContent: '▸', title: `Next ${label}` }), { onclick: () => step(1) }));
  const rows = el('div', { className: 'pw-rows fl-body' });
  const rowsWrap = el('div', { className: 'pw-rowswrap' }, rows);   // (the parameter view sizes the parent of the element it draws in)
  paramsPane.append(map, stepper(machineName, 'machine', d => stepMachine(d)), stepper(nodeName, 'node', d => stepNode(d)), rowsWrap);
  host.append(tabs, picturePane, paramsPane);
  const panel = patcher.nodePanel(rows, doc);

  const nodes = () => patcher.nodeIdsOf(machine);
  const settle = () => {   // a machine and node that exist
    const ids = machineIds();
    if (!ids.includes(machine)) machine = ids.includes(patcher.instrument) ? patcher.instrument : ids[0];
    const list = nodes();
    if (!list.includes(node)) node = list[0] ?? null;
  };
  function stepNode(d) { const list = nodes(); if (!list.length) return; node = list[(Math.max(0, list.indexOf(node)) + d + list.length) % list.length]; refresh(); }
  function stepMachine(d) { const ids = machineIds(); if (!ids.length) return; machine = ids[(Math.max(0, ids.indexOf(machine)) + d + ids.length) % ids.length]; node = null; refresh(); }

  function refresh() {
    settle();
    machineName.textContent = machine ?? '-'; nodeName.textContent = node ?? '(no node with parameters)';
    if (node) panel.show(machine, node); else panel.show(null, null);
    drawMap();
  }
  function drawMap() {
    if (tab !== 'params') return;
    const W = Math.max(60, Math.round(map.clientWidth || 300)), dpr = win.devicePixelRatio || 1;
    if (map.width !== Math.round(W * dpr)) { map.width = Math.round(W * dpr); map.style.height = `${MAP_H}px`; map.height = Math.round(MAP_H * dpr); }
    const ctx = map.getContext('2d'), css = win.getComputedStyle(doc.documentElement);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    patcher.drawMap(ctx, W, MAP_H, machine, node, css.getPropertyValue('--fg').trim() || '#ccc', css.getPropertyValue('--accent').trim() || '#4a8fe0');
  }
  map.addEventListener('click', e => {   // a click on the map goes to the node under it
    const d = patcher.nodeAt?.(machine, node, e.offsetX, e.offsetY, map.clientWidth, MAP_H);
    if (d) { node = d; refresh(); }
  });

  function show(id) {
    tab = id;
    picturePane.hidden = id !== 'picture'; paramsPane.hidden = id !== 'params';
    for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-selected', String(k === id));
    if (id === 'params') refresh();
  }
  doc.addEventListener('keydown', e => {
    if (tab !== 'params' || !e.altKey || e.ctrlKey || e.metaKey) return;
    const d = { ArrowLeft: [stepNode, -1], ArrowRight: [stepNode, 1], ArrowUp: [stepMachine, -1], ArrowDown: [stepMachine, 1] }[e.key];
    if (d) { e.preventDefault(); d[0](d[1]); }
  });
  show('picture');
  return {
    picturePane,
    show,
    refresh: () => { if (tab === 'params') { drawMap(); panel.refresh(); } },   // called every frame: the map and the live values
    release: () => panel.release(),
  };
}
