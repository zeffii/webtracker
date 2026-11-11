// The machine tree: a popup that lists every kind of instrument you can add, in groups that fold open and shut, drawn as a tree
// of thin lines in orange on dark (the look of the ztrk menu). It is used wherever a new instrument is picked.
//
//   Up / Down      move through the rows that are showing        Home / End   the first / last row
//   Right          open a group, or step into it                  Left         close a group, or step out to the one it is in
//   Enter          pick a machine (on a group: open or close it)  Esc          close the menu
//   a letter       jump to the next row that starts with it       click        pick a machine, or open and close a group
//
// Which groups are open is kept for the session, and the menu opens on the machine you picked last.
//
// buildMachineTree(items) turns the flat list [{ value, label, disabled }] the app already has into the nodes below, laid out by
// MACHINE_TREE (instruments.js). A machine that the layout does not name is put in a group called "other", so none goes missing.
//   node = { name, title?, value?, disabled?, children? }      (a node with children is a group; one with a value is a machine)
import { popups } from './kit/popups.js';
import { MACHINE_TREE } from '../instruments.js';

export function buildMachineTree(items) {
  const byKind = new Map(items.map(it => [it.value === 'sampler' ? 'sampler' : it.value.replace(/^synth:/, ''), it]));
  const used = new Set();
  const leaf = ([kind, name]) => {
    const it = byKind.get(kind);
    if (!it) return null;
    used.add(kind);
    return { name, title: it.label, value: it.value, disabled: !!it.disabled };
  };
  const group = g => {
    const children = [...(g.items ?? []).map(leaf), ...(g.groups ?? []).map(group)].filter(Boolean);
    return children.length ? { name: g.name, children } : null;
  };
  const tree = MACHINE_TREE.map(group).filter(Boolean);
  const rest = [...byKind.entries()].filter(([kind]) => !used.has(kind)).map(([, it]) => ({ name: it.label, title: it.label, value: it.value, disabled: !!it.disabled }));
  if (rest.length) tree.push({ name: 'other', children: rest });
  return tree;
}

// The rows that are showing, top to bottom. Each has its node, how deep it is, the path that names it, and the guide
// lines to draw in front of it: 'v' a line passing through, 'e' blank, 't' a branch with more below, 'l' the last branch.
export function visibleRows(tree, open) {
  const rows = [];
  const walk = (nodes, depth, passes, parent) => {
    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      const path = parent ? `${parent.path}/${node.name}` : node.name;
      const guides = depth === 0 ? [] : [...passes.map(p => (p ? 'v' : 'e')), last ? 'l' : 't'];
      const row = { node, depth, path, guides, parent };
      rows.push(row);
      if (node.children && open.has(path)) walk(node.children, depth + 1, depth === 0 ? passes : [...passes, !last], row);
    });
  };
  walk(tree, 0, [], null);
  return rows;
}

const open = new Set(['samplers', 'synths', 'drums', 'tools']);   // which groups are open (by path); the top groups to begin with
let lastPicked = null;                                              // the path of the machine picked last
let closeNow = null;

