// A node's per-sample loop drawn as a signal-flow diagram. The loop is read as plain JavaScript (just the part a DSP loop is made of:
// declarations, assignments, + - * /, comparisons, ?:, calls such as Math.tanh, indexing) and turned into a graph: the stream
// being read goes in on the left, every operation is a symbol, a variable that is read before it is written in the pass is a
// one-sample delay (z^-1) fed from where the variable ends up, a name set outside the loop is a coefficient, and a write to
// out[i] is the output. Anything the reader does not understand (an if, a nested loop) is skipped and counted, never guessed at.

const TOK = /\s*(?:(\/\/.*)|(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)|([A-Za-z_$][\w$]*)|(\+\+|--|\+=|-=|\*=|\/=|<=|>=|===|!==|==|!=|&&|\|\||<<|>>|[-+*/%<>=!?:,;.()[\]{}&|^~]))/gy;

function tokens(lines, from) {
  const out = [];
  lines.forEach((text, k) => {
    TOK.lastIndex = 0;
    let m;
    while (TOK.lastIndex < text.length && (m = TOK.exec(text))) {
      if (m[1]) continue;
      out.push({ t: m[2] ? 'num' : m[3] ? 'id' : 'op', v: m[2] ?? m[3] ?? m[4], line: from + k });
    }
  });
  return out;
}

const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '===': 6, '!==': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

class Reader {
  constructor(toks) { this.toks = toks; this.at = 0; }
  peek(v) { const t = this.toks[this.at]; return v === undefined ? t : t && t.v === v ? t : null; }
  next() { return this.toks[this.at++]; }
  eat(v) { if (this.peek(v)) { this.at++; return true; } return false; }
  expr(min = 0) {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') break;
      if (t.v === '?' && min === 0) { this.at++; const b = this.expr(0); if (!this.eat(':')) throw new Error('?'); const c = this.expr(0); a = { k: 'cond', c: a, a: b, b: c, line: t.line }; continue; }
      const p = PREC[t.v];
      if (!p || p <= min) break;
      this.at++;
      a = { k: 'bin', op: t.v, a, b: this.expr(p), line: t.line };
    }
    return a;
  }
  unary() {
    const t = this.next();
    if (!t) throw new Error('end');
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!' || t.v === '~')) { const a = this.unary(); return t.v === '+' ? a : { k: 'un', op: t.v, a, line: t.line }; }
    let e;
    if (t.t === 'num') e = { k: 'num', v: Number(t.v), line: t.line };
    else if (t.t === 'id') e = { k: 'id', n: t.v, line: t.line };
    else if (t.v === '(') { e = this.expr(0); if (!this.eat(')')) throw new Error(')'); }
    else throw new Error(`unexpected ${t.v}`);
    for (;;) {
      if (this.eat('.')) { const p = this.next(); e = { k: 'dot', o: e, p: p.v, line: p.line }; }
      else if (this.eat('[')) { const i = this.expr(0); if (!this.eat(']')) throw new Error(']'); e = { k: 'idx', o: e, i, line: e.line }; }
      else if (this.peek('(')) {
        this.at++; const args = [];
        if (!this.eat(')')) { do args.push(this.expr(0)); while (this.eat(',')); if (!this.eat(')')) throw new Error(')'); }
        e = { k: 'call', f: e, args, line: e.line };
      } else break;
    }
    return e;
  }
}

// The key a variable or array element goes by: x, s[0], this.y
const keyOf = e => e.k === 'id' ? e.n : e.k === 'idx' && e.o.k === 'id' && e.i.k === 'num' ? `${e.o.n}[${e.i.v}]` : e.k === 'dot' && e.o.k === 'id' ? `${e.o.n}.${e.p}` : null;

