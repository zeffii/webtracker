// The shader editor: a view of its own for the live picture's GLSL. A transparent textarea lies over a copy of the same text painted in
// colours (the usual trick: the browser keeps the caret, selection and undo; the copy shows the syntax). Changes reach the picture
// a moment after typing stops. An empty setting means the built-in picture, whose source is shown here to start from.

const KEYWORDS = new Set('attribute const uniform varying break continue do for while if else in out inout return discard struct precision highp mediump lowp true false invariant'.split(' '));
const TYPES = new Set('void bool int float vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 mat2 mat3 mat4 sampler2D samplerCube'.split(' '));
const BUILTINS = new Set(('radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep ' +
  'length distance dot cross normalize faceforward reflect refract matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D dFdx dFdy fwidth').split(' '));
const WAX = new Set('hit pitch vel held hits cell R T BEAT HITS NL SKEL C1 C2 LANE PAT WIN BEHIND'.split(' '));
const SPECIAL = new Set(['gl_FragCoord', 'gl_FragColor', 'gl_PointCoord']);

import { knobCalls } from './visdata.js';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("[^"\n]*"?)|(#[^\n]*)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|([\s\S])/g;

// The text as HTML, each word in a span whose class says what it is: c comment, s string, p preprocessor line, n number, k keyword,
// t type, f built-in function, w one of Wax's own names, g gl_ variable. Everything else is left as it is.
export function highlight(text, mark = -1) {
  let out = '', at = 0;
  for (const c of knobCalls(text)) { out += colour(text.slice(at, c.start), at, mark); out += `<span class="x">${esc(c.text)}</span>`; at = c.end; }
  return out + colour(text.slice(at), at, mark);
}
function colour(text, offset, mark) {
  let out = '';
  for (const m of text.matchAll(TOKEN)) {
    const [all, comment, string, pre, num, word] = m;
    const cls = comment ? 'c' : string ? 's' : pre ? 'p' : num ? `${/^\d+$/.test(num) ? 'i' : 'n'}${m.index + offset === mark ? ' on' : ''}`
      : word ? (KEYWORDS.has(word) ? 'k' : TYPES.has(word) ? 't' : WAX.has(word) ? 'w' : BUILTINS.has(word) ? 'f' : SPECIAL.has(word) ? 'g' : '') : '';
    out += cls ? `<span class="${cls}">${esc(all)}</span>` : esc(all);
  }
  return out;
}

