// GenExpr compiler: text in, a JavaScript function out, once per edit (never per audio block).
// A subset of the gen~ code language: History, Param, Data and Delay declarations, assignments, if / else, the usual
// operators and a library of functions. `in1` `in2` come in, `out1` `out2` go out. Every mistake is reported with its
// line, column and a hint, and a program with mistakes produces no code, so the last good one keeps running.
import { parse } from './parser.js';

export const MAX_PARAMS = 8, MAX_BUFFER = 1 << 22;
export const DEFAULT_CODE = `// GenExpr: in1 and in2 come in, out1 and out2 go out.
// A Param becomes a knob, p1 to p8 in the order they are declared.
Param amount(0.5, min=0, max=1);
History smooth(0);

smooth = smooth + (in1 - smooth) * 0.1;
out1 = mix(in1, smooth, amount);
out2 = in2;
`;

const CONSTS = { pi: Math.PI, twopi: Math.PI * 2, halfpi: Math.PI / 2, invpi: 1 / Math.PI, e: Math.E, ln2: Math.LN2, ln10: Math.LN10, sqrt2: Math.SQRT2, sqrt1_2: Math.SQRT1_2 };

// name: [min args, max args, builder(args, ctx)]; args are JavaScript source strings; ctx.state(n) reserves state slots
const M = name => (...a) => `Math.${name}(${a.join(', ')})`;
const FUNCS = {
  sin: [1, 1, M('sin')], cos: [1, 1, M('cos')], tan: [1, 1, M('tan')], asin: [1, 1, a => `Math.asin($c(${a}, -1, 1))`], acos: [1, 1, a => `Math.acos($c(${a}, -1, 1))`], atan: [1, 1, M('atan')], atan2: [2, 2, M('atan2')],
  sinh: [1, 1, M('sinh')], cosh: [1, 1, M('cosh')], tanh: [1, 1, M('tanh')],
  abs: [1, 1, M('abs')], sign: [1, 1, M('sign')], floor: [1, 1, M('floor')], ceil: [1, 1, M('ceil')], round: [1, 1, M('round')], trunc: [1, 1, M('trunc')],
  fract: [1, 1, a => `$fract(${a})`], sqrt: [1, 1, a => `$sqrt(${a})`], exp: [1, 1, a => `$fin(Math.exp(${a}))`], log: [1, 1, a => `$log(${a})`], log2: [1, 1, a => `($log(${a}) / Math.LN2)`], log10: [1, 1, a => `($log(${a}) / Math.LN10)`],
  pow: [2, 2, (a, b) => `$pow(${a}, ${b})`], min: [2, 2, M('min')], max: [2, 2, M('max')],
  clamp: [3, 3, (x, lo, hi) => `$c(${x}, ${lo}, ${hi})`], clip: [3, 3, (x, lo, hi) => `$c(${x}, ${lo}, ${hi})`],
  mix: [3, 3, (a, b, t) => `$mix(${a}, ${b}, ${t})`], scale: [5, 5, (x, il, ih, ol, oh) => `$scale(${x}, ${il}, ${ih}, ${ol}, ${oh})`],
  wrap: [3, 3, (x, lo, hi) => `$wrap(${x}, ${lo}, ${hi})`], fold: [3, 3, (x, lo, hi) => `$fold(${x}, ${lo}, ${hi})`], mod: [2, 2, (a, b) => `$mod(${a}, ${b})`],
  mtof: [1, 1, m => `(440 * Math.pow(2, (${m} - 69) / 12))`], ftom: [1, 1, f => `(69 + 12 * $log(${f} / 440) / Math.LN2)`],
  dbtoa: [1, 1, d => `Math.pow(10, ${d} / 20)`], atodb: [1, 1, a => `(20 * $log(Math.max(${a}, 1e-12)) / Math.LN10)`],
  mstosamps: [1, 1, (m, c) => `(${m} * sr / 1000)`], sampstoms: [1, 1, s => `(${s} * 1000 / sr)`],
  fixdenorm: [1, 1, a => `$fd(${a})`],
  noise: [0, 0, (c) => `$noise(S, ${c.state(1)})`],
  phasor: [1, 1, (f, c) => `$phasor(S, ${c.state(1)}, ${f})`],
  cycle: [1, 1, (f, c) => `Math.sin(TAU * $phasor(S, ${c.state(1)}, ${f}))`],
  delta: [1, 1, (x, c) => `$delta(S, ${c.state(1)}, ${x})`],
  change: [1, 1, (x, c) => `Math.sign($delta(S, ${c.state(1)}, ${x}))`],
  slide: [3, 3, (x, up, down, c) => `$slide(S, ${c.state(1)}, ${x}, ${up}, ${down})`],
  dcblock: [1, 1, (x, c) => { const k = c.state(2); return `$dcblock(S, ${k}, ${x})`; }],
};
const BUFFER_FUNCS = new Set(['peek', 'poke', 'dim']);
const WORDS = new Set(['if', 'else', 'History', 'Param', 'Data', 'Delay']);

