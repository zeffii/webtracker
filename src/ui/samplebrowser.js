// The sample browser, on the Samples screen: pick a folder once, then move through its audio files with the arrow keys and hear each one as
// you land on it. Enter (or a double-click) loads the file into the project as a new sample. A file over the size limit is never read
// until you say so (the limit is in Config, 10 MB by default): the panel beside the list asks, with Preview and Load buttons.
//
// Keys, with the list focused: Up and Down (Home, End, Page Up, Page Down) move and play; Right or Enter opens a folder; Left or Backspace
// goes up a level; Enter loads a file; Space plays it again (or stops it); Esc stops; a letter jumps to the next name that starts with it.
//
// The folder is picked with showDirectoryPicker (Chromium) and its handle kept in IndexedDB, so it comes back next time (the browser may ask
// once to allow reading it again). Elsewhere a plain "Choose files" button gives a flat list for as long as the page is open.
import { dirEntryFromHandle, dirEntryFromFiles, dirEntryFromTree, createHandleStore, needsAsk, sizeText, isAudioName } from '../project/samplefolder.js';
import { readPreview, createPlayer, drawWave, lengthText } from '../project/samplepreview.js';
import { rateText } from '../project/audioinfo.js';

const SETTLE = 70;       // ms the selection must rest before a file is read, so holding an arrow key does not read every file it passes
const CONFIRM = 5000;    // ms a first press of Enter or Space on a large file stays "asked"
const CACHE = 6;         // decoded files kept for going back and forth

