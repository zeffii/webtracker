// The code panel of a genexpr node: a text box with line numbers and highlighting, mistakes underlined where they are, and a
// list of them below with the line, the column and a hint. It compiles a moment after typing stops (the same compiler the
// audio side uses), so what the list says is what the sound will do. The knobs the code declares are listed under it.
import { compile, DEFAULT_CODE } from '../genexpr/compile.js';

const KEYWORDS = /^(History|Param|Data|Delay|if|else)$/;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One class per character: comment, keyword, number, name of an operator; then runs of equal class are wrapped in spans.
function paint(text, marks) {
  const cls = new Array(text.length).fill('');
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|\b([A-Za-z_]\w*)\b|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|\.\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    const c = m[1] ? 'c' : m[3] ? 'n' : KEYWORDS.test(m[2]) ? 'k' : /^(in|out)[12]$/.test(m[2]) ? 'io' : '';
    if (c) cls.fill(c, m.index, m.index + m[0].length);
  }
  const lineStart = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStart.push(i + 1);
  const flag = new Array(text.length).fill('');
  for (const [list, kind] of marks) for (const e of list) {
    const base = lineStart[e.line - 1]; if (base === undefined) continue;
    const a = base + e.col - 1, b = Math.min(base + Math.max(e.end - 1, e.col), lineStart[e.line] !== undefined ? lineStart[e.line] - 1 : text.length);
    for (let i = a; i < Math.max(b, a + 1) && i < text.length; i++) if (flag[i] !== 'e') flag[i] = kind;
    if (a >= text.length || text[a] === '\n') { /* an error at the very end of a line: mark nothing, the list still says it */ }
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
  const root = el('div', { className: 'ge' }, el('div', { className: 'ge-code' }, gutter, wrap), status, list, knobs);

  let prev = compile(text).params, timer = 0, last = null;
  const cap = typeof setTimeout === 'function';

  const draw = r => {
    last = r;
    mirror.innerHTML = paint(text, [[r.warnings, 'w'], [r.errors, 'e']]);
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
  area.addEventListener('scroll', () => { mirror.scrollTop = gutter.scrollTop = area.scrollTop; mirror.scrollLeft = area.scrollLeft; });
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
  return {
    el: root,
    refresh() { if (area.value !== text) area.value = text; },
    setText(next) { text = next; area.value = next; run(); },
  };
}
