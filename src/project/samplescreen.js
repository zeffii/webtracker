import { setLoop, setSampleProps, SAMPLE_PROPS, removeSample, renameSample } from './ops.js';
import { applyEdit, createHistory, redoEdit, undoEdit } from './sampleedit.js';
import { LOWER, UPPER } from '../seq/piano.js';

// The sample screen (F3): a list of the project's samples on the left and, for the one selected, its
// information, loops, levels and display switch on the right, drawn as monospace text like the pattern
// and arrangement views. The waveform / spectrogram below it is a separate canvas (waveform.js).
//
// Keys. In the list: Up/Down/PgUp/PgDn/Home/End choose a sample; Tab, Right or Enter go to its fields;
// the piano keys (as in the pattern view; [ and ] change the octave) play the sample while held, with
// no instrument or effects, only its own volume, global volume and pan; Space plays it at its root note;
// L loads files; Delete removes it. Shift+C or T trim (keep the selection, else the loop region), X cut, S silence, R reverse, N normalise, I fade in,
// O fade out, D remove DC offset and B bake the loop crossfades act on the selection (the Select field
// or Shift+drag on the display), or on the whole sample when nothing is selected; Ctrl+Z / Ctrl+Y undo and redo. In the fields: Tab/Down and Shift+Tab/Up
// move between them, Esc goes back to the list; Left/Right or -/+ change the value (Shift is a bigger step,
// Ctrl a much bigger one); digits type a value and Enter sets it (Enter on a field starts editing it).
// Every parameter, slider or number, answers to the same keys.

const LIST_ROWS = 13, LEFT = 38;
const FIELDS = ['name', 'loopOn', 'loopBeg', 'loopEnd', 'loopXf', 'susOn', 'susBeg', 'susEnd', 'susXf', 'selBeg', 'selEnd', 'volume', 'globalVolume', 'pan', 'view'];
const SLIDERS = { volume: 'Default volume', globalVolume: 'Global volume', pan: 'Default pan' };
const LOOP_FIELDS = { loopOn: 'loop', loopBeg: 'loop', loopEnd: 'loop', loopXf: 'loop', susOn: 'sus', susBeg: 'sus', susEnd: 'sus', susXf: 'sus' };

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const seg = (text, cls) => ({ t: text.length, h: cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text) });
const line = (...segs) => segs.map(s => (typeof s === 'string' ? seg(s) : s)).reduce((a, s) => ({ t: a.t + s.t, h: a.h + s.h }), { t: 0, h: '' });
const padTo = (l, n) => l.h + ' '.repeat(Math.max(0, n - l.t));
const PIANO = { ...LOWER, ...UPPER };
const EDITS = { C: 'crop', T: 'crop', X: 'cut', S: 'silence', R: 'reverse', N: 'normalise', I: 'fadeIn', O: 'fadeOut', D: 'removeDc', B: 'bakeCrossfade' };
const ROOT = 60;
const round2 = v => Math.round(v * 100) / 100;

export function createSampleScreen({ el, statusEl, getProject, onChange = () => {}, onSelect = () => {}, onRemove = () => {}, onRename = () => {}, onNote = () => {}, onLoad = () => {}, onView = () => {}, onSelection = () => {} }) {
  let sel = null, focus = 'list', edit = null, mode = 'wave', announced = null, last = null, top = 0;
  let selFrom = 0, selTo = 0, octave = 5;
  const held = new Map();   // key -> note it is playing
  const history = createHistory();
  const say = text => { if (statusEl) statusEl.textContent = text; };
  const ids = () => Object.keys(getProject().samples);
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

  function toggle(field) {
    const s = sample(), project = getProject();
    if (field === 'view') {
      mode = mode === 'wave' ? 'spec' : 'wave';
      onView(mode);
      return;
    }
    const p = LOOP_FIELDS[field], [, ek, ok] = loopKeys(p);
    if (!(s[ek] > 0)) attempt(() => setLoop(project, sel, 0, s.data.length, p));   // no points yet: loop the whole sample
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
    if (id !== sel) { selFrom = 0; selTo = 0; onSelection(0, 0); }
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
    if (!(sel in getProject().samples)) select(list[0]);

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
      if (k === ' ') { if (!e.repeat) startNote(' ', ROOT); return eat(); }
      if (k === 'l' || k === 'L') { onLoad(); return eat(); }
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
  el.addEventListener('keyup', e => stopNote(String(e.key).toLowerCase()));
  el.addEventListener('blur', () => { for (const code of [...held.keys()]) stopNote(code); });

  // ---- drawing ----
  const fieldCell = (field, text, width, extra = '') => {
    const editing = edit?.field === field;
    const shown = editing ? `${edit.buf}_` : text;
    return seg(shown.padEnd(width).slice(0, width), `sf${focus === field ? ' on' : ''}${editing ? ' ed' : ''}${extra}`);
  };
  const slider = field => {
    const s = sample(), spec = SAMPLE_PROPS[field], v = s[field] ?? spec.def;
    const editing = edit?.field === field;
    const fill = ((v - spec.min) / (spec.max - spec.min)) * 100;
    const bar = { t: 24, h: `<span class="sl${focus === field ? ' on' : ''}"><i style="width:${fill}%"></i></span>` };
    const num = editing ? `${edit.buf}_` : (field === 'pan' ? v.toFixed(2).padStart(5) : v.toFixed(2));
    return line(`${SLIDERS[field].padEnd(16)}`, bar, ' ', seg(num, editing ? 'sf ed' : ''));
  };

  function draw() {
    const project = getProject();
    const list = ids();
    if (sel && !(sel in project.samples)) { sel = null; edit = null; }
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
        left.push(line(seg(`${id === sel ? '>' : ' '} ${String(i + 1).padStart(2, '0')} ${id.padEnd(22).slice(0, 22)} ${(d.data.length / d.rate).toFixed(2).padStart(6)}s `, cls)));
      }
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
        line(' Display   ', seg(' Waveform ', mode === 'wave' ? `sf${focus === 'view' ? ' on' : ''}` : ''), ' ', seg(' Spectrum ', mode === 'spec' ? `sf${focus === 'view' ? ' on' : ''}` : '')),
      ];
      const rows = Math.max(left.length, right.length);
      const out = [];
      for (let i = 0; i < rows; i++) out.push(`<span class="lc">${i < left.length ? padTo(left[i], LEFT) : ' '.repeat(LEFT)}</span> ${i < right.length ? right[i].h : ''}`);   // the divider is the border of the left column
      out.push('', ...[' Tab/Shift+Tab fields · Left/Right or -/+ change (Shift bigger, Ctrl bigger still) · digits + Enter type a value',
        ` Piano keys play the sample (octave ${octave}, [ ] change it) · Space plays the root · Esc to list · L load · Del remove`,
        ' Edit the selection (Shift+drag on the display), or all: Shift+ C or T trim · X cut · S silence · R reverse · N normalise',
        ' I fade in · O fade out · D remove DC · B bake xfade · Ctrl+Z / Ctrl+Y undo and redo'].map(t => `<span class="help">${t}</span>`));
      html = out.join('\n');
    }
    if (html !== last) { last = html; el.innerHTML = html; }
  }

  return { draw, key, select, setSelection(from, to) { if (sel) setSelection(Math.max(0, from), Math.max(0, to)); }, history, get octave() { return octave; }, get selection() { return [selFrom, selTo]; }, get selected() { return sel; }, get focus() { return focus; }, get mode() { return mode; } };
}