export function createSampleBrowser({ root, getCtx, limitMB = () => 10, onLoad, say = () => {}, doc = document, picker = globalThis.showDirectoryPicker, store = null, waveColour = () => '#4dbccc' }) {
  const handles = store ?? createHandleStore();
  const el = (tag, props = {}, ...kids) => { const e = doc.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };

  // ---- the page ----
  const pick = el('button', { type: 'button', className: 'sb-pick', textContent: 'Choose folder…' });
  const reopen = el('button', { type: 'button', className: 'sb-reopen', hidden: true });
  const folderInput = el('input', { type: 'file', webkitdirectory: true, hidden: true });
  const filesBtn = el('button', { type: 'button', className: 'sb-pick', textContent: 'Choose files…', hidden: true });
  const files = el('input', { type: 'file', accept: 'audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.opus', multiple: true, hidden: true });
  const up = el('button', { type: 'button', className: 'sb-up', textContent: 'Up', title: 'Up one folder (Left, Backspace)', disabled: true });
  const path = el('span', { className: 'sb-path' });
  const list = el('div', { className: 'sb-list', tabIndex: 0, role: 'listbox', ariaLabel: 'Audio files and folders' });
  const canvas = el('canvas', { className: 'sb-wave', width: 320, height: 72 });
  const playhead = el('div', { className: 'sb-playhead', hidden: true });
  const grip = el('div', { className: 'sb-grip', title: 'Drag to make the waveform bigger or smaller (double-click resets)' });
  const waveBox = el('div', { className: 'sb-wavebox' }, canvas, playhead, grip);
  const info = el('div', { className: 'sb-info' });
  const ask = el('div', { className: 'sb-ask', hidden: true });
  const askText = el('p', { className: 'sb-ask-text' });
  const askPreview = el('button', { type: 'button', textContent: 'Preview' });
  const askLoad = el('button', { type: 'button', textContent: 'Load as a new sample' });
  ask.append(askText, askPreview, askLoad);
  const hint = el('p', { className: 'sb-hint', textContent: 'Up and Down move and play · Enter loads · Right opens a folder, Left goes up · Space plays again · letters jump' });
  let side;
  root.replaceChildren(el('div', { className: 'sb-bar' }, pick, reopen, filesBtn, up, path, files, folderInput), el('div', { className: 'sb-main' }, list, side = el('div', { className: 'sb-side' }, waveBox, info, ask)), hint);

  // ---- state ----
  const player = createPlayer({ getCtx });
  let shown = null;   // the buffer in the picture, so it can be redrawn at a new size
  const paint = () => { drawWave(canvas, shown, shown ? waveColour() : null); };
  const sizeKey = 'wax.sampleBrowserWave';
  const sizes = { w: 320, h: 72 };
  try { Object.assign(sizes, JSON.parse(localStorage.getItem(sizeKey) ?? '{}')); } catch { /* defaults */ }
  const applySize = () => {
    sizes.w = Math.min(900, Math.max(200, sizes.w)); sizes.h = Math.min(400, Math.max(48, sizes.h));
    side.style.flexBasis = `${sizes.w}px`; waveBox.style.height = `${sizes.h}px`;
    canvas.width = Math.round(sizes.w); canvas.height = Math.round(sizes.h);   // one bitmap pixel per screen pixel
    paint();
  };
  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, w0 = sizes.w, h0 = sizes.h;
    const move = m => { sizes.w = w0 - (m.clientX - x0); sizes.h = h0 + (m.clientY - y0); applySize(); };   // the picture is on the right, so dragging left makes it wider
    const done = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', done); try { localStorage.setItem(sizeKey, JSON.stringify(sizes)); } catch { /* not kept */ } };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', done);
  });
  grip.addEventListener('dblclick', () => { sizes.w = 320; sizes.h = 72; applySize(); try { localStorage.removeItem(sizeKey); } catch { /* fine */ } });
  applySize();
  let raf = 0;
  const tick = () => {
    const at = player.progress();
    playhead.hidden = at < 0;
    if (at >= 0) { playhead.style.left = `${at * 100}%`; raf = requestAnimationFrame(tick); } else raf = 0;
  };
  const follow = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const cache = new Map();            // File -> its decoded preview, newest last
  let trail = [];                     // the folders we are inside: { entry, entries, index }
  let token = 0, timer = 0, typed = '', typedAt = 0, asked = null;
  const here = () => trail[trail.length - 1];
  const current = () => here()?.entries[here().index] ?? null;

  const setInfo = (text, cls = '') => { info.textContent = text; info.className = `sb-info ${cls}`.trim(); };
  const clearPreview = () => { shown = null; paint(); playhead.hidden = true; setInfo(''); ask.hidden = true; asked = null; };

  const render = () => {
    const t = here();
    up.disabled = trail.length < 2;
    path.textContent = trail.map(x => x.entry.name).join(' / ');
    list.replaceChildren(...(t?.entries ?? []).map((e, i) => {
      const row = el('div', { className: `sb-row ${e.kind}`, role: 'option', id: `sb-row-${i}` });
      row.append(el('span', { className: 'sb-name', textContent: e.kind === 'dir' ? `${e.name}/` : e.name }), el('span', { className: 'sb-size' }));
      row.addEventListener('click', () => { list.focus(); select(i); });
      row.addEventListener('dblclick', () => { select(i); activate(); });
      return row;
    }));
    if (!t?.entries.length) list.append(el('div', { className: 'sb-empty', textContent: trail.length ? 'No audio files or folders here.' : 'Choose a folder to browse its audio files.' }));
    mark();
    fillSizes(t);
  };
  const mark = () => {
    const t = here();
    [...list.children].forEach((row, i) => { const on = t && i === t.index && row.classList.contains('sb-row'); row.setAttribute('aria-selected', String(on)); row.classList.toggle('on', on); });
    const row = list.children[t?.index ?? -1];
    if (row) { list.setAttribute('aria-activedescendant', row.id); row.scrollIntoView?.({ block: 'nearest' }); }
  };
  // sizes appear a few at a time, so a big folder does not make the list wait (a size needs no reading of the file itself)
  const fillSizes = async t => {
    if (!t) return;
    for (let i = 0; i < t.entries.length; i += 24) {
      await Promise.all(t.entries.slice(i, i + 24).map(async (e, k) => {
        if (e.kind !== 'file') return;
        try { const f = await e.file(); if (here() === t) list.children[i + k]?.querySelector('.sb-size')?.replaceChildren(sizeText(f.size)); } catch { /* unreadable: no size */ }
      }));
      if (here() !== t) return;
    }
  };

  // ---- moving ----
  const select = (i, { play = true } = {}) => {
    const t = here();
    if (!t?.entries.length) return;
    t.index = Math.max(0, Math.min(t.entries.length - 1, i));
    mark();
    stopAll();
    const entry = current();
    if (entry.kind !== 'file') { clearPreview(); return; }
    if (play) timer = setTimeout(() => preview(entry, false), SETTLE);
    else clearPreview();
  };
  const stopAll = () => { clearTimeout(timer); token++; player.stop(); clearPreview(); };

  const open = async entry => {
    try {
      const entries = await entry.list();
      stopAll();
      trail.push({ entry, entries, index: 0 });
      render();
      select(0, { play: false });
    } catch (err) { say(`Could not read ${entry.name}: ${err.message ?? err}`); }
  };
  const goUp = () => {
    if (trail.length < 2) return;
    const left = trail.pop().entry;
    stopAll();
    const t = here(), at = t.entries.findIndex(e => e.name === left.name && e.kind === 'dir');
    t.index = Math.max(0, at);
    render();
    select(t.index, { play: false });
  };

  // ---- hearing a file ----
  // `forced` is true once the person has said yes to a file over the limit.
  async function preview(entry, forced) {
    const mine = ++token;
    let file;
    try { file = await entry.file(); } catch (err) { setInfo(`Cannot open ${entry.name}: ${err.message ?? err}`, 'bad'); return; }
    if (mine !== token) return;
    if (!forced && needsAsk(file.size, limitMB())) { askAbout(entry, file); return; }
    const ctx = getCtx();
    if (!ctx) { setInfo('Press Start first: the audio engine is not running yet.', 'bad'); return; }
    ask.hidden = true;
    setInfo(`${entry.name}  ·  ${sizeText(file.size)}  ·  reading…`);
    try {
      let got = cache.get(file);
      if (got) { cache.delete(file); } else got = await readPreview(file, ctx);
      cache.set(file, got);
      if (cache.size > CACHE) cache.delete(cache.keys().next().value);
      if (mine !== token) return;
      const { buffer, info: head } = got, parts = [sizeText(file.size)];
      if (head?.rate) parts.push(rateText(head.rate));
      else parts.push(`${rateText(buffer.sampleRate)} (as played here)`);
      parts.push(`${buffer.numberOfChannels === 1 ? 'mono' : buffer.numberOfChannels === 2 ? 'stereo' : `${buffer.numberOfChannels} channels`}`);
      if (head?.bits) parts.push(`${head.bits} bit`);
      parts.push(lengthText(buffer.duration));
      setInfo(`${entry.name}\n${parts.join('  ·  ')}`);
      shown = buffer; paint();
      player.play(buffer); follow();
    } catch (err) {
      if (mine === token) { shown = null; paint(); setInfo(`${entry.name}\nCannot decode this file${err?.message ? `: ${err.message}` : '.'}`, 'bad'); }
    }
  }
  function askAbout(entry, file) {
    shown = null; paint();
    setInfo(entry.name);
    askText.textContent = `${sizeText(file.size)} is over the ${limitMB()} MB limit, so nothing has been read from this file. Space previews it, Enter loads it (press twice), or use the buttons.`;
    ask.hidden = false;
    asked = { entry, size: file.size, until: 0, action: '' };
  }
  // A first press of Enter or Space on a large file only says what it would do; the second one, soon after, does it.
  const confirmed = action => {
    const now = Date.now();
    if (asked.action === action && now < asked.until) return true;
    asked.action = action; asked.until = now + CONFIRM;
    askText.textContent = action === 'load' ? `Load ${sizeText(asked.size)}? Press Enter again to read the whole file and add it, or Esc to leave it.` : 'Preview it? Press Space again to read the whole file and play it, or Esc to leave it.';
    return false;
  };
  // Is this file over the limit? If so the panel is shown (once) and `asked` is set for it.
  const tooBig = async entry => {
    const file = await entry.file();
    if (!needsAsk(file.size, limitMB())) return false;
    if (asked?.entry !== entry) askAbout(entry, file);
    return true;
  };

  const loadCurrent = async () => {
    const entry = current();
    if (entry?.kind !== 'file') return;
    stopAll();
    try { await onLoad(await entry.file()); } catch (err) { say(`${entry.name}: ${err.message ?? err}`); }
  };
  async function activate() {
    const entry = current();
    if (!entry) return;
    if (entry.kind === 'dir') { open(entry); return; }
    try { if (await tooBig(entry) && !confirmed('load')) return; } catch (err) { setInfo(`Cannot open ${entry.name}: ${err.message ?? err}`, 'bad'); return; }
    loadCurrent();
  }
  async function replay() {
    const entry = current();
    if (entry?.kind !== 'file') return;
    if (player.playing) { player.stop(); return; }
    try { const big = await tooBig(entry); if (big && !confirmed('preview')) return; preview(entry, big); } catch (err) { setInfo(`Cannot open ${entry.name}: ${err.message ?? err}`, 'bad'); }
  }
  askPreview.addEventListener('click', () => { const e = current(); if (e) { list.focus(); preview(e, true); } });
  askLoad.addEventListener('click', () => { list.focus(); loadCurrent(); });

  // ---- keys ----
  list.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = here(), step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
    let used = true;
    if (step) select((t?.index ?? 0) + step);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select((t?.entries.length ?? 1) - 1);
    else if (e.key === 'Enter') activate();
    else if (e.key === 'ArrowRight') { if (current()?.kind === 'dir') open(current()); }
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace') goUp();
    else if (e.key === 'Escape') { stopAll(); if (t && current()?.kind === 'file') select(t.index, { play: false }); }
    else if (e.key === ' ') replay();
    else if (t && e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const from = typed.length > 1 ? t.index : t.index + 1, names = t?.entries.map(x => x.name.toLowerCase()) ?? [];
      const at = [...names.slice(from), ...names.slice(0, from)].findIndex(n => n.startsWith(typed));
      if (at >= 0) select((from + at) % names.length);
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  });
  for (const type of ['keyup', 'keypress']) list.addEventListener(type, e => { if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || e.key.startsWith('Arrow') || e.key === 'Enter')) e.stopPropagation(); });

  // ---- choosing where to look ----
  const start = async entry => { trail = []; cache.clear(); stopAll(); await open(entry); list.focus(); };
  pick.addEventListener('click', async () => {
    if (typeof picker !== 'function') { folderInput.click(); return; }
    try {
      const handle = await picker({ id: 'wax-samples', mode: 'read', startIn: 'music' });
      try { await handles.save(handle); } catch { /* it still works for this visit */ }
      reopen.hidden = true;
      await start(dirEntryFromHandle(handle));
    } catch (err) { if (err?.name !== 'AbortError') say(`Could not open the folder: ${err.message ?? err}`); }
  });
  folderInput.addEventListener('change', async () => {
    const chosen = [...folderInput.files]; folderInput.value = '';
    const entry = dirEntryFromTree(chosen);
    if (!(await entry.list()).length) { say('No audio files in that folder.'); return; }
    await start(entry);
  });
  files.addEventListener('change', async () => {
    const chosen = [...files.files].filter(f => isAudioName(f.name)); files.value = '';
    if (!chosen.length) { say('No audio files in that choice.'); return; }
    await start(dirEntryFromFiles(chosen));
  });
  up.addEventListener('click', () => { goUp(); list.focus(); });
  if (typeof picker !== 'function') { pick.textContent = 'Choose folder…'; pick.title = 'This browser cannot remember the folder, so it is asked for again each visit'; filesBtn.hidden = false; }
  filesBtn.addEventListener('click', () => files.click());

  // the folder from last time: straight in when the browser still allows it, else one click to allow it again
  (async () => {
    if (typeof picker !== 'function') return;
    const handle = await handles.load();
    if (!handle) return;
    let state = 'prompt';
    try { state = await handle.queryPermission({ mode: 'read' }); } catch { /* an old handle */ }
    if (state === 'granted') { await start(dirEntryFromHandle(handle)); return; }
    reopen.textContent = `Reopen ${handle.name}`; reopen.hidden = false;
    reopen.addEventListener('click', async () => {
      try { if (await handle.requestPermission({ mode: 'read' }) === 'granted') { reopen.hidden = true; await start(dirEntryFromHandle(handle)); } else say('The folder was not opened.'); }
      catch (err) { say(`Could not reopen the folder: ${err.message ?? err}`); }
    });
  })();

  render();
  return { stop: stopAll, focus: () => list.focus(), get entries() { return here()?.entries ?? []; }, get index() { return here()?.index ?? -1; } };
}
