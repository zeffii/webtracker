// The code panel of a genexpr node: a text box with line numbers and highlighting, mistakes underlined where they are, and a
// list of them below with the line, the column and a hint. It compiles a moment after typing stops (the same compiler the
// audio side uses), so what the list says is what the sound will do. The knobs the code declares are listed under it.
import { compile, DEFAULT_CODE } from '../genexpr/compile.js';
import { classify, bracketAt, wordAt, sameWords } from '../genexpr/highlight.js';
import { DOCS } from '../genexpr/docs.js';
import { TEMPLATES } from '../genexpr/templates.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One class per character from the highlighter (comment, keyword, function, constant, names by kind ...), then the flags drawn over it: mistakes
// and warnings (`marks`), the bracket pair at the caret, loose brackets and other uses of the word at the caret (`extra`). Runs of equal
// class are wrapped in spans.
function paint(text, info, marks, extra = {}) {
  const cls = info.cls;
  const lineStart = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStart.push(i + 1);
  const flag = new Array(text.length).fill('');
  for (const i of info.loose) flag[i] = 'brx';
  for (const i of extra.same ?? []) flag.fill('same', i, i + extra.sameLen);
  for (const i of extra.pair ?? []) flag[i] = 'br';
  for (const [list, kind] of marks) for (const e of list) {
    const base = lineStart[e.line - 1]; if (base === undefined) continue;
    const a = base + e.col - 1, b = Math.min(base + Math.max(e.end - 1, e.col), lineStart[e.line] !== undefined ? lineStart[e.line] - 1 : text.length);
    for (let i = a; i < Math.max(b, a + 1) && i < text.length; i++) if (flag[i] !== 'e') flag[i] = kind;
  }
  let out = '', i = 0;
  while (i < text.length) {
    let j = i + 1; while (j < text.length && cls[j] === cls[i] && flag[j] === flag[i] && text[j] !== '\n' && text[i] !== '\n') j++;
    const part = esc(text.slice(i, j)), c = [cls[i] && `g-${cls[i]}`, flag[i] && `g-${flag[i]}`].filter(Boolean).join(' ');
    out += c ? `<span class="${c}">${part}</span>` : part; i = j;
  }
  return `${out}\n`;   // the trailing newline keeps the last empty line the same height as the textarea's
}