// statements of the loop body: [{ kind: 'decl' | 'assign' | 'skip', ... }]
function statements(toks) {
  const r = new Reader(toks), out = [];
  let skipped = 0;
  const skipStatement = () => {   // up to the end of the next statement, brackets balanced
    let depth = 0; skipped++;
    while (r.peek()) {
      const t = r.next();
      if (t.v === '{' || t.v === '(' || t.v === '[') depth++;
      else if (t.v === '}' || t.v === ')' || t.v === ']') { depth--; if (depth < 0) { r.at--; return; } if (depth === 0 && t.v === '}' && !(r.peek('else'))) return; }
      else if (t.v === ';' && depth === 0) return;
    }
  };
  while (r.peek()) {
    const t = r.peek();
    if (t.v === ';' || t.v === '{' || t.v === '}') { r.next(); continue; }
    if (t.v === 'if' || t.v === 'for' || t.v === 'while' || t.v === 'return' || t.v === 'switch' || t.v === 'break' || t.v === 'continue') {
      // an if with a plain assignment inside is common (clamping): read the body as if it always ran, and say so
      skipStatement(); continue;
    }
    const save = r.at;
    try {
      if (t.v === 'const' || t.v === 'let' || t.v === 'var') {
        r.next();
        do {
          const name = r.next();
          if (!r.eat('=')) { out.push({ kind: 'declare', name: name.v, line: name.line }); continue; }
          out.push({ kind: 'decl', name: name.v, e: r.expr(0), line: name.line });
        } while (r.eat(','));
      } else {
        do {
          const lhs = r.unary();
          const op = r.next();
          if (!op || !['=', '+=', '-=', '*=', '/='].includes(op.v)) throw new Error('not an assignment');
          out.push({ kind: 'assign', lhs, op: op.v, e: r.expr(0), line: op.line });
        } while (r.eat(','));
      }
      if (!r.eat(';') && r.peek() && r.peek().v !== '}') throw new Error('no ;');
    } catch {
      r.at = save; skipStatement();
    }
  }
  return { list: out, skipped };
}

const FUNCS = new Set(['tanh', 'sin', 'cos', 'abs', 'sqrt', 'exp', 'log', 'pow', 'min', 'max', 'floor', 'round', 'sign', 'atan', 'tan', 'fround']);

// The graph of one loop. lines: the file's lines; [a, b]: the loop's first and last line.
export function buildCircuit(lines, [a, b]) {
  const text = lines.slice(a, b + 1);
  const first = text[0].indexOf('{');
  if (first < 0) return null;
  text[0] = text[0].slice(first + 1);
  const last = text[text.length - 1].lastIndexOf('}');
  if (last >= 0) text[text.length - 1] = text[text.length - 1].slice(0, last);
  const loopVar = (lines[a].match(/for \(let (\w+) =/) ?? [])[1] ?? 'i';
  const { list, skipped } = statements(tokens(text, a));
  if (!list.length) return null;

  const nodes = [], edges = [];
  const add = (kind, label, line, ins = []) => { const n = { id: nodes.length, kind, label, line, ins }; nodes.push(n); for (const s of ins) edges.push({ from: s, to: n.id }); return n.id; };
  const written = new Set(), arrays = new Set();
  for (const s of list) {
    if (s.kind === 'assign' || s.kind === 'decl') {
      const lhs = s.kind === 'decl' ? { k: 'id', n: s.name } : s.lhs;
      const k = keyOf(lhs);
      if (k) written.add(k);
      if (lhs.k === 'idx' && lhs.o.k === 'id') arrays.add(lhs.o.n);
    }
  }
  const env = new Map(), delays = new Map(), coefs = new Map(), streams = new Map(), mems = new Map();
  const readKey = (key, line) => {
    if (env.has(key)) return env.get(key);
    if (written.has(key)) { if (!delays.has(key)) delays.set(key, add('delay', key, line)); return delays.get(key); }
    if (!coefs.has(key)) coefs.set(key, add('coef', key, line));
    return coefs.get(key);
  };
  const numeric = e => e.k === 'num' ? e.v : e.k === 'dot' && e.o.k === 'id' && e.o.n === 'Math' ? ({ PI: Math.PI, E: Math.E, SQRT2: Math.SQRT2 })[e.p] : e.k === 'un' && e.op === '-' && numeric(e.a) !== undefined ? -numeric(e.a) : undefined;
  const fmt = v => Number.isInteger(v) ? String(v) : String(+v.toPrecision(4));
  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '%': 'mod' };
  const ev = e => {
    const n = numeric(e);
    if (n !== undefined) return add('num', fmt(n), e.line);
    switch (e.k) {
      case 'id': return readKey(e.n, e.line);
      case 'idx': {
        const key = keyOf(e);
        if (key) return readKey(key, e.line);
        if (e.o.k === 'id' && e.i.k === 'id' && e.i.n === loopVar && !written.has(e.o.n)) { if (!streams.has(e.o.n)) streams.set(e.o.n, add('in', e.o.n, e.line)); return streams.get(e.o.n); }
        if (e.o.k === 'id') return add('mem', `${e.o.n}[ ]`, e.line, [ev(e.i)]);
        throw new Error('index');
      }
      case 'dot': { const k = keyOf(e); if (k) return readKey(k, e.line); throw new Error('dot'); }
      case 'un': return add(e.op === '-' ? 'neg' : 'func', e.op === '-' ? '−' : e.op, e.line, [ev(e.a)]);
      case 'bin': {
        const x = numeric(e.a), y = numeric(e.b);
        const sym = SYM[e.op] ?? e.op;
        if (y !== undefined) return add(['+', '-', '*', '/'].includes(e.op) ? OPKIND[e.op] : 'func', `${sym}${fmt(y)}`, e.line, [ev(e.a)]);
        if (x !== undefined && (e.op === '+' || e.op === '*')) return add(OPKIND[e.op], `${sym}${fmt(x)}`, e.line, [ev(e.b)]);
        return add(OPKIND[e.op] ?? 'func', sym, e.line, [ev(e.a), ev(e.b)]);
      }
      case 'cond': return add('mux', '?:', e.line, [ev(e.c), ev(e.a), ev(e.b)]);
      case 'call': {
        const f = e.f.k === 'dot' && e.f.o.k === 'id' && e.f.o.n === 'Math' ? e.f.p : e.f.k === 'id' ? e.f.n : null;
        if (f && FUNCS.has(f)) return add('func', f, e.line, e.args.map(ev));
        throw new Error('call');
      }
      default: throw new Error('expr');
    }
  };
  const OPKIND = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
  let unread = 0;
  for (const s of list) {
    try {
      if (s.kind === 'declare') continue;
      const lhs = s.kind === 'decl' ? { k: 'id', n: s.name } : s.lhs;
      let value;
      if (s.kind === 'assign' && s.op !== '=') value = ev({ k: 'bin', op: s.op[0], a: lhs, b: s.e, line: s.line });
      else value = ev(s.e);
      const key = keyOf(lhs);
      if (key) env.set(key, value);
      else if (lhs.k === 'idx' && lhs.o.k === 'id') {
        if (lhs.i.k === 'id' && lhs.i.n === loopVar) { const name = lhs.o.n; const o = add('out', name, s.line, [value]); void o; }
        else add('write', `${lhs.o.n}[ ]`, s.line, [value, ev(lhs.i)]);
      } else throw new Error('target');
    } catch { unread++; }
  }
  // what each delayed variable ends the pass as, fed back to its delay
  const back = [];
  for (const [key, id] of delays) { const src = env.get(key); if (src !== undefined && src !== id) back.push({ from: src, to: id }); }
  // drop what leads nowhere (a value computed and never used, a constant nobody read)
  const used = new Set();
  const mark = id => { if (used.has(id)) return; used.add(id); for (const s of nodes[id].ins) mark(s); };
  nodes.forEach(n => { if (n.kind === 'out' || n.kind === 'write') mark(n.id); });
  for (const e of back) if (used.has(e.to)) mark(e.from);
  const keep = nodes.filter(n => used.has(n.id));
  if (!keep.some(n => n.kind === 'out')) return null;
  return { nodes: keep, edges: edges.filter(e => used.has(e.from) && used.has(e.to)), back: back.filter(e => used.has(e.from) && used.has(e.to)), skipped: skipped + unread };
}