// Every plain number in the text, with where it sits: { start, end } the characters a new value replaces (a negative one is written as
// (-.3), so it can follow a minus sign), { numStart, numEnd } the digits, kind 'int' or 'float', value signed. Numbers in comments,
// strings and #lines, written with an exponent, or stuck to a letter (0x1F) are left out.
export function numbers(text) {
  const out = [], calls = knobCalls(text);
  for (const m of text.matchAll(TOKEN)) {
    const t = m[4];
    if (!t || calls.some(c => m.index >= c.start && m.index < c.end) || /[eE]/.test(t) || /\w/.test(text[m.index + t.length] ?? '')) continue;
    let start = m.index, end = m.index + t.length, neg = false;
    if (text[start - 1] === '-' && text[start - 2] === '(' && text[end] === ')') { start -= 2; end += 1; neg = true; }
    out.push({ start, end, numStart: m.index, numEnd: m.index + t.length, text: t, kind: /^\d+$/.test(t) ? 'int' : 'float', neg, value: (neg ? -1 : 1) * parseFloat(t) });
  }
  return out;
}
const ceilNice = v => { const e = 10 ** Math.floor(Math.log10(v)), n = v / e; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e; };
// The slider's range for a number: from 0 (unsigned) or from minus the top (signed) up to about four times the number. Ints go in whole steps.
export function sliderSpec(kind, value, signed) {
  const mag = Math.abs(value);
  if (kind === 'int') { const hi = Math.max(8, ceilNice(mag * 4)); return { lo: signed ? -hi : 0, hi, step: 1, decimals: 0 }; }
  const hi = mag ? ceilNice(mag * 4) : 1, step = ceilNice(hi / 400);
  return { lo: signed ? -hi : 0, hi, step, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}
// The text for a value: floats always keep their point (2 would be an int), a leading zero follows how the number was first written, and a
// negative one is wrapped in brackets.
export function formatValue(kind, v, { decimals = 0, bare = false } = {}) {
  let s;
  if (kind === 'int') s = String(Math.abs(Math.round(v)));
  else {
    s = Math.abs(v).toFixed(decimals);
    s = s.includes('.') ? s.replace(/0+$/, '') : `${s}.`;
    if (bare && /^0\.\d/.test(s)) s = s.slice(1);
  }
  const zero = /^[0.]*$/.test(s);
  return v < 0 && !zero ? `(-${s})` : s;
}

// parts: { box, input, paint, gutter, status, templates (a select), reset (a button) }; config; defaultSource; templates: { id: { label, source } }
// sliders: parts.clip (the box the popup sits in) and parts.slidersOn (the tick box that switches the number chips and sliders on or off)
// store: { get(), set(text), texts(), list(), index, select(i), add(), duplicate(), rename(i, name), remove(i) } holds the sources ('' for the built-in
// picture): the project's shaders, with the Config text as a default for the first; get and set are the one being edited
export function createShaderView({ parts, config, store, defaultSource, templates, machine = null }) {
  const { input, paint, gutter, status } = parts;
  parts.machine = machine;
  let timer = null, errorLine = 0, shown = '', slider = null, hoverMark = -1;
  const stored = () => store.get();
  const lineCount = () => input.value.split('\n').length;
  const draw = () => {
    paint.innerHTML = `${highlight(input.value, hoverMark >= 0 ? hoverMark : slider ? slider.numStart : -1)}\n`;
    const n = lineCount();
    gutter.innerHTML = Array.from({ length: n }, (_, i) => `<span${i + 1 === errorLine ? ' class="bad"' : ''}>${i + 1}</span>`).join('');
    sync();
  };
  const sync = () => { paint.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`; gutter.style.transform = `translateY(${-input.scrollTop}px)`; };
  const apply = () => { timer = null; shown = input.value; store.set(input.value === defaultSource ? '' : input.value); };
  const change = () => { if (sliding) return; closeSlider(false); errorLine = 0; draw(); clearTimeout(timer); timer = setTimeout(apply, 350); };
  let sliding = false;
  input.addEventListener('input', change);
  input.addEventListener('scroll', sync);
  input.addEventListener('keydown', e => {
    e.stopPropagation();   // typing here is not a shortcut for the rest of the program
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = input;
      if (a === b) { document.execCommand('insertText', false, '  '); return; }
      const from = value.lastIndexOf('\n', a - 1) + 1, block = value.slice(from, b), lines = block.split('\n');
      const next = e.shiftKey ? lines.map(l => l.replace(/^ {1,2}/, '')) : lines.map(l => `  ${l}`);
      input.setSelectionRange(from, b);
      document.execCommand('insertText', false, next.join('\n'));
      input.setSelectionRange(from, from + next.join('\n').length);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const { selectionStart: a, value } = input, start = value.lastIndexOf('\n', a - 1) + 1, indent = /^ */.exec(value.slice(start, a))[0];
      const more = /\{\s*$/.test(value.slice(start, a)) ? '  ' : '';
      e.preventDefault();
      document.execCommand('insertText', false, `\n${indent}${more}`);
    }
  });
  // ---- number sliders: numbers are drawn on a faint chip; click one (or drag it sideways) for a slider that writes into the text ----
  const clip = parts.clip, signedPref = { int: false, float: false };
  const pop = document.createElement('div');
  pop.id = 'shader-pop-slider'; pop.hidden = true;
  pop.innerHTML = '<label title="Untick to put the number back as it was and close"><input type="checkbox" checked> live</label><input type="range" aria-label="Value"><output></output><label title="Allow negative values"><input type="checkbox"> &plusmn;</label><button type="button" aria-label="Close" title="Close, keeping the value">&#x2715;</button>';
  clip.append(pop);
  const [liveBox, range, out, signBox] = [...pop.querySelectorAll('input'), pop.querySelector('output')].filter(Boolean).reduce((a, el) => (el.tagName === 'OUTPUT' ? [a[0], a[1], el, a[3]] : a[0] ? (a[1] ? [a[0], a[1], a[2], el] : [a[0], el, a[2], a[3]]) : [el, a[1], a[2], a[3]]), [null, null, null, null]);
  const closeBtn = pop.querySelector('button');
  const enabled = () => parts.slidersOn.checked;
  const metrics = () => {   // one character's width, a line's height, the text's offset inside the box
    const cs = getComputedStyle(input), probe = Object.assign(document.createElement('span'), { textContent: 'M'.repeat(40) });
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
    input.parentNode.append(probe); const cw = probe.getBoundingClientRect().width / 40; probe.remove();
    return { cw, lh: parseFloat(cs.lineHeight) || 19, px: parseFloat(cs.paddingLeft), py: parseFloat(cs.paddingTop) };
  };
  const numberAtEvent = e => {
    if (!enabled()) return null;
    const r = input.getBoundingClientRect(), { cw, lh, px, py } = metrics();
    const x = e.clientX - r.left + input.scrollLeft - px, y = e.clientY - r.top + input.scrollTop - py;
    if (x < 0 || y < 0) return null;
    const lines = input.value.split('\n'), row = Math.floor(y / lh), col = x / cw;
    if (row >= lines.length) return null;
    let at = 0; for (let i = 0; i < row; i++) at += lines[i].length + 1;
    if (col > lines[row].length) return null;
    const offset = at + Math.floor(col);
    return { n: numbers(input.value).find(n => offset >= n.start && offset < n.end) ?? null, caret: at + Math.min(lines[row].length, Math.round(col)), row, col: Math.floor(col), lh, cw, px, py };
  };
  let frame = 0;
  const write = v => {   // a new value into the text, at the number the slider is on
    const s = slider, text = formatValue(s.kind, v, { decimals: s.spec.decimals, bare: s.bare });
    sliding = true;
    input.setRangeText(text, s.start, s.end, 'preserve');
    sliding = false;
    s.end = s.start + text.length; s.numStart = s.start + (text.startsWith('(') ? 2 : 0);
    out.textContent = text.replace(/^\(|\)$/g, ''); range.value = String(v);
    draw();
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; clearTimeout(timer); apply(); });
  };
  const place = () => {
    const { cw, lh, px, py } = metrics(), lines = input.value.slice(0, slider.start).split('\n');
    const x = px + lines[lines.length - 1].length * cw - input.scrollLeft, line = py + (lines.length - 1) * lh - input.scrollTop;
    // just above the number; below it when the number is on the top line
    pop.style.left = `${Math.max(0, Math.min(x - 8, clip.clientWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${line - pop.offsetHeight - 1 >= 0 ? line - pop.offsetHeight - 1 : line + lh + 1}px`;
  };
  function openSlider(n) {
    if (slider && slider.start === n.start) return;
    closeSlider(true);
    const signed = signedPref[n.kind] || n.value < 0, spec = sliderSpec(n.kind, n.value, signed);
    slider = { ...n, was: input.value.slice(n.start, n.end), spec, bare: /^\./.test(n.text), signed };
    liveBox.checked = true; signBox.checked = signed;
    range.min = spec.lo; range.max = spec.hi; range.step = spec.step; range.value = String(n.value);
    out.textContent = n.text; pop.hidden = false; place(); draw();
  }
  // One undo step for a whole slide: the old text is put back, then the new typed over it.
  function commit(start, end, was) {
    const now = input.value.slice(start, end);
    if (now === was) return;
    const at = input.selectionStart, active = document.activeElement;
    sliding = true;
    input.setRangeText(was, start, end, 'end');
    input.focus({ preventScroll: true }); input.setSelectionRange(start, start + was.length);
    document.execCommand('insertText', false, now);
    input.setSelectionRange(Math.min(at, input.value.length), Math.min(at, input.value.length));
    if (active && active !== input) active.focus?.({ preventScroll: true });
    sliding = false;
  }
  // keep = true: leave the value in the text, as one step for undo; false (untick): put the number back as it was
  function closeSlider(keep) {
    if (!slider) return;
    const s = slider; slider = null; pop.hidden = true;
    if (!keep) { sliding = true; input.setRangeText(s.was, s.start, s.end, 'preserve'); sliding = false; }
    else commit(s.start, s.end, s.was);
    clearTimeout(timer); apply(); draw();
  }
  range.addEventListener('input', () => { if (slider) write(Number(range.value)); });
  liveBox.addEventListener('change', () => { if (!liveBox.checked) { closeSlider(false); input.focus({ preventScroll: true }); } });
  signBox.addEventListener('change', () => {
    if (!slider) return;
    signedPref[slider.kind] = signBox.checked; slider.signed = signBox.checked;
    const v = Number(range.value); slider.spec = sliderSpec(slider.kind, v, signBox.checked);
    range.min = slider.spec.lo; range.max = slider.spec.hi; range.step = slider.spec.step; range.value = String(Math.max(slider.spec.lo, v));
    write(Number(range.value));
  });
  closeBtn.addEventListener('click', () => { closeSlider(true); input.focus({ preventScroll: true }); });
  pop.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { closeSlider(true); input.focus({ preventScroll: true }); } });
  // the slider shows while the mouse is over a number or the caret is in one, and goes a moment after both have left
  let hoverTimer = 0, overPop = false, overNumber = false;
  const caretNumber = () => (input.selectionStart === input.selectionEnd && document.activeElement === input ? numbers(input.value).find(n => input.selectionStart >= n.numStart && input.selectionStart <= n.numEnd) : null);
  const settle = () => {   // close it if neither the mouse nor the caret is on it
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (slider && !overPop && !overNumber && !drag && !caretNumber() && document.activeElement !== range) closeSlider(true); }, 280);
  };
  pop.addEventListener('mouseenter', () => { overPop = true; clearTimeout(hoverTimer); });
  pop.addEventListener('mouseleave', () => { overPop = false; settle(); });
  input.addEventListener('mousemove', e => {
    if (drag) return;
    const hit = numberAtEvent(e);
    input.style.cursor = hit?.n ? 'ew-resize' : '';
    overNumber = !!hit?.n;
    if (hit?.n) { clearTimeout(hoverTimer); if (!slider || slider.start !== hit.n.start) hoverTimer = setTimeout(() => { if (overNumber && !drag) openSlider(hit.n); }, 140); }
    else settle();
  });
  input.addEventListener('mouseleave', () => { input.style.cursor = ''; overNumber = false; settle(); });
  const onCaret = () => { if (!enabled() || drag || sliding) return; const n = caretNumber(); if (n) openSlider(n); else settle(); };
  input.addEventListener('keyup', onCaret);
  input.addEventListener('focus', onCaret);
  input.addEventListener('blur', () => { setTimeout(() => { if (slider && !pop.contains(document.activeElement) && !overPop) closeSlider(true); }, 0); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && slider) { e.preventDefault(); closeSlider(true); } });
  input.addEventListener('scroll', () => { if (slider) place(); });
  // a plain click on a number opens its slider; dragging sideways slides it straight away (Shift: a tenth as fast)
  let drag = null;
  input.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.detail > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const hit = numberAtEvent(e);
    if (!hit?.n) { closeSlider(true); return; }
    e.preventDefault(); input.focus({ preventScroll: true });
    drag = { x: e.clientX, hit, moved: false, base: hit.n.value };
  });
  addEventListener('mousemove', e => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 4) return;
    if (!drag.moved) { drag.moved = true; openSlider(drag.hit.n); drag.base = slider.kind === 'int' ? Number(range.value) : Number(range.value); drag.x = e.clientX; }
    const span = slider.spec.hi - slider.spec.lo, per = span / 300 * (e.shiftKey ? .1 : 1);
    drag.base = Math.min(slider.spec.hi, Math.max(slider.spec.lo, drag.base + (e.clientX - drag.x) * per)); drag.x = e.clientX;
    write(slider.kind === 'int' ? Math.round(drag.base) : Math.round(drag.base / slider.spec.step) * slider.spec.step);
    e.preventDefault();
  });
  addEventListener('mouseup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { input.setSelectionRange(d.hit.caret, d.hit.caret); openSlider(d.hit.n); }
    overNumber = true; settle();
  });
  parts.slidersOn.addEventListener('change', () => { config.set('shaderSliders', parts.slidersOn.checked); if (!parts.slidersOn.checked) closeSlider(true); rebuildKnobs(); paint.classList.toggle('plain', !parts.slidersOn.checked); });
  parts.slidersOn.checked = config.get('shaderSliders'); paint.classList.toggle('plain', !parts.slidersOn.checked);

  // ---- the knobs panel: every number in the text with a slider of its own ----
  const knobsEl = parts.knobs, rows = [];
  let knobTimer = 0;
  const nth = i => numbers(input.value)[i];
  let liveTimer = 0;
  const plain = v => { const t = String(Number(v.toFixed(6))); return t.includes('.') ? t : `${t}.`; };
  // Put text over a range of the code as one step for undo, then rebuild the lists.
  const replaceText = (start, end, text) => {
    closeSlider(true);
    const at = input.selectionStart;
    sliding = true;
    input.focus({ preventScroll: true }); input.setSelectionRange(start, end);
    document.execCommand('insertText', false, text);
    input.setSelectionRange(Math.min(at, input.value.length), Math.min(at, input.value.length));
    sliding = false;
    clearTimeout(timer); apply(); draw(); rebuildKnobs();
  };
  const guessName = (text, n) => {   // the name written before the = on the number's line: "float rad = .07 + ..." is "rad"
    const ls = text.lastIndexOf('\n', n.start - 1) + 1, before = text.slice(ls, n.start), m = /([A-Za-z_]\w*)\s*[-+*\/]?=(?!=)/.exec(before);
    return m ? m[1] : 'knob';
  };
  const rebuildKnobs = () => {
    clearInterval(liveTimer);
    knobsEl.hidden = !parts.knobsOn.checked || !enabled();
    if (knobsEl.hidden) return;
    knobsEl.textContent = ''; rows.length = 0;
    const text = input.value, nums = numbers(text).slice(0, 150), calls = knobCalls(text), machine = parts.machine;
    const list = [...nums.map((n, i) => ({ n, i, at: n.start })), ...calls.map(c => ({ c, at: c.start }))].sort((x, y) => x.at - y.at);
    const lineOf = at => { const ls = text.lastIndexOf('\n', at - 1) + 1, le = text.indexOf('\n', at); return [ls, text.slice(ls, le < 0 ? text.length : le)]; };
    const live = [];
    if (!list.length) knobsEl.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No numbers in the shader.' }));
    for (const item of list) {
      const el = document.createElement('div');
      if (item.c) {   // an exposed number: kn("name", start, low, high)
        const c = item.c, here = machine?.get(c.name) !== undefined;
        el.className = 'knob xp';
        const dot = Object.assign(document.createElement('span'), { className: 'xd', textContent: '●', title: 'Exposed: a pattern column of the shader lane moves it' });
        const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.001, disabled: !here, value: here ? machine.get(c.name) : 0 });
        const val = Object.assign(document.createElement('span'), { className: 'val' });
        const show = v => { val.textContent = here ? plain(c.lo + (c.hi - c.lo) * v).replace(/^0\./, '.') : '-'; };
        show(here ? machine.get(c.name) : 0);
        const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: here ? 'unexpose' : 'make input', title: here ? 'Back to a plain number, as it stands now' : 'This project has no input of that name: make one, starting at the number in the code' });
        const ctx = Object.assign(document.createElement('div'), { className: 'ctx' });
        ctx.append(Object.assign(document.createElement('b'), { textContent: c.name }), document.createTextNode(`  ${plain(c.lo)} to ${plain(c.hi)}${here ? '' : '  (no input yet)'}`));
        r.addEventListener('input', () => { machine.set(c.name, Number(r.value)); show(Number(r.value)); });
        btn.addEventListener('click', () => {
          try {
            if (here) {
              const now = machine.get(c.name), mapped = c.lo + (c.hi - c.lo) * now;
              const others = calls.some(o => o !== c && o.name === c.name);
              replaceText(c.start, c.end, formatValue('float', mapped, { decimals: 4 }));
              if (!others) machine.remove(c.name);
            } else {
              machine.expose(c.name, Math.max(0, Math.min(1, (c.start0 - c.lo) / ((c.hi - c.lo) || 1))));
              rebuildKnobs();
            }
          } catch (err) { status.textContent = err.message; }
        });
        el.addEventListener('mouseenter', () => { hoverMark = c.start; draw(); });
        el.addEventListener('mouseleave', () => { hoverMark = -1; draw(); });
        if (here) live.push(() => { if (document.activeElement !== r) { const v = machine.get(c.name); if (v !== undefined && Number(r.value) !== v) { r.value = v; show(v); } } });
        el.append(dot, r, val, btn, ctx); knobsEl.append(el);
        continue;
      }
      const { n, i } = item;
      const row = { i, orig: null, undoText: null, spec: sliderSpec(n.kind, n.value, n.value < 0 || signedPref[n.kind]), bare: /^\./.test(n.text), kind: n.kind };
      el.className = `knob off ${n.kind}`;
      const tick = Object.assign(document.createElement('input'), { type: 'checkbox', title: 'Ticked: the knob sets the number. Untick: it goes back to the text as it was' });
      const r = Object.assign(document.createElement('input'), { type: 'range', min: row.spec.lo, max: row.spec.hi, step: row.spec.step, value: n.value });
      const val = Object.assign(document.createElement('span'), { className: 'val', textContent: n.text.replace(/^\(|\)$/g, '') });
      const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'reset', title: 'Back to the number as it was' });
      const [ls, line] = lineOf(n.start);
      const ctx = document.createElement('div'); ctx.className = 'ctx';
      const a = line.slice(Math.max(0, n.start - ls - 22), n.start - ls), z = line.slice(n.end - ls, n.end - ls + 14);
      ctx.append(document.createTextNode(`${a.trimStart()}`), Object.assign(document.createElement('b'), { textContent: text.slice(n.start, n.end) }), document.createTextNode(z));
      const touch = () => { const cur = nth(i), now = input.value.slice(cur.start, cur.end); if (row.orig === null) row.orig = now; row.undoText = now; tick.checked = true; el.classList.remove('off'); };
      const put = v => {
        closeSlider(true);
        const cur = nth(i); if (!cur) return;
        const t = formatValue(row.kind, v, { decimals: row.spec.decimals, bare: row.bare });
        sliding = true; input.setRangeText(t, cur.start, cur.end, 'preserve'); sliding = false;
        val.textContent = t.replace(/^\(|\)$/g, '');
        draw(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; clearTimeout(timer); apply(); });
      };
      const back = () => {
        if (row.orig === null) return;
        const cur = nth(i); sliding = true; input.setRangeText(row.orig, cur.start, cur.end, 'preserve'); sliding = false;
        const now = nth(i); r.value = now.value; val.textContent = now.text.replace(/^\(|\)$/g, '');
        row.orig = null; tick.checked = false; el.classList.add('off'); draw(); clearTimeout(timer); apply();
      };
      r.addEventListener('input', () => { if (row.orig === null || !tick.checked) touch(); put(Number(r.value)); });
      r.addEventListener('change', () => { const cur = nth(i); if (cur && row.undoText !== null) { commit(cur.start, cur.end, row.undoText); const now = nth(i); row.undoText = input.value.slice(now.start, now.end); } });
      tick.addEventListener('change', () => { if (tick.checked) touch(); else back(); });
      reset.addEventListener('click', back);
      el.addEventListener('mouseenter', () => { hoverMark = nth(i)?.numStart ?? -1; draw(); });
      el.addEventListener('mouseleave', () => { hoverMark = -1; draw(); });
      el.append(tick, r, val, reset, ctx);
      if (n.kind === 'float' && machine) {   // expose: the number becomes an input the patterns can move
        const ex = Object.assign(document.createElement('button'), { type: 'button', textContent: 'expose', title: 'Make this number an input of the shader machine: a pattern column that animates it' });
        ex.addEventListener('click', () => {
          try {
            if (row.orig !== null) back();
            const cur = nth(i), lo = row.spec.lo, hi = row.spec.hi;
            const name = machine.expose(guessName(input.value, cur), Math.max(0, Math.min(1, (cur.value - lo) / ((hi - lo) || 1))));
            replaceText(cur.start, cur.end, `kn("${name}", ${plain(cur.value)}, ${plain(lo)}, ${plain(hi)})`);
            status.textContent = `${name} is now an input: see the shader lane in the pattern editor.`;
          } catch (err) { status.textContent = err.message; }
        });
        el.append(ex);
      }
      knobsEl.append(el); rows.push(row);
    }
    // inputs the machine has that no kn() call uses any more
    const used = new Set(store.texts().flatMap(t => knobCalls(t).map(c => c.name)));   // a name any of the shaders uses is in use
    if (machine) for (const name of machine.names().filter(nm => !used.has(nm))) {
      const el = document.createElement('div'); el.className = 'knob orphan';
      const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'remove', title: 'Delete this input and its pattern column' });
      btn.addEventListener('click', () => { try { machine.remove(name); rebuildKnobs(); } catch (err) { status.textContent = err.message; } });
      el.append(Object.assign(document.createElement('span'), { className: 'ctx', textContent: `input "${name}" is not used in the code` }), btn);
      knobsEl.append(el);
    }
    if (live.length) liveTimer = setInterval(() => live.forEach(f => f()), 120);
  };
  const queueKnobs = () => { clearTimeout(knobTimer); knobTimer = setTimeout(rebuildKnobs, 250); };
  parts.knobsOn.addEventListener('change', () => { config.set('shaderKnobs', parts.knobsOn.checked); rebuildKnobs(); });
  parts.knobsOn.checked = config.get('shaderKnobs');
  input.addEventListener('input', () => { if (!sliding) queueKnobs(); });

  // what the settings hold, shown when they change from outside (a template, an imported settings file)
  const load = () => {
    const v = stored() || defaultSource;
    if (v === shown && input.value === v) return;
    shown = input.value = v; errorLine = 0; draw(); queueKnobs();
  };
  parts.templates.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Start from a template…' }),
    ...Object.entries(templates).map(([id, t]) => Object.assign(document.createElement('option'), { value: id, textContent: t.label })),
    Object.assign(document.createElement('option'), { value: 'builtin', textContent: 'Built-in metaballs' }));
  parts.templates.addEventListener('change', () => {
    const id = parts.templates.value; parts.templates.value = '';
    if (!id) return;
    clearTimeout(timer); timer = null;
    store.set(id === 'builtin' ? defaultSource : templates[id].source);   // a copy of the built-in is stored, so it cannot turn into whatever the Config default says
    load();
  });
  parts.reset.addEventListener('click', () => { clearTimeout(timer); timer = null; store.set(defaultSource); load(); });
  // the shaders of the project: pick the one to edit (the picture shows it while this screen is open; a pattern's Shd column picks it while playing)
  const pick = parts.pick;
  const fillPick = () => {
    if (!pick) return;
    const names = store.list();
    pick.textContent = '';
    names.forEach((s, i) => pick.append(Object.assign(document.createElement('option'), { value: i, textContent: `${i.toString(16).toUpperCase()}  ${s.name}` })));
    pick.value = store.index;
    parts.del && (parts.del.disabled = names.length < 2);
    parts.add && (parts.add.disabled = names.length >= 16);
  };
  const flush = () => { if (timer) { clearTimeout(timer); apply(); } };
  const switched = () => { fillPick(); shown = ''; load(); rebuildKnobs(); };
  pick?.addEventListener('change', () => { flush(); store.select(Number(pick.value)); switched(); });
  parts.add?.addEventListener('click', () => { flush(); try { store.add(); switched(); status.textContent = `Shader ${store.index.toString(16).toUpperCase()} is new: it starts as a copy of the one before. A Shd cell with that digit in the shader lane switches to it.`; } catch (err) { status.textContent = err.message; } });
  parts.dup?.addEventListener('click', () => { flush(); try { store.duplicate(); switched(); } catch (err) { status.textContent = err.message; } });
  parts.rename?.addEventListener('click', () => {
    const name = window.prompt('Name for this shader:', store.list()[store.index]?.name ?? '');
    if (name !== null && name.trim()) { store.rename(store.index, name.trim().slice(0, 24)); fillPick(); }
  });
  parts.del?.addEventListener('click', () => {
    if (!window.confirm(`Delete shader ${store.index.toString(16).toUpperCase()}? Shd cells that point at it or at the ones after it will show a different shader.`)) return;
    clearTimeout(timer); timer = null;
    try { store.remove(store.index); switched(); } catch (err) { status.textContent = err.message; }
  });
  fillPick(); load(); rebuildKnobs();
  return {
    load() { fillPick(); load(); rebuildKnobs(); },
    // the picture's compile error, or '' when it is fine; the failing line is marked in the gutter
    error(text) {
      status.textContent = text ? `${text}${text.includes('built-in') ? '' : ' (the built-in picture keeps running)'}` : 'The picture is running this shader.';
      status.classList.toggle('bad', !!text);
      errorLine = Number(/line (\d+)/.exec(text ?? '')?.[1] ?? 0);
      draw();
    },
    focus: () => input.focus(),
    // Puts a whole shader into the editor as typing would, so Ctrl+Z brings the old text back.
    tryText(text) { input.focus(); input.select(); document.execCommand('insertText', false, text); },
  };
}
