// The Euclidean preview for the Script tab: every euclid(hits, steps, rotate) with plain numbers in the code, and every
// 'x..x..' pattern string, drawn as a ring and a row of steps, before anything runs.
import { euclid, inv, rot, rev, both, either, xor } from './lib.js';

const MAX = 8;

// The helpers whose results can be drawn before anything runs, when their arguments are plain numbers, strings or other such calls.
const CALLS = { euclid, inv, rot, rev, both, either, xor };

// Reads one call with literal arguments starting at `i` (inv(euclid(3, 8)), rot('x..x', 1), both(a, b) with strings...).
// Returns { value, end } or null when it is anything else (a variable, an operator...), which needs the script to run.
function readCall(s, i) {
  const head = /^(euclid|inv|rot|rev|both|either|xor)\s*\(/.exec(s.slice(i));
  if (!head || (i > 0 && /[\w$.]/.test(s[i - 1]))) return null;
  let at = i + head[0].length;
  const args = [];
  const skip = () => { while (/\s/.test(s[at] ?? '')) at++; };
  for (;;) {
    skip();
    let m;
    if (s[at] === ')' && args.length === 0) { at++; break; }
    if ((m = /^-?\d+/.exec(s.slice(at)))) { args.push(Number(m[0])); at += m[0].length; }
    else if ((m = /^(['"`])((?:\\.|(?!\1).)*)\1/.exec(s.slice(at)))) { args.push(m[2]); at += m[0].length; }
    else { const sub = readCall(s, at); if (!sub) return null; args.push(sub.value); at = sub.end; }
    skip();
    if (s[at] === ',') { at++; continue; }
    if (s[at] === ')') { at++; break; }
    return null;
  }
  try {
    const value = CALLS[head[1]](...args);
    return typeof value === 'string' && value.length >= 1 && value.length <= 64 ? { value, end: at } : null;
  } catch { return null; }
}

// [{ line, label, bits: 'x..x..x.', hits, steps }] in the order they appear: the outermost euclid / inv / rot / rev / both /
// either / xor calls with plain arguments, and 'x..x' strings. Anything that needs the script to run is left out.
export function findPatterns(code) {
  const out = [];
  const lines = String(code).split('\n');
  lines.forEach((text, i) => {
    const body = text.replace(/\/\/.*$/, '');
    const found = [];
    let at = 0;
    while (at < body.length) {
      const call = /[a-z]/.test(body[at]) ? readCall(body, at) : null;
      if (call) { found.push({ at, line: i + 1, label: body.slice(at, call.end).replace(/\s+/g, ' '), bits: call.value }); at = call.end; continue; }
      const str = /^(['"`])([x.]{4,64})\1/.exec(body.slice(at));
      if (str) { found.push({ at, line: i + 1, label: `'${str[2]}'`, bits: str[2] }); at += str[0].length; continue; }
      at++;
    }
    for (const f of found) out.push({ line: f.line, label: f.label, bits: f.bits, steps: f.bits.length, hits: [...f.bits].filter(c => c === 'x').length });
  });
  return out;
}

// The grid the way the page draws it: a column per pattern, `rows` virtual rows (each pattern repeats), and how many
// patterns hit on each row.
export function gridModel(patterns, rows) {
  const cols = patterns.slice(0, MAX).map(p => ({ label: p.label, line: p.line, hits: Array.from({ length: rows }, (_, r) => p.bits[r % p.bits.length] === 'x') }));
  const together = Array.from({ length: rows }, (_, r) => cols.filter(c => c.hits[r]).length);
  return { cols, together };
}

const NS = 'http://www.w3.org/2000/svg';

// A ring: the steps round a circle from the top, clockwise, hits filled and joined by a polygon.
export function ring(bits) {
  const n = bits.length, R = 30, C = 36;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${C * 2} ${C * 2}`); svg.setAttribute('width', 56); svg.setAttribute('height', 56);
  svg.setAttribute('class', 'ev-ring'); svg.setAttribute('aria-hidden', 'true');
  const pt = i => [C + R * Math.sin((i / n) * Math.PI * 2), C - R * Math.cos((i / n) * Math.PI * 2)];
  const base = document.createElementNS(NS, 'circle');
  base.setAttribute('cx', C); base.setAttribute('cy', C); base.setAttribute('r', R); base.setAttribute('class', 'ev-base');
  svg.append(base);
  const hits = [...bits].flatMap((c, i) => (c === 'x' ? [i] : []));
  if (hits.length > 1) {
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', hits.map(i => pt(i).map(v => v.toFixed(1)).join(',')).join(' ')); poly.setAttribute('class', 'ev-poly');
    svg.append(poly);
  }
  [...bits].forEach((c, i) => {
    const [x, y] = pt(i), d = document.createElementNS(NS, 'circle');
    d.setAttribute('cx', x.toFixed(1)); d.setAttribute('cy', y.toFixed(1)); d.setAttribute('r', c === 'x' ? 3.4 : 1.5);
    d.setAttribute('class', c === 'x' ? 'ev-hit' : 'ev-rest');
    svg.append(d);
  });
  return svg;
}

// The row of steps: a box per step, hits lit, a heavier edge every four steps.
export function strip(bits) {
  const row = document.createElement('div');
  row.className = 'ev-steps';
  [...bits].forEach((c, i) => {
    const b = document.createElement('i');
    b.className = `${c === 'x' ? 'on' : ''}${i % 4 === 0 ? ' beat' : ''}`.trim();
    row.append(b);
  });
  return row;
}

// The grid: time runs down in square cells, a column per pattern, plus a column counting the hits that land together.
function grid(patterns, rows, caretLine) {
  const { cols, together } = gridModel(patterns, rows);
  const box = document.createElement('div'); box.className = 'eg';
  const labels = document.createElement('div'); labels.className = 'eg-rows';
  labels.append(document.createElement('b'));
  for (let r = 0; r < rows; r++) { const i = document.createElement('i'); i.textContent = String(r).padStart(2, '0'); if (r % 4 === 0) i.className = 'beat'; labels.append(i); }
  box.append(labels);
  const column = (name, title, cells, cls) => {
    const c = document.createElement('div'); c.className = `eg-col ${cls}`;
    const h = document.createElement('b'); h.textContent = name; h.title = title; c.append(h);
    cells.forEach((on, r) => { const u = document.createElement('u'); u.className = `${on ? 'on' : ''}${r % 4 === 0 ? ' beat' : ''}`.trim(); if (typeof on === 'number') u.textContent = on > 1 ? on : ''; c.append(u); });
    box.append(c);
    return c;
  };
  cols.forEach((col, k) => { const c = column(`${k + 1}`, `${col.label} (line ${col.line})`, col.hits, `v${k % 6}${col.line === caretLine ? ' cur' : ''}`); });
  if (cols.length > 1) column('Σ', 'rows where two or more patterns hit together', together.map(n => n > 1), 'tg').querySelectorAll('u').forEach((u, r) => { if (together[r] > 1) u.textContent = together[r]; });
  const key = document.createElement('div'); key.className = 'eg-key';
  cols.forEach((col, k) => { const d = document.createElement('div'); d.innerHTML = `<i class="v${k % 6}"></i>`; const t = document.createElement('code'); t.textContent = `${k + 1}  ${col.label}`; d.append(t); key.append(d); });
  box.append(key);
  return box;
}

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const view = { mode: read('webtracker.evMode', 'cards'), rows: Number(read('webtracker.evRows', '16')) || 16 };
const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* not remembered */ } };

// Fills `el` with the patterns, as cards (a ring and a row of steps each) or as the grid; the ones on `caretLine` are
// marked. Hidden when there is nothing to show.
export function renderViz(el, patterns, caretLine = 0) {
  el.replaceChildren();
  el.hidden = patterns.length === 0;
  if (!patterns.length) return;
  const bar = document.createElement('div'); bar.className = 'ev-bar';
  const again = () => renderViz(el, patterns, caretLine);
  for (const m of ['cards', 'grid']) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = m; b.setAttribute('aria-pressed', String(view.mode === m));
    b.title = m === 'cards' ? 'Each pattern as a ring and a row of steps' : 'Time running down in square cells, one column per pattern, to see how they fall together';
    b.addEventListener('click', () => { view.mode = m; save('webtracker.evMode', m); again(); });
    bar.append(b);
  }
  if (view.mode === 'grid') {
    for (const n of [16, 32, 64]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${n} rows`; b.setAttribute('aria-pressed', String(view.rows === n));
      b.addEventListener('click', () => { view.rows = n; save('webtracker.evRows', n); again(); });
      bar.append(b);
    }
  }
  el.append(bar);
  if (view.mode === 'grid') { el.append(grid(patterns, view.rows, caretLine)); if (patterns.length > MAX) el.append(Object.assign(document.createElement('div'), { className: 'ev-more', textContent: `+${patterns.length - MAX} more` })); return; }
  for (const p of patterns.slice(0, MAX)) {
    const card = document.createElement('div');
    card.className = `ev-card${p.line === caretLine ? ' cur' : ''}`;
    const text = document.createElement('div');
    text.className = 'ev-text';
    const name = document.createElement('code'); name.textContent = p.label;
    const meta = document.createElement('span'); meta.textContent = `line ${p.line} · ${p.hits} of ${p.steps}`;
    const bits = document.createElement('code'); bits.className = 'ev-bits'; bits.textContent = p.bits;
    text.append(name, meta, strip(p.bits), bits);
    card.append(ring(p.bits), text);
    el.append(card);
  }
  if (patterns.length > MAX) {
    const more = document.createElement('div');
    more.className = 'ev-more'; more.textContent = `+${patterns.length - MAX} more`;
    el.append(more);
  }
}
