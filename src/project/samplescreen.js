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

const LIST_ROWS = 13, LEFT = 38;
const FIELDS = ['name', 'loopOn', 'loopBeg', 'loopEnd', 'loopXf', 'susOn', 'susBeg', 'susEnd', 'susXf', 'selBeg', 'selEnd', 'volume', 'globalVolume', 'pan', 'view'];
const SLIDERS = { volume: 'Default volume', globalVolume: 'Global volume', pan: 'Default pan' };
const LOOP_FIELDS = { loopOn: 'loop', loopBeg: 'loop', loopEnd: 'loop', loopXf: 'loop', susOn: 'sus', susBeg: 'sus', susEnd: 'sus', susXf: 'sus' };

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const seg = (text, cls, at = '') => ({ t: text.length, h: cls || at ? `<span${cls ? ` class="${cls}"` : ''}${at}>${esc(text)}</span>` : esc(text) });
const line = (...segs) => segs.map(s => (typeof s === 'string' ? seg(s) : s)).reduce((a, s) => ({ t: a.t + s.t, h: a.h + s.h }), { t: 0, h: '' });
const padTo = (l, n) => l.h + ' '.repeat(Math.max(0, n - l.t));
const PIANO = { ...LOWER, ...UPPER };
const EDITS = { C: 'crop', T: 'crop', X: 'cut', S: 'silence', R: 'reverse', N: 'normalise', I: 'fadeIn', O: 'fadeOut', D: 'removeDc', B: 'bakeCrossfade' };
const ROOT = 60;
const round2 = v => Math.round(v * 100) / 100;

