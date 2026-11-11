// The Bounce to sample dialog: which ticks, whether the lane is heard on its own or the whole mix, how long a tail may ring,
// and what the new sample is called. askBounce() resolves to the choice, or null when it is cancelled.
//
// info = { laneId, patternName, ranges: { pattern, selection, loop, lane }, barTicks, scope }
//   each range is { start, end } in ticks (end is the first tick not played) or null when there is none; scope names
//   the range the dialog starts on.
import { popups } from './kit/popups.js';

const pad3 = n => String(n).padStart(3, '0');
let remembered = { solo: true, maxTail: 10, marker: true };   // what the last bounce chose, for the next dialog

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

export function askBounce(info) {
  return new Promise(resolve => {
    const state = { ...remembered, scope: info.scope, from: 0, to: 1, named: false };
    const first = info.ranges[state.scope] ?? info.ranges.lane;
    state.from = first.start; state.to = first.end;

    const number = (value, label, width = '5ch') => el('input', { type: 'number', value, min: 0, className: 'bn-num', ariaLabel: label, style: `width: ${width}` });
    const from = number(state.from, 'First tick'), to = number(state.to, 'Last tick plus one'), tail = number(state.maxTail, 'Longest tail, seconds', '4ch');
    const name = el('input', { type: 'text', className: 'bn-name', ariaLabel: 'Sample name' });
    const marker = el('input', { type: 'checkbox', checked: state.marker, id: 'bn-marker' });
    const size = el('span', { className: 'bn-dim' });
    const ranges = el('div', { className: 'bn-row' });
    const heard = el('div', { className: 'bn-col' });

    const autoName = () => {
      const patternRange = info.ranges.pattern;
      const onPattern = patternRange && Number(from.value) === patternRange.start && Number(to.value) === patternRange.end && info.patternName;
      const who = state.solo ? info.laneId : 'mix';
      return onPattern ? `${who} ${info.patternName}` : `${who} ${pad3(Number(from.value))}–${pad3(Number(to.value))}`;
    };
    const refresh = () => {
      const a = Number(from.value), z = Number(to.value), n = z - a;
      size.textContent = n > 0 ? `${n} ticks${n % info.barTicks === 0 ? ` · ${n / info.barTicks} bar${n / info.barTicks === 1 ? '' : 's'}` : ''}` : 'the end must come after the start';
      if (!state.named) name.value = autoName();
      go.disabled = !(n > 0) || !name.value.trim();
      for (const b of ranges.querySelectorAll('button')) b.classList.toggle('on', b.dataset.scope === state.scope);
      for (const b of heard.querySelectorAll('button')) b.classList.toggle('on', (b.dataset.solo === '1') === state.solo);
    };
    const pick = scope => {
      const r = info.ranges[scope];
      if (!r) return;
      state.scope = scope; from.value = r.start; to.value = r.end;
      refresh();
    };
    const labels = { pattern: 'this pattern', selection: 'selection', loop: 'loop', lane: 'whole lane' };
    for (const [scope, label] of Object.entries(labels)) {
      ranges.append(el('button', { type: 'button', textContent: label, disabled: !info.ranges[scope], onclick: () => pick(scope) }));
      ranges.lastChild.dataset.scope = scope;
    }
    for (const [solo, label] of [[1, `the ${info.laneId} lane on its own, with whatever it plays through`], [0, 'everything, as the whole song plays it']]) {
      heard.append(el('button', { type: 'button', textContent: label, onclick: () => { state.solo = !!solo; refresh(); } }));
      heard.lastChild.dataset.solo = String(solo);
    }
    for (const input of [from, to]) input.addEventListener('input', () => { state.scope = ''; refresh(); });
    name.addEventListener('input', () => { state.named = true; refresh(); });

    let layer = null;   // its place on the popup stack: Escape cancels
    const close = answer => {
      box.remove();
      layer?.release();
      resolve(answer);
    };
    const go = el('button', { type: 'button', className: 'bn-go', textContent: 'bounce ▸', onclick: () => {
      remembered = { solo: state.solo, maxTail: Number(tail.value) || 10, marker: marker.checked };
      close({ from: Number(from.value), to: Number(to.value), solo: state.solo, maxTail: Math.min(60, Math.max(0.5, Number(tail.value) || 10)), name: name.value.trim(), marker: marker.checked });
    } });
    const cancel = el('button', { type: 'button', className: 'bn-plain', textContent: 'cancel', onclick: () => close(null) });

    const box = el('div', { className: 'bounce', role: 'dialog', ariaLabel: 'Bounce to sample' },
      el('h3', {}, 'bounce to sample ', el('span', { className: 'bn-dim' }, info.laneId)),
      el('h4', {}, 'range'),
      el('div', { className: 'bn-row' }, 'from ', from, ' to ', to, size),
      ranges,
      el('h4', {}, 'what is heard'),
      heard,
      el('h4', {}, 'length'),
      el('div', { className: 'bn-row' }, 'the range, plus what still rings: tails end below −72 dB, at most ', tail, ' s'),
      el('h4', {}, 'sample'),
      el('div', { className: 'bn-row' }, 'name ', name),
      el('div', { className: 'bn-row' }, marker, el('label', { htmlFor: 'bn-marker', textContent: 'slice marker where the range ends (so you can see the tails)' })),
      el('div', { className: 'bn-row bn-end' }, cancel, go));
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !go.disabled) { e.preventDefault(); e.stopPropagation(); go.click(); }
      else e.stopPropagation();   // no key reaches the grid underneath
    });
    refresh();
    document.body.append(box);
    layer = popups.open({ name: 'bounce dialog', element: box, close: () => close(null), outside: false, doc: document });
    to.focus(); go.focus();
  });
}
