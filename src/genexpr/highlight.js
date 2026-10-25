// The colouring of GenExpr code, worked out from the text alone so it holds while the code has mistakes in it. `classify` gives every
// character a class (comment, keyword, function, constant ...); names the code declares are coloured by what they are wherever they are used.
// Also here: which brackets pair, and where else the word under the caret is used.
import { BUILTINS } from './compile.js';

const set = list => new Set(list);
const DECL = set(BUILTINS.declarations), CONTROL = set(BUILTINS.control), FUNCS = set([...BUILTINS.funcs, ...BUILTINS.bufferFuncs]), CONSTS = set(BUILTINS.consts), IO = set([...BUILTINS.inputs, ...BUILTINS.outputs]);
const KIND_CLASS = { Param: 'dp', History: 'dh', Data: 'dd', Delay: 'dd' };

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|([A-Za-z_]\w*)|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|(\*\*|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:])|([;,(){}.])/g;

// -> { cls: one class name (or '') per character, decls: Map name -> { kind, line }, pairs: Map open index -> close index (and back), loose: indexes of brackets without a partner }
export function classify(text) {
  const cls = new Array(text.length).fill(''), decls = new Map(), toks = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) toks.push({ i: m.index, s: m[0], t: m[1] ? 'c' : m[2] ? 'id' : m[3] ? 'n' : m[4] ? 'op' : 'pu' });
  const lineOf = i => { let n = 1; for (let k = 0; k < i; k++) if (text[k] === '\n') n++; return n; };
  toks.forEach((tk, k) => {   // a declaration names the next word
    if (tk.t === 'id' && DECL.has(tk.s) && toks[k + 1]?.t === 'id' && !DECL.has(toks[k + 1].s)) decls.set(toks[k + 1].s, { kind: tk.s, line: lineOf(toks[k + 1].i) });
  });
  toks.forEach((tk, k) => {
    let c = '';
    if (tk.t === 'c') c = 'c';
    else if (tk.t === 'n') c = 'n';
    else if (tk.t === 'op') c = 'op';
    else if (tk.t === 'pu') c = 'pu';
    else {
      const after = toks[k + 1], before = toks[k - 1];
      if (before?.s === '.') c = 'm';   // name.read(...)
      else if (DECL.has(tk.s)) c = 'k';
      else if (CONTROL.has(tk.s)) c = 'kc';
      else if (IO.has(tk.s)) c = 'io';
      else if (decls.has(tk.s)) c = KIND_CLASS[decls.get(tk.s).kind];
      else if (CONSTS.has(tk.s)) c = 'cn';
      else if (FUNCS.has(tk.s) && after?.s === '(') c = 'f';
    }
    if (c) cls.fill(c, tk.i, tk.i + tk.s.length);
  });
  const pairs = new Map(), loose = [], stack = [];
  for (const tk of toks) {
    if (tk.t !== 'pu' || !'(){}'.includes(tk.s)) continue;
    if (tk.s === '(' || tk.s === '{') stack.push(tk);
    else {
      const open = stack.at(-1);
      if (open && open.s === (tk.s === ')' ? '(' : '{')) { stack.pop(); pairs.set(open.i, tk.i); pairs.set(tk.i, open.i); }
      else loose.push(tk.i);
    }
  }
  for (const o of stack) loose.push(o.i);
  return { cls, decls, pairs, loose };
}

// The bracket that goes with the one just before or at the caret: [index, partner index] or null.
export function bracketAt(info, caret) {
  for (const i of [caret - 1, caret]) if (info.pairs.has(i)) return [i, info.pairs.get(i)];
  return null;
}

// The word the index sits in: { word, from, to } or null (not in a comment).
export function wordAt(text, info, i) {
  if (i < 0 || i > text.length) return null;
  const isW = c => c !== undefined && /\w/.test(c);
  let a = i, b = i;
  if (!isW(text[a]) && isW(text[a - 1])) { a--; b--; }
  if (!isW(text[a])) return null;
  while (a > 0 && isW(text[a - 1])) a--;
  b = a; while (isW(text[b])) b++;
  if (info?.cls[a] === 'c' || /^\d/.test(text.slice(a, b))) return null;
  return { word: text.slice(a, b), from: a, to: b };
}

// Every other place the same word stands, as starting indexes (comments left out).
export function sameWords(text, info, w) {
  const out = [], re = new RegExp(`\\b${w.word}\\b`, 'g');
  let m;
  while ((m = re.exec(text))) if (m.index !== w.from && info.cls[m.index] !== 'c') out.push(m.index);
  return out;
}