const PRELUDE = `
const TAU = Math.PI * 2;
const $fin = x => (x === x && x < 1e18 && x > -1e18 ? x : 0);
const $c = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const $div = (a, b) => (b === 0 ? 0 : a / b);
const $sqrt = x => (x > 0 ? Math.sqrt(x) : 0);
const $log = x => (x > 0 ? Math.log(x) : 0);
const $pow = (a, b) => $fin(Math.pow(a, b));
const $fract = x => x - Math.floor(x);
const $mod = (a, b) => (b === 0 ? 0 : a - b * Math.floor(a / b));
const $mix = (a, b, t) => a + (b - a) * t;
const $scale = (x, il, ih, ol, oh) => (ih === il ? ol : ol + (x - il) * (oh - ol) / (ih - il));
const $wrap = (x, lo, hi) => { const r = hi - lo; return r === 0 ? lo : lo + $mod(x - lo, r); };
const $fold = (x, lo, hi) => { const r = hi - lo; if (r === 0) return lo; const t = $mod(x - lo, 2 * r); return lo + (t > r ? 2 * r - t : t); };
const $fd = x => (x > -1e-18 && x < 1e-18 ? 0 : x);
const $phasor = (S, k, f) => { const p = S[k]; let q = p + f / sr; q -= Math.floor(q); S[k] = q; return p; };
const $noise = (S, k) => { let x = S[k] | 0 || 22222; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; S[k] = x | 0; return (x >>> 0) / 2147483648 - 1; };
const $delta = (S, k, x) => { const d = x - S[k]; S[k] = x; return d; };
const $slide = (S, k, x, up, down) => { const y = S[k], s = Math.max(1, x > y ? up : down); S[k] = y + (x - y) / s; return S[k]; };
const $dcblock = (S, k, x) => { const y = x - S[k] + 0.995 * S[k + 1]; S[k] = x; S[k + 1] = y; return y; };
const $peek = (b, i) => b[(((Math.floor(i) % b.length) + b.length) % b.length)];
const $poke = (b, v, i) => { b[(((Math.floor(i) % b.length) + b.length) % b.length)] = v; };
const $dwrite = (B, k, S, w, x) => { const b = B[k]; b[S[w]] = x; S[w] = (S[w] + 1) % b.length; };
const $dread = (B, k, S, w, t) => { const b = B[k], n = b.length; let pos = S[w] - Math.max(1, t); pos = ((pos % n) + n) % n; const i0 = Math.floor(pos), f = pos - i0; return b[i0] * (1 - f) + b[(i0 + 1) % n] * f; };
`;

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function closest(name, names) {
  let best = null, score = Infinity;
  for (const n of names) { const d = distance(name.toLowerCase(), n.toLowerCase()); if (d < score) { score = d; best = n; } }
  return name.length >= 3 && best && score <= Math.max(1, Math.floor(name.length / 3)) ? best : null;
}

