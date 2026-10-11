import { KINDS, encodeCell, noteToken } from './cells.js';
import { esc } from './html.js';

// Piano keys: semitones above the base octave. Lower row Z..M with S D G H J as
// sharps, upper row Q..U one octave up with 2 3 5 6 7, then I O P with 9 0.
const LOWER = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11 };
const UPPER = { q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
const ROWS = 24;
const isBlank = token => /^\.+$/.test(token);
const isNote = token => /^[A-G][-#]\d$/.test(token);

// Keyboard-driven view of every lane side by side. The cursor sits on one character
// of one cell. Edits go straight into the shared pages, so they are heard on the next
// tick while the song plays. Call load() with the prepared lanes before drawing.
export function createTrackerView({ el, statusEl, transport, onToggle, onBack, onMove }) {
  let lanes = null, len = 0, widths = [], editor = null;
  const cur = { lane: 0, tick: 0, col: 0, ch: 0 };
  let octave = 3, message = '';

  const load = ({ lanes: l, song, editor: e }) => {
    lanes = l;
    len = song.length;
    editor = e;
    widths = lanes.map(lane => lane.columns.map(c => Math.max(c.label.length, KINDS[c.token].width)));
    Object.assign(cur, { lane: 0, tick: 0, col: 0, ch: 0 });
    message = '';
  };

  const column = (li = cur.lane, ci = cur.col) => lanes[li].columns[ci];
  const cellWidth = (li = cur.lane, ci = cur.col) => KINDS[column(li, ci).token].width;
  const block = li => widths[li].reduce((a, w) => a + w, 0) + widths[li].length - 1;

  const moveRow = d => { cur.tick = (cur.tick + d + len) % len; };
  const moveLane = d => {
    cur.lane = (cur.lane + d + lanes.length) % lanes.length;
    cur.col = Math.min(cur.col, lanes[cur.lane].columns.length - 1);
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
  };
  // One character at a time, hopping to the next cell, column and lane at the ends.
  const moveChar = d => {
    cur.ch += d;
    if (cur.ch < 0) {
      if (--cur.col < 0) {
        cur.lane = (cur.lane + lanes.length - 1) % lanes.length;
        cur.col = lanes[cur.lane].columns.length - 1;
      }
      cur.ch = cellWidth() - 1;
    } else if (cur.ch >= cellWidth()) {
      if (++cur.col >= lanes[cur.lane].columns.length) {
        cur.lane = (cur.lane + 1) % lanes.length;
        cur.col = 0;
      }
      cur.ch = 0;
    }
  };

  const write = token => {
    if (editor.setCell(cur.lane, cur.tick, cur.col, token)) { message = ''; return true; }
    message = 'No pattern here. Press Enter to insert one.';
    return false;
  };
  // After typing a character: the next character, or the next row after the last one.
  const advance = () => {
    if (cur.ch + 1 < cellWidth()) cur.ch += 1;
    else { cur.ch = 0; moveRow(1); }
  };

  // Returns true if the key was used.
  const typeKey = k => {
    const kind = column().token, old = lanes[cur.lane].rows[cur.tick][cur.col];
    if (kind === 'note') {
      if (cur.ch === 0) {   // first character: a whole note at once
        let next = null;
        if (k === '1') next = '===';
        else if (k === '`') next = '^^^';
        else {
          const n = Object.hasOwn(LOWER, k) ? LOWER[k] : Object.hasOwn(UPPER, k) ? UPPER[k] : null;
          if (n === null) return false;
          try { next = noteToken(octave * 12 + n); } catch { message = 'Note out of range.'; return true; }
        }
        if (write(next)) { cur.ch = 0; moveRow(1); }
        return true;
      }
      // Second and third characters edit a note that is already there.
      let next = null;
      if (cur.ch === 1 && (k === '-' || k === '#')) next = old[0] + k + old[2];
      else if (cur.ch === 2 && /^\d$/.test(k)) next = old.slice(0, 2) + k;
      else return false;
      if (!isNote(old)) { message = 'Only a filled note can be edited by character.'; return true; }
      try { encodeCell(next, 'note'); } catch { message = 'Not a valid note.'; return true; }
      if (write(next)) advance();
      return true;
    }
    if (!/^[0-9a-f]$/.test(k)) return false;
    // An empty cell becomes zeros with this digit in place; a filled cell changes one character.
    const base = isBlank(old) ? '0'.repeat(cellWidth()) : old;
    if (write(base.slice(0, cur.ch) + k.toUpperCase() + base.slice(cur.ch + 1))) advance();
    return true;
  };

  el.addEventListener('keydown', e => {
    if (!lanes || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        const redo = key === 'y' || e.shiftKey;
        const label = redo ? editor.redo() : editor.undo();
        message = label ? `${redo ? 'Redid' : 'Undid'} ${label}.` : `Nothing to ${redo ? 'redo' : 'undo'}.`;
        e.preventDefault();
      }
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const was = [cur.lane, cur.tick];
    let used = true;
    switch (k) {
      case 'ArrowUp': moveRow(-1); break;
      case 'ArrowDown': moveRow(1); break;
      case 'ArrowLeft': moveChar(-1); break;
      case 'ArrowRight': moveChar(1); break;
      case 'Tab': moveLane(e.shiftKey ? -1 : 1); break;
      case 'PageUp': moveRow(-16); break;
      case 'PageDown': moveRow(16); break;
      case 'Home': cur.tick = 0; break;
      case 'End': cur.tick = len - 1; break;
      case ' ': onToggle(); break;
      case '[': octave = Math.max(0, octave - 1); message = `Octave ${octave}`; break;
      case ']': octave = Math.min(9, octave + 1); message = `Octave ${octave}`; break;
      case 'Escape': message = ''; onBack(); break;
      case 'Enter':
        message = editor.insertPattern(cur.lane, cur.tick) ? 'Pattern inserted.' : 'A pattern is already here.';
        break;
      case 'Delete':
      case 'Backspace':
        write(KINDS[column().token].blank);   // clearing does not advance
        break;
      default: used = typeKey(k);
    }
    if (used) e.preventDefault();
    if (onMove && (cur.lane !== was[0] || cur.tick !== was[1])) onMove(cur.lane, cur.tick);   // keep the arrangement in step
  });

  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    const top = Math.max(0, Math.min(cur.tick - 8, len - ROWS));
    const lines = [
      `    ${lanes.map((l, li) => ` ${esc(l.id.padEnd(block(li)))}`).join('  ')}`,
      `    ${lanes.map((l, li) => ` ${l.columns.map((c, ci) => esc(c.label.padEnd(widths[li][ci]))).join(' ')}`).join('  ')}`,
    ];
    for (let t = top; t < Math.min(len, top + ROWS); t++) {
      const chunks = lanes.map((lane, li) => {
        const mark = lane.placements.some(p => p.start === t) ? '▌' : ' ';   // a pattern starts here
        return mark + lane.columns.map((c, ci) => {
          const text = lane.rows[t][ci].padEnd(widths[li][ci]);
          if (li !== cur.lane || ci !== cur.col || t !== cur.tick) return text;
          const at = `<span class="cur">${text[cur.ch]}</span>`;
          return `<span class="cell">${text.slice(0, cur.ch)}${at}${text.slice(cur.ch + 1)}</span>`;
        }).join(' ');
      });
      const row = `${playing && t === playTick ? '>' : ' '}${String(t).padStart(2, '0')} ${chunks.join('  ')}`;
      lines.push(playing && t === playTick ? `<b>${row}</b>` : row);
    }
    el.innerHTML = lines.join('\n');
    statusEl.textContent = [
      lanes[cur.lane].id, `row ${cur.tick}`, column().label, `char ${cur.ch + 1}/${cellWidth()}`,
      `octave ${octave}`, message,
    ].filter(Boolean).join(' · ');
  };

  const goto = (laneIdx, tick) => {
    cur.lane = laneIdx;
    cur.tick = tick;
    cur.col = Math.min(cur.col, lanes[laneIdx].columns.length - 1);
    cur.ch = Math.min(cur.ch, cellWidth() - 1);
    message = '';
  };

  return { draw, load, goto };
}
