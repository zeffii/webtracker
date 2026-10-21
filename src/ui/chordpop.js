// The chord palette (Alt+C over a row of notes): the chord on a small keyboard, and ways to change it — voicings,
// one note at a time, another quality, smooth voice-leading down several rows — each with an ear button that plays the
// chord for a second. Nothing is written until Enter. opts:
//   { notes (st, ascending), rows: [{ tick, notes }] (the selected rows, first is `notes`), scale: { key, id }, anchor: { x, y },
//     preview(notes), onScale({ key, id }), onApply(notes), onSmooth([notes per row]), onCancel() }
// Without a page (the tests) it just applies what it is given.
import { PC, QUALITIES, SCALES, spell, detect, voicings, setQuality, candidates, stepScale, scaleSet, voiceLead, movement, sameNotes } from '../seq/chords.js';

const BLACK = [1, 3, 6, 8, 10];
const EAR = 'M6 9a6 6 0 1 1 12 0c0 3-2.5 4-3.5 6.2-.8 1.7-.8 3.800-3 3.800a3.200 3.200 0 0 1-3.200-3.200 M9.500 9.500a2.500 2.500 0 0 1 5 0c0 1.600-1.500 2-1.500 3.500';

export function showChordPalette(opts, { doc = typeof document === 'undefined' ? null : document } = {}) {
  if (!doc) { opts.onApply(opts.notes); return () => {}; }
  const asc = a => [...a].sort((x, y) => x - y);
  let work = [...opts.notes], voice = 0, tab = 'voicings', scale = { ...opts.scale };
  const smooth = opts.rows.length > 1;
  const box = doc.createElement('div');
  box.className = 'chord-pop';
  box.tabIndex = -1;

  const h = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : doc.createTextNode(String(kid)));
    return e;
  };
  const svg = (d, cls) => {
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  };
  const ear = notes => h('button', { class: 'cd-ear', type: 'button', title: 'Hear it (1 second)', 'aria-label': 'Hear it', onclick: e => { e.stopPropagation(); opts.preview(notes); } }, svg(EAR));

  const set = () => scaleSet(scale.key, scale.id);
  // A strip of keys that covers the given notes with a little room either side; lit, outlined (ghost) and picked keys.
  const roll = (lists, { lit, ghost = [], pick = [], size = '', onKey = null }) => {
    const all = lists.flat(), lo = Math.max(0, Math.floor((Math.min(...all) - 2) / 12) * 12), hi = Math.min(127, Math.max(...all) + 3), s = set();
    const wrap = h('div', { class: `cd-roll ${size}` });
    for (let m = lo; m <= hi; m++) {
      const pc = m % 12;
      let cls = `cd-k ${BLACK.includes(pc) ? 'b' : 'w'}`;
      if (lit.includes(m)) cls += ' on';
      if (ghost.includes(m)) cls += ' gh';
      if (pick.includes(m)) cls += ' pick';
      if (s && s.has(pc)) cls += ' sc';
      const k = h('i', { class: cls }, pc === 0 ? `C${Math.floor(m / 12)}` : '');
      if (onKey) k.addEventListener('click', () => onKey(m));
      wrap.append(k);
    }
    return wrap;
  };
  const named = notes => detect(notes)?.name ?? '';

  const setWork = n => { work = asc(n.filter(m => m >= 0 && m <= 127)); voice = Math.min(voice, work.length - 1); draw(); };
  const moveVoice = (note) => { if (note < 0 || note > 127 || work.includes(note)) return; const next = asc(work.map((m, i) => (i === voice ? note : m))); work = next; voice = next.indexOf(note); draw(); };

  const smoothed = () => {
    const out = [];
    opts.rows.forEach((r, i) => { out.push(i === 0 ? r.notes : voiceLead(out[i - 1], r.notes) ?? r.notes); });
    return out;
  };

  const panel = () => {
    if (tab === 'voicings') {
      return h('div', { class: 'cd-list' }, voicings(work).map(v => h('div', { class: `cd-row${sameNotes(v.notes, work) ? ' on' : ''}`, onclick: () => setWork(v.notes) },
        h('div', { class: 'cd-n' }, h('b', {}, v.name), h('span', {}, v.notes.map(spell).join(' '))),
        roll([work, v.notes], { lit: v.notes, ghost: sameNotes(v.notes, work) ? [] : work, size: 'sm' }), ear(v.notes))));
    }
    if (tab === 'one') {
      const list = candidates(work, voice, set());
      return h('div', { class: 'cd-list' },
        h('div', { class: 'cd-hint' }, `Voice ${voice + 1} of ${work.length} is ${spell(work[voice])}. Left/Right picks another voice, Up/Down moves it a semitone, Shift+Up/Down a scale step, or click a key above.`),
        list.map(c => h('div', { class: 'cd-row', onclick: () => moveVoice(c.note) },
          h('div', { class: 'cd-n' }, h('b', {}, `${spell(work[voice])} → ${spell(c.note)}`), h('span', {}, `${c.interval}${c.chord ? ` · ${c.chord}` : ''}`)),
          roll([work, c.notes], { lit: c.notes, ghost: [work[voice]], size: 'sm' }),
          h('span', { class: `cd-tag${c.inScale === false ? ' out' : ''}` }, c.inScale === null ? '' : c.inScale ? 'in the scale' : 'outside the scale'), ear(c.notes))));
    }
    if (tab === 'quality') {
      const root = asc(work)[0];
      return h('div', { class: 'cd-tiles' }, QUALITIES.map(q => {
        const n = setQuality(work, q);
        return h('div', { class: `cd-tile${sameNotes(n, work) ? ' on' : ''}`, onclick: () => setWork(n) },
          h('b', {}, `${PC[root % 12]}${q.label}`), roll([n], { lit: n, size: 'tiny' }), h('span', {}, n.map(spell).join(' ')), ear(n));
      }));
    }
    const out = smoothed();
    return h('div', { class: 'cd-list' },
      h('div', { class: 'cd-hint' }, 'Each chord below the first is revoiced so its notes move as little as possible from the one above. Enter writes them all.'),
      opts.rows.map((r, i) => {
        const was = r.notes, now = out[i], mv = i ? movement(out[i - 1], now) : null;
        return h('div', { class: 'cd-row' },
          h('div', { class: 'cd-n' }, h('b', {}, named(was) || spell(was[0])), h('span', {}, i === 0 ? 'your chord' : mv === null ? 'different number of notes: left as it is' : `${mv} semitone${mv === 1 ? '' : 's'} in all`)),
          roll([was, now], { lit: now, ghost: sameNotes(now, was) ? [] : was, size: 'sm' }), ear(now));
      }));
  };

  const draw = () => {
    box.replaceChildren();
    const tabBtn = (id, label) => h('button', { class: `cd-tab${tab === id ? ' on' : ''}`, type: 'button', onclick: () => { tab = id; draw(); } }, label);
    box.append(
      h('div', { class: 'cd-head' },
        h('b', { class: 'cd-name' }, named(work) || (work.length ? work.map(spell).join(' ') : 'no notes')),
        h('span', { class: 'cd-sub' }, work.map(spell).join('  ')), ear(work)),
      roll([work, opts.notes], { lit: work, ghost: sameNotes(work, opts.notes) ? [] : opts.notes, pick: tab === 'one' ? [work[voice]] : [], onKey: m => { const i = work.indexOf(m); if (i >= 0) { voice = i; tab = 'one'; draw(); } else if (tab === 'one') moveVoice(m); } }),
      h('div', { class: 'cd-bar' },
        h('span', { class: 'cd-lbl' }, 'Inversion'), h('button', { type: 'button', title: 'Lowest note down… highest note down an octave ([)', onclick: () => setWork(asc([...work.slice(0, -1), work[work.length - 1] - 12])) }, '◂'),
        h('button', { type: 'button', title: 'Lowest note up an octave (])', onclick: () => setWork(asc([...work.slice(1), work[0] + 12])) }, '▸'),
        h('span', { class: 'cd-lbl' }, 'Move'), ...[[-12, '−12'], [-1, '−1'], [1, '+1'], [12, '+12']].map(([d, t]) => h('button', { type: 'button', onclick: () => setWork(work.map(m => m + d)) }, t))),
      h('div', { class: 'cd-tabs' }, tabBtn('voicings', 'Voicings'), tabBtn('one', 'One note'), tabBtn('quality', 'Quality'), smooth && tabBtn('smooth', 'Smooth rows')),
      panel(),
      h('div', { class: 'cd-foot' },
        h('label', {}, 'Key ', h('select', { onchange: e => { scale.key = Number(e.target.value); opts.onScale(scale); draw(); } }, PC.map((p, i) => h('option', { value: i, selected: i === scale.key }, p)))),
        h('label', {}, 'Scale ', h('select', { onchange: e => { scale.id = e.target.value; opts.onScale(scale); draw(); } }, Object.keys(SCALES).map(id => h('option', { value: id, selected: id === scale.id }, id === 'off' ? 'no scale' : id)))),
        h('span', { class: 'cd-hint', style: 'flex:1' }, 'Space hears it · Tab changes page'),
        h('button', { type: 'button', onclick: () => cancel() }, 'Cancel'),
        h('button', { type: 'button', class: 'cd-go', onclick: () => accept() }, 'Apply')));
  };

  let closed = false;
  const close = () => { if (closed) return; closed = true; box.remove(); doc.removeEventListener('keydown', keys, true); doc.removeEventListener('mousedown', away, true); };
  const accept = () => { close(); if (tab === 'smooth' && smooth) opts.onSmooth(smoothed()); else opts.onApply(work); };
  const cancel = () => { close(); opts.onCancel(); };
  const away = e => { if (!box.contains(e.target)) cancel(); };
  const TABS = () => ['voicings', 'one', 'quality', ...(smooth ? ['smooth'] : [])];
  const keys = e => {
    const k = e.key, big = e.shiftKey;
    if (e.target?.tagName === 'SELECT') { if (k === 'Escape') cancel(); else return; e.preventDefault(); e.stopPropagation(); return; }
    if (k === 'Escape') cancel();
    else if (k === 'Enter') accept();
    else if (k === ' ') opts.preview(work);
    else if (k === 'Tab') { const t = TABS(); tab = t[(t.indexOf(tab) + (big ? -1 : 1) + t.length) % t.length]; draw(); }
    else if (k === 'ArrowLeft') { voice = Math.max(0, voice - 1); draw(); }
    else if (k === 'ArrowRight') { voice = Math.min(work.length - 1, voice + 1); draw(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { const d = k === 'ArrowUp' ? 1 : -1; moveVoice(e.ctrlKey ? work[voice] + 12 * d : big ? stepScale(work[voice], d, set()) : work[voice] + d); }
    else if (k === '[') setWork(asc([...work.slice(0, -1), work[work.length - 1] - 12]));
    else if (k === ']') setWork(asc([...work.slice(1), work[0] + 12]));
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  doc.body.append(box);
  draw();
  doc.addEventListener('keydown', keys, true);
  doc.addEventListener('mousedown', away, true);
  const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight, w = box.offsetWidth, hh = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(opts.anchor.x, vw - w - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(opts.anchor.y, vh - hh - 8))}px`;
  box.focus();
  return close;
}
