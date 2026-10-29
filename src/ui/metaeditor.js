// The Selections editor of a meta machine (see seq/metacolumns.js): on the left the other instruments of the song, each with the things
// it offers to play (its notes, velocities, triggers and exposed parameters); ticking one adds a column for it. On the right the
// columns in the order they stand, each with a header of its own if you like, its kind and width, and for a relative note its root.
import * as ops from '../project/ops.js';
import { proxyChoices, rootName } from '../seq/metacolumns.js';
import { noteSemitones } from '../seq/cells.js';
import { MASTER } from '../instruments.js';

const same = (a, b) => a.instrument === b.instrument && (a.role === b.role) && (a.nc ?? 0) === (b.nc ?? 0) && (a.tc ?? 0) === (b.tc ?? 0) && a.node === b.node && a.param === b.param;
const KIND_NAME = { spacer: 'Spacer', note: 'Note, as is', rnote: 'Note, relative', vel: 'Velocity', trig: 'Trigger', param: 'Value' };
const BITS = [[4, '1hex'], [8, '2hex'], [16, '4hex']];

export function createMetaEditor({ root, doc = document, getProject, onChange = () => {}, onAddLane = () => {}, onBind = () => {} }) {
  let metaId = null, selected = null, pending = null, insertAfter = false;
  const open = new Set();   // the instruments whose list is unfolded

  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); e.append(...kids); return e; };
  const project = () => getProject();
  const specs = () => project()?.instruments[metaId]?.meta?.columns ?? [];
  const lane = () => project()?.lanes.find(l => l.instrument === metaId);
  const built = id => lane()?.columns.find(c => c.spec === id);   // the column a proxy came out as (none if its machine is gone)

  const changed = message => { onChange(metaId, message); render(message); };

  // ---- the left side: what can be played
  const instrumentList = () => {
    const box = el('div', { className: 'me-tree' });
    const p = project();
    const gap = el('button', { type: 'button', className: 'me-pick me-gap', textContent: '+ Spacer (a gap between groups)', title: 'A rule between groups of columns; its header, if you give it one, names the group to its right' });
    gap.addEventListener('click', () => {
      const at = insertAfter && selected ? specs().findIndex(s => s.id === selected) + 1 : undefined;
      selected = ops.addMetaColumn(project(), metaId, { role: 'spacer' }, at).id;
      changed('Added a spacer. Give it a header to name the group after it.');
    });
    box.append(gap);
    for (const [id, def] of Object.entries(p.instruments)) {
      if (id === metaId || id === MASTER || def.meta) continue;
      const choices = proxyChoices(id, def), used = choices.filter(c => specs().some(s => same(s, c.spec))).length;
      const head = el('button', { type: 'button', className: 'me-inst', textContent: `${open.has(id) ? '▾' : '▸'} ${id}` }, el('span', { className: 'me-dim', textContent: used ? `  ${used} used` : `  ${choices.length} things` }));
      head.addEventListener('click', () => { if (open.has(id)) open.delete(id); else open.add(id); render(); });
      box.append(head);
      if (!open.has(id)) continue;
      for (const choice of choices) {
        const have = specs().filter(s => same(s, choice.spec));
        const row = el('button', { type: 'button', className: `me-pick${have.length ? ' on' : ''}`, textContent: `[${have.length ? 'x' : ' '}] ${choice.label}${have.length > 1 ? `  ×${have.length}` : ''}` });
        row.title = have.length ? 'Click to remove the column (the last one, if there are several)' : 'Click to add a column for it';
        row.addEventListener('click', () => toggle(choice, have));
        box.append(row);
      }
    }
    if (!box.children.length) box.append(el('p', { className: 'me-dim', textContent: 'No other instruments yet. Add some and they are listed here.' }));
    return box;
  };

  const toggle = (choice, have) => {
    if (have.length) {
      const last = have[have.length - 1], l = lane();
      const key = built(last.id)?.key;
      if (l && key && ops.columnHasData(l, key) && pending !== last.id) { pending = last.id; render(`That column holds data: click again to remove it.`); return; }
      pending = null;
      ops.removeMetaColumn(project(), metaId, last.id);
      if (selected === last.id) selected = null;
      changed(`Removed the column of ${choice.label}.`);
      return;
    }
    const at = insertAfter && selected ? specs().findIndex(s => s.id === selected) + 1 : undefined;
    selected = ops.addMetaColumn(project(), metaId, choice.spec, at).id;
    changed(`Added a column for ${choice.label}.`);
    if (specs().filter(s => s.instrument === choice.spec.instrument).length === 1) onBind(choice.spec.instrument);   // the first one: the machine is played from here now
  };

  // ---- the right side: the columns
  const table = () => {
    const t = el('table', { className: 'me-table' });
    t.append(el('thead', {}, el('tr', {}, ...['#', 'Header', 'Source', 'Kind', 'Width', 'Root'].map(h => el('th', { textContent: h })))));
    const body = el('tbody');
    specs().forEach((s, i) => {
      const c = built(s.id), spacer = s.role === 'spacer';
      const tr = el('tr', { className: s.id === selected ? 'sel' : '' });
      tr.addEventListener('click', e => { if (e.target.closest('input, select')) return; selected = s.id; pending = null; render(); });
      const header = el('input', { type: 'text', value: s.header ?? '', placeholder: spacer ? 'group' : c?.short ?? '', maxLength: 8, size: 8 });
      header.setAttribute('aria-label', `Header of column ${i + 1}`);
      header.addEventListener('focus', () => { selected = s.id; });
      header.addEventListener('keydown', e => e.stopPropagation());
      header.addEventListener('change', () => { ops.setMetaColumn(project(), metaId, s.id, { header: header.value.trim().slice(0, 8) }); changed(''); });
      let kind = el('span', { textContent: KIND_NAME[s.role] });
      if (s.role === 'note' || s.role === 'rnote') {
        kind = el('select', {}, ...['note', 'rnote'].map(r => el('option', { value: r, textContent: KIND_NAME[r], selected: s.role === r })));
        kind.setAttribute('aria-label', `Kind of column ${i + 1}`);
        kind.addEventListener('change', () => { ops.setMetaColumn(project(), metaId, s.id, { role: kind.value }); changed('The cells of that column are cleared, as a note and a relative note are not the same.'); });
      }
      let width = el('span', { className: 'me-dim', textContent: spacer ? 'as wide as its header' : c ? c.token : '' });
      if (s.role === 'param') {
        const bits = s.bits ?? project().instruments[s.instrument]?.exposed?.find(e => e.node === s.node && e.param === s.param)?.bits ?? 8;
        width = el('select', {}, ...BITS.map(([b, name]) => el('option', { value: b, textContent: name, selected: b === bits })));
        width.setAttribute('aria-label', `Width of column ${i + 1}`);
        width.addEventListener('change', () => { ops.setMetaColumn(project(), metaId, s.id, { bits: Number(width.value) }); changed(''); });
      }
      let rootCell = el('span');
      if (s.role === 'rnote') {
        const input = el('input', { type: 'text', value: rootName(s.root ?? 60), size: 4, maxLength: 3 });
        input.setAttribute('aria-label', `Root note of column ${i + 1}`);
        input.addEventListener('keydown', e => e.stopPropagation());
        input.addEventListener('change', () => {
          const semis = noteSemitones(input.value.trim().replace(/^([a-g])/, m => m.toUpperCase()));
          if (semis === null || semis + 12 > 127) { input.value = rootName(s.root ?? 60); return; }
          ops.setMetaColumn(project(), metaId, s.id, { root: semis + 12 });
          changed('');
        });
        rootCell = el('span', {}, input, el('span', { className: 'me-dim', textContent: ' 80 = root' }));
      }
      tr.append(el('td', { textContent: String(i + 1) }), el('td', {}, header), el('td', { textContent: spacer ? '(spacer)' : c ? c.long : `${s.instrument} (not there)` }), el('td', {}, kind), el('td', {}, width), el('td', {}, rootCell));
      body.append(tr);
    });
    t.append(body);
    return t;
  };

  const buttons = () => {
    const i = specs().findIndex(s => s.id === selected), has = i >= 0;
    const btn = (text, title, enabled, run) => { const b = el('button', { type: 'button', textContent: text, title, disabled: !enabled }); b.addEventListener('click', run); return b; };
    const remove = btn(pending === selected && has ? 'Sure? It holds data' : 'Remove', 'Take the column away (its cells go with it)', has, () => {
      const l = lane(), key = built(selected)?.key;
      if (l && key && ops.columnHasData(l, key) && pending !== selected) { pending = selected; render('That column holds data: click Remove again to take it away.'); return; }
      pending = null;
      ops.removeMetaColumn(project(), metaId, selected); selected = null; changed('Column removed.');
    });
    const box = el('div', { className: 'me-buttons' },
      btn('◀', 'Move the column left', has && i > 0, () => { ops.moveMetaColumn(project(), metaId, selected, i - 1); changed(''); }),
      btn('▶', 'Move the column right', has && i < specs().length - 1, () => { ops.moveMetaColumn(project(), metaId, selected, i + 1); changed(''); }),
      remove,
      btn('Duplicate', 'A second column for the same thing, right after it (two columns may drive one parameter)', has, () => { selected = ops.duplicateMetaColumn(project(), metaId, selected).id; changed('Column duplicated.'); }),
    );
    const after = el('input', { type: 'checkbox', checked: insertAfter });
    after.addEventListener('change', () => { insertAfter = after.checked; });
    box.append(el('label', { className: 'me-after' }, after, ' ticking adds the column after the selected one'));
    return box;
  };

  let note = '';
  function render(message = note) {
    note = message ?? '';
    if (!metaId || !project()?.instruments[metaId]?.meta) { root.hidden = true; return; }
    root.hidden = false;
    const l = lane();
    const head = el('div', { className: 'me-head' }, 'Machine ', el('b', { textContent: metaId }), ' (meta): it plays other instruments. Each of its pattern columns is a proxy of one thing of another instrument.');
    const left = el('div', { className: 'me-left' }, el('h3', { textContent: 'Instruments in the song' }), instrumentList());
    const right = el('div', { className: 'me-right' }, el('h3', { textContent: 'Columns, left to right' }));
    if (specs().length) right.append(table(), buttons());
    else right.append(el('p', { className: 'me-dim', textContent: 'No columns yet: tick something on the left.' }));
    if (!l) {
      const add = el('button', { type: 'button', textContent: 'Add a lane for this machine' });
      add.addEventListener('click', () => { onAddLane(metaId); render(); });
      right.append(el('p', { className: 'me-dim', textContent: 'No lane plays this machine yet, so its columns have nowhere to be written. ' }, add));
    }
    right.append(
      el('p', { className: 'me-note', textContent: note }),
      el('p', { className: 'me-help', textContent: 'A new column is empty in every pattern; nothing already written moves. Headers are automatic: n1 n2 notes, v1 velocities, t1 triggers, p1 p2 parameters, numbered in column order. A relative note is a 2hex cell: 80 plays the root note, 81 a semitone above, 7F one below, 00 is a note off. A machine that only a meta machine plays needs no lane of its own.' }),
    );
    root.replaceChildren(head, el('div', { className: 'me-body' }, left, right));
  }

  return {
    show(id) { if (id !== metaId) { selected = null; pending = null; } metaId = id; render(''); },
    hide() { metaId = null; root.hidden = true; },
    render,
    get shown() { return !root.hidden; },
  };
}
