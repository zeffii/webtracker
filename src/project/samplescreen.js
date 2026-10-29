import * as config from '../ui/config.js';
import { detectOnsets } from './onsets.js';
import { setLoop, setSampleProps, setSlices, placeHex, SAMPLE_PROPS, removeSample, renameSample, isPool } from './ops.js';
import { applyEdit, createHistory, redoEdit, undoEdit } from './sampleedit.js';
import { LOWER, UPPER } from '../seq/piano.js';

// The sample screen (F2): a list of the project's samples on the left and, for the one selected, its
// information, loops, levels and display switch on the right, drawn as monospace text like the pattern
// and arrangement views. The waveform / spectrogram below it is a separate canvas (waveform.js).
//
// Keys. In the list: Up/Down/PgUp/PgDn/Home/End choose a sample; Tab, Right or Enter go to its fields;
// the piano keys (as in the pattern view; [ and ] change the octave) play the sample while held, with
// no instrument or effects, only its own volume, global volume and pan; Space plays it at its root note;
// L loads files; Delete removes it. Shift+C or T trim (keep the selection, else the loop region), X cut, S silence, R reverse, N normalise, I fade in,
// O fade out, Shift+Z zooms the display to the selection, Shift+A out, Shift+W to the whole sample (Ctrl+wheel on it too); D remove DC offset and B bake the loop crossfades act on the selection (the Select field
// or Shift+drag on the display), or on the whole sample when nothing is selected; Ctrl+Z / Ctrl+Y undo and redo. In the fields: Tab/Down and Shift+Tab/Up
// move between them, Esc goes back to the list; Left/Right or -/+ change the value (Shift is a bigger step,
// Ctrl a much bigger one); digits type a value and Enter sets it (Enter on a field starts editing it).
// Every parameter, slider or number, answers to the same keys.

const LIST_ROWS = 13, LEFT = 54, NAMEW = 20;
const FIELDS = ['name', 'loopOn', 'loopBeg', 'loopEnd', 'loopXf', 'loopHide', 'susOn', 'susBeg', 'susEnd', 'susXf', 'susHide', 'selBeg', 'selEnd', 'selHide', 'volume', 'globalVolume', 'pan', 'view'];
const SLIDERS = { volume: 'Default volume', globalVolume: 'Global volume', pan: 'Default pan' };
const SWITCH = ['loopOn', 'susOn', 'loopHide', 'susHide', 'selHide', 'view'];   // fields that are switches: Space, Enter and a click flip them
const LOOP_FIELDS = { loopOn: 'loop', loopBeg: 'loop', loopEnd: 'loop', loopXf: 'loop', susOn: 'sus', susBeg: 'sus', susEnd: 'sus', susXf: 'sus' };   // (loopHide and susHide are switches of their own, not numbers)

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const seg = (text, cls, at = '') => ({ t: text.length, h: cls || at ? `<span${cls ? ` class="${cls}"` : ''}${at}>${esc(text)}</span>` : esc(text) });
const line = (...segs) => segs.map(s => (typeof s === 'string' ? seg(s) : s)).reduce((a, s) => ({ t: a.t + s.t, h: a.h + s.h }), { t: 0, h: '' });
const padTo = (l, n) => l.h + ' '.repeat(Math.max(0, n - l.t));
const PIANO = { ...LOWER, ...UPPER };
const EDITS = { C: 'crop', T: 'crop', X: 'cut', S: 'silence', R: 'reverse', N: 'normalise', I: 'fadeIn', O: 'fadeOut', D: 'removeDc', B: 'bakeCrossfade' };
const ROOT = 60;
const round2 = v => Math.round(v * 100) / 100;

