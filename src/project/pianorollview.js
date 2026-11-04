// The piano roll overlay of the sample display (waveform.js draws the sample, this draws on top of it and takes the mouse
// while the roll is on). The roll's data and maths are in pianoroll.js; this file is only drawing and mouse handling.
//
// Pitch runs up the display from the roll's `lo` note at the bottom edge to `hi` at the top, the same axis the spectrogram uses
// while the roll is on, so a note bar sits on the line of the partial it stands for. Time is the display's own axis.
//
//   top ruler    the row numbers, with the S and E markers of the virtual pattern: drag a marker to move it;
//                press on a row to hear the chord sounding in it (held while the button is)
//   key strip    the note names down the left edge: press a key to hear that pitch; the wheel scrolls the pitch range
//                (Shift: an octave at a time), Ctrl+wheel zooms it
//   body         drag on empty space to draw a note, drag a note to move it (in time and pitch), drag its right end to
//                lengthen or shorten it, right click a note to remove it; a click on a note plays it.
//                Snap moves notes to the row lines; Shift does the opposite of the snap setting while it is held.
//   overtones    each note's 2nd to 8th partials as dashed lines in the note's colour; hovering a pitch that one of them
//                explains says so ("≈ 3× C-3"), so you can tell a real note from stacked overtones
import { addNote, replaceNote, removeNote, noteAt, notesAtRow, overtoneOf, hzOf, rowFrame, rowAt, snapFrame, noteLabel } from './pianoroll.js';

const RULER = 13, KEYS = 30, GRAB = 6, EDGE = 5;
const BLACK = new Set([1, 3, 6, 8, 10]);
const hueOf = midi => (((midi % 12) + 12) % 12) * 30;   // one colour per pitch class: a note and its overtones share it

