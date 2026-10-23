// The shader editor: a view of its own for the live picture's GLSL. A transparent textarea lies over a copy of the same text painted in
// colours (the usual trick: the browser keeps the caret, selection and undo; the copy shows the syntax). Changes reach the picture
// a moment after typing stops. An empty setting means the built-in picture, whose source is shown here to start from.

const KEYWORDS = new Set('attribute const uniform varying break continue do for while if else in out inout return discard struct precision highp mediump lowp true false invariant'.split(' '));
const TYPES = new Set('void bool int float vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 mat2 mat3 mat4 sampler2D samplerCube'.split(' '));
const BUILTINS = new Set(('radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep ' +
  'length distance dot cross normalize faceforward reflect refract matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D dFdx dFdy fwidth').split(' '));
const WAX = new Set('hit pitch vel held hits cell R T BEAT HITS NL SKEL C1 C2 LANE PAT WIN BEHIND'.split(' '));
const SPECIAL = new Set(['gl_FragCoord', 'gl_FragColor', 'gl_PointCoord']);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("[^"\n]*"?)|(#[^\n]*)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|([\s\S])/g;

// The text as HTML, each word in a span whose class says what it is: c comment, s string, p preprocessor line, n number, k keyword,
// t type, f built-in function, w one of Wax's own names, g gl_ variable. Everything else is left as it is.
export function highlight(text) {
  let out = '';
  for (const m of text.matchAll(TOKEN)) {
    const [all, comment, string, pre, num, word] = m;
    const cls = comment ? 'c' : string ? 's' : pre ? 'p' : num ? 'n'
      : word ? (KEYWORDS.has(word) ? 'k' : TYPES.has(word) ? 't' : WAX.has(word) ? 'w' : BUILTINS.has(word) ? 'f' : SPECIAL.has(word) ? 'g' : '') : '';
    out += cls ? `<span class="${cls}">${esc(all)}</span>` : esc(all);
  }
  return out;
}

// parts: { box, input, paint, gutter, status, templates (a select), reset (a button) }; config; defaultSource; templates: { id: { label, source } }
export function createShaderView({ parts, config, defaultSource, templates }) {
  const { input, paint, gutter, status } = parts;
  let timer = null, errorLine = 0, shown = '';
  const stored = () => config.get('visualGlsl');
  const lineCount = () => input.value.split('\n').length;
  const draw = () => {
    paint.innerHTML = `${highlight(input.value)}\n`;
    const n = lineCount();
    gutter.innerHTML = Array.from({ length: n }, (_, i) => `<span${i + 1 === errorLine ? ' class="bad"' : ''}>${i + 1}</span>`).join('');
    sync();
  };
  const sync = () => { paint.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`; gutter.style.transform = `translateY(${-input.scrollTop}px)`; };
  const apply = () => { timer = null; shown = input.value; config.set('visualGlsl', input.value === defaultSource ? '' : input.value); };
  const change = () => { errorLine = 0; draw(); clearTimeout(timer); timer = setTimeout(apply, 350); };
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
  // what the settings hold, shown when they change from outside (a template, an imported settings file)
  const load = () => {
    const v = stored() || defaultSource;
    if (v === shown && input.value === v) return;
    shown = input.value = v; errorLine = 0; draw();
  };
  parts.templates.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Start from a template…' }),
    ...Object.entries(templates).map(([id, t]) => Object.assign(document.createElement('option'), { value: id, textContent: t.label })),
    Object.assign(document.createElement('option'), { value: 'builtin', textContent: 'Built-in metaballs' }));
  parts.templates.addEventListener('change', () => {
    const id = parts.templates.value; parts.templates.value = '';
    if (!id) return;
    clearTimeout(timer); timer = null;
    config.set('visualGlsl', id === 'builtin' ? '' : templates[id].source);
    load();
  });
  parts.reset.addEventListener('click', () => { clearTimeout(timer); timer = null; config.set('visualGlsl', ''); load(); });
  config.onChange(k => { if (k === 'visualGlsl' && timer === null) load(); });
  load();
  return {
    load,
    // the picture's compile error, or '' when it is fine; the failing line is marked in the gutter
    error(text) {
      status.textContent = text ? `${text}${text.includes('built-in') ? '' : ' (the built-in picture keeps running)'}` : 'The picture is running this shader.';
      status.classList.toggle('bad', !!text);
      errorLine = Number(/line (\d+)/.exec(text ?? '')?.[1] ?? 0);
      draw();
    },
    focus: () => input.focus(),
  };
}