export function createSampleScreen({ el, statusEl, getProject, onChange = () => {}, onSelect = () => {}, onRemove = () => {}, onRename = () => {}, onNote = () => {}, onLoad = () => {}, onReplace = () => {}, onKeep = () => {}, onView = () => {}, onSelection = () => {}, onSlice = () => {}, onZoom = () => '', onAutoSlice = null, onChords = null, onEdited = () => {} }) {
  let sel = null, focus = 'list', edit = null, mode = 'wave', announced = null, last = null, top = 0;
  let selFrom = 0, selTo = 0, octave = 5, activeSlice = -1;   // the slice marker + and - move
  const held = new Map();   // key -> note it is playing
  const history = createHistory();
  const say = text => { if (statusEl) statusEl.textContent = text; };
  // the normal samples, then the tap pool slots that hold a take (empty ones stay out of the list)
  const ids = () => { const all = Object.entries(getProject().samples); return [...all.filter(([id]) => !isPool(id)), ...all.filter(([id, s]) => isPool(id) && s.taken)].map(([id]) => id); };
  const sample = () => (sel ? getProject().samples[sel] : undefined);
  const attempt = fn => {
    try { const users = fn(); say(''); if (users) onChange(users); return true; } catch (err) { say(err.message); return false; }
  };
  const loopKeys = p => [`${p}Start`, `${p}End`, `${p}On`, `${p}Xfade`];

  // ---- the value of each field ----
  const frameValue = (s, field) => {
    if (field === 'selBeg') return selFrom;
    if (field === 'selEnd') return selTo;
    const p = LOOP_FIELDS[field], [sk, ek, , xk] = loopKeys(p);
    return field.endsWith('Beg') ? s[sk] ?? 0 : field.endsWith('End') ? s[ek] ?? 0 : s[xk] ?? 0;
  };
  const isOn = (s, p) => (s[`${p}End`] ?? 0) > 0 && s[`${p}On`] !== false;

  // Sets a field to a value (clamped to what makes sense). Returns whether it took.
  function setField(field, value) {
    const s = sample(), project = getProject(), n = s.data.length;
    if (field in SLIDERS) {
      const spec = SAMPLE_PROPS[field];
      return attempt(() => setSampleProps(project, sel, { [field]: round2(Math.min(spec.max, Math.max(spec.min, value))) }));
    }
    if (field === 'selBeg' || field === 'selEnd') { setSel(field, value); return true; }
    const p = LOOP_FIELDS[field];
    const [sk, ek, ok, xk] = loopKeys(p);
    const has = (s[ek] ?? 0) > 0;
    if (field.endsWith('Beg')) {
      const end = has ? s[ek] : n;
      return attempt(() => setLoop(project, sel, Math.min(Math.max(0, Math.round(value)), end - 2), end, p));
    }
    if (field.endsWith('End')) {
      if (value < 1) return attempt(() => setLoop(project, sel, 0, 0, p));   // 0 means no loop
      const beg = has ? s[sk] : 0;
      return attempt(() => setLoop(project, sel, beg, Math.min(Math.max(Math.round(value), beg + 2), n), p));
    }
    return attempt(() => setSampleProps(project, sel, { [xk]: Math.min(Math.max(0, Math.round(value)), n) }));
  }

  const setActive = i => { activeSlice = i; onSlice(i); };
  // Moves the current slice marker by some frames; it keeps its number only while it stays between its neighbours.
  function nudgeSlice(delta) {
    const s = sample(), slices = s.slices ?? [];
    if (!slices.length) return;
    const i = Math.min(Math.max(activeSlice, 0), slices.length - 1);
    const to = Math.min(Math.max(slices[i] + delta, 0), s.data.length - 1);
    if (to === slices[i]) return;
    if (slices.includes(to)) { say('Another marker is already there.'); return; }
    if (attempt(() => setSlices(getProject(), sel, slices.map((f, k) => (k === i ? to : f))))) setActive(sample().slices.indexOf(to));
  }

  function setSelection(from, to) {
    selFrom = from; selTo = to;
    onSelection(from, to);
  }
  function setSel(field, v) {
    const n = sample().data.length;
    if (field === 'selBeg') {
      const from = Math.min(Math.max(0, Math.round(v)), n - 1);
      setSelection(from, selTo > from ? selTo : n);
    } else if (v < 1) setSelection(0, 0);   // an end of 0 selects nothing, so edits take the whole sample
    else {
      const to = Math.min(Math.max(1, Math.round(v)), n);
      setSelection(Math.min(selFrom, to - 1), to);
    }
  }

  function runEdit(tool) {
    const range = selTo > selFrom ? { from: selFrom, to: selTo } : null;
    if (attempt(() => applyEdit(getProject(), sel, history, tool, range))) {
      onEdited();
      if (tool === 'crop' || tool === 'cut') setSelection(0, 0);
      else if (selTo > sample().data.length) setSelection(0, 0);
    }
  }

  // The edit menu on the waveform (right click) calls these.
  const undoRedo = redo => {
    if (sel && attempt(() => (redo ? redoEdit : undoEdit)(getProject(), sel, history))) {
      onEdited();
      if (selTo > sample().data.length) setSelection(0, 0);
    }
  };
  const markSlice = at => {
    const s = sample();
    if (!s) return;
    const f = Math.max(0, Math.min(at, s.data.length - 1));
    if (attempt(() => setSlices(getProject(), sel, [...(s.slices ?? []), f]))) setActive(sample().slices.indexOf(f));
  };

  function toggle(field) {
    const s = sample(), project = getProject();
    if (field === 'loopHide' || field === 'susHide' || field === 'selHide') { const key = { loopHide: 'waveHideLoop', susHide: 'waveHideSus', selHide: 'waveHideSel' }[field]; config.set(key, !config.get(key)); return; }
    if (field === 'view') {
      mode = mode === 'wave' ? 'spec' : 'wave';
      onView(mode);
      return;
    }
    const p = LOOP_FIELDS[field], [, ek, ok] = loopKeys(p);
    if (!(s[ek] > 0)) attempt(() => { setLoop(project, sel, 0, s.data.length, p); return setSampleProps(project, sel, { [ok]: true }); });   // no points yet: loop the whole sample, switched on
    else attempt(() => setSampleProps(project, sel, { [ok]: !isOn(s, p) }));
  }

  function adjust(field, dir, e) {
    const s = sample();
    if (field === 'name') return;
    if (SWITCH.includes(field)) { toggle(field); return; }
    if (field in SLIDERS) {
      const step = e.ctrlKey ? 0.25 : e.shiftKey ? 0.1 : 0.01;
      setField(field, (s[field] ?? SAMPLE_PROPS[field].def) + dir * step);
      return;
    }
    const step = e.ctrlKey ? 1000 : e.shiftKey ? 100 : 1;
    const now = frameValue(s, field);
    if (field.endsWith('Beg') && !field.startsWith('sel') && !((s[`${LOOP_FIELDS[field]}End`] ?? 0) > 0)) { setField(field, 0); return; }
    setField(field, now + dir * step);
  }

  const valueText = field => {
    const s = sample();
    if (field === 'name') return sel;
    if (field in SLIDERS) return String(s[field] ?? SAMPLE_PROPS[field].def);
    return String(frameValue(s, field));
  };

  // Delete, or the × on a slot: the sample goes (an instrument that plays it stops that, with a message), and the list selects its neighbour.
  function removeAt(gone, at = ids().indexOf(gone)) {
    if (!attempt(() => removeSample(getProject(), gone))) return;
    const rest = ids().filter(id => id !== gone);
    history.drop(gone);
    sel = null;
    select(rest[Math.min(at, rest.length - 1)]);
    onRemove(gone);
  }

  function select(id) {
    if (!id || !(id in getProject().samples)) return;
    if (id !== sel) { selFrom = 0; selTo = 0; onSelection(0, 0); activeSlice = -1; onSlice(-1); }
    sel = id; edit = null;
    const at = ids().indexOf(id);
    if (at < top) top = at;
    if (at >= top + LIST_ROWS) top = at - LIST_ROWS + 1;
  }

  function startNote(code, note) {
    if (!sel || held.has(code)) return;
    held.set(code, note);
    onNote(sel, note, true);
  }
  function stopNote(code) {
    if (!held.has(code)) return;
    onNote(sel, held.get(code), false);
    held.delete(code);
  }
  // The two buttons on a slice row: play from the marker to the next one, or on to the end of the sample. Clicking a button
  // that is playing stops it; the note is also stopped at the next marker by a timer (the sampler has no end point of its own).
  let sliceTimer = 0, sliceBtn = '';
  const stopSlice = (hard = false) => {
    clearTimeout(sliceTimer);
    if (hard && held.has('slice-audition')) { held.delete('slice-audition'); onNote(sel, ROOT, false, 0, -1); }   // a cut: a one-shot would otherwise play on after the note off
    else stopNote('slice-audition');
    sliceBtn = '';
  };
  const playSlice = (i, toEnd) => {
    const s = sample(), sl = s?.slices ?? [];
    if (!s || i < 0 || i >= sl.length) return;
    const btn = `${i}:${toEnd ? 'end' : 'seg'}`, was = sliceBtn;
    stopSlice(true);
    if (was === btn) return;
    const end = toEnd ? s.data.length : (sl[i + 1] ?? s.data.length);
    setActive(i);
    if (!playFrom('slice-audition', sl[i], toEnd ? 0 : (end - sl[i]) / s.rate)) return;
    sliceBtn = btn;
    sliceTimer = setTimeout(stopSlice, Math.max(30, (end - sl[i]) / s.rate * 1000));
    say(`Playing slice ${i.toString(16).toUpperCase().padStart(2, '0')} ${toEnd ? 'to the end' : 'to the next marker'}.`);
  };
  const pianoNote = e => {
    if (e.shiftKey || e.ctrlKey) return null;
    const k = String(e.key).toLowerCase();
    if (!Object.hasOwn(PIANO, k) || (focus !== 'list' && /\d/.test(k))) return null;   // digits type into number fields
    const note = octave * 12 + PIANO[k];
    return note <= 127 ? note : null;
  };

  // ---- keys ----
  function key(e) {
    if (e.ctrlKey && !e.altKey && !e.metaKey && ['z', 'y', 'Z'].includes(e.key) && sel) {
      const redo = e.key === 'y' || e.shiftKey;
      if (attempt(() => (redo ? redoEdit : undoEdit)(getProject(), sel, history)) && selTo > sample().data.length) setSelection(0, 0);
      e.preventDefault?.();
      return true;
    }
    if (e.ctrlKey && !['ArrowLeft', 'ArrowRight'].includes(e.key) && !['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) return false;
    if (e.metaKey || e.altKey) return false;
    const k = e.key, list = ids();
    const eat = () => { e.preventDefault?.(); return true; };
    if (!list.length) { if (k === 'l' || k === 'L') { onLoad(); return eat(); } return false; }
    if (!list.includes(sel)) select(list[0]);

    if (edit) {
      if (k === 'Escape') { edit = null; return eat(); }
      if (k === 'Enter') {
        const { field, buf } = edit;
        edit = null;
        if (field === 'name') {
          attempt(() => { const next = renameSample(getProject(), sel, buf); const was = sel; sel = next; history.rename(was, next); onRename(was, next); });
        } else if (buf.trim() !== '' && Number.isFinite(Number(buf))) setField(field, Number(buf));
        return eat();
      }
      if (k === 'Backspace') { edit.buf = edit.buf.slice(0, -1); return eat(); }
      if (k.length === 1 && (edit.field === 'name' || /[0-9.\-]/.test(k))) { edit.buf += k; return eat(); }
      return eat();
    }

    if (e.shiftKey && focus !== 'name' && Object.hasOwn(EDITS, k)) { runEdit(EDITS[k]); return eat(); }
    if (e.shiftKey && focus !== 'name' && (k === 'M' || k === 'U')) {   // M marks a slice at the start of the selection, U takes away the one nearest to it
      const s = sample(), at = Math.min(selFrom, s.data.length - 1), slices = s.slices ?? [];
      if (k === 'M') { if (attempt(() => setSlices(getProject(), sel, [...slices, at]))) setActive(sample().slices.indexOf(at)); }
      else if (slices.length) {
        const nearest = slices.reduce((best, f) => (Math.abs(f - at) < Math.abs(best - at) ? f : best));
        if (attempt(() => setSlices(getProject(), sel, slices.filter(f => f !== nearest)))) setActive(-1);
      }
      return eat();
    }
    if (e.shiftKey && focus !== 'name' && k === 'E') { if (onAutoSlice) onAutoSlice(); else say(autoSlice.apply()); return eat(); }   // auto-slice: the dialog (main.js) asks for the settings, or it just runs
    if (e.shiftKey && focus !== 'name' && k === 'H' && onChords) { onChords(); return eat(); }   // detect chords: the dialog (main.js)
    if (e.shiftKey && focus !== 'name' && (k === 'Z' || k === 'A' || k === 'W')) { say(onZoom(k === 'Z' ? 'selection' : k === 'A' ? 'out' : 'all') ?? ''); return eat(); }   // zoom the display: to the selection, out, whole sample
    if ((k === '[' || k === ']') && focus !== 'name') {
      octave = Math.min(9, Math.max(0, octave + (k === ']' ? 1 : -1)));
      say(`Octave ${octave}`);
      return eat();
    }

    if (focus === 'list') {
      const at = list.indexOf(sel);
      const go = n => { select(list[Math.min(list.length - 1, Math.max(0, n))]); return eat(); };
      if (k === 'ArrowUp') return go(at - 1);
      if (k === 'ArrowDown') return go(at + 1);
      if (k === 'PageUp') return go(at - 8);
      if (k === 'PageDown') return go(at + 8);
      if (k === 'Home') return go(0);
      if (k === 'End') return go(list.length - 1);
      if (k === 'Tab' && !e.shiftKey || k === 'ArrowRight' || k === 'Enter') { focus = FIELDS[0]; return eat(); }
      if (k === 'Delete') { removeAt(sel, at); return eat(); }
      if ((k === '+' || k === '=' || k === '-' || k === '_') && sample().slices?.length) { nudgeSlice((k === '+' || k === '=' ? 1 : -1) * (e.ctrlKey ? 100 : 1)); return eat(); }
      if ((k === '<' || k === '>') && sample().slices?.length) {   // choose the previous or next marker
        const n = sample().slices.length;
        setActive(Math.min(n - 1, Math.max(0, (activeSlice < 0 ? (k === '>' ? -1 : n) : activeSlice) + (k === '>' ? 1 : -1))));
        return eat();
      }
      if (k === ' ') { if (!e.repeat) startNote(' ', ROOT); return eat(); }
      if (k === 'l' || k === 'L') { onLoad(); return eat(); }
      if (k === 'k' || k === 'K') { onKeep(sel); return eat(); }   // copy a tap sample out as a normal one
      const note = pianoNote(e);
      if (note !== null) { if (!e.repeat) startNote(String(k).toLowerCase(), note); return eat(); }
      return false;
    }

    const at = FIELDS.indexOf(focus);
    if (k === 'Escape') { focus = 'list'; return eat(); }
    if (k === 'Tab' || k === 'ArrowDown' || k === 'ArrowUp') {
      const back = k === 'ArrowUp' || (k === 'Tab' && e.shiftKey);
      const next = at + (back ? -1 : 1);
      focus = next < 0 || next >= FIELDS.length ? 'list' : FIELDS[next];
      return eat();
    }
    const dirOf = { ArrowRight: 1, ArrowLeft: -1 }[k] ?? (focus === 'name' ? undefined : { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 }[e.code]);
    if (dirOf) { adjust(focus, dirOf, e); return eat(); }
    if (k === 'Enter') {
      if (SWITCH.includes(focus)) toggle(focus);
      else edit = { field: focus, buf: focus === 'name' ? sel : '' };
      return eat();
    }
    if (k === ' ') {
      if (SWITCH.includes(focus)) toggle(focus); else if (!e.repeat) startNote(' ', ROOT);
      return eat();
    }
    if (focus !== 'name') {
      const note = pianoNote(e);
      if (note !== null) { if (!e.repeat) startNote(String(k).toLowerCase(), note); return eat(); }
    }
    if (k === 'l' && focus !== 'name') { onLoad(); return eat(); }
    if (focus === 'name') { if (k.length === 1) { edit = { field: 'name', buf: k }; return eat(); } return false; }
    if (k.length === 1 && /[0-9.\-]/.test(k) && !SWITCH.includes(focus)) { edit = { field: focus, buf: k }; return eat(); }
    return false;
  }

  el.addEventListener('keydown', key);

  // The mouse: a click on a sample picks it; on a field it moves the cursor there (a second click on the field starts typing
  // a value; digits typed straight after the first click do too); on a switch it flips it; on a slider bar it sets the value.
  const commit = () => {
    if (!edit) return;
    const { field, buf } = edit;
    edit = null;
    if (field === 'name') attempt(() => { const next = renameSample(getProject(), sel, buf); const was = sel; sel = next; history.rename(was, next); onRename(was, next); });
    else if (buf.trim() !== '' && Number.isFinite(Number(buf))) setField(field, Number(buf));
  };
  // the buttons on the slots: ▶ plays while the mouse is held, Replace and Load… ask for a file, × removes the sample
  el.addEventListener('mousedown', e => {
    const act = e.target.closest?.('[data-act]');
    if (act?.dataset?.act) {
      e.preventDefault(); el.focus();
      const id = act.dataset.sid, what = act.dataset.act;
      if (what === 'load') onLoad();
      else if (what === 'replace') { commit(); select(id); onReplace(id); }
      else if (what === 'remove') { commit(); removeAt(id); }
      else if (what === 'play') {
        commit(); select(id);
        const code = 'slot-play';
        if (playFrom(code, 0)) window.addEventListener('mouseup', () => { stopNote(code); draw(); }, { once: true });
      }
      draw(); return;
    }
    const play = e.target.closest?.('[data-play]');
    if (play?.dataset?.play !== undefined && sample()) { e.preventDefault(); el.focus(); const [i, how] = play.dataset.play.split(':'); playSlice(Number(i), how === 'end'); draw(); return; }
    const hit = e.target.closest?.('[data-f], [data-id]');
    if (!hit || !sample()) return;
    e.preventDefault();
    el.focus();
    if (hit.dataset.id) { commit(); select(hit.dataset.id); focus = 'list'; draw(); return; }
    const field = hit.dataset.f, again = focus === field && !edit;
    if (edit && edit.field !== field) commit();
    focus = field;
    if (field === 'view') { if (hit.dataset.mode !== mode) toggle('view'); }
    else if (field === 'loopOn' || field === 'susOn' || field === 'loopHide' || field === 'susHide' || field === 'selHide') toggle(field);
    else if (hit.dataset.bar) {
      const r = hit.getBoundingClientRect(), spec = SAMPLE_PROPS[field];
      setField(field, spec.min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (spec.max - spec.min));
    } else if (again) edit = { field, buf: field === 'name' ? sel : '' };
    draw();
  });
  el.addEventListener('wheel', e => {   // the slot list scrolls when the pointer is over it
    if (!e.target.closest?.('.lc')) return;
    const total = Math.max(LIST_ROWS, ids().length + 1), next = Math.min(total - LIST_ROWS, Math.max(0, top + Math.sign(e.deltaY) * 3));
    if (next !== top) { top = next; draw(); }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('keyup', e => stopNote(String(e.key).toLowerCase()));
  el.addEventListener('blur', () => { for (const code of [...held.keys()]) stopNote(code); });

  // ---- drawing ----
  const fieldCell = (field, text, width, extra = '') => {
    const editing = edit?.field === field;
    const shown = editing ? `${edit.buf}_` : text;
    return seg(shown.padEnd(width).slice(0, width), `sf${focus === field ? ' on' : ''}${editing ? ' ed' : ''}${extra}`, ` data-f="${field}"`);
  };
  const slider = field => {
    const s = sample(), spec = SAMPLE_PROPS[field], v = s[field] ?? spec.def;
    const editing = edit?.field === field;
    const fill = ((v - spec.min) / (spec.max - spec.min)) * 100;
    const bar = { t: 24, h: `<span class="sl${focus === field ? ' on' : ''}" data-f="${field}" data-bar="1"><i style="width:${fill}%"></i></span>` };
    const num = editing ? `${edit.buf}_` : (field === 'pan' ? v.toFixed(2).padStart(5) : v.toFixed(2));
    return line(`${SLIDERS[field].padEnd(16)}`, bar, ' ', seg(num, editing ? 'sf ed' : '', ` data-f="${field}"`));
  };

  let shownActive = -2;
  function draw() {
    const project = getProject();
    const list = ids();
    if (sel && !(sel in project.samples && ids().includes(sel))) { sel = null; edit = null; }
    if (!sel && list.length) select(list[0]);
    if (sel !== announced) { announced = sel; onSelect(sel); }
    let html;
    // The slots, numbered like Impulse Tracker's: a sample in each, then empty ones with a Load… button. A new sample always takes the first empty slot.
    const slotRows = () => {
      const rows = [line(' Sample list')], total = Math.max(LIST_ROWS, list.length + 1);
      top = Math.min(top, total - LIST_ROWS);
      for (let i = top; i < Math.min(total, top + LIST_ROWS); i++) {
        const no = String(i + 1).padStart(2, '0'), id = list[i];
        if (id === undefined) { rows.push(line(seg(`  ${no} ${'· · · empty'.padEnd(NAMEW)} ${' '.repeat(8)} `, 'sdim'), seg(' Load… ', 'sbtn load', ' data-act="load" title="Pick audio files: they fill this and the next empty slots"'))); continue; }
        const d = project.samples[id], cls = id === sel ? (focus === 'list' ? 'sf on' : 'sf') : '', sid = ` data-sid="${esc(id)}"`;
        rows.push(line(seg(`${id === sel ? '>' : ' '} ${no} ${id.padEnd(NAMEW).slice(0, NAMEW)} ${(d.data.length / d.rate).toFixed(2).padStart(6)}s `, cls, ` data-id="${esc(id)}"`), ' ',
          seg(' ▶ ', 'sbtn', ` data-act="play"${sid} title="Hear it (held)"`), ' ', seg(' Replace ', 'sbtn', ` data-act="replace"${sid} title="Put a different audio file in this slot: instruments that play it follow"`), ' ', seg(' × ', 'sbtn', ` data-act="remove"${sid} title="Remove this sample (Delete)"`)));
      }
      return rows;
    };
    if (!list.length) {
      const left = slotRows(), right = [line(' Sample'), line(''), line(' No samples yet. Load… a slot, drop audio files on this screen,'), line(' or use the Record and Browse tabs below.')];
      const out = [];
      for (let i = 0; i < Math.max(left.length, right.length); i++) out.push(`<span class="lc">${i < left.length ? padTo(left[i], LEFT) : ' '.repeat(LEFT)}</span> ${i < right.length ? right[i].h : ''}`);
      html = out.join('\n');
    } else {
      const s = sample();
      const left = slotRows();
      // Slice markers: number, the hex value an Off cell would hold, the frame and the time. The slice command
      // (10 0000 is the first) starts a note at one.
      const sliceLines = d => {
        const sl = d.slices ?? [];
        return [line(` Slices    ${sl.length ? sl.length : 'none'}${sl.length ? '' : '  (Shift+M marks one at the selection start;'}`), ...(sl.length ? [] : [line('           Alt+click the display)')]),
          ...sl.map((f, i) => { const l = line(`${i === activeSlice ? ' >' : '  '} ${i.toString(16).toUpperCase().padStart(2, '0')}  ${placeHex(f, d.data.length, config.get('hexMode'))}  ${String(f).padStart(8, '0')}  ${(f / d.rate).toFixed(3)}s`, '  ', seg('   ', 'sl-b sl-seg', ` data-play="${i}:seg" title="Play from this slice to the next"`), ' ', seg('   ', 'sl-b sl-end', ` data-play="${i}:end" title="Play from this slice to the end of the sample"`)); return i === activeSlice ? { t: l.t, h: `<span class="sl-act">${l.h}</span>` } : l; })];
      };
      const numCell = field => fieldCell(field, frameValue(s, field).toString().padStart(8, '0'), 8);
      const loopLine = (label, p, onField, begField, endField, xfField, hideField) => line(
        ` ${label.padEnd(9)}`, fieldCell(onField, isOn(s, p) ? ' on' : ' off', 4), ' Beg ', numCell(begField), ' End ', numCell(endField), ' Xfade ', numCell(xfField), '  ',
        fieldCell(hideField, config.get(p === 'sus' ? 'waveHideSus' : 'waveHideLoop') ? 'show' : 'hide', 4));   // hide: keeps the region off the waveform
      const right = [
        line(' Sample'),
        line(' Name     ', fieldCell('name', sel, 24)),
        line(` Speed    ${s.rate} Hz   ${s.right ? 'stereo' : 'mono'}`),
        line(` Length   ${String(s.data.length).padStart(8, '0')} frames  ${(s.data.length / s.rate).toFixed(2)} s`),
        line(''),
        loopLine('Loop', 'loop', 'loopOn', 'loopBeg', 'loopEnd', 'loopXf', 'loopHide'),
        loopLine('SusLoop', 'sus', 'susOn', 'susBeg', 'susEnd', 'susXf', 'susHide'),
        line(' Select   ', seg('    ', ''), ' Beg ', numCell('selBeg'), ' End ', numCell('selEnd'), (selTo > selFrom ? '' : '(whole sample)').padStart(7 + 8 + 1) + ' ', fieldCell('selHide', config.get('waveHideSel') ? 'show' : 'hide', 4)),   // hide lines up with the ones above
        line(''),
        line(' Levels'),
        ...Object.keys(SLIDERS).map(f => line(' ', slider(f))),
        line(''),
        line(' Display   ', seg(' Waveform ', mode === 'wave' ? `sf${focus === 'view' ? ' on' : ''}` : '', ' data-f="view" data-mode="wave"'), ' ', seg(' Spectrum ', mode === 'spec' ? `sf${focus === 'view' ? ' on' : ''}` : '', ' data-f="view" data-mode="spec"')),
      ];
      // The slice markers stand in a third column, to the right of the sample's fields: a small scroll box as tall as the
      // fields, so every marker can be reached without pushing the page down.
      const marks = sliceLines(s), RIGHTW = 74;
      const rows = Math.max(left.length, right.length);
      const out = [];
      for (let i = 0; i < rows; i++) out.push(`<span class="lc">${i < left.length ? padTo(left[i], LEFT) : ' '.repeat(LEFT)}</span> ${i < right.length ? right[i].h : ''}`);   // the divider is the border of the left column
      html = `${out.join('\n')}<div class="slbox" style="left:${LEFT + 1 + RIGHTW}ch;height:${(rows * 1.35).toFixed(2)}em">${marks.map(m => m.h).join('\n')}</div>`;
    }
    if (html !== last) {
      last = html;
      const kept = el.querySelector?.('.slbox')?.scrollTop ?? 0;
      el.innerHTML = html;
      const box = el.querySelector?.('.slbox');
      if (box) {
        box.scrollTop = kept;
        const act = box.querySelector('.sl-act');
        if (act && activeSlice !== shownActive) {   // a new active slice is brought into view
          const lineH = act.offsetHeight || 16;
          if (act.offsetTop < box.scrollTop) box.scrollTop = act.offsetTop;
          else if (act.offsetTop + lineH > box.scrollTop + box.clientHeight) box.scrollTop = act.offsetTop + lineH - box.clientHeight;
        }
      }
      shownActive = activeSlice;
    }
  }

  // Auto-slice: a marker on every hit of the sample, or of the selection (markers inside it are replaced). preview finds them without
  // touching the sample, so a dialog can show how many a setting gives; apply puts the markers in. Both take sensitivity (0 to 100) and gap (ms).
  // Plays the selected sample from a frame, for as long as the key that started it is held (main.js: Space over the waveform).
  const playFrom = (code, frame, seconds = 0) => { if (!sel || held.has(code)) return false; held.set(code, ROOT); onNote(sel, ROOT, true, frame, seconds); return true; };
  const autoSlice = {
    preview({ sensitivity = config.get('sliceSensitivity'), gap = config.get('sliceMinGap'), replace = config.get('sliceReplace') } = {}) {
      const s = sample();
      if (!s) return { hits: [], marks: [], whole: true, name: '' };
      const whole = selTo <= selFrom, from = whole ? 0 : selFrom, to = whole ? s.data.length : selTo;
      const hits = detectOnsets(s.data, s.right, s.rate, { from, to, sensitivity: sensitivity / 100, minGapMs: gap });
      // the markers it would add: one on each hit, and one at the start of the range when the first hit is well after it
      const marks = hits.length ? [...(hits[0] - from > Math.round(0.02 * s.rate) ? [from] : []), ...hits] : [];
      return { hits, marks, whole, from, to, replace, name: sel, length: s.data.length / s.rate };
    },
    apply(opts) {
      const s = sample(), { hits, marks: added, whole, from, to, replace } = autoSlice.preview(opts);
      if (!s) return 'Pick a sample first.';
      if (!hits.length) return 'No onsets found: try a higher sensitivity.';
      const keep = (s.slices ?? []).filter(f => !replace || f < from || f >= to);   // markers outside the range stay; inside it they are replaced, if asked
      const marks = [...new Set([...keep, ...added])];
      if (!attempt(() => setSlices(getProject(), sel, marks))) return '';
      setActive(-1);
      return `Found ${hits.length} onsets${whole ? '' : ' in the selection'}: ${sample().slices.length} slice markers now.`;
    },
  };
  return { draw, key, select, runEdit, autoSlice, playFrom, release: code => stopNote(code), say, undoRedo, markSlice, setSelection(from, to) { if (sel) setSelection(Math.max(0, from), Math.max(0, to)); }, setActiveSlice(i) { activeSlice = i; }, history, get octave() { return octave; }, get selection() { return [selFrom, selTo]; }, get selected() { return sel; }, get focus() { return focus; }, get mode() { return mode; } };
}