export function createPianoRollOverlay({ getSample, getSettings, onChange, onPlay, onStop }) {
  // getSettings(): { on, snap, overtones }; onChange(roll) stores a new roll; onPlay(midis) sounds notes until onStop()
  let drag = null, hover = null, history = [], future = [];
  const roll = () => getSample()?.roll ?? null;
  const active = () => !!(getSettings().on && roll());

  // ---- the axes, from the display's own (view: { W, H, frameToX, xToFrame }) ----
  const span = r => r.hi - r.lo;
  const yOf = (r, v, midi) => ((r.hi - midi) / span(r)) * v.H;
  const midiAt = (r, v, y) => r.hi - (y / v.H) * span(r);
  const snapping = e => getSettings().snap !== !!e.shiftKey;

  const commit = next => {
    const now = roll();
    if (!now || next === now) return;
    history.push(now); if (history.length > 200) history.shift();
    future = [];
    onChange(next);
  };

  // Ctrl+Z / Ctrl+Y while the roll is on (sample screen). Returns whether there was a step to take.
  function undo(redo = false) {
    const from = redo ? future : history, to = redo ? history : future;
    if (!active() || !from.length) return false;
    to.push(roll());
    onChange(from.pop());
    return true;
  }

  // ---- drawing ----
  function draw(ctx, v) {
    const r = roll();
    if (!active() || !r) return;
    const { W, H } = v, set = getSettings();
    ctx.save();
    ctx.font = '10px ui-monospace, Consolas, monospace';
    // outside the virtual pattern: dimmed
    const xs = v.frameToX(r.start), xe = v.frameToX(r.end);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    if (xs > 0) ctx.fillRect(0, 0, xs, H);
    if (xe < W) ctx.fillRect(xe, 0, W - xe, H);
    // pitch lines: every C, and every semitone when there is room for them
    const band = v.H / span(r);
    for (let m = Math.ceil(r.lo); m <= r.hi; m++) {
      const y = Math.round(yOf(r, v, m + 0.5)) + 0.5;
      if (m % 12 === 0) { ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'; ctx.fillRect(KEYS, Math.round(yOf(r, v, m - 0.5)), W - KEYS, 1); }
      else if (band >= 6) { ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.fillRect(KEYS, y, W - KEYS, 1); }
    }
    // the row lines between the markers; every fourth a little brighter
    for (let row = 0; row <= r.rows; row++) {
      const x = Math.round(v.frameToX(rowFrame(r, row)));
      if (x < -1 || x > W + 1) continue;
      ctx.fillStyle = row === 0 || row === r.rows ? 'rgba(255, 215, 90, 0.9)' : row % 4 === 0 ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.11)';
      ctx.fillRect(x, row === 0 || row === r.rows ? 0 : RULER, 1, H);
    }
    // the overtones of every note (under the notes): a dashed line 3 px thick with a dark rim round it, so it reads on a pale spectrogram and on
    // a bright pink one alike; the harmonic number beside it has the same dark outline
    if (set.overtones) {
      ctx.lineJoin = 'round';
      for (const n of r.notes) {
        const a = Math.max(KEYS, v.frameToX(n.from)), b = Math.min(W, v.frameToX(n.to));
        if (b <= a) continue;
        for (let h = 2; h <= 8; h++) {
          const m = n.midi + 12 * Math.log2(h);
          if (m > r.hi) break;
          const y = Math.round(yOf(r, v, m)) + 0.5, fade = 0.95 - h * 0.05;
          ctx.setLineDash([6, 3]);
          ctx.strokeStyle = `rgba(8, 10, 16, ${fade * 0.85})`; ctx.lineWidth = 5;   // the rim
          ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke();
          ctx.strokeStyle = `hsla(${hueOf(n.midi)} 95% 78% / ${fade})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke();
          if (b - a > 18) {
            ctx.setLineDash([]); ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)'; ctx.strokeText(`${h}`, a + 2, y - 2);
            ctx.fillStyle = `hsl(${hueOf(n.midi)} 95% 85%)`; ctx.fillText(`${h}`, a + 2, y - 2);
          }
        }
      }
      ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    // the notes: a translucent bar with a bright top edge, the name at its start when there is room
    const shown = drag?.preview ? drag.preview : r.notes;
    shown.forEach((n, i) => {
      const a = v.frameToX(n.from), b = v.frameToX(n.to), c = yOf(r, v, n.midi), half = Math.max(2.5, band / 2), y0 = c - half, y1 = c + half;   // at least 5 px tall, however many notes the range shows
      if (b < KEYS || a > W) return;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';   // a dark rim, so the bar stands out on a bright spectrogram
      ctx.fillRect(a - 1, y0 - 1, Math.max(2, b - a) + 2, y1 - y0 + 2);
      const hot = (drag?.preview && i === drag.index) || (!drag && hover?.note === i);
      ctx.fillStyle = `hsla(${hueOf(n.midi)} 75% 62% / ${hot ? 0.75 : 0.5})`;
      ctx.fillRect(a, y0, Math.max(2, b - a), Math.max(2, y1 - y0));
      ctx.fillStyle = `hsl(${hueOf(n.midi)} 90% ${hot ? 88 : 78}%)`;
      ctx.fillRect(a, y0, Math.max(2, b - a), 1);
      ctx.fillRect(a, y0, 1, Math.max(2, y1 - y0));
      if (b - a > 26 && y1 - y0 >= 9) { ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(noteLabel(n.midi), a + 3, (y0 + y1) / 2 + 0.5); }
    });
    // the hovered pitch: its overtones (dotted) and what it may be an overtone of
    if (hover?.body && !drag) {
      const m = Math.round(hover.midi), y0 = yOf(r, v, m + 0.5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(KEYS, y0, W - KEYS, band);
      if (set.overtones) {
        ctx.setLineDash([1, 3]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        for (let h = 2; h <= 8; h++) { const hm = m + 12 * Math.log2(h); if (hm > r.hi) break; const y = Math.round(yOf(r, v, hm)) + 0.5; ctx.beginPath(); ctx.moveTo(hover.x - 40, y); ctx.lineTo(hover.x + 40, y); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      const ot = overtoneOf(r, hover.frame, m);
      const text = `${noteLabel(m)}  ${hzOf(r, m).toFixed(1)} Hz${ot ? `   ≈ ${ot.harmonic}× ${noteLabel(ot.note.midi)} (${ot.off >= 0 ? '+' : ''}${Math.round(ot.off)}¢)` : ''}`;
      const tw = ctx.measureText(text).width + 8, tx = Math.min(W - tw - 2, hover.x + 12), ty = Math.max(RULER + 2, y0 - 16);
      ctx.fillStyle = ot ? 'rgba(120, 40, 20, 0.9)' : 'rgba(10, 14, 20, 0.85)';
      ctx.fillRect(tx, ty, tw, 13);
      ctx.fillStyle = ot ? '#ffd2b8' : '#e8eef5'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(text, tx + 4, ty + 7);
    }
    // the key strip down the left edge
    ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
    ctx.fillRect(0, 0, KEYS, H);
    for (let m = Math.ceil(r.lo); m <= r.hi; m++) {
      const y0 = yOf(r, v, m + 0.5), y1 = yOf(r, v, m - 0.5);
      if (BLACK.has(m % 12)) { ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; ctx.fillRect(0, y0, KEYS * 0.6, y1 - y0); }
      if (drag?.kind === 'key' && drag.midi === m) { ctx.fillStyle = 'rgba(255, 215, 90, 0.6)'; ctx.fillRect(0, y0, KEYS, y1 - y0); }
      if (m % 12 === 0 || (band >= 11 && !BLACK.has(m % 12))) {
        ctx.fillStyle = m % 12 === 0 ? '#e8eef5' : 'rgba(232, 238, 245, 0.55)'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
        ctx.fillText(noteLabel(m), KEYS - 3, (y0 + y1) / 2 + 0.5);
      }
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; ctx.fillRect(KEYS, 0, 1, H);
    // the ruler: row numbers in hex, the row being heard, and the S and E markers
    ctx.fillStyle = 'rgba(10, 14, 20, 0.78)'; ctx.fillRect(KEYS + 1, 0, W - KEYS - 1, RULER);
    const rowW = v.frameToX(rowFrame(r, 1)) - v.frameToX(rowFrame(r, 0)), every = rowW >= 16 ? 1 : rowW >= 8 ? 2 : rowW >= 4 ? 4 : 16;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (let row = 0; row < r.rows; row++) {
      const x = v.frameToX(rowFrame(r, row));
      if (x < KEYS || x > W) continue;
      if (drag?.kind === 'row' && drag.row === row) { ctx.fillStyle = 'rgba(255, 215, 90, 0.45)'; ctx.fillRect(x, 0, Math.max(2, rowW), RULER); }
      if (row % every === 0) { ctx.fillStyle = row % 4 === 0 ? '#e8eef5' : 'rgba(232, 238, 245, 0.55)'; ctx.fillText(row.toString(16).toUpperCase().padStart(2, '0'), x + 2, 1); }
    }
    ctx.fillStyle = 'rgb(255, 215, 90)';
    for (const [x, label] of [[xs, 'S'], [xe, 'E']]) {
      if (x < -2 || x > W + 2) continue;
      ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 6); ctx.closePath(); ctx.fill();
      ctx.textAlign = label === 'S' ? 'left' : 'right'; ctx.fillText(label, x + (label === 'S' ? 5 : -5), RULER + 1);
    }
    ctx.restore();
  }

  // ---- the mouse ----
  // Where a point is: the ruler, the key strip or the body, with its frame, pitch and the note under it.
  const locate = (v, x, y) => {
    const r = roll(), frame = v.xToFrame(x), midi = midiAt(r, v, y), m = Math.round(midi);
    const note = noteAt(r, frame, m);
    const n = r.notes[note];
    return { x, y, frame, midi, m, note, edge: n ? Math.abs(x - v.frameToX(n.to)) <= EDGE : false, ruler: y < RULER && x >= KEYS, keys: x < KEYS, body: y >= RULER && x >= KEYS };
  };
  const stop = () => onStop();

  // Returns whether the overlay took the press (then waveform.js leaves it alone).
  function down(e, v) {
    if (!active() || (e.button ?? 0) !== 0 || e.altKey) return false;
    const r = roll(), at = locate(v, e.offsetX, e.offsetY);
    if (at.y < RULER) {   // the markers can be grabbed over the key strip too (S sits at its edge when it is on the first frame)
      const xs = v.frameToX(r.start), xe = v.frameToX(r.end);
      if (Math.abs(at.x - xs) <= GRAB) { drag = { kind: 'marker', which: 'start', before: r }; return true; }
      if (Math.abs(at.x - xe) <= GRAB) { drag = { kind: 'marker', which: 'end', before: r }; return true; }
    }
    if (at.ruler) {
      const row = Math.floor(rowAt(r, at.frame));
      if (row >= 0 && row < r.rows) { drag = { kind: 'row', row }; const notes = notesAtRow(r, row); if (notes.length) onPlay(notes.map(n => n.midi)); }
      return true;
    }
    if (at.keys) { drag = { kind: 'key', midi: at.m }; onPlay([at.m]); return true; }
    if (at.note >= 0) {
      const n = r.notes[at.note];
      drag = { kind: at.edge ? 'resize' : 'move', index: at.note, orig: n, grab: at.frame - n.from, grabMidi: at.m, moved: false, preview: null, sounding: n.midi };
      onPlay([n.midi]);
      return true;
    }
    const from = snapping(e) ? rowFrame(r, Math.floor(rowAt(r, at.frame))) : at.frame;   // snapping: the start of the row clicked in
    drag = { kind: 'draw', anchor: from, midi: at.m, preview: null, index: r.notes.length, sounding: at.m };
    onPlay([at.m]);
    return true;
  }

  function move(e, v) {
    if (!active()) { hover = null; return false; }
    const r = roll(), at = locate(v, e.offsetX, e.offsetY);
    hover = drag ? null : at;
    if (!drag) return false;
    const snap = snapping(e), frames = getSample().data.length;
    const sounding = midi => { if (midi !== drag.sounding) { onStop(); onPlay([midi]); drag.sounding = midi; } };
    if (drag.kind === 'marker') {
      const f = Math.max(0, Math.min(frames, at.frame));
      onChange(drag.which === 'start' ? { ...r, start: Math.min(f, r.end - 1) } : { ...r, end: Math.max(f, r.start + 1) });   // shown at once; one undo step once let go
    } else if (drag.kind === 'move') {
      const len = drag.orig.to - drag.orig.from;
      let from = at.frame - drag.grab;
      if (snap) from = snapFrame(r, from);
      const midi = Math.max(0, Math.min(127, drag.orig.midi + (at.m - drag.grabMidi)));
      drag.moved = drag.moved || from !== drag.orig.from || midi !== drag.orig.midi;
      drag.preview = replaceNote(r, drag.index, { from: Math.max(0, from), to: Math.max(0, from) + len, midi }).notes;
      drag.index = drag.preview.findIndex(n => n.from === Math.max(0, from) && n.midi === midi);
      sounding(midi);
    } else if (drag.kind === 'resize') {
      let to = snap ? snapFrame(r, at.frame) : at.frame;
      to = Math.max(drag.orig.from + 1, to);
      drag.moved = true;
      drag.preview = replaceNote(r, drag.index, { ...drag.orig, to }).notes;
      drag.index = drag.preview.indexOf(drag.preview.find(n => n.from === drag.orig.from && n.midi === drag.orig.midi && n.to === to));
    } else if (drag.kind === 'draw') {
      let to = snap ? snapFrame(r, at.frame) : at.frame;
      const a = Math.min(drag.anchor, to), b = Math.max(drag.anchor, to);
      drag.preview = addNote(r, { from: a, to: b, midi: drag.midi }).notes;
      drag.index = drag.preview.findIndex(n => n.from === a && n.midi === drag.midi && n.to === Math.max(a + 1, b));
    } else if (drag.kind === 'row') {
      const row = Math.floor(rowAt(r, at.frame));
      if (row !== drag.row && row >= 0 && row < r.rows) { onStop(); drag.row = row; const notes = notesAtRow(r, row); if (notes.length) onPlay(notes.map(n => n.midi)); }
    } else if (drag.kind === 'key') {
      if (at.m !== drag.midi) { onStop(); drag.midi = at.m; onPlay([at.m]); }
    }
    return true;
  }

  function up() {
    const d = drag;
    drag = null;
    if (!d) return false;
    stop();
    const r = roll();
    if (!r) return true;
    if (d.kind === 'marker') { if (r !== d.before) { history.push(d.before); future = []; } return true; }
    if ((d.kind === 'move' || d.kind === 'resize') && d.moved && d.preview) commit({ ...r, notes: d.preview });
    else if (d.kind === 'draw') {
      if (d.preview && d.preview.length > r.notes.length && (d.preview[d.index]?.to ?? 0) - (d.preview[d.index]?.from ?? 0) > 1) commit({ ...r, notes: d.preview });
      else {   // a click without a drag: a note one row long (from the row line when snapping)
        const len = Math.max(1, rowFrame(r, 1) - rowFrame(r, 0));
        commit(addNote(r, { from: d.anchor, to: d.anchor + len, midi: d.midi }));
      }
    }
    return true;
  }

  // The wheel over the key strip: scrolls the pitch range a semitone (Shift: an octave); Ctrl+wheel zooms it about the pitch
  // under the mouse. Returns whether it took the wheel.
  function wheel(e, v) {
    const r = roll();
    if (!active() || e.offsetX >= KEYS) return false;
    const dir = e.deltaY > 0 ? -1 : 1;
    let lo = r.lo, hi = r.hi;
    if (e.ctrlKey) {
      const at = midiAt(r, v, e.offsetY), k = dir > 0 ? 0.8 : 1.25, span2 = Math.max(12, Math.min(108, Math.round((hi - lo) * k)));
      lo = Math.round(at - (at - lo) * span2 / (hi - lo)); hi = lo + span2;
    } else { const step = e.shiftKey ? 12 : 1; lo += dir * step; hi += dir * step; }
    if (lo < 12) { hi += 12 - lo; lo = 12; }
    if (hi > 120) { lo -= hi - 120; hi = 120; }
    onChange({ ...r, lo: Math.max(12, lo), hi });
    return true;
  }

  // Right click: a note under the mouse goes. Returns whether it took the click.
  function menu(e, v) {
    if (!active()) return false;
    const at = locate(v, e.offsetX, e.offsetY);
    if (!at.body || at.note < 0) return false;
    commit(removeNote(roll(), at.note));
    return true;
  }

  const cursor = () => {
    if (!active()) return null;
    if (drag?.kind === 'marker' || drag?.kind === 'resize' || hover?.edge) return 'col-resize';
    if (drag?.kind === 'move') return 'grabbing';
    if (hover?.note >= 0) return 'grab';
    return hover?.body ? 'crosshair' : 'default';
  };

  // what the display's cache key needs to know so it draws again when any of this changes
  const key = () => {
    const r = roll(), set = getSettings();
    if (!active()) return 'off';
    return `${r.start}.${r.end}.${r.rows}.${r.lo}.${r.hi}.${r.a4}.${r.cents}:${r.notes.length}:${r.notes.map(n => `${n.from}/${n.to}/${n.midi}`).join(',')}:${set.overtones}:${hover ? `${hover.x}.${hover.y}` : ''}:${drag ? `${drag.kind}.${drag.row ?? ''}.${drag.midi ?? ''}.${drag.preview ? drag.preview.map(n => `${n.from}/${n.to}/${n.midi}`).join(',') : ''}` : ''}`;
  };
  // the pitch axis the spectrogram should use while the roll is on, or null
  const pitch = () => { const r = roll(); return active() ? { lo: r.lo, hi: r.hi, hzOf: m => hzOf(r, m), sig: `${r.lo}.${r.hi}.${r.a4}.${r.cents}` } : null; };
  const leave = () => { if (!drag) hover = null; };
  const forget = () => { history = []; future = []; drag = null; hover = null; };

  return { active, draw, down, move, up, menu, wheel, cursor, key, pitch, leave, undo, forget, commit, get dragging() { return !!drag; } };
}