export function createGenexprEditor({ doc = document, code, onChange = () => {}, setKnob = () => {} }) {
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
  let text = typeof code === 'string' ? code : DEFAULT_CODE;
  const gutter = el('div', { className: 'ge-gutter' }), mirror = el('pre', { className: 'ge-mirror' }), area = el('textarea', { className: 'ge-text', spellcheck: false, wrap: 'off', value: text });
  area.setAttribute('autocapitalize', 'off'); area.setAttribute('autocomplete', 'off'); area.setAttribute('aria-label', 'GenExpr code');
  const wrap = el('div', { className: 'ge-wrap' }, mirror, area);
  const status = el('div', { className: 'ge-status' }), list = el('div', { className: 'ge-errors' }), knobs = el('div', { className: 'ge-knobs' });
  // Templates: working programs to start from. Choosing one replaces the code; the code you had is kept one step back.
  const picker = el('select', { className: 'ge-templates', ariaLabel: 'Load a template' }, el('option', { value: '', textContent: 'Templates…' }));
  for (const [kind, label] of [['instrument', 'Instruments (in front of Voices)'], ['effect', 'Effects']]) {
    const group = el('optgroup', { label });
    TEMPLATES.forEach((t, i) => { if (t.kind === kind) group.append(el('option', { value: String(i), textContent: t.name })); });
    picker.append(group);
  }
  const backOption = el('option', { value: 'back', textContent: '↩ the code I had before', hidden: true });
  picker.append(backOption);
  let before = null;
  picker.addEventListener('change', () => {
    const v = picker.value; picker.value = '';
    if (v === '') return;
    if (v === 'back') { if (before !== null) { const now = text; api.setText(before); before = now; } return; }
    before = text; backOption.hidden = false;
    api.setText(TEMPLATES[Number(v)].code);
  });
  const root = el('div', { className: 'ge' }, picker, el('div', { className: 'ge-code' }, gutter, wrap), status, list, knobs);

  let prev = compile(text).params, timer = 0, last = null, info = classify(text);
  // At the caret: the bracket that pairs with the one beside it, and the other places the word under it is used.
  const caretExtra = () => {
    if (doc.activeElement !== area || area.selectionStart !== area.selectionEnd) return {};
    const at = area.selectionStart, pr = bracketAt(info, at), w = wordAt(text, info, at);
    return { pair: pr ?? undefined, same: w ? sameWords(text, info, w) : undefined, sameLen: w ? w.to - w.from : 0 };
  };
  const repaint = () => { if (last) mirror.innerHTML = paint(text, info, [[last.warnings, 'w'], [last.errors, 'e']], caretExtra()); };
  const cap = typeof setTimeout === 'function';

  const draw = r => {
    last = r;
    info = classify(text);
    mirror.innerHTML = paint(text, info, [[r.warnings, 'w'], [r.errors, 'e']], caretExtra());
    const lines = text.split('\n').length, bad = new Set(r.errors.map(e => e.line));
    gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<span${bad.has(i + 1) ? ' class="bad"' : ''}>${i + 1}</span>`).join('');
    status.className = `ge-status ${r.ok ? 'ok' : 'bad'}`;
    status.textContent = r.ok ? `compiled${r.params.length ? ` · ${r.params.length} knob${r.params.length > 1 ? 's' : ''}` : ''}${r.warnings.length ? ` · ${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}` : ''}` : `${r.errors.length} mistake${r.errors.length > 1 ? 's' : ''}: the last working code keeps playing`;
    list.replaceChildren(...[...r.errors.map(e => [e, 'e']), ...r.warnings.map(e => [e, 'w'])].map(([e, kind]) => {
      const row = el('button', { type: 'button', className: `ge-err ${kind}` });
      row.append(el('b', { textContent: `line ${e.line}, col ${e.col}` }), el('span', { textContent: e.message }));
      if (e.hint) row.append(el('i', { textContent: e.hint }));
      row.addEventListener('click', () => {
        const lines = text.split('\n'); let at = 0; for (let i = 0; i < e.line - 1; i++) at += lines[i].length + 1;
        area.focus(); area.setSelectionRange(at + e.col - 1, at + Math.max(e.end - 1, e.col));
      });
      return row;
    }));
    knobs.replaceChildren(...r.params.map((p, i) => el('div', { className: 'ge-knob', textContent: `p${i + 1}  ${p.name}  ${p.min} to ${p.max}` })));
    sizeTo();
  };
  const sizeTo = () => { const n = Math.min(10, Math.max(6, text.split('\n').length + 1)); area.style.height = mirror.style.height = gutter.style.height = `${n * 18 + 12}px`; };

  const run = () => {
    timer = 0;
    const r = compile(text);
    draw(r);
    onChange(text, r);
    if (r.ok) {   // a knob whose Param is new, or whose default or range changed, moves to the new default
      r.params.forEach((p, i) => { const o = prev[i]; if (!o || o.def !== p.def || o.min !== p.min || o.max !== p.max) setKnob(i, (p.def - p.min) / (p.max - p.min)); });
      prev = r.params;
    }
  };
  area.addEventListener('input', () => {
    text = area.value; draw(last ?? compile(text));   // keep the lines and the highlight in step while typing; the compile follows
    if (cap) { clearTimeout(timer); timer = setTimeout(run, 280); } else run();
  });
  // Rest the pointer on a word for its help: what an operator does, or what a name in the code is.
  const tip = el('div', { className: 'ge-tip', hidden: true });
  wrap.append(tip);
  let cw = 0;
  const charWidth = () => {
    if (!cw) { const probe = el('span', { textContent: '0'.repeat(20) }); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'; mirror.append(probe); cw = probe.getBoundingClientRect().width / 20; probe.remove(); }
    return cw || 7;
  };
  const help = w => {
    const d = info.decls.get(w.word);
    if (d) {
      const p = d.kind === 'Param' ? last?.params.find(q => q.name === w.word) : null, k = last?.params.findIndex(q => q.name === w.word);
      return [`${d.kind} ${w.word}`, d.kind === 'Param' ? (p ? `knob p${k + 1}, ${p.min} to ${p.max}, starts at ${p.def}` : 'a knob on the node') : `${DOCS[d.kind][1]} (declared on line ${d.line})`];
    }
    return DOCS[w.word] ?? null;
  };
  const hideTip = () => { tip.hidden = true; };
  area.addEventListener('mousemove', e => {
    const r = area.getBoundingClientRect(), cs = typeof getComputedStyle === 'function' ? getComputedStyle(area) : null;
    const x = e.clientX - r.left + area.scrollLeft - (parseFloat(cs?.paddingLeft) || 8), y = e.clientY - r.top + area.scrollTop - (parseFloat(cs?.paddingTop) || 6);
    const lines = text.split('\n'), row = Math.floor(y / 18), col = Math.floor(x / charWidth());
    if (row < 0 || row >= lines.length || col < 0 || col >= lines[row].length) return hideTip();
    let at = col; for (let i = 0; i < row; i++) at += lines[i].length + 1;
    const w = wordAt(text, info, at), h = w && info.cls[at] !== 'c' ? help(w) : null;
    if (!h) return hideTip();
    tip.replaceChildren(el('b', { textContent: h[0] }), el('span', { textContent: h[1] }));
    tip.style.left = `${Math.max(0, Math.min(e.clientX - r.left, r.width - 200))}px`; tip.style.top = `${e.clientY - r.top + 16}px`;
    tip.hidden = false;
  });
  area.addEventListener('mouseleave', hideTip);
  area.addEventListener('input', hideTip);
  for (const ev of ['keyup', 'click', 'focus', 'blur']) area.addEventListener(ev, repaint);
  area.addEventListener('scroll', () => { hideTip(); mirror.scrollTop = gutter.scrollTop = area.scrollTop; mirror.scrollLeft = area.scrollLeft; });
  area.addEventListener('keydown', e => {
    e.stopPropagation();   // typing here is not a shortcut for the patcher
    if (e.key === 'Tab') {
      e.preventDefault();
      const a = area.selectionStart, b = area.selectionEnd;
      area.setRangeText('  ', a, b, 'end'); area.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const a = area.selectionStart, before = area.value.slice(0, a), indent = /(?:^|\n)([ \t]*)[^\n]*$/.exec(before)?.[1] ?? '', open = /\{\s*$/.test(before);
      area.setRangeText(`\n${indent}${open ? '  ' : ''}`, a, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input'));
    }
  });
  draw(compile(text));
  const api = {
    el: root,
    refresh() { if (area.value !== text) area.value = text; },
    setText(next) { text = next; area.value = next; run(); },
  };
  return api;
}