export function showMachineTree(at, tree, { onPick, title = '', doc = document } = {}) {
  closeNow?.();
  const menu = doc.createElement('div');
  menu.className = 'mtree';
  menu.setAttribute('role', 'tree');
  menu.tabIndex = -1;
  let rows = [], at_ = 0;

  const remember = path => { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/')); };
  if (lastPicked) remember(lastPicked);

  const draw = () => {
    rows = visibleRows(tree, open);
    menu.replaceChildren();
    if (title) { const t = doc.createElement('div'); t.className = 'mt-title'; t.textContent = title; menu.append(t); }
    rows.forEach((row, i) => {
      const el = doc.createElement('div');
      el.className = `mt-row${i === at_ ? ' on' : ''}${row.node.disabled ? ' off' : ''}`;
      el.setAttribute('role', 'treeitem');
      if (row.node.title) el.title = row.node.title;
      row.guides.forEach((g, k) => { const s = doc.createElement('span'); s.className = `mt-g ${g}${i === at_ && k === row.guides.length - 1 ? ' s' : ''}`; el.append(s); });
      const label = doc.createElement('span');
      label.className = 'mt-lab';
      label.textContent = row.node.children ? `${row.node.name}${open.has(row.path) ? '' : ' +'}` : row.node.name;
      el.append(label);
      el.addEventListener('mousemove', () => { if (at_ !== i) { at_ = i; mark(); } });   // moving, not entering: a redraw under a still mouse must not take the highlight
      el.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); at_ = i; activate(); });
      menu.append(el);
    });
    const hint = doc.createElement('div');
    hint.className = 'mt-hint';
    hint.textContent = '↑↓ move   ←→ fold   ⏎ pick';
    menu.append(hint);
  };
  const mark = () => {
    const els = menu.querySelectorAll('.mt-row');
    els.forEach((el, i) => {
      el.classList.toggle('on', i === at_);
      const guides = [...el.querySelectorAll('.mt-g')];
      guides.forEach(g => g.classList.remove('s'));
      if (i === at_ && guides.length) guides[guides.length - 1].classList.add('s');   // the branch in front of the chosen row is filled too
    });
    els[at_]?.scrollIntoView?.({ block: 'nearest' });
  };
  const keepOn = row => { draw(); at_ = Math.max(0, rows.findIndex(r => r.path === row.path)); mark(); };   // redraw after a fold, staying on that row
  const close = () => { menu.remove(); layer.release(); if (closeNow === close) closeNow = null; };
  const activate = () => {
    const row = rows[at_];
    if (!row) return;
    if (row.node.children) { if (open.has(row.path)) open.delete(row.path); else open.add(row.path); keepOn(row); return; }
    if (row.node.disabled) return;
    lastPicked = row.path;
    close();
    onPick(row.node.value);
  };
  // Arrows, Home/End, Enter, fold and unfold, type-to-jump. Returns true if it took the key. (Escape, a click elsewhere and a scroll are the popup stack's.)
  const onKey = ev => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return false;
    const row = rows[at_];
    if (ev.key === 'ArrowDown') { at_ = (at_ + 1) % rows.length; mark(); }
    else if (ev.key === 'ArrowUp') { at_ = (at_ - 1 + rows.length) % rows.length; mark(); }
    else if (ev.key === 'Home') { at_ = 0; mark(); }
    else if (ev.key === 'End') { at_ = rows.length - 1; mark(); }
    else if (ev.key === 'Enter') activate();
    else if (ev.key === 'ArrowRight') {
      if (row.node.children) {   // open the group if it is shut, and go to its first machine
        if (!open.has(row.path)) { open.add(row.path); keepOn(row); }
        at_ += 1; mark();
      }
    } else if (ev.key === 'ArrowLeft') {
      if (row.node.children && open.has(row.path)) { open.delete(row.path); keepOn(row); }
      else if (row.parent) { at_ = rows.indexOf(row.parent); mark(); }
    } else if (ev.key.length === 1 && /[a-z0-9]/i.test(ev.key)) {   // type a letter: the next row that starts with it
      const k = ev.key.toLowerCase();
      for (let n = 1; n <= rows.length; n++) { const i = (at_ + n) % rows.length; if (rows[i].node.name.toLowerCase().startsWith(k)) { at_ = i; mark(); break; } }
    } else return false;
    return true;
  };

  doc.body.append(menu);
  draw();
  if (lastPicked) { const i = rows.findIndex(r => r.path === lastPicked); if (i >= 0) at_ = i; }
  mark();
  const w = menu.offsetWidth, h = menu.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  menu.style.left = `${Math.max(0, Math.min(at.x, vw - w - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(at.y, vh - h - 4))}px`;
  const layer = popups.open({ name: 'machine menu', element: menu, close, onKey, closeOnScroll: true, doc });
  closeNow = close;
  return close;
}
