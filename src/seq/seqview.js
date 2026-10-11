import { esc } from './html.js';
import { placementAt, puidByIndex, startsAt } from './edit.js';

const WINDOW = 64;   // ticks shown at once
const LABEL = 8;     // characters for the lane name
const hex2 = n => n.toString(16).toUpperCase().padStart(2, '0');

// The arrangement: one line per lane, one character per tick, patterns drawn as blocks
// (a later pattern covers the ones under it, as in the grid). Keyboard-driven.
export function createSequenceView({ el, statusEl, transport, onToggle, onOpen }) {
  let lanes = null, len = 0, editor = null;
  const cur = { lane: 0, tick: 0 };
  let typed = '', message = '';

  const load = ({ lanes: l, song, editor: e }) => {
    lanes = l; len = song.length; editor = e;
    Object.assign(cur, { lane: 0, tick: 0 });
    typed = ''; message = '';
  };

  const lane = () => lanes[cur.lane];
  const moveTick = d => { cur.tick = Math.min(len - 1, Math.max(0, cur.tick + d)); typed = ''; };
  const moveLane = d => { cur.lane = (cur.lane + d + lanes.length) % lanes.length; typed = ''; };
  const here = () => placementAt(lane(), cur.tick);

  // Placing a pattern by its two-digit shorthand; the cursor then jumps to the end of
  // it, so typing pairs of digits lays patterns out one after another.
  const place = index => {
    const puid = puidByIndex(lane(), index);
    if (puid === undefined) { message = `No pattern ${hex2(index)} in ${lane().id}.`; return; }
    if (startsAt(lane(), cur.tick)) { message = 'A pattern already starts here.'; return; }
    const placed = editor.placePattern(cur.lane, cur.tick, puid);
    if (!placed) { message = 'It does not fit here.'; return; }
    message = `Placed ${lane().patterns[puid].name}.`;
    cur.tick = Math.min(len - 1, cur.tick + placed);
  };

  // Each edit reports through the message line; delta moves for ,.<>
  const act = (label, result, ok) => { message = result ? ok : `Can't ${label} here.`; return result; };

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
    const li = cur.lane, t = cur.tick;
    let used = true;
    switch (k) {
      case 'ArrowLeft': moveTick(-1); break;
      case 'ArrowRight': moveTick(1); break;
      case 'ArrowUp': moveLane(-1); break;
      case 'ArrowDown': moveLane(1); break;
      case 'PageUp': moveTick(-16); break;
      case 'PageDown': moveTick(16); break;
      case 'Home': cur.tick = 0; typed = ''; break;
      case 'End': cur.tick = len - 1; typed = ''; break;
      case ' ': onToggle(); break;
      case 'Escape': typed = ''; message = ''; break;
      case 'Enter':   // open the pattern under the cursor in the grid, or start a new one
        if (here()) onOpen(li, t);
        else act('insert a pattern', editor.insertPattern(li, t), 'Pattern inserted.');
        break;
      case 'i': act('insert a pattern', editor.insertPattern(li, t, { overlay: true }), 'Pattern inserted.'); break;
      case 'n': act('clone', editor.clone(li, t), 'Cloned: this placement now has its own copy.'); break;
      case 's': act('slice', editor.slice(li, t), 'Sliced.'); break;
      case '+': case '=': act('extend', editor.resize(li, t, 16), 'Extended.'); break;
      case '-': act('shrink', editor.resize(li, t, -16), 'Shrunk.'); break;
      case '.': case ',': case '>': case '<': {
        const delta = { '.': 1, ',': -1, '>': 16, '<': -16 }[k];
        const moved = editor.move(li, t, delta);
        if (act('move', moved, 'Moved.')) cur.tick = moved.start;
        break;
      }
      case 'Delete': case 'Backspace': act('remove', editor.remove(li, t), 'Removed. The pattern stays in the list.'); break;
      case 'w':
        if (e.shiftKey) message = editor.restoreWaypoint() ? 'Restored the waypoint.' : 'No waypoint set.';
        else { editor.setWaypoint(); message = 'Waypoint set.'; }
        break;
      default:
        if (/^[0-9a-f]$/.test(k)) {
          typed += k.toUpperCase();
          if (typed.length === 2) { place(parseInt(typed, 16)); typed = ''; }
        } else used = false;
    }
    if (used) e.preventDefault();
  });

  const draw = () => {
    if (!lanes) return;
    const playing = Atomics.load(transport, 1) === 1, playTick = Atomics.load(transport, 0);
    const count = Math.min(WINDOW, len);
    const left = Math.max(0, Math.min(cur.tick - 16, len - count));
    const gutter = ' '.repeat(LABEL);

    const head = Array(count).fill(' '), ruler = Array(count).fill(' ');
    if (playing && playTick >= left && playTick < left + count) head[playTick - left] = '▼';
    for (let t = left; t < left + count; t++) {
      if (t % 16 !== 0) continue;
      [...String(t)].forEach((c, i) => { if (t - left + i < count) ruler[t - left + i] = c; });
    }
    const lines = [gutter + head.join(''), gutter + ruler.join('')];

    lanes.forEach((l, li) => {
      let html = '', run = '', runClass = '';
      const flush = () => { if (run) html += runClass ? `<span class="${runClass}">${esc(run)}</span>` : esc(run); run = ''; };
      for (let t = left; t < left + count; t++) {
        const pl = placementAt(l, t);
        let ch = ' ', cls = '';
        if (pl) {
          const pat = l.patterns[pl.puid];
          ch = `▌${hex2(pat.index)} ${pat.name}`[t - pl.start] ?? '·';
          cls = `p${pat.index % 6}`;
        }
        if (li === cur.lane && t === cur.tick) {
          flush(); runClass = '';
          html += `<span class="cur">${esc(ch)}</span>`;
        } else {
          if (cls !== runClass) { flush(); runClass = cls; }
          run += ch;
        }
      }
      flush();
      lines.push(`${li === cur.lane ? '>' : ' '}${esc(l.id.slice(0, LABEL - 2).padEnd(LABEL - 1))}${html}`);
    });

    const pool = Object.values(lane().patterns).sort((a, b) => a.index - b.index)
      .map(p => `${hex2(p.index)} ${esc(p.name)} (${p.length})`).join('  ');
    lines.push('', `${esc(lane().id)} patterns: ${pool || 'none yet'}`);
    const log = editor.log().slice(0, 5).map(esc).join(' < ');
    lines.push(`undo: ${log || 'nothing yet'}${editor.hasWaypoint() ? '   [waypoint set]' : ''}`);
    el.innerHTML = lines.join('\n');

    const owner = here();
    statusEl.textContent = [
      lane().id, `tick ${cur.tick}`,
      owner ? `${hex2(lane().patterns[owner.puid].index)} ${lane().patterns[owner.puid].name}` : 'no pattern',
      typed && `typing ${typed}`, message,
    ].filter(Boolean).join(' · ');
  };

  const goto = (laneIdx, tick) => { cur.lane = laneIdx; cur.tick = tick; typed = ''; };
  return { draw, load, goto };
}
