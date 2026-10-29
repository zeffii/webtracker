// The chord lab in the script tutorial (::chord-lab::): the circle of fifths as a wheel you can click, a strip for the
// progression you build, and the tbin line that plays it. `put(text)` drops that line into the try-a-line box.
import { CIRCLE, prog, progression, chordList, relative } from './chords.js';
import { noteToken } from '../seq/cells.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', textContent: text ?? '' });
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.append(e); return e; };
const polar = (r, i) => { const a = ((i * 30 - 90) * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
const wedge = (r0, r1, i) => {
  const a0 = ((i * 30 - 105) * Math.PI) / 180, a1 = ((i * 30 - 75) * Math.PI) / 180, pt = (r, a) => `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
  return `M${pt(r1, a0)}A${r1},${r1} 0 0 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0},${r0} 0 0 0 ${pt(r0, a0)}Z`;
};
const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const ringPos = pc => CIRCLE.findIndex(n => PITCH[n] === pc);
const rootPc = name => PITCH[/^[A-G][#b]?/.exec(name)[0]];
const MINOR_RING = CIRCLE.map(n => relative(n));   // the inner ring: the relative minor of each major key
const ROMAN = { major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] };
const NUMERAL_TEXT = {
  major: { triad: 'I ii iii IV V vi vii°', seventh: 'Imaj7 ii7 iii7 IVmaj7 V7 vi7 viiø' },
  minor: { triad: 'i ii° III iv v VI VII', seventh: 'i7 iiø IIImaj7 iv7 v7 VImaj7 VII7' },
};

export function chordLab(put) {
  const box = el('div', 'eh-lab cl-lab');
  const state = { key: 0, minor: false, sev: false, lead: true, length: 4, list: [], arc: [] };
  // the seven chords of the key: name, numeral, and where each sits on the wheel (outer ring for major chords, inner for minor)
  const degrees = () => {
    const mode = state.minor ? 'minor' : 'major', keyName = state.minor ? MINOR_RING[state.key] : CIRCLE[state.key];
    const names = prog(NUMERAL_TEXT[mode][state.sev ? 'seventh' : 'triad'], keyName.replace(/m$/, ''), mode);
    return names.map((name, d) => {
      const pc = rootPc(name), isMinor = /^[A-G][#b]?(m(?!aj)|dim)/.test(name);
      return { name, numeral: ROMAN[mode][d], pos: ringPos(pc), inner: isMinor };
    });
  };
  const keyLabel = () => (state.minor ? MINOR_RING[state.key] : CIRCLE[state.key]);

  const wheel = svgEl('svg', { viewBox: '-165 -165 330 330', class: 'cl-wheel' });
  const side = el('div', 'cl-side');
  const info = el('div', 'cl-info'), strip = el('div', 'cl-strip'), line = el('code', 'cl-line');
  const mode = el('div', 'cl-chips'), tools = el('div', 'cl-chips'), sug = el('div', 'cl-chips'), go = el('div', 'cl-chips');
  const button = (parent, text, title, on) => { const b = el('button', '', text); b.type = 'button'; b.title = title; b.addEventListener('click', on); parent.append(b); return b; };
  const toggle = (parent, text, title, key, after) => { const b = button(parent, text, title, () => { state[key] = !state[key]; after?.(); draw(); }); b.dataset.key = key; return b; };

  const majorB = button(mode, 'Major', 'Show the key as a major key', () => { if (state.minor) { state.key = (state.key + 9) % 12; state.minor = false; state.arc = []; draw(); } });
  const minorB = button(mode, 'Minor', 'Show the key as a minor key', () => { if (!state.minor) { state.key = (state.key + 3) % 12; state.minor = true; state.arc = []; draw(); } });
  button(tools, 'Undo', 'Remove the last chord', () => { state.list.pop(); draw(); });
  button(tools, 'Clear', 'Start again', () => { state.list = []; state.arc = []; draw(); });
  const leadB = toggle(tools, 'Smooth voicing', 'Each chord is turned to move the fewest notes from the one before', 'lead');
  const sevB = toggle(tools, 'Sevenths', 'Chords with their seventh', 'sev', () => { state.arc = []; });
  const lengthSel = Object.assign(document.createElement('select'), { title: 'How many chords a suggested progression has' });
  for (const n of [4, 6, 8, 16]) lengthSel.append(Object.assign(document.createElement('option'), { value: n, textContent: `${n} chords` }));
  lengthSel.addEventListener('change', () => { state.length = Number(lengthSel.value); state.arc = []; });
  const nextB = button(sug, 'Suggest next', 'Adds the next chord of a progression that ends back at the home chord', () => {
    const mode = state.minor ? 'minor' : 'major';
    const make = n => progression(Math.random, n, keyLabel().replace(/m$/, ''), mode, { sevenths: state.sev });
    if (state.list.length && !state.arc.length) state.list.push(make(3)[1]);   // chords of your own: a likely move from home
    else {
      if (!state.arc.length || state.list.length >= state.arc.length) { state.arc = make(state.length); state.list = []; }
      state.list.push(state.arc[state.list.length]);
    }
    draw();
  });
  sug.prepend(lengthSel);
  const putB = button(go, 'Put this in the try-a-line box', 'Puts the line in the box; press Enter there to write it into the pattern', () => put(line.textContent));
  side.append(mode, info, el('div', 'cl-hint', 'Click a chord to add it. Click a key on the wheel to change key.'), strip, tools, sug, line, go);
  box.append(wheel, side);

  function draw() {
    const deg = degrees(), byRing = {};
    deg.forEach(d => { byRing[`${d.inner ? 'i' : 'o'}${d.pos}`] = d; });
    wheel.replaceChildren();
    const home = state.key;
    for (let i = 0; i < 12; i++) {
      for (const [ring, r0, r1, labels] of [['o', 104, 150, CIRCLE], ['i', 62, 100, MINOR_RING]]) {
        const d = byRing[`${ring}${i}`], isHome = i === home && (ring === 'i') === state.minor;
        const p = svgEl('path', { d: wedge(r0, r1, i), class: `cl-k${d ? ' d' : ''}${isHome ? ' t' : ''}` }, wheel);
        const [x, y] = polar((r0 + r1) / 2, i);
        svgEl('text', { x, y: d ? y - 5 : y }, wheel).textContent = d ? d.name : labels[i];
        if (d) svgEl('text', { x, y: y + 9, class: 'cl-rn' }, wheel).textContent = d.numeral;
        p.addEventListener('click', () => {
          if (d) { state.list.push(d.name); draw(); return; }
          state.key = i; state.minor = ring === 'i'; state.arc = []; draw();
        });
      }
    }
    if (state.list.length > 1) {   // a line through the chords in the order they were added
      const pts = state.list.map(n => { const pc = rootPc(n), inner = /^[A-G][#b]?(m(?!aj)|dim)/.test(n); return polar(inner ? 81 : 127, ringPos(pc)); });
      svgEl('polyline', { points: pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' '), class: 'cl-path' }, wheel);
    }
    svgEl('text', { x: 0, y: -8, class: 'cl-key' }, wheel).textContent = keyLabel();
    svgEl('text', { x: 0, y: 10, class: 'cl-rn' }, wheel).textContent = state.minor ? 'minor' : 'major';
    const near = (state.minor ? [4, 3, 2, 6, 5] : [4, 3, 5, 2, 1]).map(i => deg[i].name);
    info.textContent = `Key of ${keyLabel()}. Next to it: ${near.join(' ')}. ${state.minor ? 'Relative major' : 'Relative minor'}: ${relative(keyLabel())}.`;
    majorB.setAttribute('aria-pressed', String(!state.minor)); minorB.setAttribute('aria-pressed', String(state.minor));
    leadB.setAttribute('aria-pressed', String(state.lead)); sevB.setAttribute('aria-pressed', String(state.sev));
    strip.replaceChildren();
    if (!state.list.length) strip.append(el('span', 'cl-empty', 'no chords yet'));
    state.list.forEach((n, i) => { if (i) strip.append(el('i', '', '›')); const c = el('span', 'cl-chord', n); c.title = chordList([n]).map(l => l.map(m => noteToken(m - 12)).join(' ')).join(''); strip.append(c); });
    const pattern = state.list.length ? Array(state.list.length).fill('x...').join(' ') : '';
    line.textContent = state.list.length ? `tbin('${pattern}', chords('${state.list.join(' ')}')${state.lead ? ', { lead: true }' : ''})` : '';
    putB.disabled = !state.list.length;
  }
  draw();
  return box;
}
