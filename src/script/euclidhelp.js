// The pictures and little tools inside the script tutorial: ::euclid 5 8:: draws a ring, ::euclid-lab:: is a builder with
// sliders, ::euclid-gallery:: lists traditional rhythms to click. `put(text)` drops a line into the try-a-line box.
import { euclid } from './lib.js';
import { ring, strip } from './euclidviz.js';

const GALLERY = [
  [2, 3, 'Common in Latin American and jazz bass lines'], [3, 4, 'Calypso and cumbia'],
  [3, 8, 'The Cuban tresillo, the backbone of countless pop and dance grooves'], [5, 8, 'The cinquillo, Cuban and Latin American'],
  [4, 7, 'A Bulgarian folk rhythm'], [5, 9, 'An Arabic rhythm'], [5, 12, 'A Venda pattern from southern Africa'],
  [7, 12, 'The West African bell pattern (Bembe)'], [5, 16, 'Bossa nova'], [7, 16, 'Samba'],
  [9, 16, 'West and Central African polyrhythms'], [13, 24, 'A Central African pygmy rhythm'],
];

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
const call = (k, n, r) => (r ? `euclid(${k}, ${n}, ${r})` : `euclid(${k}, ${n})`);

// One picture: the ring, the steps and the text of the pattern.
function figure(k, n, r) {
  const bits = euclid(k, n, r), box = el('div', 'eh-fig');
  const text = el('div', 'ev-text');
  text.append(el('code', '', call(k, n, r)), el('span', '', `${k} hits in ${n} steps`), strip(bits), el('code', 'ev-bits', bits));
  box.append(ring(bits), text);
  return box;
}

function lab(put) {
  const box = el('div', 'eh-lab'), state = { k: 5, n: 8, r: 0 };
  const view = el('div'), sliders = el('div', 'eh-sliders'), inputs = {};
  const row = (key, label, hint) => {
    const r = el('label', 'eh-row'), input = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 16, value: state[key] }), out = el('output');
    input.addEventListener('input', () => { state[key] = Number(input.value); draw(); });
    r.append(el('span', '', label), input, out); r.title = hint; sliders.append(r); inputs[key] = { input, out };
  };
  row('k', 'hits', 'How many notes to play');
  row('n', 'steps', 'How many rows the pattern is spread over');
  row('r', 'shift', 'Slide the whole pattern along; the hits keep their spacing');
  const buttons = el('div', 'eh-buttons');
  const line = () => `tbin(${call(state.k, state.n, state.r)}, 'C-2')`;
  const use = el('button', '', 'Put this in the try-a-line box'); use.type = 'button';
  use.addEventListener('click', () => put(line()));
  buttons.append(use);
  function draw() {
    state.k = Math.min(state.k, state.n); state.r = Math.min(state.r, state.n - 1);
    inputs.n.input.min = 2; inputs.n.input.max = 32; inputs.n.input.value = state.n;
    inputs.k.input.max = state.n; inputs.k.input.value = state.k;
    inputs.r.input.max = state.n - 1; inputs.r.input.value = state.r;
    for (const key of ['k', 'n', 'r']) inputs[key].out.textContent = state[key];
    view.replaceChildren(figure(state.k, state.n, state.r));
    use.title = `Puts ${line()} in the box; press Enter there to write it into the pattern`;
  }
  box.set = (k, n) => { state.k = k; state.n = n; state.r = 0; draw(); box.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); };
  box.append(view, sliders, buttons);
  draw();
  return box;
}

function gallery(labBox) {
  const box = el('div', 'eh-gallery');
  for (const [k, n, note] of GALLERY) {
    const b = el('button', 'eh-card'); b.type = 'button';
    const bits = euclid(k, n);
    b.append(ring(bits), el('b', '', `${k} in ${n}`), el('span', '', note), el('code', 'ev-bits', bits));
    b.title = 'Show this one in the builder';
    b.addEventListener('click', () => (labBox ? labBox.set(k, n) : null));
    box.append(b);
  }
  return box;
}

export function mountWidgets(root, { put }) {
  let labBox = null;
  const nodes = [...root.querySelectorAll('.md-widget')];
  for (const w of nodes) {   // the builder first, so the gallery can talk to it wherever it sits
    if (w.dataset.widget === 'euclid-lab') { labBox = lab(put); w.replaceWith(labBox); }
  }
  for (const w of nodes) {
    if (!w.isConnected) continue;
    const [k, n, r = 0] = w.dataset.args.split(/\s+/).map(Number);
    if (w.dataset.widget === 'euclid' && Number.isInteger(k) && Number.isInteger(n) && n >= 1 && n <= 64) w.replaceWith(figure(k, n, r));
    else if (w.dataset.widget === 'euclid-gallery') w.replaceWith(gallery(labBox));
  }
}
