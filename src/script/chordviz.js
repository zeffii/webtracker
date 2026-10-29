// The chord preview for the Script tab: every chords('Am7 Fmaj7 C G') and chords(prog('I vi IV V', 'C')) written with plain
// text in the code is shown as the chord names and the notes each one puts in the note columns, before anything runs.
import { chordList, namesOf, prog } from './chords.js';
import { noteToken } from '../seq/cells.js';

const Q = `(['"\`])((?:\\\\.|(?!\\1).)*)\\1`;   // a quoted string: quote, text, the same quote
const OPTS = '(?:\\s*,\\s*\\{([^}]*)\\})?';
const DIRECT = new RegExp(`chords\\(\\s*${Q}${OPTS}\\s*\\)`, 'g');
const NUMERALS = new RegExp(`chords\\(\\s*prog\\(\\s*${Q}(?:\\s*,\\s*${Q.replace(/\\1/g, '\\3')})?(?:\\s*,\\s*${Q.replace(/\\1/g, '\\5')})?\\s*\\)${OPTS}\\s*\\)`, 'g');

// { lead: true, octave: 3, spread: 'open' } as an object, only the plain values (what the preview can know without running)
function readOptions(text) {
  const o = {};
  for (const m of String(text ?? '').matchAll(/(\w+)\s*:\s*(true|false|-?\d+|'[^']*'|"[^"]*")/g)) {
    const v = m[2];
    o[m[1]] = v === 'true' ? true : v === 'false' ? false : /^-?\d/.test(v) ? Number(v) : v.slice(1, -1);
  }
  return o;
}

// [{ line, label, names, options, notes? , error? }] in the order they appear.
export function findChords(code) {
  const out = [];
  String(code).split('\n').forEach((text, i) => {
    const body = text.replace(/\/\/.*$/, '');
    const found = [];
    for (const m of body.matchAll(NUMERALS)) found.push({ at: m.index, label: m[0], make: () => prog(m[2], m[4] ?? 'C', m[6] ?? 'major'), opts: m[7] });
    for (const m of body.matchAll(DIRECT)) {
      if (found.some(f => m.index >= f.at && m.index < f.at + f.label.length)) continue;
      found.push({ at: m.index, label: m[0], make: () => namesOf(m[2]), opts: m[3] });
    }
    found.sort((a, b) => a.at - b.at);
    for (const f of found) {
      const item = { line: i + 1, label: f.label.replace(/\s+/g, ' '), options: readOptions(f.opts) };
      try {
        item.names = f.make();
        item.notes = chordList(item.names, item.options).map(l => l.map(n => noteToken(n - 12)));
      } catch (err) { item.error = String(err.message ?? err); item.names = item.names ?? []; }
      out.push(item);
    }
  });
  return out;
}

// Adds a card per chords(...) call to `el`: the names in a row, and under each the notes it plays, low to high.
export function appendChords(el, items, caretLine = 0) {
  for (const it of items.slice(0, 8)) {
    const card = Object.assign(document.createElement('div'), { className: `ev-card cv-card${it.line === caretLine ? ' cur' : ''}` });
    const text = Object.assign(document.createElement('div'), { className: 'ev-text' });
    text.append(Object.assign(document.createElement('code'), { textContent: it.label }), Object.assign(document.createElement('span'), { textContent: `line ${it.line} · ${it.names.length} chords${it.options.lead ? ' · smooth voicing' : ''}` }));
    if (it.error) text.append(Object.assign(document.createElement('span'), { className: 'cv-err', textContent: it.error }));
    else {
      const row = Object.assign(document.createElement('div'), { className: 'cv-row' });
      it.names.forEach((name, k) => {
        const c = Object.assign(document.createElement('div'), { className: 'cv-chord' });
        c.append(Object.assign(document.createElement('b'), { textContent: name }), Object.assign(document.createElement('small'), { textContent: it.notes[k].join(' ') }));
        row.append(c);
      });
      text.append(row);
    }
    card.append(text);
    el.append(card);
  }
}
