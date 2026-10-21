import { noteToken, KINDS } from './cells.js';
import { placementAt } from './edit.js';
import { unscale } from './describe.js';

// Getting played notes into patterns, for the MIDI keyboard. Two ways in, both writing through the editor:
//
// Step entry (stepOn / stepOff): a note, or a chord, goes in at the cursor. The first key starts a chord; keys that follow
// it join it (within `window` ms of the first, or, in 'held' mode, while any key of the chord is still down) and go into the
// next note columns, N1 N2 N3 from the lowest note to the highest (the chord is rewritten in order as each key joins), or in
// the order they were pressed when settings().order is 'played'. The cursor does not move: the caller moves it when stepOff
// says the chord has ended and the 'advance' setting asks for it.
//
// Recording (recOn / recOff): while the song plays, a note goes into the pattern under the playhead on the nearest tick
// (`pos` is the position in ticks, with the output latency already taken off). Notes that land on one tick fill the
// columns in turn; a monophonic lane steals its one column. Letting a key go writes a note off (===) on its tick, unless
// that is the same tick, a pass is not set to write them, or the cell is taken (a new note is a note off anyway). A pass,
// from arming to stopping, is one undo step.
//
// Parameter moves (recParam): while recording, a slider moved in the floating window or the graph writes its value into the
// lane's column for that parameter, or else into its Cmd column as CCXXYY, on the nearest tick (every `paramStep`th row if
// that is more than 1). The same cell is rewritten as the slider keeps moving, so the last value of a tick stays; the pass's
// undo step covers these too.
//
// A pattern that several placements share is only written to when settings().shared is 'write'.
const HEX = '0123456789ABCDEF';
const hex2 = n => HEX[n >> 4] + HEX[n & 15];

export const noteColumnsOf = lane => lane.columns.flatMap((c, i) => (c.token === 'note' ? [i] : []));

// The tick a position in ticks falls on: the nearest, wrapped into the loop (or the song).
export function quantize(pos, loop, length) {
  const lo = loop ? loop.start : 0, hi = loop ? loop.end : length, n = Math.max(1, hi - lo);
  const q = Math.round(pos);
  return q >= lo && q < hi ? q : lo + (((q - lo) % n) + n) % n;
}

