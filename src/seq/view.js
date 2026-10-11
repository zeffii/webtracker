import { KINDS, noteToken } from './cells.js';
import { insertPattern, setCell } from './edit.js';

// Piano keys: semitones above the base octave. Lower row Z..M with S D G H J as
// sharps, upper row Q..U one octave up with 2 3 5 6 7, then I O P with 9 0.
const LOWER = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11 };
const UPPER = { q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
const ROWS = 24;

// Keyboard-driven view of every lane side by side. Edits go straight into the
// shared pages, so they are heard on the next tick while the song plays.
export function createTrackerView({ el, statusEl, lanes, song, transport, onToggle }) {
  const len = song.length;
  const cur = { lane: 0, tick: 0, col: 0 };
  let pending = '', octave = 3, message = '';
  const widths = lanes.map(l => l.columns.map(c => Math.max(c.label.length, KINDS[c.token].width)));
  const block = li => widths[li].reduce((a, w) => a + w, 0) + widths[li].length - 1;

  const moveRow = d => { cur.tick = (cur.tick + d + len) % len; pending = ''; };
  const moveLane = d => {
    cur.lane = (cur.lane + d + lanes.length) % lanes.length;
    cur.col = Math.min(cur.col, lanes[cur.lane].columns.length - 1);
    pending = '';
  };
  const moveCol = d => {
    cur.col += d;
    if (cur.col < 0) { moveLane(-1); cur.col = lanes[cur.lane].columns.length - 1; }
    else if (cur.col >= lanes[cur.lane].columns.length) { moveLane(1); cur.col = 0; }
    pending = '';
  };

  const commit = (token, advance = true) => {
    if (setCell(lanes[cur.lane], len, cur.tick, cur.col, token)) {
      message = '';
      if (advance) cur.tick = (cur.tick + 1) % len;
    } else {
      message = 'No pattern here. Press Enter to insert one.';
    }
    pending = '';
  };

  // Returns true if the key was used.
  const typeKey = k => {
    const kind = lanes[cur.lane].columns[cur.col].token;
    if (kind === 'note') {
      if (k === '1') return commit('==='), true;
      if (k === '`') return commit('^^^'), true;
      const n = Object.hasOwn(LOWER, k) ? LOWER[k] : Object.hasOwn(UPPER, k) ? UPPER[k] : null;
      if (n === null) return false;
      try { commit(noteToken(octave * 12 + n)); } catch { message = 'Note out of range.'; }
      return true;
    }
    if (!/^[0-9a-f]$/.test(k)) return false;
    pending += k.toUpperCase();
    if (pending.length === KINDS[kind].width) commit(pending);
    return true;
  };

  el.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    switch (k) {
      case 'ArrowUp': moveRow(-1); break;
      case 'ArrowDown': moveRow(1); break;
      case 'ArrowLeft': moveCol(-1); break;
      case 'ArrowRight': moveCol(1); break;
      case 'Tab': moveLane(e.shiftKey ? -1 : 1); break;
      case 'PageUp': moveRow(-16); break;
      case 'PageDown': moveRow(16); break;
      case 'Home': cur.tick = 0; pending = ''; break;
      case 'End': cur.tick = len - 1; pending = ''; break;
      case ' ': onToggle(); break;
      case '[': octave = Math.max(0, octave - 1); message = `Octave ${octave}`; break;
      case ']': octave = Math.min(9, octave + 1); message = `Octave ${octave}`; break;
      case 'Escape': pending = ''; break;
      case 'Enter':
        message = insertPattern(lanes[cur.lane], len, cur.tick) ? 'Pattern inserted.' : 'A pattern is already here.';
        break;
      case 'Delete':
      case 'Backspace':
        pending = '';
        commit(KINDS[lanes[cur.lane].columns[cur.col].token].blank, false);   // clearing does not advance
        break;
      default: used = typeKey(k);
    }
    if (used) e.preventDefault();
  });

  const draw = () => {
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    const top = Math.max(0, Math.min(cur.tick - 8, len - ROWS));
    const lines = [
      `    ${lanes.map((l, li) => ` ${l.id.padEnd(block(li))}`).join('  ')}`,
      `    ${lanes.map((l, li) => ` ${l.columns.map((c, ci) => c.label.padEnd(widths[li][ci])).join(' ')}`).join('  ')}`,
    ];
    for (let t = top; t < Math.min(len, top + ROWS); t++) {
      const chunks = lanes.map((lane, li) => {
        const mark = lane.placements.some(p => p.start === t) ? '▌' : ' ';   // a pattern starts here
        return mark + lane.columns.map((c, ci) => {
          const isCur = li === cur.lane && ci === cur.col && t === cur.tick;
          const token = isCur && pending ? pending + KINDS[c.token].blank.slice(pending.length) : lane.rows[t][ci];
          const text = token.padEnd(widths[li][ci]);
          return isCur ? `<span class="cur">${text}</span>` : text;
        }).join(' ');
      });
      const row = `${playing && t === playTick ? '>' : ' '}${String(t).padStart(2, '0')} ${chunks.join('  ')}`;
      lines.push(playing && t === playTick ? `<b>${row}</b>` : row);
    }
    el.innerHTML = lines.join('\n');
    const lane = lanes[cur.lane];
    statusEl.textContent = [
      `${lane.id}`, `row ${cur.tick}`, lane.columns[cur.col].label, `octave ${octave}`,
      pending && `typing ${pending}`, message,
    ].filter(Boolean).join(' · ');
  };

  return { draw };
}
