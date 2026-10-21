// The Euclidean preview for the Script tab: every euclid(hits, steps, rotate) with plain numbers in the code, and every
// 'x..x..' pattern string, drawn as a ring and a row of steps, before anything runs.
import { euclid } from './lib.js';

const MAX = 8;

// [{ line, label, bits: 'x..x..x.', hits, steps }] in the order they appear. Calls whose arguments are not plain numbers
// (euclid(k, n) with variables) are left out: they need the script to run.
export function findPatterns(code) {
  const out = [];
  const lines = String(code).split('\n');
  lines.forEach((text, i) => {
    const body = text.replace(/\/\/.*$/, '');
    const found = [];
    for (const m of body.matchAll(/euclid\(\s*(-?\d+)\s*,\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\)/g)) {
      const k = Number(m[1]), n = Number(m[2]), r = m[3] === undefined ? 0 : Number(m[3]);
      if (n < 1 || n > 64 || k < 0) continue;
      let bits;
      try { bits = euclid(k, n, r); } catch { continue; }
      found.push({ at: m.index, line: i + 1, label: m[0].replace(/\s+/g, ' '), bits });
    }
    for (const m of body.matchAll(/(['"`])([x.]{4,64})\1/g)) found.push({ at: m.index, line: i + 1, label: `'${m[2]}'`, bits: m[2] });
    found.sort((a, b) => a.at - b.at);
    for (const f of found) out.push({ line: f.line, label: f.label, bits: f.bits, steps: f.bits.length, hits: [...f.bits].filter(c => c === 'x').length });
  });
  return out;
}

const NS = 'http://www.w3.org/2000/svg';

// A ring: the steps round a circle from the top, clockwise, hits filled and joined by a polygon.
function ring(bits) {
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
function strip(bits) {
  const row = document.createElement('div');
  row.className = 'ev-steps';
  [...bits].forEach((c, i) => {
    const b = document.createElement('i');
    b.className = `${c === 'x' ? 'on' : ''}${i % 4 === 0 ? ' beat' : ''}`.trim();
    row.append(b);
  });
  return row;
}

// Fills `el` with a card per pattern; the ones on `caretLine` are marked. Hidden when there is nothing to show.
export function renderViz(el, patterns, caretLine = 0) {
  el.replaceChildren();
  el.hidden = patterns.length === 0;
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