export function createMidiWriter({ lanes, editor, length, loop, settings, say = () => {} }) {
  let chord = null, chordId = 0, pass = 0;
  const voices = new Map();   // recording: midi note -> { li, col, tick }
  const lastParam = new Map();   // recording a slider: lane:column -> the last tick:token written

  const target = (li, tick) => {
    const lane = lanes()[li], pl = lane && placementAt(lane, tick);
    if (!pl) return { error: 'No pattern here.' };
    const sharing = lane.placements.filter(p => p.puid === pl.puid).length;
    if (sharing > 1 && settings().shared === 'ask') return { error: `This pattern is used ${sharing} times: clone it first (G), or let MIDI write into shared patterns in Config.` };
    return { lane, pl };
  };
  const cellItems = (lane, tick, col, midi, vel) => {
    const items = [{ tick, col, token: noteToken(midi - 12) }];   // a written C-4 is MIDI 60
    const v = lane.columns[col + 1]?.kind === 'vel';
    if (settings().velocity && v) items.push({ tick, col: col + 1, token: hex2(Math.max(1, Math.min(255, Math.round((vel / 127) * 255)))) });
    return items;
  };
  const put = (li, items, label, key) => editor().setCells(li, items, label, key);

  return {
    // ---- step entry ----
    stepOn({ li, tick, col, midi, vel = 100, time }) {
      const lane = lanes()[li];
      if (!lane) return { wrote: false };
      const cols = noteColumnsOf(lane), start = cols.indexOf(col), s = settings();
      const joins = chord && chord.li === li && (s.chord === 'held' ? chord.keys.size > 0 : time - chord.t0 <= s.window);
      if (!joins) {
        if (start < 0) return { wrote: false };
        chord = { id: ++chordId, li, tick, t0: time, start, notes: [], keys: new Set(), wrote: false };
      }
      chord.keys.add(midi);
      if (chord.start + chord.notes.length >= cols.length) return { wrote: false, message: 'More notes than note columns in this lane.' };
      chord.notes.push({ midi, vel });
      if (s.order !== 'played') chord.notes.sort((x, y) => x.midi - y.midi);   // lowest first: N1 is the bottom of the chord
      const t = target(li, chord.tick);
      if (t.error) { chord.notes = chord.notes.filter(n => n.midi !== midi); return { wrote: false, message: t.error }; }
      try {
        const items = chord.notes.flatMap((n, k) => cellItems(lane, chord.tick, cols[chord.start + k], n.midi, n.vel));
        put(li, items, 'midi entry', `midi:${chord.id}`);
      } catch { chord.notes = chord.notes.filter(n => n.midi !== midi); return { wrote: false, message: 'Note out of range.' }; }
      chord.wrote = true;
      return { wrote: true };
    },
    // Returns { ended: true, li, tick } when this was the last key of a chord that wrote something.
    stepOff({ midi }) {
      if (!chord || !chord.keys.delete(midi) || chord.keys.size > 0 || !chord.wrote) return { ended: false };
      return { ended: true, li: chord.li, tick: chord.tick };
    },

    // ---- recording ----
    beginPass() { pass++; voices.clear(); lastParam.clear(); },
    endPass() { voices.clear(); },
    recOn({ li, midi, vel = 100, pos }) {
      const tick = quantize(pos, loop(), length());
      const t = target(li, tick);
      if (t.error) return { wrote: false, message: t.error };
      const cols = noteColumnsOf(t.lane);
      if (!cols.length) return { wrote: false, message: 'No note column in this lane.' };
      const held = [...voices.values()].filter(v => v.li === li).map(v => v.col);
      let col = cols.find(c => !held.includes(c));
      if (col === undefined) {   // every column is holding a key: the oldest one gives way
        const oldest = [...voices.entries()].find(([, v]) => v.li === li);
        col = oldest[1].col;
        voices.delete(oldest[0]);
      }
      try {
        put(li, cellItems(t.lane, tick, col, midi, vel), 'midi recording', `rec:${pass}`);
      } catch { return { wrote: false, message: 'Note out of range.' }; }
      voices.set(midi, { li, col, tick });
      return { wrote: true, tick };
    },
    // Returns { wrote, tick } or { wrote: false, message } (no column or command for it, or no pattern there).
    recParam({ li, node, param, value, pos }) {
      const lane = lanes()[li];
      if (!lane || !Number.isFinite(value)) return { wrote: false };
      const step = Math.max(1, Math.round(settings().paramStep ?? 1));
      const lo = loop() ? loop().start : 0;
      const tick = quantize(Math.round((pos - lo) / step) * step + lo, loop(), length());
      const t = target(li, tick);
      if (t.error) return { wrote: false, message: t.error };
      const hex = (n, w) => Math.round(n).toString(16).toUpperCase().padStart(w, '0');
      let col = lane.columns.findIndex(c => c.kind === 'param' && c.node === node && c.param === param), token;
      if (col >= 0) {
        const c = lane.columns[col];
        token = hex(unscale(c, c.denom, value), KINDS[c.token].width);
      } else {
        col = lane.columns.findIndex(c => c.kind === 'cmd' && c.commands.some(x => x.node === node && x.param === param && x.slot >= 0 && !Number.isFinite(x.fixed)));
        if (col < 0) return { wrote: false, message: `${lane.instrument}: ${param} has no column or command to record into.` };
        const cmd = lane.columns[col].commands.find(x => x.node === node && x.param === param && x.slot >= 0 && !Number.isFinite(x.fixed));
        token = `${hex(cmd.id, 2)}${hex(unscale(cmd, 65535, value), 4)}`;
      }
      const key = `${li}:${col}:${tick}`;
      if (lastParam.get(`${li}:${col}`) === `${tick}:${token}`) return { wrote: true, tick };   // the same cell again
      lastParam.set(`${li}:${col}`, `${tick}:${token}`);
      put(li, [{ tick, col, token }], 'parameter recording', `rec:${pass}`);
      return { wrote: true, tick, key };
    },
    recOff({ midi, pos }) {
      const v = voices.get(midi);
      if (!v) return { wrote: false };
      voices.delete(midi);
      if (!settings().offs) return { wrote: false };
      const tick = quantize(pos, loop(), length());
      if (tick <= v.tick) return { wrote: false };
      const t = target(v.li, tick);
      if (t.error || t.lane.patterns[t.pl.puid].rows[tick - t.pl.start][v.col] !== '...') return { wrote: false };
      put(v.li, [{ tick, col: v.col, token: '===' }], 'midi recording', `rec:${pass}`);
      return { wrote: true, tick };
    },
  };
}
