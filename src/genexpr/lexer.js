// GenExpr lexer: text to tokens, each with its line, column and end column (1-based) so errors can point at the exact spot.
const OPS = ['**', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '+', '-', '*', '/', '%', '<', '>', '=', '!', '?', ':', ';', ',', '(', ')', '{', '}', '.'];

export function lex(text) {
  const toks = [], errors = [];
  let i = 0, line = 1, col = 1;
  const adv = n => { for (let k = 0; k < n; k++) { if (text[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(1); continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') adv(1); continue; }
    if (c === '/' && text[i + 1] === '*') {
      const l0 = line, c0 = col, end = text.indexOf('*/', i + 2);
      if (end < 0) { errors.push({ line: l0, col: c0, end: c0 + 2, message: 'this comment is never closed (missing */)' }); adv(text.length - i); }
      else adv(end + 2 - i);
      continue;
    }
    const start = col, l0 = line;
    let m;
    if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40)))) {
      toks.push({ t: 'num', v: Number(m[0]), s: m[0], line: l0, col: start, end: start + m[0].length }); adv(m[0].length);
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 80)))) {
      toks.push({ t: 'id', v: m[0], line: l0, col: start, end: start + m[0].length }); adv(m[0].length);
    } else {
      const op = OPS.find(o => text.startsWith(o, i));
      if (op) { toks.push({ t: 'op', v: op, line: l0, col: start, end: start + op.length }); adv(op.length); }
      else { errors.push({ line: l0, col: start, end: start + 1, message: `unexpected character "${c}"` }); adv(1); }
    }
  }
  toks.push({ t: 'eof', v: '', line, col, end: col });
  return { toks, errors };
}
