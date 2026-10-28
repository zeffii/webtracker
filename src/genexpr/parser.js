// GenExpr parser: tokens to a syntax tree. On a mistake it records the error, skips to the next `;` or `}` and carries on,
// so one run reports every statement that is wrong, not just the first.
import { lex } from './lexer.js';

const DECLS = new Set(['History', 'Param', 'Data', 'Delay']);

class Bail extends Error {}

export function parse(text) {
  const { toks, errors } = lex(text);
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const is = (v, t = 'op') => toks[p].t === t && toks[p].v === v;
  const pos = tk => ({ line: tk.line, col: tk.col, end: tk.end });
  const span = (a, b) => ({ line: a.line, col: a.col, end: b.line === a.line ? b.end : a.end });
  const fail = (tk, message) => { errors.push({ line: tk.line, col: tk.col, end: Math.max(tk.end, tk.col + 1), message }); throw new Bail(); };
  const expect = (v, what) => {
    if (!is(v)) { const tk = peek(), prev = toks[p - 1]; fail(tk.t === 'eof' || (prev && tk.line > prev.line) ? { line: prev.line, col: prev.end, end: prev.end + 1 } : tk, `expected ${what ?? `"${v}"`}${tk.t === 'eof' ? ' but the code ended' : ` but found ${describe(tk)}`}`); }
    return next();
  };
  const describe = tk => (tk.t === 'eof' ? 'the end' : tk.t === 'num' ? `the number ${tk.s}` : `"${tk.v}"`);

  function primary() {
    const tk = next();
    if (tk.t === 'num') return { k: 'num', v: tk.v, ...pos(tk) };
    if (tk.t === 'id') {
      if (is('(')) {
        next(); const args = [];
        if (!is(')')) do { args.push(expr()); } while (is(',') && next());
        const close = expect(')', '")" to close the call');
        return { k: 'call', name: tk.v, args, ...span(tk, close) };
      }
      return { k: 'id', name: tk.v, ...pos(tk) };
    }
    if (tk.v === '(' && tk.t === 'op') { const e = expr(); expect(')', '")" to close the bracket'); return e; }
    p--; fail(tk, tk.t === 'eof' ? 'the code ended in the middle of an expression' : `expected a value but found ${describe(tk)}`);
  }
  function postfix() {
    let e = primary();
    while (is('.')) {
      next(); const name = peek();
      if (name.t !== 'id') fail(name, 'expected a method name after "."');
      next(); expect('(');
      const args = [];
      if (!is(')')) do { args.push(expr()); } while (is(',') && next());
      const close = expect(')', '")" to close the call');
      e = { k: 'method', obj: e, name: name.v, args, ...span(e, close) };
    }
    return e;
  }
  function unary() {
    if (is('-') || is('!') || is('+')) { const tk = next(), e = unary(); return tk.v === '+' ? e : { k: 'un', op: tk.v, e, ...span(tk, e) }; }
    return power();
  }
  function power() { const l = postfix(); if (is('**')) { next(); const r = unary(); return { k: 'bin', op: '**', l, r, ...span(l, r) }; } return l; }
  const level = (ops, sub) => () => { let l = sub(); while (peek().t === 'op' && ops.includes(peek().v)) { const op = next().v, r = sub(); l = { k: 'bin', op, l, r, ...span(l, r) }; } return l; };
  const mul = level(['*', '/', '%'], unary), add = level(['+', '-'], mul), rel = level(['<', '>', '<=', '>='], add), eq = level(['==', '!='], rel), and = level(['&&'], eq), or = level(['||'], and);
  function expr() {
    const c = or();
    if (is('?')) { next(); const a = expr(); expect(':', '":" in the ?: choice'); const b = expr(); return { k: 'cond', c, a, b, ...span(c, b) }; }
    return c;
  }

  function block() {
    expect('{'); const body = [];
    while (!is('}') && peek().t !== 'eof') body.push(statement());
    expect('}', '"}" to close the block');
    return body;
  }

  function statement() {
    const start = p;
    try {
      const tk = peek();
      if (tk.t === 'id' && tk.v === 'if') {
        next(); expect('('); const cond = expr(); expect(')', '")" after the if condition');
        const then = is('{') ? block() : [statement()];
        let other = null;
        if (is('else', 'id')) { next(); other = is('{') ? block() : [statement()]; }
        return { k: 'if', cond, then, other, ...pos(tk) };
      }
      if (tk.t === 'id' && DECLS.has(tk.v) && toks[p + 1].t === 'id') {
        next(); const name = next(); expect('(');
        const args = [];
        if (!is(')')) do {
          if (peek().t === 'id' && toks[p + 1].t === 'op' && toks[p + 1].v === '=') { const key = next(); next(); args.push({ key: key.v, value: expr(), at: pos(key) }); }
          else args.push({ key: null, value: expr() });
        } while (is(',') && next());
        expect(')', '")" to close the declaration'); expect(';', '";" after the declaration');
        return { k: 'decl', kind: tk.v, name: name.v, nameAt: pos(name), args, ...pos(tk) };
      }
      // a, b, c = x, y, z;  every value is worked out first, then the names are set (so  a, b = b, a;  swaps)
      if (tk.t === 'id' && toks[p + 1].t === 'op' && toks[p + 1].v === ',') {
        let q = p, names = 0;
        while (toks[q].t === 'id' && toks[q + 1].t === 'op' && toks[q + 1].v === ',') { q += 2; names++; }
        if (toks[q].t === 'id' && toks[q + 1].t === 'op' && toks[q + 1].v === '=') {
          const targets = [];
          for (let i = 0; i <= names; i++) { const n = next(); targets.push(n); if (i < names) next(); }
          next();
          const values = [expr()];
          while (is(',')) { next(); values.push(expr()); }
          expect(';', '";" at the end of the statement');
          if (values.length !== targets.length) {
            errors.push({ line: tk.line, col: tk.col, end: tk.col + 1, message: `${targets.length} names on the left but ${values.length} value${values.length === 1 ? '' : 's'} on the right`, hint: 'write one value for each name: a, b = 1, 2;' });
            return { k: 'tuple', sets: targets.map(n => ({ k: 'set', name: n.v, op: '=', value: { k: 'num', v: 0, ...pos(n) }, ...pos(n), nameAt: pos(n) })), ...pos(tk) };
          }
          return { k: 'tuple', sets: targets.map((n, i) => ({ k: 'set', name: n.v, op: '=', value: values[i], ...span(n, values[i]), nameAt: pos(n) })), ...pos(tk) };
        }
      }
      if (tk.t === 'id' && toks[p + 1].t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(toks[p + 1].v)) {
        next(); const op = next().v, value = expr(); expect(';', '";" at the end of the statement');
        return { k: 'set', name: tk.v, op, value, ...span(tk, value), nameAt: pos(tk) };
      }
      const e = expr();
      if (e.k !== 'call' && e.k !== 'method') { errors.push({ line: e.line, col: e.col, end: e.end, message: 'this does nothing; a statement is an assignment (x = ...;), a declaration or a call' }); }
      expect(';', '";" at the end of the statement');
      return { k: 'expr', e, ...pos(tk) };
    } catch (err) {
      if (!(err instanceof Bail)) throw err;
      // skip to the end of this statement; always move forward
      if (p === start) p++;
      while (peek().t !== 'eof' && !is(';') && !is('}')) p++;
      if (is(';')) p++;
      return { k: 'bad', line: toks[start].line, col: toks[start].col, end: toks[start].end };
    }
  }

  const body = [];
  while (peek().t !== 'eof') {
    if (is('}')) { errors.push({ line: peek().line, col: peek().col, end: peek().end, message: 'this "}" closes nothing' }); p++; continue; }
    body.push(statement());
  }
  return { body, errors };
}