// Columns by depth from the left, rows ordered by where the inputs sit, so the wires cross as little as they can.
export function layoutCircuit(g, { dx = 74, dy = 34 } = {}) {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const rank = new Map();
  const rankOf = id => {
    if (rank.has(id)) return rank.get(id);
    const n = byId.get(id);
    const r = n.ins.length ? 1 + Math.max(...n.ins.map(rankOf)) : 0;
    rank.set(id, r); return r;
  };
  g.nodes.forEach(n => rankOf(n.id));
  const cols = [];
  for (const n of g.nodes) { (cols[rank.get(n.id)] ??= []).push(n); n.col = rank.get(n.id); }
  const y = new Map();
  cols.forEach(c => c.forEach((n, i) => y.set(n.id, i)));
  for (let pass = 0; pass < 4; pass++) {
    cols.forEach((c, ci) => {
      if (!ci) return;
      const key = n => (n.ins.length ? n.ins.reduce((s, i) => s + y.get(i), 0) / n.ins.length : y.get(n.id));
      c.sort((p, q) => key(p) - key(q) || p.id - q.id);
      c.forEach((n, i) => y.set(n.id, Math.max(i, key(n) - 0.0)));
    });
    cols.forEach(c => { let last = -1; c.forEach(n => { const v = Math.max(y.get(n.id), last + 1); y.set(n.id, v); last = v; }); });
  }
  const rows = Math.max(...[...y.values()]) + 1;
  for (const n of g.nodes) { n.x = 70 + n.col * dx; n.y = 22 + y.get(n.id) * dy; }
  return { width: 70 + (cols.length - 1) * dx + 70, height: 22 + rows * dy + 30 };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// SVG text for the diagram. Colours come from the page's own variables; every symbol carries data-line, the file line it came from.
export function circuitSvg(g) {
  const size = layoutCircuit(g), byId = new Map(g.nodes.map(n => [n.id, n]));
  const out = [];
  const R = 11;
  const edge = (a, b, dashed = false) => {
    const bx = b.x - (b.kind === 'delay' || b.kind === 'out' || b.kind === 'write' || b.kind === 'mem' ? 20 : R);
    const ax = a.x + (a.kind === 'in' || a.kind === 'coef' || a.kind === 'num' || a.kind === 'delay' ? 14 + Math.min(34, 3.4 * String(a.label).length) : (a.kind === 'func' || a.kind === 'mem' ? 20 : R));
    if (dashed) {
      const low = Math.max(a.y, b.y) + 22;
      return `<path class="bk" d="M${a.x + 6},${a.y + R} C${a.x + 6},${low} ${b.x - 34},${low} ${b.x - 34},${b.y} L${b.x - 20},${b.y}" />`;
    }
    const mid = (ax + bx) / 2;
    return `<path class="wire" d="M${ax},${a.y} C${mid},${a.y} ${mid},${b.y} ${bx},${b.y}" />`;
  };
  for (const n of g.nodes) n.ins.forEach(i => out.push(edge(byId.get(i), n)));
  for (const e of g.back) out.push(edge(byId.get(e.from), byId.get(e.to), true));
  for (const n of g.nodes) {
    const at = `data-line="${n.line}" transform="translate(${n.x},${n.y})"`;
    const tip = `<title>${esc(n.kind === 'coef' ? `${n.label}: set before the loop` : `${n.label} (line ${n.line + 1})`)}</title>`;
    if (n.kind === 'in') out.push(`<g class="sym in" ${at}>${tip}<text x="-4" y="4" text-anchor="end">${esc(n.label)}</text><path d="M0,-8 L12,0 L0,8 Z" /></g>`);
    else if (n.kind === 'coef') out.push(`<g class="sym coef" ${at}>${tip}<text x="-4" y="4" text-anchor="end">${esc(n.label)}</text><rect x="0" y="-7" width="10" height="14" rx="3" /></g>`);
    else if (n.kind === 'num') out.push(`<g class="sym num" ${at}>${tip}<text x="0" y="4" text-anchor="middle">${esc(n.label)}</text></g>`);
    else if (n.kind === 'delay') out.push(`<g class="sym delay" ${at}>${tip}<text x="-26" y="4" text-anchor="end">${esc(n.label)}</text><rect x="-20" y="-10" width="40" height="20" rx="3" /><text x="0" y="4" text-anchor="middle" class="in">z⁻¹</text></g>`);
    else if (n.kind === 'out') out.push(`<g class="sym outp" ${at}>${tip}<path d="M-18,-8 L-6,0 L-18,8 Z" /><text x="-2" y="4">${esc(n.label)}</text></g>`);
    else if (n.kind === 'write') out.push(`<g class="sym outp" ${at}>${tip}<rect x="-20" y="-9" width="40" height="18" rx="3" /><text x="0" y="4" text-anchor="middle">${esc(n.label)}</text></g>`);
    else if (n.kind === 'mem') out.push(`<g class="sym fn" ${at}>${tip}<rect x="-20" y="-9" width="40" height="18" rx="3" /><text x="0" y="4" text-anchor="middle">${esc(n.label)}</text></g>`);
    else if (n.kind === 'func' && n.label.length > 2) out.push(`<g class="sym fn" ${at}>${tip}<rect x="-20" y="-9" width="40" height="18" rx="9" /><text x="0" y="4" text-anchor="middle">${esc(n.label)}</text></g>`);
    else if (n.kind === 'mux') out.push(`<g class="sym fn" ${at}>${tip}<rect x="-11" y="-11" width="22" height="22" rx="3" /><text x="0" y="4" text-anchor="middle">?:</text></g>`);
    else out.push(`<g class="sym op" ${at}>${tip}<circle r="${R}" /><text x="0" y="${n.label.length > 2 ? 3.5 : 4.5}" text-anchor="middle" ${n.label.length > 2 ? 'class="sm"' : ''}>${esc(n.label.length > 4 ? n.label.slice(0, 4) : n.label)}</text></g>`);
  }
  return `<svg class="circuit" xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${out.join('')}</svg>`;
}