export function compile(text, { sampleRate = 48000 } = {}) {
  const { body, errors } = parse(text), warnings = [];
  const err = (at, message, hint) => errors.push({ line: at.line, col: at.col, end: at.end, message, ...(hint ? { hint } : {}) });
  const warn = (at, message) => warnings.push({ line: at.line, col: at.col, end: at.end, message });

  const syms = new Map();   // name -> { kind, ... }
  syms.set('in1', { kind: 'in', n: 0 }); syms.set('in2', { kind: 'in', n: 1 });
  syms.set('out1', { kind: 'out', n: 0 }); syms.set('out2', { kind: 'out', n: 1 });
  for (const [k, v] of Object.entries(CONSTS)) syms.set(k, { kind: 'const', v });
  syms.set('samplerate', { kind: 'const', v: sampleRate });
  const reserved = () => [...syms.keys(), ...Object.keys(FUNCS), ...BUFFER_FUNCS, ...WORDS];

  let nState = 0; const inits = [], buffers = [], params = [], locals = new Set(), assigned = new Set();
  const used = { in: [false, false], out: [false, false], params: new Set() };
  const state = n => { const k = nState; nState += n; return k; };

  // locals are every name that is set somewhere and is not declared; found first so "used before set" can be told from "unknown"
  const setNames = new Set();
  (function scan(list) { for (const s of list) { if (s.k === 'set') setNames.add(s.name); else if (s.k === 'if') { scan(s.then); if (s.other) scan(s.other); } } })(body);

  // constants for declarations
  function constant(e) {
    if (e.k === 'num') return e.v;
    if (e.k === 'id') { const s = syms.get(e.name); if (s?.kind === 'const') return s.v; }
    if (e.k === 'un' && e.op === '-') return -constant(e.e);
    if (e.k === 'bin' && ['+', '-', '*', '/'].includes(e.op)) { const a = constant(e.l), b = constant(e.r); return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : b === 0 ? 0 : a / b; }
    err(e, 'this has to be a fixed number here (a number, pi, samplerate, or arithmetic on those)');
    return 0;
  }

  function declare(s) {
    const clash = syms.get(s.name) || FUNCS[s.name] || BUFFER_FUNCS.has(s.name) || WORDS.has(s.name);
    if (clash) { err(s.nameAt, syms.has(s.name) && syms.get(s.name).kind !== 'const' && syms.get(s.name).kind !== 'in' && syms.get(s.name).kind !== 'out' ? `"${s.name}" is declared twice` : `"${s.name}" is already a name in GenExpr`); return; }
    const pos = s.args.filter(a => !a.key), named = Object.fromEntries(s.args.filter(a => a.key).map(a => [a.key, a]));
    const only = (allowed, tail = '') => { for (const a of s.args.filter(a => a.key)) if (!allowed.includes(a.key)) err(a.at, `${s.kind} has no "${a.key}" setting; it takes ${allowed.join(', ')}${tail}`); };
    if (s.kind === 'History') {
      only([]); if (pos.length > 1) err(pos[1].value, 'History takes one starting value, History name(0)');
      const k = state(1); inits.push([k, pos[0] ? constant(pos[0].value) : 0]); syms.set(s.name, { kind: 'history', k });
    } else if (s.kind === 'Param') {
      only(['min', 'max']);
      if (!pos.length) { err(s, `Param ${s.name} needs a default value, for example Param ${s.name}(0.5, min=0, max=1)`); return; }
      if (pos.length > 3) err(pos[3].value, 'Param takes a default, then min= and max=');
      const def = constant(pos[0].value);
      let min = named.min ? constant(named.min.value) : pos[1] ? constant(pos[1].value) : Math.min(0, def), max = named.max ? constant(named.max.value) : pos[2] ? constant(pos[2].value) : Math.max(1, def);
      if (!(min < max)) err(named.max?.value ?? named.min?.value ?? s, `min (${min}) has to be below max (${max})`);
      else if (def < min || def > max) err(pos[0].value, `the default ${def} is outside the range ${min} to ${max}`);
      if (params.length >= MAX_PARAMS) { err(s.nameAt, `this version has ${MAX_PARAMS} Param knobs, p1 to p${MAX_PARAMS}; remove one or use a History`); return; }
      const idx = params.length; params.push({ name: s.name, def, min, max, at: s.nameAt });
      syms.set(s.name, { kind: 'param', idx });
    } else {   // Data and Delay
      only([]); if (pos.length !== 1) { err(s, `${s.kind} ${s.name} needs a size, for example ${s.kind} ${s.name}(${s.kind === 'Delay' ? 'samplerate' : 512})`); return; }
      const size = Math.floor(constant(pos[0].value));
      if (!(size >= 1) || size > MAX_BUFFER) { err(pos[0].value, `the size has to be between 1 and ${MAX_BUFFER}, not ${size}`); return; }
      const b = buffers.length; buffers.push(size);
      syms.set(s.name, { kind: s.kind === 'Data' ? 'data' : 'delay', b, w: s.kind === 'Delay' ? state(1) : -1, size });
    }
  }

  const known = () => [...reserved(), ...[...setNames], ...[...syms.keys()]];
  const unknown = (at, name, what = 'name') => err(at, `unknown ${what} "${name}"`, (() => { const c = closest(name, what === 'operator' ? [...Object.keys(FUNCS), ...BUFFER_FUNCS] : known()); return c ? `did you mean "${c}"?` : undefined; })());

  function bufferArg(a, fnName) {
    if (a.k === 'id') { const s = syms.get(a.name); if (s && (s.kind === 'data' || s.kind === 'delay')) return s; if (!s) { unknown(a, a.name); return null; } }
    err(a, `${fnName} needs a Data or Delay name here`); return null;
  }

  const ctx = { state };
  function gen(e) {
    switch (e.k) {
      case 'num': return Number.isFinite(e.v) ? String(e.v) : '0';
      case 'id': {
        const s = syms.get(e.name);
        if (s) {
          if (s.kind === 'const') return String(s.v);
          if (s.kind === 'in') { used.in[s.n] = true; return `i${s.n + 1}`; }
          if (s.kind === 'out') { used.out[s.n] = true; return `o${s.n + 1}`; }
          if (s.kind === 'param') { used.params.add(s.idx); return `p${s.idx}`; }
          if (s.kind === 'history') return `S[${s.k}]`;
          err(e, `"${e.name}" is a ${s.kind === 'data' ? 'Data' : 'Delay'} buffer, not a number`, s.kind === 'data' ? `use peek(${e.name}, index) or ${e.name}.read(index)` : `use ${e.name}.read(time) and ${e.name}.write(value)`);
          return '0';
        }
        if (FUNCS[e.name] || BUFFER_FUNCS.has(e.name)) { err(e, `"${e.name}" is an operator; write it with brackets, ${e.name}(...)`); return '0'; }
        if (setNames.has(e.name)) { if (!assigned.has(e.name)) err(e, `"${e.name}" is used before it is set`, `set it on an earlier line, for example ${e.name} = 0;`); else return `v_${e.name}`; return '0'; }
        unknown(e, e.name); return '0';
      }
      case 'un': { const x = gen(e.e); return e.op === '-' ? `(-${x})` : `(${x} === 0 ? 1 : 0)`; }
      case 'bin': {
        const l = gen(e.l), r = gen(e.r), cmp = op => `(${l} ${op} ${r} ? 1 : 0)`;
        switch (e.op) {
          case '/': return `$div(${l}, ${r})`; case '%': return `$mod(${l}, ${r})`; case '**': return `$pow(${l}, ${r})`;
          case '==': return cmp('==='); case '!=': return cmp('!=='); case '<': return cmp('<'); case '>': return cmp('>'); case '<=': return cmp('<='); case '>=': return cmp('>=');
          case '&&': return `(${l} !== 0 && ${r} !== 0 ? 1 : 0)`; case '||': return `(${l} !== 0 || ${r} !== 0 ? 1 : 0)`;
          default: return `(${l} ${e.op} ${r})`;
        }
      }
      case 'cond': return `(${gen(e.c)} !== 0 ? ${gen(e.a)} : ${gen(e.b)})`;
      case 'call': {
        if (BUFFER_FUNCS.has(e.name)) {
          const want = e.name === 'peek' ? 2 : e.name === 'poke' ? 3 : 1;
          if (e.args.length !== want) { err(e, `${e.name} takes ${want} argument${want > 1 ? 's' : ''} but got ${e.args.length}`, e.name === 'poke' ? 'poke(buffer, value, index)' : e.name === 'peek' ? 'peek(buffer, index)' : 'dim(buffer)'); return '0'; }
          const b = bufferArg(e.args[0], e.name); const rest = e.args.slice(1).map(gen);
          if (!b) return '0';
          if (e.name === 'dim') return String(b.size);
          if (b.kind !== 'data') { err(e.args[0], `${e.name} works on Data, not Delay`, 'a Delay is read with name.read(time)'); return '0'; }
          return e.name === 'peek' ? `$peek(B[${b.b}], ${rest[0]})` : `$poke(B[${b.b}], ${rest[0]}, ${rest[1]})`;
        }
        const nameAt = { line: e.line, col: e.col, end: e.col + e.name.length }, f = FUNCS[e.name];
        if (!f) { if (syms.has(e.name)) err(nameAt, `"${e.name}" is not an operator, you cannot call it`); else unknown(nameAt, e.name, 'operator'); e.args.forEach(gen); return '0'; }
        const [lo, hi, build] = f;
        if (e.args.length < lo || e.args.length > hi) {
          err(nameAt, `${e.name} takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'} but got ${e.args.length}`);
          e.args.forEach(gen); return '0';
        }
        return build(...e.args.map(gen), ctx);
      }
      case 'method': {
        const b = e.obj.k === 'id' ? syms.get(e.obj.name) : null;
        if (!b || (b.kind !== 'data' && b.kind !== 'delay')) { err(e.obj, e.obj.k === 'id' && !b ? `unknown name "${e.obj.name}"` : 'only a Data or Delay has methods like .read and .write'); e.args.forEach(gen); return '0'; }
        const args = e.args.map(gen);
        if (b.kind === 'delay') {
          if (e.name === 'read') { if (args.length !== 1) { err(e, `read takes 1 argument (the delay time in samples) but got ${args.length}`); return '0'; } return `$dread(B, ${b.b}, S, ${b.w}, ${args[0]})`; }
          if (e.name === 'write') { if (args.length !== 1) { err(e, `write takes 1 argument (the value) but got ${args.length}`); return '0'; } return `($dwrite(B, ${b.b}, S, ${b.w}, ${args[0]}), 0)`; }
        } else {
          if (e.name === 'read') { if (args.length !== 1) { err(e, `read takes 1 argument (the index) but got ${args.length}`); return '0'; } return `$peek(B[${b.b}], ${args[0]})`; }
          if (e.name === 'write') { if (args.length !== 2) { err(e, `write takes 2 arguments (the value and the index) but got ${args.length}`); return '0'; } return `($poke(B[${b.b}], ${args[0]}, ${args[1]}), 0)`; }
        }
        err(e, `${b.kind === 'delay' ? 'a Delay' : 'Data'} has read and write, not "${e.name}"`); return '0';
      }
    }
    return '0';
  }

  function stmts(list, depth) {
    const pad = '    '.repeat(depth + 1); let out = '';
    for (const s of list) {
      if (s.k === 'decl') { if (depth) err(s, `${s.kind} has to be declared at the top level, not inside an if`); else declare(s); }
      else if (s.k === 'set') {
        const sym = syms.get(s.name);
        const value = (() => { const prior = s.op === '=' ? null : gen({ k: 'id', name: s.name, line: s.nameAt.line, col: s.nameAt.col, end: s.nameAt.end }); const v = gen(s.value); return prior === null ? v : `(${prior} ${s.op[0]} ${v})`; })();
        if (sym?.kind === 'in') err(s.nameAt, `"${s.name}" is an input and cannot be set`, 'read it, or copy it into a variable');
        else if (sym?.kind === 'const') err(s.nameAt, `"${s.name}" is a constant and cannot be set`);
        else if (sym?.kind === 'param') err(s.nameAt, `"${s.name}" is a Param: it is set by its knob, not in the code`, `read it in an expression, or copy it: x = ${s.name};`);
        else if (sym?.kind === 'data' || sym?.kind === 'delay') err(s.nameAt, `"${s.name}" is a buffer; write to it with ${sym.kind === 'data' ? 'poke(' + s.name + ', value, index)' : s.name + '.write(value)'}`);
        else if (sym?.kind === 'out') { used.out[sym.n] = true; out += `${pad}o${sym.n + 1} = ${value};\n`; }
        else if (sym?.kind === 'history') out += `${pad}S[${sym.k}] = ${value};\n`;
        else if (FUNCS[s.name] || BUFFER_FUNCS.has(s.name) || WORDS.has(s.name)) err(s.nameAt, `"${s.name}" is a GenExpr word and cannot be a variable name`);
        else { assigned.add(s.name); locals.add(s.name); out += `${pad}v_${s.name} = ${value};\n`; }
      } else if (s.k === 'if') {
        const c = gen(s.cond);
        out += `${pad}if (${c} !== 0) {\n${stmts(s.then, depth + 1)}${pad}}`;
        if (s.other) out += ` else {\n${stmts(s.other, depth + 1)}${pad}}`;
        out += '\n';
      } else if (s.k === 'expr') out += `${pad}${gen(s.e)};\n`;
    }
    return out;
  }

  const code = stmts(body, 0);
  for (const p of params) if (!used.params.has(params.indexOf(p))) warn(p.at, `Param "${p.name}" is never used`);
  if (!used.out[0] && !used.out[1] && !errors.length) warn({ line: 1, col: 1, end: 2 }, 'nothing sets out1 or out2, so this is silent');

  if (errors.length) return { ok: false, errors: sortErrors(errors), warnings, params: [] };

  const src = `"use strict";${PRELUDE}
let ZERO = new Float32Array(256);
return function (I1, I2, O1, O2, n, P) {
  if (ZERO.length < n) ZERO = new Float32Array(n);
  const A1 = I1 || ZERO, A2 = I2 || ZERO;
${params.map((_, i) => `  const p${i} = P[${i}];`).join('\n')}
  for (let i = 0; i < n; i++) {
    const i1 = A1[i], i2 = A2[i];
    let o1 = 0, o2 = 0${[...locals].map(l => `, v_${l} = 0`).join('')};
${code}    O1[i] = $fin(o1); O2[i] = $fin(o2);
  }
  for (let k = 0; k < S.length; k++) if (!(S[k] > -1e30 && S[k] < 1e30)) S[k] = 0;
};`;
  let factory;
  try { factory = new Function('sr', 'S', 'B', src); } catch (e) { return { ok: false, errors: [{ line: 1, col: 1, end: 2, message: `internal compiler error: ${e.message}` }], warnings, params: [] }; }
  return {
    ok: true, errors: [], warnings, source: src,
    params: params.map(({ name, def, min, max }) => ({ name, def, min, max })),
    inputs: used.in, outputs: used.out,
    // A fresh running copy: its own state and buffers.
    build(sr = sampleRate) {
      const S = new Float64Array(Math.max(1, nState)), B = buffers.map(n => new Float32Array(n));
      for (const [k, v] of inits) S[k] = v;
      return factory(sr, S, B);
    },
  };
}

const sortErrors = list => list.slice().sort((a, b) => a.line - b.line || a.col - b.col);