export function createSampleScreen({ el, statusEl, getProject, onChange = () => {}, onSelect = () => {}, onRemove = () => {}, onRename = () => {}, onNote = () => {}, onLoad = () => {}, onKeep = () => {}, onView = () => {}, onSelection = () => {}, onSlice = () => {}, onZoom = () => '' }) {
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
      if (tool === 'crop' || tool === 'cut') setSelection(0, 0);
      else if (selTo > sample().data.length) setSelection(0, 0);
    }
  }

  // The edit menu on the waveform (right click) calls these.
  const undoRedo = redo => {
    if (sel && attempt(() => (redo ? redoEdit : undoEdit)(getProject(), sel, history)) && selTo > sample().data.length) setSelection(0, 0);
  };
  const markSlice = at => {
    const s = sample();
    if (!s) return;
    const f = Math.max(0, Math.min(at, s.data.length - 1));
    if (attempt(() => setSlices(getProject(), sel, [...(s.slices ?? []), f]))) setActive(sample().slices.indexOf(f));
  };

  function toggle(field) {
    const s = sample(), project = getProject();
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
    if (field === 'loopOn' || field === 'susOn' || field === 'view') { toggle(field); return; }
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
    if (e.shiftKey && focus !== 'name' && k === 'E') {   // find the onsets (hits) of the sample, or of the selection, and put a slice marker on each
      const s = sample(), whole = selTo <= selFrom, from = whole ? 0 : selFrom, to = whole ? s.data.length : selTo;
      const hits = detectOnsets(s.data, s.right, s.rate, { from, to, sensitivity: config.get('sliceSensitivity') / 100, minGapMs: config.get('sliceMinGap') });
      if (!hits.length) say('No onsets found: try a higher sensitivity in Config (Sample).');
      else {
        const keep = (s.slices ?? []).filter(f => f < from || f >= to);   // markers outside the range stay; inside it they are replaced
        const marks = [...new Set([...keep, ...(hits[0] - from > Math.round(0.02 * s.rate) ? [from] : []), ...hits])];
        if (attempt(() => setSlices(getProject(), sel, marks))) { setActive(-1); say(`Found ${hits.length} onsets${whole ? '' : ' in the selection'}: ${sample().slices.length} slice markers now.`); }
      }
      return eat();
    }
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
      if (k === 'Delete') {
        const gone = sel;
        if (attempt(() => removeSample(getProject(), gone))) {
          const rest = list.filter(id => id !== gone);
          history.drop(gone);
          sel = null;
          select(rest[Math.min(at, rest.length - 1)]);
          onRemove(gone);
        }
        return eat();
      }
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
      if (focus === 'loopOn' || focus === 'susOn' || focus === 'view') toggle(focus);
      else edit = { field: focus, buf: focus === 'name' ? sel : '' };
      return eat();
    }
    if (k === ' ') {
      if (focus === 'loopOn' || focus === 'susOn' || focus === 'view') toggle(focus); else if (!e.repeat) startNote(' ', ROOT);
      return eat();
    }
    if (focus !== 'name') {
      const note = pianoNote(e);
      if (note !== null) { if (!e.repeat) startNote(String(k).toLowerCase(), note); return eat(); }
    }
    if (k === 'l' && focus !== 'name') { onLoad(); return eat(); }
    if (focus === 'name') { if (k.length === 1) { edit = { field: 'name', buf: k }; return eat(); } return false; }
    if (k.length === 1 && /[0-9.\-]/.test(k) && !['loopOn', 'susOn', 'view'].includes(focus)) { edit = { field: focus, buf: k }; return eat(); }
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
  el.addEventListener('mousedown', e => {
    const hit = e.target.closest?.('[data-f], [data-id]');
    if (!hit || !sample()) return;
    e.preventDefault();
    el.focus();
    if (hit.dataset.id) { commit(); select(hit.dataset.id); focus = 'list'; draw(); return; }
    const field = hit.dataset.f, again = focus === field && !edit;
    if (edit && edit.field !== field) commit();
    focus = field;
    if (field === 'view') { if (hit.dataset.mode !== mode) toggle('view'); }
    else if (field === 'loopOn' || field === 'susOn') toggle(field);
    else if (hit.dataset.bar) {
      const r = hit.getBoundingClientRect(), spec = SAMPLE_PROPS[field];
      setField(field, spec.min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (spec.max - spec.min));
    } else if (again) edit = { field, buf: field === 'name' ? sel : '' };
    draw();
  });
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
    if (!list.length) html = ' Sample list\n\n No samples loaded. Press L, or use the Load button, to add audio files.\n';
    else {
      const s = sample();
      const left = [line(' Sample list')];
      for (let i = top; i < Math.min(list.length, top + LIST_ROWS); i++) {
        const id = list[i], d = project.samples[id];
        const cls = id === sel ? (focus === 'list' ? 'sf on' : 'sf') : '';
        left.push(line(seg(`${id === sel ? '>' : ' '} ${String(i + 1).padStart(2, '0')} ${id.padEnd(22).slice(0, 22)} ${(d.data.length / d.rate).toFixed(2).padStart(6)}s `, cls, ` data-id="${esc(id)}"`)));
      }
      // Slice markers: number, the hex value an Off cell would hold, the frame and the time. The slice command
      // (10 0000 is the first) starts a note at one.
      const sliceLines = d => {
        const sl = d.slices ?? [];
        return [line(` Slices    ${sl.length ? sl.length : 'none'}${sl.length ? '' : '  (Shift+M marks one at the selection start;'}`), ...(sl.length ? [] : [line('           Alt+click the display)')]),
          ...sl.map((f, i) => { const l = line(`${i === activeSlice ? ' >' : '  '} ${i.toString(16).toUpperCase().padStart(2, '0')}  ${placeHex(f, d.data.length, config.get('hexMode'))}  ${String(f).padStart(8, '0')}  ${(f / d.rate).toFixed(3)}s`); return i === activeSlice ? { t: l.t, h: `<span class="sl-act">${l.h}</span>` } : l; })];
      };
      const numCell = field => fieldCell(field, frameValue(s, field).toString().padStart(8, '0'), 8);
      const loopLine = (label, p, onField, begField, endField, xfField) => line(
        ` ${label.padEnd(9)}`, fieldCell(onField, isOn(s, p) ? ' on' : ' off', 4), ' Beg ', numCell(begField), ' End ', numCell(endField), ' Xfade ', numCell(xfField));
      const right = [
        line(' Sample'),
        line(' Name     ', fieldCell('name', sel, 24)),
        line(` Speed    ${s.rate} Hz   ${s.right ? 'stereo' : 'mono'}`),
        line(` Length   ${String(s.data.length).padStart(8, '0')} frames  ${(s.data.length / s.rate).toFixed(2)} s`),
        line(''),
        loopLine('Loop', 'loop', 'loopOn', 'loopBeg', 'loopEnd', 'loopXf'),
        loopLine('SusLoop', 'sus', 'susOn', 'susBeg', 'susEnd', 'susXf'),
        line(' Select   ', seg('    ', ''), ' Beg ', numCell('selBeg'), ' End ', numCell('selEnd'), selTo > selFrom ? '' : '  (whole sample)'),
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

  return { draw, key, select, runEdit, undoRedo, markSlice, setSelection(from, to) { if (sel) setSelection(Math.max(0, from), Math.max(0, to)); }, setActiveSlice(i) { activeSlice = i; }, history, get octave() { return octave; }, get selection() { return [selFrom, selTo]; }, get selected() { return sel; }, get focus() { return focus; }, get mode() { return mode; } };
}
