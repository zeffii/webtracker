import { Engine } from './audio/engine.js';
import { encodeWav, renderSong } from './audio/export.js';
import { createMeters } from './ui/meters.js';
import { createSplash } from './ui/splash.js';
import { createMachineHelp } from './ui/machinehelp.js';
import { parseRules, analyse, resolve, stepsOf, label as stepLabel, describe as describeRule, noteUnknown, unknownTyped, clearUnknown, ACTIONS } from './ui/console.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { helpPage } from './graph/help.js';
import { createBackups, hashOf, idbStore, memoryStore, stamp } from './project/backup.js';
import { createBackupPanel } from './ui/backuppanel.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createInsertMenu } from './graph/menu.js';
import { createSynthwaveProject } from './project/synthwave.js';
import { createArpDemoProject } from './project/arpdemo.js';
import { artCanvas, encodeMp4 } from './audio/mp4.js';
import { createVisData } from './ui/visdata.js';
import { createVisual, createLabels, DEFAULT_GLSL } from './ui/visual.js';
import { TEMPLATES } from './ui/vistemplates.js';
import { GUIDE } from './ui/shaderguide.js';
import { paletteColours } from './ui/palettes.js';
import { createSampleBrowser } from './ui/samplebrowser.js';
import { createShaderView } from './ui/shaderview.js';
import { mountConfig } from './ui/quickconfig.js';
import { createDspView } from './ui/dspview.js';
import * as ops from './project/ops.js';
import { importMidi, parseMidi } from './project/midi.js';
import { modToProject, parseMod } from './project/mod.js';
import * as presets from './project/presets.js';
import { LIBRARY_EXT, addToLibrary, importFromLibrary, newLibrary, parseLibrary, serializeLibrary } from './project/library.js';
import { createRecorder } from './project/recorder.js';
import { poolId, isPool, ensurePool, usersOfSample } from './project/ops.js';
import { idFromName, uniqueId, addLane, addSample, replaceSample, addSamplerInstrument, addSynthInstrument, channelsOf, sampleMessage, slotsOf, syncSamplerStereo } from './project/ops.js';
import { MASTER, SHADER, GRAPH, ensureMaster, synthKinds } from './instruments.js';
import { createMetaEditor } from './ui/metaeditor.js';
import { createStreams } from './ui/streams.js';
import { createNodeSeqEditor } from './nodeseq/editor.js';
import { ensureGraph, cleanGraph } from './nodeseq/graphops.js';
import { createSampleScreen } from './project/samplescreen.js';
import { createWaveformView } from './project/waveform.js';
import { showContextMenu } from './ui/ctxmenu.js';
import { buildInstrument, fitTail } from './project/ptr.js';
import { ABOUT, CHANGELOG } from './ui/about.js';
import { renderMarkdown } from './ui/markdown.js';
import { TUTORIAL } from './script/tutorial.js';
import { mountWidgets } from './script/euclidhelp.js';
import { createMidiInput } from './ui/midiin.js';
import { createOscClient } from './ui/oscclient.js';
import { noteMessage } from './osc.js';
import { scanChords, patternFrom } from './project/chordscan.js';
import { noteToken } from './seq/cells.js';
import { createMidiWriter } from './seq/midiwrite.js';
import { createMarkerRegionView } from './project/markerregion.js';
import { FILE_EXT, INSTRUMENT_EXT, parseInstrument, parseProject, serializeInstrument, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { toggleLoop, loopRange, loopActive } from './seq/loop.js';
import { prepareSong, rebuildInstrumentLanes } from './seq/lane.js';
import * as config from './ui/config.js';
import { createSequenceView } from './seq/seqview.js';
import { attachGrip } from './ui/grip.js';
import { createTrackerView } from './seq/view.js';
import { createTabs } from './ui/tabs.js';
import { createScriptRunner } from './script/client.js';
import { createScriptScreen } from './script/screen.js';
import { createScratch, sendEdits } from './script/scratch.js';
import { placementAt } from './seq/edit.js';

const engine = new Engine();
engine.dither = config.get('dither'); engine.volFloor = config.get('volFloor'); engine.delayComp = config.get('delayComp');
config.onChange((k, v) => {
  if (k === 'dither') engine.setDither(v); else if (k === 'volFloor') engine.setVolFloor(v);
  else if (k === 'delayComp') { engine.setDelayComp(v); for (const id of Object.keys(project?.instruments ?? {})) reloadInstrument(id); }   // every machine is compiled again, with or without the lining up
});
const $ = id => document.getElementById(id);
let started = false, playing = false, project = null, recording = false;

const PLAY_ICON = '<svg class="ico" viewBox="0 0 12 12"><path d="M2.5 1 L10.5 6 L2.5 11 Z" fill="currentColor"/></svg>';
const STOP_ICON = '<svg class="ico" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';
let pausedAt = null;   // the tick a pause stopped at; Play carries on from there
const setPaused = tick => { pausedAt = tick; $('pause').setAttribute('aria-pressed', String(tick !== null)); };
const setPlaying = (value, from = null) => {
  if (value && from === null && pausedAt !== null) from = pausedAt;   // after a pause, Play resumes
  setPaused(null);
  playing = value;
  if (playing) scratch?.stop?.();
  if (playing) engine.play(from); else engine.stop();
  if (playing) engine.wake().then(ok => { if (!ok && playing) $('status').textContent = `The audio context is ${engine.ctx.state}, so nothing can sound: press Play again, and if it stays silent reload the page (the audio device may have changed).`; });
  $('play').innerHTML = playing ? STOP_ICON : PLAY_ICON;
  $('play').title = playing ? 'Stop (F8)' : pausedAt !== null ? 'Play: carry on from the pause' : 'Play (F5)';
  $('play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  if (recording) { if (playing) writer.beginPass(); else writer.endPass(); }   // each run of the song is its own undo step
  nsFlags(); if (!playing) nsView?.stopped();
};
const togglePlay = () => setPlaying(!playing);
// Pause stops where the song is and keeps the place; Pause again, or Play, carries on from there (notes held across the pause start again).
const togglePause = () => {
  if (!started) return;
  if (pausedAt !== null) { const at = pausedAt; setPlaying(true); $('status').textContent = `Carrying on from row ${at}.`; }
  else if (playing) { const at = Math.floor(engine.position); setPlaying(false); setPaused(at); $('play').title = 'Play: carry on from the pause'; $('status').textContent = `Paused at row ${at}. Play carries on from here.`; }
};
$('pause').addEventListener('click', e => { togglePause(); e.currentTarget.blur(); });
// Panic: every sounding note stops, and held keyjazz keys are let go.
$('cut').addEventListener('click', e => { if (playing) setPlaying(false); engine.cut(); patcher.releaseKeys(); e.currentTarget.blur(); });
$('panic').addEventListener('click', e => { engine.panic(); patcher.releaseKeys(); e.currentTarget.blur(); });
$('play').addEventListener('click', e => { togglePlay(); e.currentTarget.blur(); });

// The Script panel docked beside the pattern editor: shown with it while the Patterns tab is up.
let keysRefresh = () => {};   // set once the floating shortcuts window exists
let scriptDock = false, dockW = 0;
try { scriptDock = localStorage.getItem('webtracker.scriptDock') === '1'; dockW = Number(localStorage.getItem('webtracker.scriptDockW')) || 0; } catch {}
function applyDock(id = 'patterns', relayout = true) {
  document.body.classList.toggle('sdock', scriptDock);
  if (dockW) document.body.style.setProperty('--dock-w', `${dockW}px`);
  $('script-dock').setAttribute('aria-pressed', String(scriptDock));
  $('script-dock').classList.toggle('active', scriptDock);
  if (id === 'patterns') $('pane-script').hidden = !scriptDock;
  if (relayout) try { view.relayout(); } catch {}
}
function toggleDock() {
  scriptDock = !scriptDock;
  try { localStorage.setItem('webtracker.scriptDock', scriptDock ? '1' : '0'); } catch {}
  applyDock(tabs.active);
  if (scriptDock && tabs.active === 'patterns') $('script').focus(); else if (!scriptDock && tabs.active === 'patterns') $('view').focus();
}
$('script-help').addEventListener('click', e => {
  const on = document.body.classList.toggle('shelp');
  $('script-help').setAttribute('aria-pressed', String(on));
  e.currentTarget.blur();
});
$('script-dock').addEventListener('click', e => { toggleDock(); e.currentTarget.blur(); });
$('dock-grip').addEventListener('mousedown', e => {
  e.preventDefault();
  const move = m => { dockW = Math.max(240, Math.min(window.innerWidth - 360, window.innerWidth - m.clientX)); applyDock(tabs.active); };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); try { localStorage.setItem('webtracker.scriptDockW', String(dockW)); } catch {} };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
// The script / scratch splitter and the help column's width: dragged, remembered.
{
  const root = document.body, num = k => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
  const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  const sw = num('webtracker.scriptW'), kw = num('webtracker.keysW');
  if (sw) root.style.setProperty('--script-w', `${sw}px`);
  if (kw) root.style.setProperty('--keys-w', `${kw}px`);
  const drag = (grip, onMove, key) => grip.addEventListener('mousedown', e => {
    e.preventDefault();
    let v = 0;
    const move = m => { v = onMove(m); },
      up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (v) save(key, v); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  drag($('script-split'), m => {
    const left = $('script-left').getBoundingClientRect().left, room = $('pane-script').querySelector('.pane-main').getBoundingClientRect().width;
    const w = Math.round(Math.max(280, Math.min(room - 300, m.clientX - left)));
    root.style.setProperty('--script-w', `${w}px`);
    return w;
  }, 'webtracker.scriptW');
  drag($('keys-grip'), m => {
    const w = Math.round(Math.max(200, Math.min(window.innerWidth - 400, window.innerWidth - m.clientX - (root.classList.contains('sdock') ? 0 : 8))));
    root.style.setProperty('--keys-w', `${w}px`);
    return w;
  }, 'webtracker.keysW');
}
// Full-screen panes. Switching with an F-key or a click focuses the pane's main element.
let shaderView = null, dspView = null, nsView = null;
let sampleBrowser = null;
let replaceTarget = null;   // the slot a Replace button was pressed on, while the file chooser is open   // the sample browser (made further down); leaving the Samples screen stops what it is playing
let tabBefore = 'patterns', tabNow = 'patterns';   // where the Info close button goes back to
const tabs = createTabs({
  onChange: id => { if (id !== 'samples') sampleBrowser?.stop(); if (id === 'dsp') dspView?.open(patcher?.instrument); if (id === 'nodeseq') nsView?.refresh(); nsFlags(); if (id === 'shader') { shaderView?.load(); if (!vizOn) config.set('visualOn', true); } if (id !== tabNow) { tabBefore = tabNow; tabNow = id; } applyDock(id); keysRefresh(id); requestAnimationFrame(() => { fitArrangement(); syncFloat(); placeViz(); placeMeters(); }); },
  tabs: [
    { id: 'patterns', key: 'F1', el: $('pane-patterns'), button: $('tab-patterns'), focus: $('view') },
    { id: 'samples', key: 'F2', el: $('pane-samples'), button: $('tab-samples'), focus: $('smp') },
    { id: 'instruments', key: 'F3', el: $('pane-instruments'), button: $('tab-instruments'), focus: $('inst-list') },
    { id: 'arrange', key: 'F4', el: $('pane-arrange'), button: $('tab-arrange'), focus: $('seq') },
    { id: 'config', key: 'F11', el: $('pane-config'), button: $('tab-config'), focus: $('cfg') },
    { id: 'script', key: null, combo: e => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS', el: $('pane-script'), button: $('tab-script'), focus: $('script') },
    { id: 'shader', key: null, combo: e => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyG', el: $('pane-shader'), button: $('tab-shader'), focus: $('shader-input') },
    { id: 'dsp', key: null, combo: e => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyI', el: $('pane-dsp'), button: $('tab-dsp'), focus: $('dsp-src') },
    { id: 'nodeseq', key: null, combo: e => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyN', el: $('pane-nodeseq'), button: $('tab-nodeseq'), focus: { focus: () => nsView?.focus() } },
    { id: 'info', key: 'F10', el: $('pane-info'), button: $('tab-info'), focus: { focus: () => (!$('info').hidden ? $('info') : $('info-view')).focus() } },
  ],
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY') && tabs.active === 'instruments' && !e.target.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select')) {   // undo and redo in the graph editor
    e.preventDefault(); (e.code === 'KeyY' || e.shiftKey ? patcher.redo() : patcher.undo()); return;
  }
  if (e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && tabs.active === 'instruments' && (!nodeHelp.hidden ? (hideHelp(), true) : patcher.helpSelected())) { e.preventDefault(); return; }   // F1 on the instrument screen shows or hides the help of the selected node
  if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); toggleDock(); return; }
  if (e.key === 'F2' && e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && tabs.active === 'instruments' && project) { e.preventDefault(); renameInstrumentBox(); return; }   // rename the selected instrument
  if (tabs.handleKey(e)) return;
  const here = () => (tabs.active === 'arrange' ? seqView : view).tick;   // the row the cursor is on
  // Ctrl+Shift+R arms and disarms MIDI recording; Alt+V switches MIDI velocity on and off.
  if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyM') { e.preventDefault(); toggleMeters(); return; }
  if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyV') { e.preventDefault(); toggleViz(); return; }
  if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyO') { e.preventDefault(); toggleScope(); return; }
  if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyH') { e.preventDefault(); toggleHelp(); return; }
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyR' && project) { e.preventDefault(); setRecording(!recording); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyV' && project) {
    e.preventDefault();
    const on = !config.get('midiVelocity'); config.set('midiVelocity', on); midiSay(on ? 'MIDI velocity on: key velocity is played and written.' : 'MIDI velocity off: the default volume, nothing written.');
    return;
  }
  // Alt+Up / Alt+Down: the song's tempo, 1 bpm at a time (10 with Shift).
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && project) {
    e.preventDefault();
    const bpm = Math.max(20, Math.min(400, project.song.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
    if (bpm !== project.song.bpm) { project.song.bpm = bpm; $('bpm').value = bpm; songChanged(); }
    $('status').textContent = `Tempo ${bpm} bpm.`;
    return;
  }
  // Alt+S: solo the lane under the cursor (the other lanes let go and play nothing); again to bring everyone back.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS' && project && (tabs.active === 'arrange' || tabs.active === 'patterns')) {
    e.preventDefault();
    const li = seqView.lane, on = project.editor.solo(li), name = project.lanes[li]?.id;
    const text = on === null ? 'The master lane cannot be soloed.' : on ? `${name} solo.` : project.lanes.some(l => l.solo) ? `${name} unsoloed.` : 'Solo off: every lane plays.';
    seqView.say(text); view.say(text);
    return;
  }
  // Alt+M: silence the lane under the cursor whatever its marks say (the pair of Alt+S); again to bring it back.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM' && project && (tabs.active === 'arrange' || tabs.active === 'patterns')) {
    e.preventDefault();
    const li = seqView.lane, name = project.lanes[li]?.id, on = project.editor.silence(li);
    const text = on ? `${name} muted.` : `${name} is back on.`;
    seqView.say(text); view.say(text);
    seqView.draw?.(); view.draw?.();
    return;
  }
  const fKeys = { F5: () => setPlaying(true), F6: () => setPlaying(true, here()), F7: () => engine.playRow(here()), F8: () => setPlaying(false), F9: toggleFollow, Pause: togglePause };
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && fKeys[e.key]) {
    e.preventDefault();
    if (started || e.key === 'F9') fKeys[e.key]();
    return;
  }
});

// Song info: a plain text page of notes and greetings, kept in the project.
const infoStatus = () => { const t = $('info').value; $('info-status').textContent = `${t ? t.split('\n').length : 0} lines · ${t.length} characters`; };
// Not editing, the text is shown with its web addresses as links; editing is a plain text box.
const renderInfo = () => {
  const box = $('info-view');
  box.replaceChildren();
  for (const [i, part] of $('info').value.split(/(https?:\/\/[^\s<>"']+)/g).entries()) {
    if (i % 2 === 0) { box.append(part); continue; }
    const url = part.replace(/[.,;:!?)\]]+$/, ''), a = document.createElement('a');
    a.href = url; a.textContent = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    box.append(a, part.slice(url.length));
  }
};
const editInfo = on => {
  if (!on) renderInfo();
  $('info').hidden = !on; $('info-view').hidden = on;
  $('info-edit').textContent = on ? 'Done' : 'Edit';
  (on ? $('info') : $('info-view')).focus();
};
$('info-close').addEventListener('click', () => tabs.show(tabBefore === 'info' ? 'patterns' : tabBefore));
$('info-edit').addEventListener('click', () => editInfo(!$('info').hidden === false));
$('info-view').addEventListener('dblclick', () => editInfo(true));
$('info').addEventListener('keydown', e => { if (e.key === 'Escape') { editInfo(false); e.preventDefault(); } });
$('info').addEventListener('input', () => {
  if (project) { if ($('info').value) project.song.info = $('info').value; else delete project.song.info; }
  infoStatus();
});

// Follow mode: the grids move with the playing row instead of the row marker moving. F9 or the button; remembered here.
let following = config.get('follow');
const syncFollow = () => $('follow').setAttribute('aria-pressed', String(following));
const toggleFollow = () => { if (following && (seqView.resume() | view.resume())) return; config.set('follow', !following); };   // while paused by moving the caret, it follows again first
config.onChange((k, v) => { if (k === 'follow') { following = v; syncFollow(); } });
$('follow').addEventListener('click', () => { toggleFollow(); $('follow').blur(); });
syncFollow();

// The instrument editor shows the machine of the lane the cursor is in (a setting on the Config tab).
let lastLane = -1;
let floatWanted = false;   // the floating parameter window is on: it needs the cursor lane's machine
function followLane(laneIdx) {
  if (laneIdx === lastLane) return;
  lastLane = laneIdx;
  const id = project?.lanes[laneIdx]?.instrument;
  if ((!config.get('followLane') && !floatWanted) || !id || id === patcher.instrument || !(id in project.instruments)) return;
  patcher.show(id);
  renderInstList();
  if (floatWanted) syncFloat();
}

// The machine help panel (Ctrl+Alt+H, or the pattern editor's right-click menu): what the cursor lane's columns and commands do.
const help = createMachineHelp({ onInsert: id => view.typeCommand(id) });
const toggleHelp = () => { if (project) help.toggle(project.lanes[view.lane]); };
const view = createTrackerView({
  follow: () => following,
  el: $('view'), statusEl: $('cursor'), undoEl: $('seq-undo'), transport: engine.transport, onToggle: togglePlay,
  onBack: () => tabs.show('arrange'),
  onRow: tick => { if (started) engine.playRow(tick); },
  onMove: (lane, tick) => { seqView.goto(lane, tick); followLane(lane); help.update(project?.lanes?.[lane]); },
  onHelp: (lane, id) => help.show(project.lanes[lane], id),
  onSong: () => songChanged(),
  readParam: slot => engine.registry.values[slot],
  onNote: (instrument, note, on, vel = 1) => { if (!started) return; if (on) engine.noteOn(instrument, note, vel); else engine.noteOff(instrument, note); },
});
// The sample lists of the pickers: every normal sample, and the tap slots that hold a take or that an instrument already
// plays; the other tap slots are left out unless Config says to show them.
const pickableSamples = () => {
  const used = new Set(Object.values(project.instruments ?? {}).flatMap(d => Object.values(d.samples ?? {}).flat()));
  return Object.entries(project.samples).filter(([id, smp]) => !isPool(id) || smp.taken || used.has(id) || config.get('tapSlots')).map(([id]) => id);
};
const seqView = createSequenceView({
  follow: () => following,
  el: $('seq'), statusEl: $('seq-status'), undoEl: $('seq-undo'), listEl: $('seq-list'), transport: engine.transport, onToggle: togglePlay,
  onOpen: (lane, tick, { solo = false } = {}) => { if (!solo || !view.enterSolo(lane, tick)) view.goto(lane, tick); tabs.show('patterns'); },
  onMove: (lane, tick) => { view.goto(lane, tick); followLane(lane); help.update(project?.lanes?.[lane]); },
  onParams: () => setFloat(true),
  instruments: () => listedInstruments(),
  unassigned: () => { const used = new Set(project.lanes.map(l => l.instrument)); return listedInstruments().filter(id => !used.has(id)); },
  newKinds: () => [
    ...Object.entries(synthKinds).filter(([k]) => k !== 'empty').map(([k, { label }]) => ({ value: `synth:${k}`, label })),
    { value: 'sampler', label: 'Sampler (plays a sample)', disabled: !$('new-inst-sample').value },
    { value: 'synth:empty', label: synthKinds.empty.label },
  ],
  onNewInstrument: (value, side) => makeInstrument(value, '', side),
  onAddLane: (id, side) => { try { const at = cursorLane(), lane = addLaneFor(id); placeLane(lane.id, at, side); projStatus(`Added lane ${lane.id}.`); } catch (err) { projStatus(err.message); } },
  onSeek: tick => { if (!started) return; if (playing) engine.play(tick); else setPlaying(true, tick); },
  onSong: () => songChanged(),
  onShape: li => { const l = project?.lanes?.[li]; if (l) engine.setLane({ id: l.id, instrument: l.instrument, columns: l.columns, pages: l.pages, mask: l.mask, auto: l.auto }); },
});

// ---- Scripts ----
// A script runs in a Worker on a copy of the pattern under the pattern editor's cursor (or its selection) and gives back
// the cells to change, which go in as one undo step. See src/script/.
const scriptTarget = () => {
  if (!project?.editor) return { error: 'Open or start a project first.' };
  const li = view.lane, lane = project.lanes[li], pl = lane && placementAt(lane, view.tick);
  if (!pl) return { error: 'There is no pattern under the cursor in the pattern editor: put the cursor in one first (F1).' };
  const pat = lane.patterns[pl.puid], len = Math.min(pl.length, pat.rows.length), r = view.selection;
  const columns = lane.columns.map(c => ({ kind: c.kind, token: c.token, label: c.label, key: c.key, ...(c.param ? { param: c.param, node: c.node, base: c.base } : {}) }));
  const selection = r ? { r0: Math.max(0, r.t0 - pl.start), r1: Math.min(len - 1, r.t1 - pl.start), c0: r.c0, c1: r.c1 } : null;
  const shared = lane.placements.filter(p => p.puid === pl.puid).length;
  if (shared > 1 && config.get('midiShared') === 'ask') return { error: `This pattern is used ${shared} times: clone it first (Ctrl+G in the pattern editor), or let MIDI and scripts write into shared patterns in Config.` };
  return {
    request: { pattern: { name: pat.name, lane: lane.id, instrument: lane.instrument, columns, rows: pat.rows.slice(0, len) }, selection, cursor: { row: view.tick - pl.start, col: view.col } },
    apply: edits => project.editor.setCells(li, edits.map(e => ({ tick: pl.start + e.row, col: e.col, token: e.token })), 'script'),
    label: `${lane.id} ${pat.name}${shared > 1 ? ` (used ${shared} times)` : ''}`,
  };
};
const scriptRunner = createScriptRunner({ limit: () => config.get('scriptLimit') });
const scriptScreen = createScriptScreen({
  area: $('script'), hl: $('script-hl'), viz: $('script-viz'), runButton: $('script-run'), status: $('script-status'), out: $('script-out'), line: $('script-line'),
  runner: scriptRunner,
  target: scriptTarget,
  onText: text => { if (project) { if (text) project.song.script = text; else delete project.song.script; } },
  midi: () => ({ window: config.get('midiWindow'), order: config.get('midiOrder') }),
});
// The scratch pattern: a grid to explore triggers in before anything is written to a pattern. The script fills it
// (each tbin goes to the next column), and 'send to pattern' writes it into the pattern under the cursor.
const scratch = createScratch({
  el: $('scratch'),
  run: (code, rows) => scriptRunner.run({
    code, scratch: true, selection: null,
    pattern: { name: 'scratch', lane: 'scratch', instrument: '', columns: Array.from({ length: 8 }, (_, i) => ({ kind: 'note', token: 'note', label: `N${i + 1}`, key: `note:${i}` })), rows: Array.from({ length: rows }, () => Array(8).fill('...')) },
  }),
  getCode: () => scriptScreen.text,
  insert: text => scriptScreen.insert(text),
  say: text => scriptScreen.say(text),
  send: cols => {
    const t = scriptTarget();
    if (t.error) return t.error;
    const { columns, rows } = t.request.pattern, sel = t.request.selection;
    const noteCols = columns.flatMap((c, i) => (c.token === 'note' ? [i] : []));
    const res = sendEdits(cols, noteCols, sel ? sel.r0 : 0, rows.length);
    if (res.error) return `Not sent: ${res.error}.`;
    const n = t.apply(res.edits);
    return `${t.label}: ${n} cell${n === 1 ? '' : 's'} written from the scratch pattern.`;
  },
  voice: () => {
    if (!started) return { error: 'Click the first screen to start the audio first.' };
    const id = project?.lanes?.[view.lane]?.instrument;
    if (!id || id === 'master') return { error: 'Put the pattern cursor in a lane with an instrument (pattern editor) to hear the grid.' };
    return { on: m => engine.noteOn(id, m, 1), off: m => engine.noteOff(id, m), tickMs: () => 60000 / (project.song.bpm * project.song.ticksPerBeat) };
  },
});

// Ctrl+Alt+R in the pattern editor: run the whole script on the pattern there.
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') || tabs.active !== 'patterns') return;
  e.preventDefault();
  view.say('Running the script...');
  scriptScreen.run().then(text => view.say(text));
});

// ---- the floating parameter window ----
// The exposed sliders of the cursor lane's machine, over the pattern editor or the arrangement; the graph's own dock covers the rest.
const floatBox = $('float-params');
const syncFloat = () => {
  const show = floatWanted && (tabs.active === 'patterns' || tabs.active === 'arrange');
  patcher.float(show);
  $('float-toggle').setAttribute('aria-pressed', String(floatWanted));
  if (show) $('float-name').textContent = `${patcher.instrument ?? ''} · parameters`;
};
const setFloat = on => {
  floatWanted = on;
  try { localStorage.setItem('webtracker.float', on ? '1' : '0'); } catch {}
  if (on) { lastLane = -1; followLane(seqView.lane); }
  syncFloat();
};
{
  try { floatWanted = localStorage.getItem('webtracker.float') === '1'; } catch {}
  try {
    const pos = JSON.parse(localStorage.getItem('webtracker.floatPos') ?? 'null');
    if (pos) { floatBox.style.left = `${pos.x}px`; floatBox.style.top = `${pos.y}px`; floatBox.style.right = 'auto'; }
  } catch {}
  const title = $('float-title');
  title.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = floatBox.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    title.setPointerCapture(e.pointerId);
    const move = ev => {
      const x = Math.min(innerWidth - 40, Math.max(0, ev.clientX - dx)), y = Math.min(innerHeight - 24, Math.max(0, ev.clientY - dy));
      Object.assign(floatBox.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
    };
    const up = () => {
      title.removeEventListener('pointermove', move); title.removeEventListener('pointerup', up);
      const b = floatBox.getBoundingClientRect();
      try { localStorage.setItem('webtracker.floatPos', JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top) })); } catch {}
    };
    title.addEventListener('pointermove', move); title.addEventListener('pointerup', up);
  });
  $('float-toggle').addEventListener('click', e => { setFloat(!floatWanted); e.currentTarget.blur(); });
  $('float-close').addEventListener('click', () => setFloat(false));
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyP')) return;
    e.preventDefault(); setFloat(!floatWanted);
  });
}

// ---- MIDI keyboard ----
// Plays the machine under the cursor (the selected instrument in the graph view, the sample on the sample screen), enters
// notes at the cursor in the pattern editor, and with Rec armed writes them into the playing song on the nearest tick.
const midiVoices = new Map();   // MIDI note -> what its press started, so the release stops that and nothing else
const midiSay = text => { (tabs.active === 'arrange' ? seqView : view).say(text); };
const writer = createMidiWriter({
  lanes: () => project?.lanes ?? [], editor: () => project.editor, length: () => project.song.length, loop: () => (project.song.loop && !project.song.loop.off ? project.song.loop : null),
  settings: () => ({ chord: config.get('midiChord'), window: config.get('midiWindow'), velocity: config.get('midiVelocity'), offs: config.get('midiOffs'), paramStep: config.get('midiParamStep'), shared: config.get('midiShared'), order: config.get('midiOrder') }),
});
// A slider moved while recording: into the cursor lane if it plays that machine, else the first lane that does.
const saidParam = new Set();
function recordParam(instrument, node, param, value) {
  const lanes = project?.lanes ?? [];
  const li = lanes[seqView.lane]?.instrument === instrument ? seqView.lane : lanes.findIndex(l => l.instrument === instrument);
  if (li < 0) return;
  const r = writer.recParam({ li, node, param, value, pos: engine.position - latencyTicks() });
  if (!r.wrote && r.message && !saidParam.has(r.message)) { saidParam.add(r.message); midiSay(r.message); }
}
const setRecording = on => {
  saidParam.clear();
  recording = on;
  $('rec').setAttribute('aria-pressed', String(on));
  if (on) writer.beginPass(); else writer.endPass();
  nsFlags(); nsView?.refresh();
  midiSay(on ? (playing ? 'Recording: play on the MIDI keyboard.' : 'Rec armed: it records while the song plays.') : 'Recording off.');
};
$('rec').addEventListener('click', e => { setRecording(!recording); e.currentTarget.blur(); });
const latencyTicks = () => {
  const ms = engine.health().latency + config.get('midiLatency');   // (with delay compensation on, the position already is where the sound is)
  return ms / (60000 / (project.song.bpm * project.song.ticksPerBeat));
};
const midiIn = createMidiInput({
  channel: () => config.get('midiChannel'),
  onState: ({ on, names, error }) => { if (error) midiSay(error); else if (on) midiSay(names.length ? `MIDI: ${names.join(', ')}` : 'MIDI on, no input found.'); },
  onNote: ({ on, note, vel, time }) => {
    if (!started || !project) return;
    const v = config.get('midiVelocity') ? Math.max(1, vel) / 127 : 1;
    const tab = tabs.active;
    if (!on) {   // a release: stop what the press started, then the writers see it
      const s = midiVoices.get(note);
      midiVoices.delete(note);
      if (s?.id !== undefined) engine.noteOff(s.id, note);
      else if (s?.sample !== undefined) playSample(s.sample, note, false);
      if (recording && playing && (tab === 'arrange' || tab === 'patterns')) writer.recOff({ midi: note, pos: engine.position - latencyTicks() });
      if (tab === 'patterns') {
        const end = writer.stepOff({ midi: note });
        if (end.ended && config.get('midiAdvance') === 'row' && view.lane === end.li && view.tick === end.tick) view.stepRows(1);
      }
      return;
    }
    if (tab === 'patterns' || tab === 'arrange') {
      const li = tab === 'arrange' ? seqView.lane : view.lane, lane = project.lanes[li], id = lane?.instrument;
      if (!id || id === 'master') return;
      const prev = midiVoices.get(note);
      if (prev?.id !== undefined) engine.noteOff(prev.id, note);
      midiVoices.set(note, { id });
      engine.noteOn(id, note, v);
      let result = null;
      if (recording && playing) result = writer.recOn({ li, midi: note, vel, pos: engine.position - latencyTicks() });
      else if (tab === 'patterns') result = writer.stepOn({ li, tick: view.tick, col: view.col, midi: note, vel, time });
      if (result?.message) midiSay(result.message);
    } else if (tab === 'script') {
      scriptScreen.midiNote(note);
    } else if (tab === 'instruments') {
      const id = patcher.instrument;
      if (!id) return;
      midiVoices.set(note, { id });
      engine.noteOn(id, note, v);
    } else if (tab === 'samples' && sampleScreen.selected) {
      midiVoices.set(note, { sample: sampleScreen.selected });
      playSample(sampleScreen.selected, note, true);
    }
  },
});
config.onChange(k => { if (k === 'midiOn') midiIn.enable(config.get('midiOn')); });
if (config.get('midiOn')) midiIn.enable(true);

// The help page of a node (F1 with a node selected, or the ? on its parameter window): a panel over the instrument screen.
const nodeHelp = $('node-help');
function showHelp(type) {
  const def = NODE_TYPES[type];
  if (!def) return;
  const page = helpPage(type, def);
  $('node-help-title').textContent = page.title;
  $('node-help-body').innerHTML = page.html;
  nodeHelp.hidden = false;
  $('node-help-body').scrollTop = 0;
  nodeHelp.focus();
}
function hideHelp() { if (nodeHelp.hidden) return false; nodeHelp.hidden = true; $('patch').focus(); return true; }
nodeHelp.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); e.stopPropagation(); hideHelp(); } });
$('node-help-close').addEventListener('click', hideHelp);
const monoOf = new WeakMap();   // a stereo sample's one-channel mix, for the granular scope
const patcher = createPatcher({
  onHelp: showHelp,
  // the song's tick, for the lines on time and rate sliders: how long it is, how many make a beat, whether to show them and snap to them
  getTiming: () => (project?.song ? { tickMs: 60000 / (project.song.bpm * project.song.ticksPerBeat), perBeat: project.song.ticksPerBeat, lines: config.get('tickLines'), snap: config.get('tickSnap') } : null),
  onNote: (id, note, on) => { if (!started) return; if (on) engine.noteOn(id, note, 1); else engine.noteOff(id, note); },
  canvas: $('patch'), panel: $('patch-panel'), toolsEl: $('patch-tools'), paramPanel: $('patch-scroll'), exposedDock: $('exposed-scroll'), floatDock: $('float-scroll'), onEscape: () => $('inst-list').focus(), statusEl: $('patch-status'), nodeTypes: NODE_TYPES,
  onStructure: id => reloadInstrument(id),
  onContext: ({ x, y, replace, wire }) => menu.open(x, y, replace, wire),
  onData: (id, node, msg) => engine.sendToNode(id, node, msg),
  onScope: (id, node, on) => {
    engine.scope(id, node, on);
    if (project?.instruments[id]?.graph.nodes.some(n => n.id === node && n.type === 'granular')) engine.sendToNode(id, node, { type: 'watch', on });   // a granular scope draws its grains
  },
  getGrainSource: (id, node) => {   // the sample a granular node reads, as one channel
    const inst = project?.instruments[id], n = inst?.graph.nodes.find(q => q.id === node);
    if (!n) return null;
    const a = `${id}.${node}.sample`, pick = Math.max(0, Math.floor(engine.registry.slots.has(a) ? engine.registry.get(a) : n.params?.sample ?? 0));
    const s = project.samples[slotsOf(inst.samples?.[node])[pick]];
    if (!s) return null;
    if (!s.right) return s.data;
    let m = monoOf.get(s.data);
    if (!m) monoOf.set(s.data, m = Float32Array.from(s.data, (v, i) => (v + s.right[i]) * 0.5));
    return m;
  },
  readLive: (id, node, name) => { const a = `${id}.${node}.${name}`; return engine.registry.slots.has(a) ? engine.registry.get(a) : undefined; },
  getSampleIds: () => pickableSamples(),
  getSample: id => { const s = project.samples[id]; return s ? { data: s.right ? Float32Array.from(s.data, (v, i) => (v + s.right[i]) * 0.5) : s.data, rate: s.rate } : null; },
  onParam: (id, node, name, value) => {
    const address = `${id}.${node}.${name}`;
    if (engine.registry.slots.has(address)) engine.set(address, value);
    if (recording && playing) recordParam(id, node, name, value);
  },
});

// The height of the graph area, the pattern editor and the arrangement: drag the bar under each (or Up/Down on it);
// the rest of the screen follows. The choices are remembered in this browser.
// The graph fills the space between the list and the shortcut panel.
if (globalThis.ResizeObserver) new ResizeObserver(() => { const w = $('patch-wrap').clientWidth; if (w > 0) patcher.fit(w - 2); }).observe($('patch-wrap'));
// The arrangement's pattern list: drag the bar between it and the sequence (all the way right hides it; double-click toggles).
{
  const pane = $('pane-arrange'), grip = $('side-grip'), DEFAULT = 320;
  let w = DEFAULT;
  try { const n = localStorage.getItem('webtracker.sideWidth'); if (n !== null) w = Number(n); } catch {}
  const apply = n => {
    w = Math.max(0, Math.min(700, Math.round(n)));
    if (w < 70) w = 0;
    pane.classList.toggle('noside', w === 0);
    if (w) pane.style.setProperty('--side-w', `${w}px`);
    try { localStorage.setItem('webtracker.sideWidth', String(w)); } catch {}
    try { seqView.draw(); } catch {}
  };
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture?.(e.pointerId); grip.classList.add('dragging'); e.preventDefault();
    const move = ev => { const r = pane.getBoundingClientRect(); apply(r.right - 12 - 8 - ev.clientX); };
    const up = () => { grip.classList.remove('dragging'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => apply(w ? 0 : DEFAULT));
  grip.addEventListener('keydown', e => {
    const d = { ArrowLeft: 1, ArrowRight: -1 }[e.key]; if (!d) return;
    apply((w || 0) + d * (e.shiftKey ? 60 : 20)); e.preventDefault();
  });
  apply(w);
}
// The line between the pattern list and the lane controls below it: drag to give the list more or less height (double-click: automatic).
{
  const list = $('seq-side'), grip = $('list-grip');
  let h = null;
  try { const n = localStorage.getItem('webtracker.listHeight'); if (n !== null) h = Number(n); } catch {}
  const apply = n => {
    h = n === null ? null : Math.max(34, Math.min(900, Math.round(n)));
    list.classList.toggle('sized', h !== null);
    if (h !== null) list.style.setProperty('--list-h', `${h}px`);
    try { if (h === null) localStorage.removeItem('webtracker.listHeight'); else localStorage.setItem('webtracker.listHeight', String(h)); } catch {}
  };
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture?.(e.pointerId); grip.classList.add('dragging'); e.preventDefault();
    const top = list.getBoundingClientRect().top;
    const move = ev => apply(ev.clientY - top - 8);
    const up = () => { grip.classList.remove('dragging'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => apply(null));
  grip.addEventListener('keydown', e => {
    const d = { ArrowUp: -1, ArrowDown: 1 }[e.key]; if (!d) return;
    apply((h ?? list.getBoundingClientRect().height) + d * (e.shiftKey ? 85 : 17)); e.preventDefault();
  });
  apply(h);
}
attachGrip({ grip: $('patch-grip'), key: 'webtracker.graphHeight', get: () => patcher.height, set: h => patcher.resize(h), step: 20, bigStep: 100, normal: 460 });
attachGrip({ grip: $('view-grip'), key: 'webtracker.patternRows', get: () => view.rows, set: n => view.setRows(n), unit: () => view.lineHeight(), step: 1, bigStep: 8, normal: 24 });
// The pattern editor and the arrangement fill the window: the rows shown follow the height that is left (Config: viewFit, seqFit);
// the drag bars are for when that is off. The footer's height changes with the tab (the cursor rows), so the page's bottom padding follows it.
const fitArrangement = () => {
  const foot = $('footer').offsetHeight;
  document.body.style.setProperty('--footer-h', `${foot}px`);
  document.body.classList.toggle('seqfit', config.get('seqFit'));
  document.body.classList.toggle('viewfit', config.get('viewFit'));
  if (config.get('seqFit') && tabs.active === 'arrange') {
    const el = $('seq'), pane = $('pane-arrange'), room = innerHeight - el.getBoundingClientRect().top - foot - 2;
    seqView.setRows(Math.floor(room / 18) - Math.max(0, el.childElementCount - seqView.rows));
    document.body.style.setProperty('--arr-h', `${Math.max(0, innerHeight - pane.getBoundingClientRect().top - foot)}px`);   // the panels reach the top of the status bar
  }
  if (config.get('viewFit') && tabs.active === 'patterns') {
    // the view is as tall as its rows: add or take away what is over or missing, and look again until nothing more fits
    // (one pass is not enough when the font size makes the measured line height a little off)
    const el = $('view');
    for (let pass = 0; pass < 6; pass++) {
      const room = innerHeight - el.getBoundingClientRect().bottom - foot - 8, n = Math.floor(room / view.lineHeight());
      if (n === 0) break;
      view.setRows(view.rows + n);
    }
  }
};
addEventListener('resize', fitArrangement);
if (globalThis.ResizeObserver) new ResizeObserver(() => fitArrangement()).observe($('footer'));
config.onChange(k => { if (k === 'seqFit' || k === 'viewFit') fitArrangement(); });
// A new font size changes the line height: fit again once the grid has been redrawn with it (otherwise rows are left over or missing).
config.onChange(k => { if (k === 'fontSize') requestAnimationFrame(fitArrangement); });
attachGrip({ grip: $('seq-grip'), key: 'webtracker.arrangementRows', get: () => seqView.rows, set: n => seqView.setRows(n), unit: () => 18, step: 1, bigStep: 8, normal: 24 });

// The keyboard shortcuts of the screen in view, in a small floating window: the Shortcuts button opens and closes it, Esc
// closes it, and its title bar drags it. Its text is a copy of the screen's own shortcut list, taken when it opens and when the
// screen changes. (The old fixed panels are always hidden; the script tutorial and the arrangement's pattern list stay.)
(() => {
  document.body.classList.add('nokeys');
  const box = $('keys-float'), body = $('keys-float-body'), button = $('keys-toggle');
  const PANES = { patterns: 'pane-patterns', samples: 'pane-samples', instruments: 'pane-instruments', arrange: 'pane-arrange' };
  const fill = id => {
    const aside = PANES[id] && document.querySelector(`#${PANES[id]} .keys`);
    body.replaceChildren();
    if (!aside) { body.append(Object.assign(document.createElement('p'), { textContent: 'This screen has no shortcut list of its own.' })); return; }
    for (const n of aside.children) if (!['seq-side', 'seq-tools', 'list-grip'].includes(n.id) && n.tagName !== 'H3') body.append(n.cloneNode(true));
    $('keys-float-title').textContent = `Shortcuts: ${id === 'arrange' ? 'arrangement' : id}`;
    narrow();
  };
  // The find box: a shortcut stays when its key and its text together hold every word typed (as whole or partial words).
  const find = $('keys-find');
  const narrow = () => {
    const words = find.value.toLowerCase().split(/\s+/).filter(Boolean);
    body.querySelector('.none')?.remove();
    let shown = 0;
    for (const dl of body.querySelectorAll('dl')) {
      const kids = [...dl.children];
      for (let i = 0; i < kids.length; i += 2) {
        const text = `${kids[i].textContent} ${kids[i + 1]?.textContent ?? ''}`.toLowerCase(), keep = words.every(w => text.includes(w));
        kids[i].hidden = !keep; if (kids[i + 1]) kids[i + 1].hidden = !keep;
        if (keep) shown++;
      }
    }
    if (words.length && !shown) body.append(Object.assign(document.createElement('p'), { className: 'none', textContent: 'No shortcut has all of those words.' }));
  };
  find.addEventListener('input', narrow);
  const open = id => { fill(id); box.hidden = false; button.setAttribute('aria-pressed', 'true'); };   // 
  const close = () => { if (box.hidden) return false; box.hidden = true; button.setAttribute('aria-pressed', 'false'); return true; };
  button.addEventListener('click', () => { if (box.hidden) open(tabs.active); else close(); button.blur(); });
  $('keys-float-close').addEventListener('click', close);
  // Esc closes it before anything else sees the key
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden && close()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // dragging by the title bar
  $('keys-float').querySelector('header').addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = m => { box.style.left = `${Math.max(0, Math.min(innerWidth - 60, m.clientX - dx))}px`; box.style.top = `${Math.max(0, Math.min(innerHeight - 30, m.clientY - dy))}px`; box.style.right = 'auto'; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  keysRefresh = id => { if (!box.hidden) fill(id); };
})();

// The floating insert menu lives over the patcher canvas.
const menu = createInsertMenu({ parent: $('patch-wrap'), nodeTypes: NODE_TYPES, onPick: (type, at, replacing, wire) => (wire != null ? patcher.insertIntoWire(type, wire) : replacing ? patcher.replace(replacing.id, type) : patcher.add(type, at)) });
$('patch').addEventListener('mousedown', () => menu.close());

const sendSample = (id, node) => {
  slotsOf(project.instruments[id].samples[node]).forEach((sampleId, slot) => {
    if (project.samples[sampleId]) engine.sendToNode(id, node, sampleMessage(project.samples[sampleId], slot));
  });
};
const loadInst = id => {
  syncSamplerStereo(project.instruments[id], project.samples);
  engine.loadInstrument(id, project.instruments[id].graph);
};
const sendSamples = id => { for (const node of Object.keys(project.instruments[id].samples ?? {})) sendSample(id, node); };

// Song name, tempo and position, shown in the header on every screen.
const songInfo = () => {
  if (!project) return;
  const looping = String(!!project.song.loop && !project.song.loop.off);
  if ($('loopbtn').getAttribute('aria-pressed') !== looping) $('loopbtn').setAttribute('aria-pressed', looping);
  // the estimated length: the loop when it is on, else the whole song, at the song's tempo (a tempo written in the master lane is not counted)
  const song = project.song, loop = loopActive(song), { start, end } = loopRange(song), ticks = loop ? end - start : song.length;
  const seconds = Math.round(ticks * 60 / (song.bpm * (song.ticksPerBeat ?? 4)));
  const clock = `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}` : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('songtime').textContent = `~${clock}${loop ? ' loop' : ''}`;
  $('songtime-label').title = `Estimated length at ${song.bpm} bpm: ${ticks} ticks, ${loop ? `the loop (ticks ${start} to ${end - 1})` : 'the whole song'}. A tempo set in the master lane is not counted.`;
  const { name, length } = project.song;
  const tick = Atomics.load(engine.transport, 0);
  $('song-info').textContent = `${name ?? 'untitled'} · row ${String(tick).padStart(2, '0')}/${length}`;
};

const projStatus = text => { $('proj-status').textContent = text; };
// the link to the OSC relay, for the OSC out machines
let oscSaid = null;
const osc = createOscClient({ port: () => config.get('oscPort'), onState: ({ up, error }) => { const said = up ? 'up' : error; if (said === oscSaid) return; oscSaid = said; projStatus(up ? 'OSC relay connected.' : `OSC: ${error}.`); } });

// The lists that depend on what the project holds: instruments, samples, the sample list.
function refreshProjectUi() {
  const fill = (select, ids) => {
    const keep = select.value;
    select.replaceChildren(...ids.map(id => new Option(id, id)));
    if (ids.includes(keep)) select.value = keep;
  };
  renderInstList();
  fill($('new-inst-sample'), pickableSamples());
}

// Alt+Left and Alt+Right are the browser's back and forward; they must not leave the page.
document.addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault(); }, true);

// The instruments the list shows: all but the master lane's.
const listedInstruments = () => Object.keys(project.instruments).filter(id => id !== MASTER);

// Keys in the instrument list: Up/Down choose, Home/End jump, Enter goes to the graph.
$('inst-list').addEventListener('keydown', e => {
  if (!project || e.ctrlKey || e.altKey || e.metaKey) return;
  const ids = listedInstruments(), at = ids.indexOf(patcher.instrument);
  const go = to => { patcher.show(ids[Math.min(ids.length - 1, Math.max(0, to))]); renderInstList(); e.preventDefault(); };
  if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(ids.length - 1);
  else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'Tab' && !e.shiftKey) { $('patch').focus(); e.preventDefault(); }
});

// A meta machine has no graph to patch: its Selections editor stands where the patcher does.
const metaEditor = createMetaEditor({
  root: $('meta-editor'),
  getProject: () => project,
  onChange: id => refreshLanes(id),
  onAddLane: id => { addLaneFor(id); refreshProjectUi(); },
  // A machine that a meta machine plays for the first time has no use for an empty lane of its own: it goes from the arrangement
  // (a lane that holds patterns stays, and can be removed by hand).
  onBind: id => {
    const empty = project.lanes.filter(l => l.instrument === id && l.placements.length === 0);
    if (!empty.length) return;
    reshape(() => { for (const l of empty) ops.removeLane(project, l.id); });
    metaEditor.render(`Added. The empty lane of ${id} is gone from the arrangement: the meta machine plays it now.`);
  },
});
function syncMetaEditor() {
  const id = patcher.instrument, meta = !!project?.instruments[id]?.meta;
  if (meta) metaEditor.show(id); else metaEditor.hide();
  for (const part of ['patch-wrap', 'patch-status', 'patch-panel']) $(part).hidden = meta;
}

// The narrow instrument list beside the patcher.
function renderInstList() {
  const buttons = listedInstruments().map((id, i) => {
    const b = document.createElement('button');
    b.textContent = `${id === patcher.instrument ? '>' : ' '} ${String(i + 1).padStart(2, '0')} ${id}`;
    b.tabIndex = -1;
    b.classList.toggle('active', id === patcher.instrument);
    b.addEventListener('click', () => { patcher.show(id); renderInstList(); $('patch').focus(); });
    return b;
  });
  $('inst-list').replaceChildren(...buttons);
  renderLaneInstruments();
  renderPresetList();
  syncPoly();
  syncMetaEditor();
}

// The lane the buttons under the arrangement act on: the one the arrangement cursor is in.
const cursorLane = () => project.lanes[seqView.lane]?.id ?? null;
let shownLane;   // the lane whose name the rename field shows
function syncLaneName() {
  const id = cursorLane();
  if (id === shownLane || document.activeElement === $('lane-name')) return;
  shownLane = id;
  $('lane-name').value = id ?? '';
}
// The instruments a new lane can play.
function renderLaneInstruments() {
  const select = $('add-lane-inst'), keep = select.value || patcher.instrument;
  select.replaceChildren(...listedInstruments().map(id => Object.assign(document.createElement('option'), { value: id, textContent: id })));
  if ([...select.options].some(o => o.value === keep)) select.value = keep;
}

// Changing the shape of the project (names, order, copies, removals): stop, change it, and load the
// whole project again so the engine, the columns and the lists agree. Pattern undo history is lost.
// With keepPlaying (a rename: the sound does not change), a song that was playing carries straight on from where it was.
function reshape(change, { instrument = patcher.instrument, lane = cursorLane(), keepPlaying = false } = {}) {
  try {
    const resumeAt = keepPlaying && playing ? Math.floor(engine.position) : null;
    if (playing) setPlaying(false);
    const result = change();
    const select = typeof result === 'object' && result !== null ? result : {};
    openProject(ops.projectData(project), { stay: true, instrument: select.instrument ?? instrument, lane: select.lane ?? lane });
    if (resumeAt !== null) setPlaying(true, resumeAt);
    $('patch-status').textContent = select.message ?? '';
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// A button that asks twice: the first click arms it, a second within three seconds does it.
function confirmed(button, label, action) {
  let timer = null;
  button.addEventListener('click', () => {
    if (timer === null) {
      button.textContent = 'Really?';
      timer = setTimeout(() => { button.textContent = label; timer = null; }, 3000);
      return;
    }
    clearTimeout(timer); timer = null;
    button.textContent = label;
    action();
  });
}

// ---- presets ----
let selectedPreset = null;
function renderPresetList() {
  const def = project.instruments[patcher.instrument];
  const list = def?.presets ?? [];
  if (!list.some(p => p.id === selectedPreset)) selectedPreset = null;
  $('preset-list').replaceChildren(...list.map(p => {
    const b = document.createElement('button');
    b.textContent = `${p.id.toString(16).toUpperCase().padStart(2, '0')}  ${p.name}`;
    b.title = 'Click to recall it';
    b.classList.toggle('active', p.id === selectedPreset);
    b.addEventListener('click', () => recallPreset(p.id));
    return b;
  }));
  $('preset-name').value = list.find(p => p.id === selectedPreset)?.name ?? '';
}

// What the instrument sounds like now: the live value of every parameter.
const snapshotNow = (id, name) => presets.capturePreset(project.instruments[id], NODE_TYPES, (node, param) => {
  const address = `${id}.${node}.${param}`;
  return engine.registry.slots.has(address) ? engine.registry.get(address) : undefined;
}, name);

function recallPreset(presetId) {
  const id = patcher.instrument, def = project.instruments[id];
  if (!def) return;
  try {
    const { params, data } = presets.applyPreset(def, NODE_TYPES, presetId);
    for (const [node, name, value] of params) {
      const address = `${id}.${node}.${name}`;
      if (engine.registry.slots.has(address)) engine.set(address, value);
    }
    for (const [node, type, points] of data) engine.sendToNode(id, node, { type, points });
    selectedPreset = presetId;
    patcher.refreshPanel();
    renderPresetList();
    $('patch-status').textContent = `Recalled preset ${presetId.toString(16).toUpperCase().padStart(2, '0')}.`;
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Changing the list of presets changes the Cmd column's table, so the lanes are rebuilt.
function presetsChanged(message) {
  refreshLanes(patcher.instrument);
  renderPresetList();
  $('patch-status').textContent = message;
}
$('preset-save').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  selectedPreset = presets.addPreset(project.instruments[id], snapshotNow(id, $('preset-name').value.trim()));
  presetsChanged(`Saved preset ${selectedPreset.toString(16).toUpperCase().padStart(2, '0')}.`);
});
$('preset-over').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  presets.overwritePreset(project.instruments[id], selectedPreset, snapshotNow(id, ''));
  presetsChanged('Replaced the preset with the current sound.');
});
$('preset-rename').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  try { presets.renamePreset(project.instruments[id], selectedPreset, $('preset-name').value); presetsChanged('Renamed.'); } catch (err) { $('patch-status').textContent = err.message; }
});
$('preset-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('preset-save').click(); e.stopPropagation(); });
confirmed($('preset-remove'), 'Remove', () => {
  const id = patcher.instrument;
  if (!id || selectedPreset === null) { $('patch-status').textContent = 'Click a preset to select it first.'; return; }
  presets.removePreset(project.instruments[id], selectedPreset);
  selectedPreset = null;
  presetsChanged('Removed the preset; the others keep their numbers.');
});

// ---- preset library (.wxpr) ----
let library = newLibrary(), libSelected = null;
function renderLibrary() {
  if (libSelected >= library.presets.length) libSelected = null;
  $('lib-list').replaceChildren(...library.presets.map((p, i) => {
    const b = document.createElement('button');
    b.textContent = p.machine ? `${p.name}  (${p.machine})` : p.name;
    b.classList.toggle('active', i === libSelected);
    b.addEventListener('click', () => { libSelected = i; renderLibrary(); });
    return b;
  }));
}
$('lib-load').addEventListener('click', () => $('lib-file').click());
$('lib-file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    library = parseLibrary(await file.text());
    libSelected = null;
    renderLibrary();
    $('patch-status').textContent = `Opened ${file.name}: ${library.presets.length} presets.`;
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
});
$('lib-add').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id || libSelected === null) { $('patch-status').textContent = 'Click a library preset first.'; return; }
  selectedPreset = importFromLibrary(project.instruments[id], library.presets[libSelected]);
  presetsChanged(`Added "${library.presets[libSelected].name}" to ${id}.`);
});
$('lib-save').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  const count = addToLibrary(library, project.instruments[id], id, selectedPreset === null ? null : [selectedPreset]);
  if (!count) { $('patch-status').textContent = 'This instrument has no presets to save.'; return; }
  renderLibrary();
  download(`presets${LIBRARY_EXT}`, serializeLibrary(library));
  $('patch-status').textContent = `Saved ${count} to presets${LIBRARY_EXT} (${library.presets.length} in the library).`;
});

// ---- instrument files ----
$('inst-export').addEventListener('click', () => {
  const id = patcher.instrument;
  if (!id) return;
  download(`${id}${INSTRUMENT_EXT}`, serializeInstrument(project, id));
  $('patch-status').textContent = `Saved ${id}${INSTRUMENT_EXT}.`;
});
$('inst-import').addEventListener('click', () => $('inst-file').click());
$('inst-file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = parseInstrument(await file.text());
    reshape(() => { const id = ops.importInstrument(project, parsed); return { instrument: id, message: `Imported ${id}.` }; });
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
});

// ---- Config tab: one row per setting in config.SCHEMA ----
{
  const status = text => { $('cfg-status').textContent = text; };
  const render = () => {
    const sections = [];
    let card = null;
    for (const { group, items } of config.grouped()) {
      const sec = document.createElement('div'), head = document.createElement('div');
      sec.className = 'cfg-sec';
      head.append(Object.assign(document.createElement('h2'), { textContent: group }), Object.assign(document.createElement('p'), { textContent: config.GROUPS[group] ?? '' }));
      card = Object.assign(document.createElement('div'), { className: 'cfg-card' });
      sec.append(head, card);
      sections.push(sec);
      for (const s of items) {
      if (s.type === 'rules') {
        const box = Object.assign(document.createElement('div'), { className: 'cfg-rules' }), ta = Object.assign(document.createElement('textarea'), { className: 'rules-ta', value: config.get(s.key), spellcheck: false, ariaLabel: s.label }), state = Object.assign(document.createElement('ul'), { className: 'rules-state' });
        box.style.cssText = 'display:block;padding:6px 12px;border-top:1px solid color-mix(in srgb, var(--fg) 12%, transparent)';
        ta.wrap = 'off';
        const gutter = Object.assign(document.createElement('div'), { className: 'rules-gutter', ariaHidden: 'true' }), wrap = Object.assign(document.createElement('div'), { className: 'rules-wrap' });
        wrap.append(gutter, ta);
        ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
        const show = () => {
          const rules = analyse(parseRules(ta.value)), total = ta.value.split('\n').length, off = new Set(rules.filter(r => !r.usable).map(r => r.line));
          gutter.replaceChildren(...Array.from({ length: total }, (_, i) => Object.assign(document.createElement('div'), { textContent: i + 1, className: off.has(i + 1) ? 'bad' : '' })));
          gutter.scrollTop = ta.scrollTop;
          const items = rules.map(r => Object.assign(document.createElement('li'), { className: r.usable ? 'ok' : 'bad', textContent: r.usable ? `line ${r.line}: ${r.text}` : `OFF  ${describeRule(r)}` }));
          const bad = rules.filter(r => !r.usable).length, unknown = Object.entries(unknownTyped());
          const note = Object.assign(document.createElement('li'), { textContent: bad ? `${bad} rule${bad === 1 ? ' is' : 's are'} switched off until fixed.` : `${rules.length} rules, all on. Actions: ${Object.keys(ACTIONS).join(', ')}.` });
          if (bad) note.className = 'bad';
          const more = [];
          if (unknown.length) {
            const li = Object.assign(document.createElement('li'), { textContent: `Typed but not understood: ${unknown.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t}${n > 1 ? ` (${n}x)` : ''}`).join(', ')} ` });
            li.append(Object.assign(document.createElement('button'), { type: 'button', textContent: 'clear', onclick: () => { clearUnknown(); show(); } }));
            more.push(li);
          }
          state.replaceChildren(note, ...items.filter(li => li.className === 'bad'), ...more);
        };
        ta.addEventListener('input', () => { config.set(s.key, ta.value); show(); });
        ta.addEventListener('keydown', e => { if (e.key !== 'Tab' && !/^F\d+$/.test(e.key)) e.stopPropagation(); });
        const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Back to the default rules', onclick: () => { ta.value = s.def; config.set(s.key, s.def); show(); } });
        show();
        box.append(wrap, state, reset);
        card.append(box);
        continue;
      }
      const label = document.createElement('label'), text = document.createElement('span');
      text.textContent = s.label;
      if (s.hint) text.append(document.createElement('br'), Object.assign(document.createElement('small'), { textContent: s.hint }));
      let input;
      if (s.type === 'choice') {
        input = document.createElement('select');
        for (const o of s.options) input.append(Object.assign(document.createElement('option'), { value: o, textContent: s.labels?.[o] ?? o }));
        input.value = config.get(s.key);
        input.addEventListener('change', () => config.set(s.key, input.value));
      } else if (s.type === 'code') {   // a text box for a shader: kept when you leave it; the text runs the full width, the box under it
        label.classList.add('cfg-code');
        input = Object.assign(document.createElement('textarea'), { value: config.get(s.key), spellcheck: false, rows: 14, ariaLabel: s.label });
        input.style.cssText = 'width:100%;font:12px ui-monospace,Consolas,monospace;white-space:pre;tab-size:2';
        input.addEventListener('change', () => config.set(s.key, input.value));
        input.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); } });
      } else if (s.type === 'image') {   // a picture kept in the settings, cropped square and scaled down so it stays small
        const holder = document.createElement('span'), thumb = Object.assign(document.createElement('img'), { width: 48, height: 48, alt: '' }), pick = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Choose...' }), clear = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Clear' }), file = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
        const show = () => { const v = config.get(s.key); thumb.hidden = !v; if (v) thumb.src = v; clear.hidden = !v; };
        pick.addEventListener('click', () => file.click());
        clear.addEventListener('click', () => { config.set(s.key, ''); show(); });
        file.addEventListener('change', async () => {
          const f = file.files?.[0]; file.value = '';
          if (!f) return;
          try {
            const c = await artCanvas(f, { size: 300 }), blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
            const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
            config.set(s.key, url); show();
          } catch (err) { $('status').textContent = `That picture could not be read: ${err.message}`; }
        });
        holder.append(thumb, pick, clear, file);
        holder.style.cssText = 'display:inline-flex;gap:8px;align-items:center';
        show();
        input = holder;
      } else if (s.type === 'colour') {
        input = Object.assign(document.createElement('input'), { type: 'color', value: config.get(s.key) });
        input.addEventListener('input', () => config.set(s.key, input.value));
      } else {
        input = Object.assign(document.createElement('input'), { type: s.type === 'bool' ? 'checkbox' : 'number' });
        if (s.type === 'int') Object.assign(input, { min: s.min, max: s.max });
        if (s.type === 'bool') { input.checked = config.get(s.key); input.addEventListener('change', () => config.set(s.key, input.checked)); }
        else { input.value = config.get(s.key); input.addEventListener('change', () => { input.value = config.set(s.key, input.value); }); }
      }
      input.classList.add('v');
      input.addEventListener('keydown', e => { if (e.key !== 'Tab' && !/^F\d+$/.test(e.key)) e.stopPropagation(); });
      label.append(text, input);
      card.append(label);
      }
    }
    // the backup section holds the buttons
    const backup = document.createElement('div');
    backup.className = 'cfg-sec';
    const bhead = document.createElement('div');
    bhead.append(Object.assign(document.createElement('h2'), { textContent: 'Settings file' }), Object.assign(document.createElement('p'), { textContent: 'Keep a copy of your settings or send them to someone.' }));
    const bcard = Object.assign(document.createElement('div'), { className: 'cfg-card' });
    const brow = Object.assign(document.createElement('div'), { className: 'cfg-row' });
    const btext = document.createElement('span');
    btext.append('Settings file', document.createElement('br'), Object.assign(document.createElement('small'), { textContent: 'webtracker-config.json' }));
    brow.append(btext, $('cfg-export'), $('cfg-import'));
    const foot = Object.assign(document.createElement('div'), { className: 'cfg-row cfg-foot' });
    foot.append(Object.assign(document.createElement('span'), { innerHTML: '<small>Put every setting back to its default</small>' }), $('cfg-reset'));
    bcard.append(brow, foot);
    backup.append(bhead, bcard);
    sections.push(backup);
    $('cfg').replaceChildren(...sections);
  };
  render();
  config.onChange(() => { if (!$('cfg').contains(document.activeElement)) render(); });
  $('cfg-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([config.exportJson()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'webtracker-config.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Exported webtracker-config.json.');
  });
  $('cfg-import').addEventListener('click', () => $('cfg-file').click());
  $('cfg-file').addEventListener('change', async () => {
    const file = $('cfg-file').files[0];
    $('cfg-file').value = '';
    if (!file) return;
    try { const n = config.importJson(await file.text()); render(); status(`Imported ${n} settings from ${file.name}.`); } catch (err) { status(err.message); }
  });
  $('cfg-reset').addEventListener('click', () => { config.reset(); render(); status('All settings are back to their defaults.'); });
}

// ---- colour theme (the themes themselves are in themes.css) ----
const showTheme = theme => {
  document.documentElement.dataset.theme = theme;
  $('theme').value = theme;
  patcher.repaint();
  window.dispatchEvent(new Event('resize'));
};
$('theme').addEventListener('change', () => { config.set('theme', $('theme').value); $('theme').blur(); });
$('theme').addEventListener('keydown', e => e.stopPropagation());
config.onChange((k, v) => { if (k === 'theme') showTheme(v); });
showTheme(config.get('theme'));

// ---- the script tutorial: markdown, and a click on an example puts it in the try-a-line box ----
{
  const tut = $('script-tut');
  tut.innerHTML = renderMarkdown(TUTORIAL);
  mountWidgets(tut, { put: text => { const l = $('script-line'); l.value = text; l.focus(); } });
  for (const code of tut.querySelectorAll('pre code')) {
    code.title = 'Click to put this in the box below the output, to try it';
    code.addEventListener('click', () => { const l = $('script-line'); l.value = code.textContent.trim().split('\n')[0]; l.focus(); });
  }
}

// ---- about ----
{
  const body = $('about-body'), el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text, className: cls ?? '' });
  body.append(el('h2', document.title));
  ABOUT.forEach((text, i) => body.append(el('p', text, i === ABOUT.length - 1 ? 'last' : '')));
  body.append(el('h3', 'Changelog'));
  for (const [build, lines] of CHANGELOG) {
    body.append(el('h4', build));
    const ul = document.createElement('ul');
    for (const line of lines) ul.append(el('li', line));
    body.append(ul);
  }
  $('about-open').addEventListener('click', e => { $('about').showModal(); $('about').scrollTop = 0; e.currentTarget.blur(); });
}

// ---- tempo and swing ----
$('loopbtn').addEventListener('click', () => { if (!project) return; const m = toggleLoop(project.song); songChanged(); (tabs.active === 'arrange' ? seqView : view).say?.(m); (tabs.active === 'arrange' ? seqView : view).draw?.(); $('loopbtn').blur(); });
const songChanged = () => { engine.setSong(project.song); songInfo(); };
// the tempo follows every step of the box (arrows, spinner, typing) at once, not only when it is left
$('bpm').addEventListener('input', () => {
  const v = Math.round(Number($('bpm').value) * 100) / 100;
  if (!project || !Number.isFinite(v) || v < 1 || v > 800 || v === project.song.bpm) return;
  project.song.bpm = v;
  songChanged();
});
$('bpm').addEventListener('change', () => {
  project.song.bpm = Math.max(1, Math.min(800, Math.round(Number($('bpm').value) * 100) / 100 || project.song.bpm));
  $('bpm').value = project.song.bpm;
  songChanged();
});
$('swing').addEventListener('change', () => {
  const pct = Math.max(50, Math.min(75, Math.round(Number($('swing').value)) || 50));
  project.song.swing = pct / 100;
  $('swing').value = pct;
  songChanged();
});
// Ticks per beat: the bpm readout follows so a tick keeps its length and the music its tempo.
$('tpb').addEventListener('change', () => {
  const old = project.song.ticksPerBeat ?? 4, n = Math.max(1, Math.min(32, Math.round(Number($('tpb').value)) || old));
  $('tpb').value = n;
  if (n === old) return;
  project.song.bpm = Math.max(1, Math.min(800, Math.round(project.song.bpm * old / n * 100) / 100));
  project.song.ticksPerBeat = n;
  $('bpm').value = project.song.bpm;
  songChanged(); seqView.draw(); view.draw?.();
});
$('bar').addEventListener('change', () => {
  const n = Math.max(1, Math.min(16, Math.round(Number($('bar').value)) || 4));
  if (n === 4) delete project.song.beatsPerBar; else project.song.beatsPerBar = n;
  $('bar').value = n;
  songChanged(); seqView.draw();
});
// A new song length is sent to the running engine as it is: the song goes on playing (the other reshaping edits reload the project and stop it).
$('length').addEventListener('change', () => {
  const before = project.song.length;
  try {
    const n = ops.setSongLength(project, $('length').value);
    const data = ops.projectData(project);
    const at = { lane: seqView.lane, tick: seqView.tick, vTick: view.tick };
    const lanes = prepareSong(data.song, project.instruments, engine.registry);
    engine.setSong(data.song);
    for (const { id, instrument, columns, pages, mask, auto } of lanes) engine.setLane({ id, instrument, columns, pages, mask, auto });
    const editor = createEditor(lanes, data.song.length);
    project = { song: data.song, instruments: project.instruments, samples: project.samples, lanes, editor };
    seqView.load({ lanes, song: data.song, editor });
    view.load({ lanes, song: data.song, editor });
    const lane = Math.min(at.lane, lanes.length - 1);
    seqView.goto(lane, Math.min(at.tick, n - 1)); view.goto(lane, Math.min(at.vTick ?? 0, n - 1));
    $('length').value = n; songInfo();
    $('patch-status').textContent = `Song length ${n} ticks.`;
  } catch (err) {
    $('length').value = before;
    $('patch-status').textContent = err.message;
  }
});
const insertSilence = n => {
  const tick = seqView.tick, lane = seqView.lane;
  reshape(() => { const k = ops.insertTicks(project, tick, n, { cut: config.get('insertCut') }); return { message: `Inserted ${k} ticks at ${Math.floor(tick / 16) * 16}.` }; }, { lane });
  seqView.goto(lane, tick);
  $('seq-status').textContent = $('patch-status').textContent;
};
$('seq-wrap').setAttribute('aria-pressed', String(config.get('seqWrap')));
$('seq-wrap').addEventListener('click', () => config.set('seqWrap', !config.get('seqWrap')));
config.onChange((k, v) => { if (k === 'seqWrap') $('seq-wrap').setAttribute('aria-pressed', String(v)); });
$('ins-n').value = config.get('insertLength');
$('ins-cut').checked = config.get('insertCut');
$('ins-cut').addEventListener('change', () => config.set('insertCut', $('ins-cut').checked));
config.onChange((k, v) => { if (k === 'insertCut') $('ins-cut').checked = v; else if (k === 'insertLength') $('ins-n').value = v; });
$('ins-go').addEventListener('click', () => insertSilence($('ins-n').value));
$('ins-n').addEventListener('keydown', e => { if (e.key === 'Enter') insertSilence($('ins-n').value); });
for (const b of document.querySelectorAll('.ins-pre')) { b.disabled = false; b.addEventListener('click', () => { $('ins-n').value = b.dataset.n; insertSilence(b.dataset.n); }); }
for (const id of ['length', 'ins-n', 'bpm', 'swing', 'tpb', 'bar', 'pname']) $(id).addEventListener('keydown', e => e.stopPropagation());

// Rename the selected instrument: Ctrl+F2, or right-click it in the list. A small box opens over its row; Enter renames, Escape or a click elsewhere leaves it.
function renameInstrumentBox() {
  const id = patcher.instrument;
  if (!project || !id || document.querySelector('.rename-box')) return;
  const row = $('inst-list').querySelector('button.active')?.getBoundingClientRect() ?? $('inst-list').getBoundingClientRect();
  const box = document.createElement('input');
  box.className = 'rename-box'; box.value = id; box.size = 18; box.setAttribute('aria-label', 'New name for the instrument');
  Object.assign(box.style, { left: `${row.left}px`, top: `${row.top - 1}px`, width: `${Math.max(row.width, 180)}px`, height: `${row.height + 2}px` });
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const text = box.value.trim(); box.remove(); $('inst-list').focus();
    if (ok && text && text !== id) reshape(() => { const next = ops.renameInstrument(project, id, text); return { instrument: next, message: `Renamed to ${next}.` }; }, { keepPlaying: true });
  };
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  box.addEventListener('blur', () => finish(false));
  document.body.append(box); box.focus(); box.select();
}
$('inst-list').addEventListener('contextmenu', e => {
  const b = e.target.closest?.('button'); if (!b || !project) return;
  e.preventDefault();
  const id = listedInstruments()[[...$('inst-list').children].indexOf(b)];
  if (id && id !== patcher.instrument) { patcher.show(id); renderInstList(); }
  showContextMenu(e, [{ label: 'Rename', hint: 'Ctrl+F2', run: renameInstrumentBox }]);
});
$('inst-up').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, -1); }); });
$('inst-down').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, 1); }); });
$('inst-dup').addEventListener('click', () => {
  const id = patcher.instrument;
  if (id) reshape(() => { const next = ops.duplicateInstrument(project, id); return { instrument: next, message: `Copied to ${next}.` }; });
});
confirmed($('inst-remove'), 'Remove', () => { const id = patcher.instrument; if (id) reshape(() => { ops.removeInstrument(project, id); return { message: `Removed ${id}.` }; }); });

$('lane-rename').addEventListener('click', () => {
  const id = cursorLane();
  if (id) reshape(() => { const next = ops.renameLane(project, id, $('lane-name').value); return { lane: next, message: `Renamed to ${next}.` }; }, { keepPlaying: true });
});
$('lane-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('lane-rename').click(); e.stopPropagation(); });
$('lane-left').addEventListener('click', () => { const id = cursorLane(); if (id) reshape(() => { ops.moveLane(project, id, -1); }); });
$('lane-right').addEventListener('click', () => { const id = cursorLane(); if (id) reshape(() => { ops.moveLane(project, id, 1); }); });
$('lane-dup').addEventListener('click', () => {
  const id = cursorLane();
  if (id) reshape(() => { const copy = ops.duplicateLane(project, id); return { lane: copy.id, message: `Copied to ${copy.id}.` }; });
});
const removeLane = (id, withMachine) => {
  if (!id) return;
  reshape(() => {
    const inst = project.lanes.find(l => l.id === id)?.instrument;
    ops.removeLane(project, id);
    if (!withMachine) return { message: `Removed ${id}.` };
    const shared = project.lanes.some(l => l.instrument === inst);
    if (inst && !shared) ops.removeInstrument(project, inst);
    return { message: shared ? `Removed (${id}) lane; (${inst}) instrument is still played by another lane.` : `Removed (${id}) lane, and (${inst}) instrument.` };
  });
};
confirmed($('lane-remove-all'), 'Remove with machine', () => removeLane(cursorLane(), true));
confirmed($('lane-remove'), 'Remove', () => removeLane(cursorLane(), false));

// The polyphony fields show the selected instrument's settings.
function syncPoly() {
  const def = project.instruments[patcher.instrument];
  $('inst-voices').value = def?.graph.voices ?? 1;
  $('inst-notecols').value = def?.noteColumns ?? 1;
}

// Polyphony: how many copies of the instrument play at once, and how many notes a row can hold.
for (const [id, field, max] of [['inst-voices', 'voices', 16], ['inst-notecols', 'noteColumns', 8]]) {
  $(id).addEventListener('change', () => {
    const def = project.instruments[patcher.instrument];
    if (!def) return;
    const n = Math.max(1, Math.min(max, Math.round(Number($(id).value)) || 1));
    if (field === 'voices') def.graph.voices = n; else def.noteColumns = n;
    reloadInstrument(patcher.instrument);
    syncPoly();   // not renderInstList: the list must stay put, or a click that blurs this field is lost
  });
}

// The waveform fills the width of the sample screen.
// The marker region view sits to its right, a sixteenth of its width.
if (globalThis.ResizeObserver) new ResizeObserver(() => {
  const total = $('wave-row').clientWidth - 8;
  if (total <= 0) return;
  const r = Math.max(24, Math.floor(total / 17));
  region.fit(r - 2);
  waveform.fit(total - r - 2);
}).observe($('wave-row'));
const sendLoop = users => users.forEach(({ instrument, node }) => sendSample(instrument, node));
const region = createMarkerRegionView({ canvas: $('region'), getSample: () => waveform.sample(), getActive: () => waveform.activeFrame() });
const waveform = createWaveformView({
  canvas: $('wave'), statusEl: $('proj-status'), getProject: () => project,
  onLoop: users => { sendLoop(users); auditionDirty = true; },
  onSlices: users => { sendLoop(users); auditionDirty = true; },
  onActiveSlice: i => sampleScreen.setActiveSlice(i),   // the screen redraws itself, so its numbers follow the markers
  onSelect: ({ from, to }) => sampleScreen.setSelection(from, to),
  onFocus: () => $('smp').focus(),
  onMenu: (e, frame) => {   // right click on the display: the edits, acting on the selection (else the whole sample)
    const [from, to] = sampleScreen.selection, has = to > from, s = waveform.sample();
    const scope = has ? 'selection' : 'whole sample';
    const edit = tool => () => { sampleScreen.runEdit(tool); $('smp').focus(); };
    showContextMenu(e, [
      { label: 'Trim to selection', hint: has ? 'Shift+C' : 'no selection: loop region', run: edit('crop') },
      { label: 'Cut selection', hint: 'Shift+X', disabled: !has, run: edit('cut') },
      { label: 'Copy selection to a new sample', disabled: !has, run: copySelection },
      { label: 'Silence', hint: `Shift+S · ${scope}`, run: edit('silence') },
      { separator: true },
      { label: 'Reverse', hint: `Shift+R · ${scope}`, run: edit('reverse') },
      { label: 'Normalise', hint: `Shift+N · ${scope}`, run: edit('normalise') },
      { label: 'Fade in', hint: `Shift+I · ${scope}`, run: edit('fadeIn') },
      { label: 'Fade out', hint: `Shift+O · ${scope}`, run: edit('fadeOut') },
      { label: 'Remove DC offset', hint: `Shift+D · ${scope}`, run: edit('removeDc') },
      { label: 'Bake loop crossfades', hint: 'Shift+B', run: edit('bakeCrossfade') },
      { separator: true },
      { label: 'Zoom to selection', hint: 'Shift+Z', disabled: !has, run: () => waveform.zoom('selection') },
      { label: 'Zoom out', hint: 'Shift+A', run: () => waveform.zoom('out') },
      { label: 'Show whole sample', hint: 'Shift+W', run: () => waveform.zoom('all') },
      { separator: true },
      { label: 'Select all', run: () => sampleScreen.setSelection(0, s?.data.length ?? 0) },
      { label: 'Clear selection', disabled: !has, run: () => sampleScreen.setSelection(0, 0) },
      { label: 'Post-transient resynthesis', hint: `${scope} → new instrument`, run: resynthesize },
      { label: `Mark a slice here`, hint: `frame ${frame}`, run: () => sampleScreen.markSlice(frame) },
      { separator: true },
      { label: 'Undo', hint: 'Ctrl+Z', run: () => sampleScreen.undoRedo(false) },
      { label: 'Redo', hint: 'Ctrl+Y', run: () => sampleScreen.undoRedo(true) },
    ]);
  },
});
attachGrip({ grip: $('wave-grip'), key: 'webtracker.waveformHeight', get: () => waveform.height, set: h => region.resize(waveform.resize(h)), step: 20, bigStep: 100, normal: 160 });

// Keyjazz in the sample screen: the sample on its own, through a hidden instrument that is just a sampler
// into the output, so only the sample's own volume, global volume and pan apply. The instrument lives in the
// engine only, never in the project, and is rebuilt when the project is loaded or the sample changes shape.
const AUDITION = '__audition';
let audition = null, auditionDirty = true;   // { id, stereo } of what is loaded; whether the engine needs the sample again
const prepareAudition = id => {
  const s = project.samples[id];
  if (!audition || audition.id !== id || audition.stereo !== !!s.right) {
    const def = { graph: { nodes: [{ id: 'sampler', type: 'sampler' }, { id: 'out', type: 'out', params: { gain: 0.45 } }], connections: [['sampler.out', 'out.in']] }, samples: { sampler: id } };
    syncSamplerStereo(def, project.samples);
    engine.loadInstrument(AUDITION, def.graph);
    audition = { id, stereo: !!s.right };
    auditionDirty = true;
  }
  if (auditionDirty) { engine.sendToNode(AUDITION, 'sampler', sampleMessage(s)); auditionDirty = false; }
};
// The sample screen's playhead is an estimate from the clock: where the note started, how fast it plays, and the loops it is in (the audio
// thread reports no voice positions). It ends with the sample, with a cut, or a moment after the key is let go of a looping sample.
let run = null;
const auditionHead = () => {
  if (!run) return null;
  const s = project?.samples?.[run.id], now = performance.now();
  if (!s) { run = null; return null; }
  const dt = (now - run.t) / 1000; run.t = now;
  run.pos += dt * s.rate * run.speed;
  const len = s.data.length;
  if (run.held && s.susOn && run.pos >= s.susEnd) run.pos = s.susStart + (run.pos - s.susStart) % Math.max(1, s.susEnd - s.susStart);
  else if (s.loopOn && !(run.held && s.susOn) && run.pos >= s.loopEnd) run.pos = s.loopStart + (run.pos - s.loopStart) % Math.max(1, s.loopEnd - s.loopStart);
  if (run.pos >= len - 1 || (run.cut !== undefined && now >= run.cut) || (run.until !== undefined && now >= run.until)) run = null;
  return run ? run.pos : null;
};
const playSample = (id, note, on, frame = 0, cutIn = 0) => {   // frame: where in the sample the note starts (0 is the beginning); cutIn: seconds after which it stops by itself
  if (!started || !(id in project.samples)) return;
  const s = project.samples[id];
  if (on) {
    prepareAudition(id);
    engine.set(`${AUDITION}.sampler.offset`, Math.min(1, Math.max(0, frame / Math.max(1, s.data.length - 1))));
    engine.noteOn(AUDITION, note, 1, { choke: true, ...(cutIn > 0 ? { cutIn } : {}) });   // a new note fades the old one, loop or not
    run = { id, pos: frame, t: performance.now(), speed: Math.pow(2, (note - 60) / 12), held: true, note, ...(cutIn > 0 ? { cut: performance.now() + cutIn * 1000 } : {}) };
  } else if (audition && cutIn < 0) { engine.noteCut(AUDITION); run = null; }
  else if (audition) {
    engine.noteOff(AUDITION, note);
    if (run?.note === note) { run.held = false; if (s.loopOn || s.susOn) run.until = performance.now() + 200; }
  }
};
// Space with the mouse over the waveform plays the sample from its start; Alt+Space (or Ctrl+Space, as some systems keep Alt+Space for
// the window menu) from the slice marker at or to the left of the mouse. The note lasts while the key is held.
let waveX = null;
{
  const wave = $('wave');
  wave.addEventListener('mousemove', e => { waveX = e.offsetX; });
  wave.addEventListener('mouseleave', () => { waveX = null; });
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' || waveX === null || tabs.active !== 'samples') return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target?.tagName) || $('autoslice').open) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat || !started) return;
    const at = waveform.frameAtX(waveX), from = e.altKey || e.ctrlKey ? waveform.sliceBefore(at) : 0;
    if (sampleScreen.playFrom('wave-space', Math.max(0, from))) {
      const slice = from >= 0 && (e.altKey || e.ctrlKey) ? (waveform.sample()?.slices ?? []).slice().sort((a, b) => a - b).indexOf(from) : -1;
      sampleScreen.say(e.altKey || e.ctrlKey ? (from >= 0 ? `Playing from slice ${slice.toString(16).toUpperCase().padStart(2, '0')}, frame ${from}.` : 'No slice marker to the left: playing from the start.') : 'Playing from the start.');
    }
  }, true);
  document.addEventListener('keyup', e => { if (e.key === ' ') sampleScreen.release('wave-space'); }, true);
  window.addEventListener('blur', () => sampleScreen.release('wave-space'));
}
let autoSliceOpen = () => {};
let chordScanOpen = () => {};
const sampleScreen = createSampleScreen({
  el: $('smp'), statusEl: $('proj-status'), getProject: () => project,
  onChange: users => { sendLoop(users); auditionDirty = true; },   // loops, levels and edits change what the sample plays
  onSelect: id => { waveform.show(id); auditionDirty = true; },
  onRemove: refreshProjectUi,
  onRename: () => { refreshProjectUi(); patcher.show(patcher.instrument); },
  onNote: playSample,
  onSelection: (from, to) => waveform.setSelection(from, to),
  onSlice: i => waveform.setActiveSlice(i),
  onZoom: kind => waveform.zoom(kind),
  onAutoSlice: () => autoSliceOpen(),
  onChords: () => chordScanOpen(),
  onLoad: () => $('sample-file').click(),
  onReplace: id => { replaceTarget = id; $('replace-file').click(); },
  onKeep: id => {   // K: copy the sample under the cursor into a new normal sample
    const s = project.samples[id];
    if (!s) return;
    const copy = addSample(project, isPool(id) ? `${id}_kept` : `${id}_copy`, s.rate, s.data.slice(), s.right?.slice());
    for (const k of ['loopStart', 'loopEnd', 'loopOn', 'loopXfade', 'susStart', 'susEnd', 'susOn', 'susXfade', 'volume', 'globalVolume', 'pan', 'slices']) if (s[k] !== undefined) project.samples[copy][k] = structuredClone(s[k]);
    refreshProjectUi(); sampleScreen.select(copy); projStatus(`Copied ${id} to ${copy}.`);
  },
  onView: mode => waveform.setMode(mode),
  onEdited: () => waveform.invalidate(),
});

// The selection on the Samples screen, copied into a new sample of its own (the original is left as it is); markers inside it come along.
function copySelection() {
  const id = sampleScreen.selected, s = project?.samples[id], [from, to] = sampleScreen.selection;
  if (!s || !(to > from)) return projStatus('Select a stretch of the sample first.');
  const a = Math.max(0, Math.round(from)), z = Math.min(s.data.length, Math.round(to));
  const copy = addSample(project, `${id}_sel`, s.rate, s.data.slice(a, z), s.right?.slice(a, z));
  for (const k of ['volume', 'globalVolume', 'pan']) if (s[k] !== undefined) project.samples[copy][k] = s[k];
  const marks = (s.slices ?? []).filter(m => m >= a && m < z).map(m => m - a);
  if (marks.length) project.samples[copy].slices = marks;
  refreshProjectUi(); sampleScreen.select(copy); projStatus(`Copied ${z - a} frames of ${id} to ${copy}.`);
}

// A new empty lane for an instrument that is already loaded in the engine.
// Post-transient resynthesis of the sample on the Samples screen (its selection, else the whole sample): the attack is kept
// as a new small sample and the rest becomes a tree of synth branches in a new instrument with its own lane.
function resynthesize() {
  const id = sampleScreen.selected, s = project.samples[id];
  if (!s) return projStatus('Pick a sample first.');
  let [from, to] = sampleScreen.selection;
  if (!(to > from)) { from = 0; to = s.data.length; }
  const mono = new Float32Array(to - from);
  for (let i = 0; i < mono.length; i++) mono[i] = s.right ? (s.data[from + i] + s.right[from + i]) / 2 : s.data[from + i];
  projStatus('Fitting the tail…');
  setTimeout(() => {   // let the message paint first: the fit takes a moment
    try {
      const fit = fitTail(mono, s.rate, { max: config.get('ptrMax'), tolerance: config.get('ptrTolerance') / 100, transientMs: config.get('ptrTransient') });
      const sampleId = addSample(project, `${id}_attack`, s.rate, fit.transient);
      const name = uniqueId(new Set(Object.keys(project.instruments)), idFromName(`${id}_ptr`));
      project.instruments[name] = buildInstrument(fit, sampleId);
      loadInst(name);
      sendSamples(name);
      addLaneFor(name);
      patcher.load({ instruments: project.instruments });
      refreshProjectUi();
      const tonal = fit.branches.filter(b => b.type === 'tonal').length, noise = fit.branches.length - tonal;
      projStatus(`Added ${name}: the first ${fit.cutMs.toFixed(0)} ms kept as ${sampleId}, the tail as ${fit.branches.length} of at most ${fit.max} branches (${tonal} tonal, ${noise} noise), ${(fit.match * 100).toFixed(0)}% of the tail matched.`);
    } catch (err) {
      projStatus(err.message);
    }
  }, 30);
}

// A lane just added at the end goes next to another one instead: side 'left' or 'right' of lane `besideId` (never before the master lane).
function placeLane(id, besideId, side) {
  const at = project.lanes.findIndex(l => l.id === besideId), from = project.lanes.findIndex(l => l.id === id);
  if (at < 0 || from < 0) return;
  const target = Math.max(1, at + (side === 'right' ? 1 : 0));
  if (target === from) return;
  reshape(() => { ops.moveLane(project, id, target - from); return { lane: id }; });
}

function addLaneFor(instrumentId) {
  const lane = addLane(project, engine.registry, instrumentId);
  engine.setLane({ id: lane.id, instrument: lane.instrument, columns: lane.columns, pages: lane.pages, mask: lane.mask, auto: lane.auto });
  project.editor.clear();
  view.relayout();
  return lane;
}

// The columns of an instrument's lanes need rebuilding (its exposed parameters or presets changed).
// Cells follow their column; undo history is cleared.
function refreshLanes(id) {
  for (const { id: laneId, instrument, columns, pages, mask, auto } of rebuildInstrumentLanes(project.lanes, project.song, project.instruments, engine.registry, id)) {
    engine.setLane({ id: laneId, instrument, columns, pages, mask, auto });
  }
  project.editor.clear();
  view.relayout();
}

// The wiring or the exposed parameters of an instrument changed: recompile it, swap it in,
// and rebuild the columns of its lanes. Cells follow their column; undo history is cleared.
function reloadInstrument(id) {
  try {
    const def = project.instruments[id];
    pruneDef(def, NODE_TYPES);
    loadInst(id);
    sendSamples(id);
    refreshLanes(id);
    nsPush();
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Loads a project into the running engine: { song, instruments, samples }.
function openProject({ song, instruments, samples }, { stay = false, instrument = null, lane = null } = {}) {
  ensureMaster({ song, instruments });
  if (song.nodeseq) cleanGraph(ensureGraph(song));   // a hand-edited file cannot trip the engine
  if (playing) setPlaying(false);
  engine.reset();
  audition = null;
  sampleScreen.history.clear();
  ensurePool(samples, engine.ctx?.sampleRate);
  project = { song, instruments, samples, lanes: [], editor: null };
  for (const id of Object.keys(instruments)) {
    loadInst(id);
    sendSamples(id);
  }
  const lanes = prepareSong(song, instruments, engine.registry);
  engine.setSong(song);
  for (const { id, instrument, columns, pages, mask, auto } of lanes) engine.setLane({ id, instrument, columns, pages, mask, auto });
  const editor = createEditor(lanes, song.length);
  project = { song, instruments, samples, lanes, editor };
  patcher.load({ instruments });
  if (instrument in instruments) patcher.show(instrument);
  nsPush(); nsView?.load();
  refreshProjectUi();
  seqView.load({ lanes, song, editor });
  view.load({ lanes, song, editor });
  const at = Math.max(lanes.length > 1 ? 1 : 0, lanes.findIndex(l => l.id === lane));   // not the master lane, to start with
  view.goto(at, 0); seqView.goto(at, 0);
  scriptScreen.load(song.script);
  shaderStore.index = 0; pushShaders(); shaderView?.load();
  $('info').value = song.info ?? '';
  infoStatus();
  if (song.info) { renderInfo(); $('info').hidden = true; $('info-view').hidden = false; $('info-edit').textContent = 'Edit'; }
  else { $('info').hidden = false; $('info-view').hidden = true; $('info-edit').textContent = 'Done'; }
  $('length').value = song.length;
  $('bpm').value = song.bpm;
  $('swing').value = Math.round((song.swing ?? 0.5) * 100);
  $('tpb').value = song.ticksPerBeat ?? 4;
  $('bar').value = song.beatsPerBar ?? 4;
  $('pname').value = song.name ?? 'untitled'; $('pname').disabled = false;
  if (!stay) markSaved(); else scheduleCheck();
  if (!stay) { tabs.show('arrange'); backups.baselineDownload?.(); }
}

const download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

// New: clear part of the project or all of it. Clearing patterns or the arrangement works on a copy of what is saved,
// then reopens it, so the instruments, samples and settings come back exactly as they were.
const newMenu = $('new-menu');
const closeNew = () => { newMenu.hidden = true; $('new').setAttribute('aria-expanded', 'false'); };
$('new').addEventListener('click', e => {
  e.stopPropagation();
  newMenu.hidden = !newMenu.hidden;
  $('new').setAttribute('aria-expanded', String(!newMenu.hidden));
});
document.addEventListener('click', closeNew);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !newMenu.hidden) closeNew(); });
newMenu.addEventListener('click', e => {
  const kind = e.target.dataset?.clear;
  if (!kind) return;
  closeNew();
  const what = { arrangement: 'the arrangement', patterns: 'every pattern and the arrangement', everything: 'everything (instruments, samples, patterns and arrangement; only the master lane is left)' }[kind];
  if (!confirm(`Clear ${what}? This cannot be undone; save first if you want to keep it.`)) return;
  backups.snapshot('before clear');
  const { song } = project;
  if (kind === 'everything') {
    // nothing left but the master lane (it is always there); instruments and lanes are added from the instrument screen
    openProject({ song: { name: 'untitled', bpm: song.bpm, ticksPerBeat: song.ticksPerBeat, length: song.length, lanes: [] }, instruments: {}, samples: {} });
  } else {
    const saved = parseProject(serializeProject(project));
    for (const lane of saved.song.lanes) { lane.placements = []; if (kind === 'patterns') lane.patterns = {}; }
    openProject(saved, { stay: true, instrument: patcher.instrument, lane: cursorLane() });
  }
  projStatus(kind === 'everything' ? 'Cleared everything.' : `Cleared ${what}.`);
});

// Backups: snapshots in the browser's database, and a copy in a chosen folder (project/backup.js); the panel is the Backups button.
const backups = createBackups({
  serialize: () => (project ? serializeProject(project) : null),
  getName: () => project?.song?.name ?? 'untitled',
  options: () => ({ on: config.get('backupOn'), minutes: config.get('backupMinutes'), keep: config.get('backupKeep'), folderMode: config.get('backupFolderMode') }),
  store: typeof indexedDB !== 'undefined' ? idbStore() : memoryStore(),
  onChange: () => backupPanel?.refresh(),
});
const backupPanel = createBackupPanel({
  el: $('backup-panel'), backups, say: text => { $('status').textContent = text; },
  canPickFolder: typeof showDirectoryPicker === 'function', isBrave: !!navigator.brave,
  pickFolder: () => showDirectoryPicker({ id: 'webtracker-backup', mode: 'readwrite' }),
  onRestore: (text, meta) => {
    try {
      const data = parseProject(text);
      backups.snapshot('before restore');
      openProject(data);
      backupPanel.hide();
      $('status').textContent = `Restored the backup from ${new Date(meta.time).toLocaleString()}. The project before it was backed up.`;
    } catch (err) { $('status').textContent = err.message; }
  },
  onSave: (text, meta) => download(`${meta.name ?? 'untitled'}-${stamp(meta.time)}${FILE_EXT}`, text),
});
$('backups').addEventListener('click', () => (backupPanel.open ? backupPanel.hide() : backupPanel.show()));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && project && config.get('backupOn')) backups.snapshot('auto'); });
config.onChange(k => { if (k === 'backupMinutes' || k === 'backupOn') backups.restart(); if (k === 'backupDownload' || k === 'backupDownloadMinutes') startDownloads(); });
let downloadTimer = null;
function startDownloads() {
  clearInterval(downloadTimer); downloadTimer = null;
  if (!config.get('backupDownload')) return;
  backups.baselineDownload();
  downloadTimer = setInterval(() => {
    const d = backups.takeDownload();
    if (d) { download(`${d.name}-${stamp(d.time)}${FILE_EXT}`, d.text); $('status').textContent = 'Downloaded a backup file.'; }
  }, Math.max(1, config.get('backupDownloadMinutes')) * 60000);
}

// Meter band: Ctrl+Alt+M or the Meters button. It sits above the status bar, and the page gets room under it.
const metersBox = $('meters');
const meters = createMeters({
  box: metersBox, transport: engine.transport, sab: engine.vring, lsab: engine.lring, lanes: () => project?.lanes ?? [], setTaps: ids => engine.setLaneTaps(ids), sampleRate: () => engine.ctx?.sampleRate ?? 44100,
  options: () => ({ spectrum: config.get('meterSpectrum'), level: config.get('meterLevel'), corr: config.get('meterCorr'), limiter: config.get('meterLimiter'), ceiling: (() => { const k = engine.registry.slots.get('master.m.ceiling'); return k === undefined ? -0.3 : engine.registry.values[k]; })(), width: config.get('meterWidth'), sgram: config.get('meterSgram'), layers: config.get('meterLayers'), colour: config.get('meterColour'), vscope: config.get('meterScope'), linger: config.get('vscopeLinger'), glow: config.get('vscopeGlow') }),
});
const placeMeters = () => {
  const foot = $('footer').offsetHeight, h = config.get('meterHeight');
  metersBox.style.bottom = `${foot}px`; metersBox.style.height = `${h}px`;
  document.body.style.paddingBottom = meters.open ? `${foot + h}px` : '';
};
const showMeters = on => { if (on) meters.show(); else meters.hide(); $('meters-btn').setAttribute('aria-pressed', String(on)); placeMeters(); };
const toggleMeters = () => config.set('meterOn', !meters.open);

// The master limiter switch on the status bar: the master lane's `limit` parameter, kept in the project so it is saved with it.
const limitSlot = () => engine.registry.slots.get('master.m.limit');
const limitOn = () => { const s = limitSlot(); return s !== undefined && engine.registry.values[s] >= 0.5; };
const paintLimit = () => { const on = String(limitOn()); if ($('limit-btn').getAttribute('aria-pressed') !== on) $('limit-btn').setAttribute('aria-pressed', on); };
$('limit-btn').addEventListener('click', () => {
  const node = project?.instruments?.master?.graph.nodes.find(n => n.id === 'm');
  if (!node || limitSlot() === undefined) return;
  const v = limitOn() ? 0 : 1;
  (node.params ??= {}).limit = v;
  engine.set('master.m.limit', v);
  paintLimit();
});
setInterval(paintLimit, 400);   // the pattern or the parameter panel can switch it too

// The Stream Manager (ui/streams.js): hidden until the eye button in the bottom bar opens it.
const streams = createStreams({
  root: $('streams'), button: $('streams-btn'), footer: $('footer'), engine, lanes: () => project?.lanes ?? [], instruments: () => project?.instruments ?? {}, nodeTypes: NODE_TYPES,
  sampleRate: () => engine.ctx?.sampleRate ?? 44100, skip: [MASTER], silent: [SHADER, GRAPH],
});
engine.onStreams = rows => streams.update(rows);
document.addEventListener('keydown', e => { if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyE') { e.preventDefault(); streams.toggle(); } });

// ---- the Node Sequencer (nodeseq/editor.js, audio/nodeseq.js): a graph of event and control wires that runs beside the pattern lanes ----
const nsSkip = new Set([MASTER, SHADER, GRAPH]);
const nsNotes = () => Object.entries(project?.instruments ?? {}).filter(([id, d]) => !nsSkip.has(id) && (d.noteColumns ?? 1) > 0).map(([id]) => ({ value: id, label: id }));
const nsParams = () => Object.entries(project?.instruments ?? {}).filter(([id]) => !nsSkip.has(id)).flatMap(([id, d]) => (d.exposed ?? []).map(e => ({ value: `${id}.${e.node}.${e.param}`, label: e.label ?? e.param, group: id })));
// What the names in the graph mean on this machine: a `set` node's parameter slot and range, and the slots of the eight group columns.
function nsResolve() {
  const g = project?.song.nodeseq, slots = {}, reg = engine.registry;
  for (const n of g?.nodes ?? []) {
    if (n.type !== 'set' || !n.data?.target) continue;
    const slot = reg.slots.get(n.data.target);
    if (slot === undefined) continue;
    const [inst, node, param] = n.data.target.split('.'), ex = project.instruments[inst]?.exposed?.find(e => e.node === node && e.param === param), m = reg.meta[slot];
    slots[n.id] = { slot, min: m.min, max: m.max, int: !!m.int, log: ex?.scale === 'log' && m.min > 0 };
  }
  return { slots, groupSlots: Array.from({ length: 8 }, (_, i) => reg.slots.get(`${GRAPH}.g.g${i + 1}`) ?? -1) };
}
const nsEmpty = { sub: 4, groups: [], nodes: [], wires: [] };
function nsPush() { if (!project || !engine.node) return; engine.setNodeseq(JSON.parse(JSON.stringify(project.song.nodeseq ?? nsEmpty)), nsResolve()); }
function nsFlags() { if (engine.node) engine.nodeseqFlags({ watch: tabs.active === 'nodeseq' && playing, record: recording && playing }); }
const nsSay = t => { $('proj-status').textContent = t; };
function nsLane() {
  if (!project) return;
  if (project.lanes.some(l => l.instrument === GRAPH)) { nsSay('The pattern lane for the groups is there already (the "graph" lane).'); return; }
  if (ops.ensureGraphMachine(project)) loadInst(GRAPH);
  addLaneFor(GRAPH); patcher.load({ instruments: project.instruments }); refreshProjectUi(); nsPush(); scheduleCheck();
  nsSay('Made the "graph" lane: a 1 in a G column starts that group, a 0 stops it.');
}
// Notes the graph plays are written into the lanes of their instrument while Rec is armed and the song plays.
function nsRecord(m) {
  if (!recording || !playing || !project) return;
  const li = project.lanes.findIndex(l => l.instrument === m.target);
  if (li < 0) return;
  const subs = project.song.nodeseq?.sub ?? 4, pos = m.tick + m.sub / subs, vel = Math.max(1, Math.round(m.vel * 127));
  const r = writer.recOn({ li, midi: m.note, vel, pos });
  if (!r.wrote && r.message && !saidParam.has(r.message)) { saidParam.add(r.message); nsSay(r.message); }
  writer.recOff({ midi: m.note, pos: pos + m.subs / subs });
}
nsView = createNodeSeqEditor({
  root: $('pane-nodeseq'), getSong: () => project?.song, noteTargets: nsNotes, paramTargets: nsParams, say: nsSay,
  isRecording: () => recording,
  onStructure: () => { nsPush(); scheduleCheck(); },
  onParam: (id, name, value) => { engine.nodeseqParam(id, name, value); scheduleCheck(); },
  onData: (id, data) => { engine.nodeseqData(id, data); scheduleCheck(); },
  onGroupLane: nsLane,
});
globalThis.waxDebug = { nsView, engine, project: () => project };   // for the browser tests
engine.onNodeseq = m => { if (m.type === 'nsnote') nsRecord(m); else nsView.activity(m); };

// The live picture: a 300 x 300 shader in the corner, fed by what the lanes play (ui/visdata.js, ui/visual.js).
const vizBox = $('viz'), vizErr = $('viz-err');
// The shader machine: numbers the shader exposes as pattern columns (see addShaderKnob). get gives a number's value, 0 to 1.
const shaderMachine = {
  names: () => (project?.instruments[SHADER]?.exposed ?? []).filter(e => e.param !== 'shader').map(e => e.label),
  entry: name => project?.instruments[SHADER]?.exposed.find(e => e.label === name),
  get(name) { const e = this.entry(name), slot = e && engine.registry.slots.get(`${SHADER}.${e.node}.${e.param}`); return slot === undefined ? undefined : engine.registry.values[slot]; },
  set(name, value) {   // from a slider: the engine's value and the project's, so it is saved
    const e = this.entry(name); if (!e) return;
    engine.set(`${SHADER}.${e.node}.${e.param}`, value);
    project.instruments[SHADER].graph.nodes.find(n => n.id === e.node).params[e.param] = value;
  },
  expose(name, value) {
    if (!project) throw new Error('Open a project first.');
    const r = ops.addShaderKnob(project, name, value);
    if (r.first) { loadInst(SHADER); addLaneFor(SHADER); patcher.load({ instruments: project.instruments }); refreshProjectUi(); }
    else reloadInstrument(SHADER);
    return r.name;
  },
  remove(name) { ops.removeShaderKnob(project, name); reloadInstrument(SHADER); },
  ensure() {   // a song with several shaders needs the lane that holds the Shd column
    if (ops.ensureShaderMachine(project)) { loadInst(SHADER); addLaneFor(SHADER); patcher.load({ instruments: project.instruments }); refreshProjectUi(); }
  },
};
// The picture's shaders live in the project (song.shaders, up to 16; the shader lane's Shd column picks one, 0 to F); a project with none uses the
// text in Config. `index` is the one being edited, which the picture shows while the Shader screen is open.
const shaderList = () => project?.song.shaders ?? [];
const shaderText = i => shaderList()[i]?.glsl || (i === 0 ? config.get('visualGlsl') : '');
const shaderCount = () => Math.max(1, shaderList().length);
const pushShaders = () => visual?.setSources(Array.from({ length: shaderCount() }, (_, i) => shaderText(i)));
const shaderStore = {
  index: 0,
  get: () => shaderText(shaderStore.index),
  set(text) {
    if (!project) return;
    const list = project.song.shaders ??= [{ name: 'main', glsl: '' }];
    (list[this.index] ??= { name: String(this.index), glsl: '' }).glsl = text;
    if (list.length === 1 && !list[0].glsl) delete project.song.shaders;
    pushShaders(); scheduleCheck();
  },
  texts: () => Array.from({ length: shaderCount() }, (_, i) => shaderText(i)),
  list: () => Array.from({ length: shaderCount() }, (_, i) => ({ name: shaderList()[i]?.name ?? 'main' })),
  select(i) { this.index = Math.max(0, Math.min(shaderCount() - 1, i)); },
  insert(at, glsl, name) {
    if (!project) throw new Error('Open a project first.');
    if (shaderCount() >= 16) throw new Error('A song can have 16 shaders (0 to F).');
    const list = project.song.shaders ??= [{ name: 'main', glsl: shaderText(0) }];
    list.splice(at, 0, { name, glsl });
    shaderMachine.ensure();
    this.index = at; pushShaders(); scheduleCheck();
  },
  add() { this.insert(shaderCount(), shaderText(this.index), `shader ${shaderCount().toString(16).toUpperCase()}`); },
  duplicate() { this.insert(this.index + 1, shaderText(this.index), `${this.list()[this.index].name} copy`.slice(0, 24)); },
  rename(i, name) { if (project?.song.shaders?.[i]) { project.song.shaders[i].name = name; scheduleCheck(); } else if (project) { project.song.shaders = [{ name, glsl: shaderText(0) }]; scheduleCheck(); } },
  remove(i) {
    if (shaderCount() < 2) throw new Error('A song keeps at least one shader. Use Built-in to clear it.');
    project.song.shaders.splice(i, 1);
    if (project.song.shaders.length === 1 && !project.song.shaders[0].glsl) delete project.song.shaders;
    this.index = Math.min(this.index, shaderCount() - 1); pushShaders(); scheduleCheck();
  },
};
const visdata = createVisData({ lanes: () => project?.lanes ?? [], transport: engine.transport, song: () => project?.song, decayMs: () => config.get('visualDecay'), knob: name => shaderMachine.get(name) });
let visual = null, labels = null, vizOn = false;
shaderView = createShaderView({
  parts: { input: $('shader-input'), paint: $('shader-paint'), gutter: $('shader-gutter'), status: $('shader-status'), templates: $('shader-templates'), reset: $('shader-reset'), clip: $('shader-clip'), slidersOn: $('shader-sliders'), pick: $('shader-pick'), add: $('shader-add'), dup: $('shader-dup'), rename: $('shader-rename'), del: $('shader-del'), knobs: $('shader-knobs'), knobsOn: $('shader-knobs-on') },
  config, store: shaderStore, defaultSource: DEFAULT_GLSL, templates: TEMPLATES, machine: shaderMachine,
});
$('shader-pop').addEventListener('click', () => popOut());
{   // the guide under the editor: built the first time it is opened; each whole example has a button that puts it in the editor (Ctrl+Z undoes)
  const box = $('shader-guide'), body = $('shader-guide-body');
  box.addEventListener('toggle', () => {
    if (!box.open || body.childElementCount) return;
    body.innerHTML = renderMarkdown(GUIDE);
    for (const pre of body.querySelectorAll('pre')) {
      const text = pre.textContent.trim();
      if (!/void\s+main\s*\(/.test(text)) continue;
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'try', textContent: 'Try it in the editor', title: 'Replaces the shader in the editor with this one; Ctrl+Z in the editor brings yours back' });
      button.addEventListener('click', () => shaderView.tryText(`${text}\n`));
      pre.after(button);
    }
  });
}
dspView = createDspView({
  parts: { inst: $('dsp-inst'), chain: $('dsp-chain'), gut: $('dsp-gut'), src: $('dsp-src'), prm: $('dsp-prm'), ports: $('dsp-ports'), kern: $('dsp-kern'), foot: $('dsp-foot'), foldAll: $('dsp-fold'), unfoldAll: $('dsp-unfold'), diag: $('dsp-diag'), circ: $('dsp-circ'), open: $('dsp-open'), code: $('dsp-code') },
  getProject: () => project, nodeTypes: NODE_TYPES,
  value: (inst, node, param) => { const slot = engine.registry.slots.get(`${inst}.${node}.${param}`); return slot === undefined ? undefined : engine.registry.values[slot]; },
});
mountConfig($('shader-cfg'), config, [['visualSize', 'Resolution'], ['visualDecay', 'Hit fade (ms)'], ['visualSkeleton', 'Pattern skeleton']]);
mountConfig($('as-cfg'), config, [['sliceSensitivity', 'Sensitivity (%)', 'range'], ['sliceMinGap', 'Shortest gap (ms)'], ['sliceReplace', 'Replace the markers in range']]);
// Auto-slice: a dialog with its two settings and a live count of the hits they find, so a setting can be tried before it is applied
{
  const dlg = $('autoslice'), count = $('as-count');
  const refresh = () => {
    if (!dlg.open) return;
    const r = sampleScreen.autoSlice.preview();
    $('as-go').disabled = !r.hits.length;
    waveform.setGhost(r.marks, r.replace ? { from: r.from, to: r.to } : null);
    count.textContent = !r.name ? 'Pick a sample first.' : r.hits.length ? `${r.hits.length} hits found${r.whole ? '' : ' in the selection'}.` : `No hits found${r.whole ? '' : ' in the selection'}: raise the sensitivity or shorten the gap.`;
  };
  const open = () => { if (!started) return; if (!sampleScreen.selected) { $('proj-status').textContent = 'Pick a sample first.'; return; } dlg.showModal(); refresh(); $('as-cfg').querySelector('input')?.focus(); };
  config.onChange(k => { if (k === 'sliceSensitivity' || k === 'sliceMinGap' || k === 'sliceReplace') refresh(); });
  dlg.addEventListener('keydown', e => e.stopPropagation());
  $('as-go').addEventListener('click', () => { const msg = sampleScreen.autoSlice.apply(); dlg.close(); $('proj-status').textContent = msg; $('smp').focus(); });
  $('as-cancel').addEventListener('click', () => { dlg.close(); $('smp').focus(); });
  dlg.addEventListener('close', () => { waveform.setGhost(null); $('smp').focus(); });
  $('autoslice-open').addEventListener('click', open);
  autoSliceOpen = open;
}
// Detect chords: the notes of each chord in the sample (or its selection) as a preview, and a button that writes them into a new pattern
{
  const dlg = $('chordscan'), list = $('cs-list'), count = $('cs-count'), laneSel = $('cs-lane'), tickIn = $('cs-tick');
  let result = null, timer = 0;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = m => `${names[m % 12]}${Math.floor(m / 12) - 1}`;
  const noteCols = lane => lane.columns.flatMap((c, i) => (c.token === 'note' ? [i] : []));
  const fillLanes = () => {
    const keep = laneSel.value;
    laneSel.replaceChildren(...project.lanes.map((l, i) => (noteCols(l).length ? Object.assign(document.createElement('option'), { value: String(i), textContent: `${l.id} (${noteCols(l).length} note column${noteCols(l).length === 1 ? '' : 's'})` }) : null)).filter(Boolean));
    const want = [keep, String(seqView.lane)].find(v => v !== undefined && [...laneSel.options].some(o => o.value === v));
    if (want !== undefined) laneSel.value = want;
  };
  const bpm = () => config.get('chordBpm') || project.song.bpm;
  const scan = () => {
    const name = sampleScreen.selected, s = name ? project.samples[name] : null;
    result = null;
    if (!s) { list.textContent = ''; count.textContent = 'Pick a sample first.'; $('cs-go').disabled = true; return; }
    let [from, to] = sampleScreen.selection;
    if (!(to > from)) { from = 0; to = s.data.length; }
    const split = config.get('chordSplit');
    const r = scanChords(s.data, s.right, s.rate, { from, to, split: split === 'onsets' ? 'onsets' : Number(split), bpm: bpm(), maxNotes: config.get('chordMaxNotes'), threshold: config.get('chordThreshold') / 100 });
    result = { ...r, rate: s.rate };
    const t = f => `${Math.floor(f / s.rate / 60)}:${(f / s.rate % 60).toFixed(2).padStart(5, '0')}`;
    list.textContent = r.segments.map(g => `${t(g.frame0)}  ${g.name.padEnd(10)} ${g.notes.map(noteName).join(' ')}`).join('\n');
    count.textContent = r.segments.length ? `${r.segments.length} chord${r.segments.length === 1 ? '' : 's'} found${to - from < s.data.length ? ' in the selection' : ''}.` : 'No notes found: pick a part of the sample that sounds, or lower the weakest-note setting.';
    $('cs-go').disabled = !r.segments.length || !laneSel.options.length;
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (dlg.open) scan(); }, 150); };
  const open = () => {
    if (!started) return;
    if (!sampleScreen.selected) { $('proj-status').textContent = 'Pick a sample first.'; return; }
    fillLanes();
    tickIn.value = String(Math.floor(seqView.tick / 16) * 16);
    dlg.showModal();
    scan();
  };
  mountConfig($('cs-cfg'), config, [['chordSplit', 'Cut the recording'], ['chordMaxNotes', 'Most notes in a chord'], ['chordThreshold', 'Weakest note kept (%)'], ['chordBpm', 'Tempo of the recording (0: the song\'s)']]);
  config.onChange(k => { if (k.startsWith('chord')) later(); });
  dlg.addEventListener('keydown', e => e.stopPropagation());
  $('cs-go').addEventListener('click', () => {
    const li = Number(laneSel.value), lane = project.lanes[li], at = Math.max(0, Math.round(Number(tickIn.value) || 0));
    if (!result?.segments.length || !lane) return;
    const cols = noteCols(lane), tps = bpm() / 60 * (project.song.ticksPerBeat ?? 4);
    const { rows, items } = patternFrom(result.segments, result.rate, { tps, cols: cols.length, noteToken });
    const base = Math.floor(at / 16) * 16;
    const clash = lane.placements.find(p => p.start < base + rows && p.start + p.length > base);
    if (clash) { count.textContent = `A pattern of ${lane.id} is in the way (it is at tick ${clash.start}): pick a later start or another lane.`; return; }
    const puid = project.editor.transcribe(li, base, rows, items.map(i => ({ ...i, col: cols[i.col] })));
    if (puid === null || puid === undefined) { count.textContent = 'Could not make a pattern there.'; return; }
    engine.setLane({ id: lane.id, instrument: lane.instrument, columns: lane.columns, pages: lane.pages, mask: lane.mask, auto: lane.auto });
    songChanged();
    dlg.close();
    $('proj-status').textContent = `Wrote ${result.segments.length} chord${result.segments.length === 1 ? '' : 's'} into ${lane.id} at tick ${base}, ${rows} rows. Open the Arrangement to hear it.`;
  });
  $('cs-cancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => $('smp').focus());
  $('chordscan-open').addEventListener('click', open);
  chordScanOpen = open;
}
const placeViz = () => { if (pip) return; vizBox.style.bottom = `${$('footer').offsetHeight + (meters.open ? config.get('meterHeight') : 0) + 14}px`; };
const showViz = on => {
  vizOn = on;
  if (on && !visual) {
    visual = createVisual($('viz-canvas'), { colours: paletteColours(config.get), onRestore: () => { visual = null; showViz(vizOn); }, onError: text => { vizErr.hidden = !text; vizErr.textContent = text; shaderView?.error(text); } });
    if (!visual) { vizOn = false; $('status').textContent = 'The live picture needs WebGL, which this browser does not have.'; }
    else { visual.resize(Number(config.get('visualSize'))); pushShaders(); labels = createLabels($('viz-text'), Number(config.get('visualSize'))); }
  }
  if (!vizOn && pip) pip.close();
  vizBox.hidden = !vizOn; $('viz-btn').setAttribute('aria-pressed', String(vizOn)); placeViz();
};
const drawViz = now => { const d = visdata.frame(now ?? performance.now()); d.skeleton = config.get('visualSkeleton'); if (tabs.active === 'shader') d.shader = shaderStore.index; visual.draw(d); labels?.update(d.names, d.skeleton); };
// The picture in a window of its own: Document Picture-in-Picture (Chrome, Edge, Brave), an always-on-top window that can go to any
// screen. The picture's box moves into it and is drawn from that window's own frame loop, which keeps running when this window is
// covered by other programs. Closing the window, or the button again, brings the box back.
let pip = null;
const popStyle = `html,body{margin:0;height:100%;background:#111;overflow:hidden}
#viz{position:fixed;inset:0;width:auto;height:auto;border-radius:0;box-shadow:none;background:#111}
#viz canvas{position:absolute;left:50%;top:50%;width:100vmin;height:100vmin;transform:translate(-50%,-50%);display:block}
#viz-text{pointer-events:none}
#viz-pop{position:absolute;right:6px;top:6px;width:26px;height:26px;padding:0;opacity:0;transition:opacity .15s;background:rgba(0,0,0,.55);color:#cfe3e7;border:0;border-radius:4px;cursor:pointer}
#viz:hover #viz-pop{opacity:1}
#viz-err{position:absolute;left:0;right:0;bottom:0;padding:3px 8px;font:11px ui-monospace,Consolas,monospace;color:#ffd9d4;background:rgba(120,20,10,.85)}
#viz-err[hidden]{display:none}`;
const popOut = async () => {
  if (pip) { pip.close(); return; }
  if (!vizOn || !visual) return;
  if (!('documentPictureInPicture' in window)) { $('status').textContent = 'This browser has no floating windows (Document Picture-in-Picture: Chrome, Edge and Brave have it).'; return; }
  try {
    const w = await documentPictureInPicture.requestWindow({ width: 340, height: 340 });
    pip = w;
    w.document.head.append(Object.assign(w.document.createElement('style'), { textContent: popStyle }));
    w.document.title = 'Wax picture';
    vizBox.style.bottom = '';
    w.document.body.append(w.document.adoptNode(vizBox));
    $('viz-btn').setAttribute('aria-pressed', 'true');
    const loop = now => { if (pip !== w) return; if (vizOn && visual) drawViz(performance.now()); w.requestAnimationFrame(loop); };
    w.requestAnimationFrame(loop);
    w.addEventListener('pagehide', () => { if (pip === w) { pip = null; document.body.append(document.adoptNode(vizBox)); vizBox.hidden = !vizOn; placeViz(); } });
    w.document.getElementById('viz-pop').addEventListener('click', () => w.close());
  } catch (e) { $('status').textContent = `Could not open the floating window: ${e.message}`; }
};
$('viz-pop').addEventListener('click', popOut);
const toggleViz = () => config.set('visualOn', !vizOn);
$('viz-btn').addEventListener('click', toggleViz);
addEventListener('resize', placeViz);
// Ctrl+Alt+O: the vectorscope panel of the meter band on or off (the band opens if it is closed)
const toggleScope = () => { if (!meters.open) { config.set('meterScope', true); config.set('meterOn', true); } else config.set('meterScope', !config.get('meterScope')); };

// ---- the command console: | opens a one-line box that runs a rule from the list in Config on the selection ----
const cmdbar = $('cmdbar'), cmd = $('cmd'), cmdHint = $('cmd-hint');
let rules = analyse(parseRules(config.get('consoleRules'))), cmdHistory = [], cmdAt = -1;
config.onChange(k => { if (k === 'consoleRules') rules = analyse(parseRules(config.get('consoleRules'))); });
const placeCmd = () => { cmdbar.style.bottom = `${$('footer').offsetHeight + (meters.open ? config.get('meterHeight') : 0)}px`; };
const closeCmd = (refocus = true) => { cmdbar.hidden = true; cmdBarOpen = false; if (refocus) tabs.show(tabs.active); };
let cmdBarOpen = false;
const openCmd = () => { placeCmd(); cmdbar.hidden = false; cmdBarOpen = true; cmd.value = ''; cmdHint.className = ''; cmdHint.textContent = 'a rule from Config, then Enter (Esc closes, ? lists them)'; cmdAt = -1; cmd.focus(); };
const hintFor = text => {
  const r = resolve(rules, text);
  if (r.empty) return ['a rule from Config, then Enter (Esc closes, ? lists them)', false];
  if (r.none) return [r.blocked ? `that rule is switched off (${describeRule(r.blocked)})` : r.near.length ? `no match; did you mean: ${r.near.map(x => x.split('->')[0].trim()).join(', ')}` : 'no rule for that', true];
  return [stepsOf(r).map(([a, n]) => stepLabel(a, n)).join(', then '), false];
};
cmd.addEventListener('input', () => { if (cmd.value.trim() === '?') { cmdHint.className = ''; cmdHint.textContent = rules.filter(r => r.usable).map(r => r.text.split('->')[0].trim()).join('   '); return; } const [t, bad] = hintFor(cmd.value); cmdHint.textContent = t; cmdHint.className = bad ? 'bad' : ''; });
cmd.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); closeCmd(); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (!cmdHistory.length) return;
    cmdAt = e.key === 'ArrowUp' ? Math.min(cmdHistory.length - 1, cmdAt + 1) : Math.max(-1, cmdAt - 1);
    cmd.value = cmdAt < 0 ? '' : cmdHistory[cmdAt]; cmd.dispatchEvent(new Event('input'));
    return;
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = cmd.value.trim();
  if (!text || text === '?') return;
  const r = resolve(rules, text);
  if (r.none) { if (!r.blocked) noteUnknown(text); const [t] = hintFor(text); cmdHint.textContent = t; cmdHint.className = 'bad'; return; }
  const table = (tabs.active === 'arrange' ? seqView : view).commands, said = [];
  for (const [action, n] of stepsOf(r)) {
    if (!table[action]) { said.push(`${action} is not available here`); break; }
    said.push(table[action](n));
  }
  cmdHistory = [text, ...cmdHistory.filter(x => x !== text)].slice(0, 30);
  closeCmd();
  (tabs.active === 'arrange' ? seqView : view).say?.(said.filter(Boolean).join(' '));
  (tabs.active === 'arrange' ? seqView : view).draw();
});
document.addEventListener('keydown', e => {
  if (e.key !== '|' || e.ctrlKey || e.altKey || e.metaKey || cmdBarOpen || (tabs.active !== 'patterns' && tabs.active !== 'arrange')) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
  e.preventDefault(); e.stopPropagation(); openCmd();
}, true);
config.onChange((k, v) => { if (k === 'visualOn') showViz(v); else if (k === 'visualPalette' || k === 'visualColour1' || k === 'visualColour2') visual?.setColours(paletteColours(config.get)); else if (k === 'visualGlsl') { pushShaders(); shaderView?.load(); } else if (k === 'visualSize') { visual?.resize(Number(v)); labels?.resize(Number(v)); } else if (k === 'meterOn') { showMeters(v); placeViz(); } else if (k.startsWith('meter')) { meters.rebuild(); placeMeters(); } });
$('meters-btn').addEventListener('click', toggleMeters);
addEventListener('resize', placeMeters);
showMeters(config.get('meterOn'));
showViz(config.get('visualOn'));

// Export: the whole song, once, offline, as a WAV file. Pressing the button again while it renders cancels.
let exporting = null;
$('export').addEventListener('click', async () => {
  if (exporting) { exporting.on = true; return; }
  if (!project || !engine.node) return;
  const cancel = exporting = { on: false }, button = $('export'), say = text => { $('status').textContent = text; };
  const mp4 = config.get('exportFormat') === 'mp4', bar = $('xprog'), icon = button.innerHTML;
  const show = f => { bar.hidden = false; bar.firstElementChild.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`; };
  show(0);
  button.title = 'Cancel the export';
  try {
    engine.stop();
    const out = await renderSong(engine.exportState(), { tail: config.get('exportTail'), cancel, onProgress: f => { show(mp4 ? f / 2 : f); say(`Rendering the song: ${Math.round(f * 100)}%`); } });
    if (!out) say('Export cancelled.');
    else if (config.get('exportFormat') === 'mp4') {
      const name = project.song.name ?? 'untitled', saved = config.get('exportArt');
      const art = await artCanvas(saved ? await (await fetch(saved)).blob() : null, { size: 300, title: name });
      const file = await encodeMp4(out, { art, cancel, onProgress: f => { show(.5 + f / 2); say(`Encoding the MP4: ${Math.round(f * 100)}%`); } });
      if (!file) say('Export cancelled.');
      else {
        download(`${name}.mp4`, file.blob);
        say(`Exported ${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')} to MP4 (${file.video} picture, ${file.audio} sound, ${(file.blob.size / 1048576).toFixed(1)} MB).`);
      }
    } else {
      const bits = Number(config.get('exportBits'));
      download(`${project.song.name ?? 'untitled'}.wav`, encodeWav(out, bits));
      const db = out.peak > 0 ? 20 * Math.log10(out.peak) : -Infinity;
      say(`Exported ${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')} to WAV, peak ${db.toFixed(1)} dB${out.peak > 1 && bits !== 32 ? ' (it clips: lower the master volume or use 32-bit float)' : ''}.`);
    }
  } catch (e) { say(`Export failed: ${e.message}`); }
  exporting = null;
  bar.hidden = true;
  button.innerHTML = icon;
  button.title = 'Export: render the whole song to a WAV or MP4 file, with a tail after the end (type and length in Config); press again while it runs to cancel';
});

// The project name in the header, and a * after it once the project differs from what was last saved or opened. The check
// serializes the project, so it runs at most every second or so after the user does something, and stops once it is dirty.
let savedHash = null, dirty = false, checkTimer = null, checkCost = 0;
const setDirty = d => { dirty = d; $('dirty').hidden = !d; };
function markSaved() { savedHash = project ? hashOf(serializeProject(project)) : null; setDirty(false); }
function checkDirty() {
  checkTimer = null;
  if (!project || savedHash === null) return;
  const t0 = performance.now(), h = hashOf(serializeProject(project));
  checkCost = performance.now() - t0;
  setDirty(h !== savedHash);
}
function scheduleCheck() { if (checkTimer || dirty || !project) return; checkTimer = setTimeout(checkDirty, Math.max(1000, checkCost * 40)); }
for (const ev of ['keydown', 'pointerup', 'change', 'input', 'drop']) document.addEventListener(ev, scheduleCheck, true);
setInterval(scheduleCheck, 4000);   // MIDI recording and the like change the project with no key or click
$('pname').addEventListener('change', () => {
  if (!project) return;
  project.song.name = $('pname').value.trim() || 'untitled';
  $('pname').value = project.song.name;
  checkDirty();
});
// Ctrl+S: Save as, from anywhere (the capture phase, so even a number field that swallows keys lets it through)
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyS') { e.preventDefault(); e.stopPropagation(); if (project) saveProject(); } }, true);
$('pname').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') $('pname').blur(); });

// Save as (the Save button and Ctrl+S): the browser's own save dialog, for a name and a folder, where it has one;
// otherwise a plain download.
async function saveProject() {
  const text = serializeProject(project), name = `${project.song.name ?? 'untitled'}${FILE_EXT}`;
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Wax project', accept: { 'application/json': [FILE_EXT] } }] });
      const chosen = handle.name.replace(/\.[^.]*$/, '');
      if (chosen && chosen !== project.song.name) { project.song.name = chosen; $('pname').value = chosen; }   // the file name becomes the project name
      const w = await handle.createWritable();
      await w.write(serializeProject(project));
      await w.close();
      backups.snapshot('save');
      markSaved();
      $('status').textContent = `Saved ${handle.name}.`;
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') { $('status').textContent = 'Save cancelled.'; return; }   // closed the dialog
  }
  download(name, text);
  backups.snapshot('save');
  markSaved();
  $('status').textContent = 'Saved.';
}
$('save').addEventListener('click', () => { saveProject(); });
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  if (project) backups.snapshot('before load');
  try {
    if (/\.midi?$/i.test(file.name)) {   // a MIDI file adds a lane on a new synth for each of its tracks
      const data = ops.projectData(project), done = importMidi(data, parseMidi(await file.arrayBuffer()));
      if (!done.lanes) throw new Error('That MIDI file has no notes.');
      openProject(data, { stay: true, lane: data.song.lanes[data.song.lanes.length - done.lanes].id });
      $('status').textContent = `Added ${done.lanes} lane${done.lanes > 1 ? 's' : ''} from ${file.name} (${data.song.bpm} bpm, ${done.ticksPerBeat} ticks per beat${done.cut ? ', the end was cut off at the longest song' : ''}).`;
      return;
    }
    if (/\.mod$/i.test(file.name)) {   // a MOD file is a whole song: it replaces the project, one lane per channel
      if (!confirm('Replace the current project with this MOD file? Save first if you want to keep it.')) return;
      const mod = parseMod(await file.arrayBuffer()), data = modToProject(mod, file.name.replace(/\.mod$/i, ''));
      openProject(data);
      $('status').textContent = `Loaded ${file.name}: ${mod.channels} channels, ${data.song.length} ticks at ${data.song.bpm} bpm.`;
      return;
    }
    openProject(parseProject(await file.text()));
    $('status').textContent = `Loaded ${file.name}.`;
  } catch (err) {
    $('status').textContent = err.message;
  }
});

$('sample-file').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; loadSampleFiles(files); });
async function loadSampleFiles(files) {
  if (!engine.ctx) { projStatus('Start the engine first (press Start), then drop the files again.'); return; }
  for (const file of files) {
    try {
      // The browser decodes the file and resamples it to the audio context's rate.
      const buffer = await engine.ctx.decodeAudioData(await file.arrayBuffer());
      const sampleId = (({ data, right }) => addSample(project, file.name, buffer.sampleRate, data, right))(channelsOf(buffer));
      sampleScreen.select(sampleId);
      projStatus(`Loaded ${file.name}.`);
    } catch (err) {
      projStatus(`${file.name}: ${err.message}`);
    }
  }
  refreshProjectUi();
}

// Replace: the file's audio goes into the slot the button belongs to. The sample keeps its name, so every instrument that plays it
// is sent the new audio (and rebuilt when the sample went from mono to stereo or back).
async function replaceFromFile(file, id) {
  if (!engine.ctx) { projStatus('Start the engine first (press Start), then try again.'); return; }
  if (!id || !project.samples[id]) { projStatus('Pick a slot to replace first.'); return; }
  try {
    const buffer = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    const { data, right } = channelsOf(buffer);
    const users = replaceSample(project, id, buffer.sampleRate, data, right);
    sampleScreen.history.drop(id);
    const touched = [...new Set(users.map(u => u.instrument))];
    for (const inst of touched) {
      const before = JSON.stringify((project.instruments[inst].graph?.nodes ?? []).map(n => n.stereo));
      syncSamplerStereo(project.instruments[inst], project.samples);
      if (before !== JSON.stringify((project.instruments[inst].graph?.nodes ?? []).map(n => n.stereo))) { loadInst(inst); sendSamples(inst); }
    }
    sendLoop(users);
    auditionDirty = true; waveform.invalidate(); sampleScreen.select(id); sampleScreen.setSelection(0, 0);
    refreshProjectUi();
    projStatus(`Replaced ${id} with ${file.name}${users.length ? ` (${touched.length} instrument${touched.length === 1 ? '' : 's'} follow${touched.length === 1 ? 's' : ''})` : ''}.`);
  } catch (err) { projStatus(`${file.name}: ${err.message}`); }
}
$('replace-file').addEventListener('change', e => { const [file] = e.target.files; e.target.value = ''; if (file) replaceFromFile(file, replaceTarget); replaceTarget = null; });

// The sample browser on the same screen: pick a folder once, arrow through it to hear the files, Enter adds one as a new sample.
sampleBrowser = createSampleBrowser({
  root: $('smp-browse-body'), getCtx: () => engine.ctx, limitMB: () => config.get('sampleAskMB'), say: projStatus,
  onLoad: file => loadSampleFiles([file]), onReplace: file => replaceFromFile(file, sampleScreen.selected), waveColour: () => getComputedStyle($('smp-browse-body')).color || '#cfd3da',
});

// The strip under the slots: Record or Browse, one at a time. The choice is remembered.
{
  const tabs = [...document.querySelectorAll('.sl-tabs [data-tab]')], panels = { record: $('rec-panel'), browse: $('smp-browse-body') };
  const show = name => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
    if (name !== 'browse') sampleBrowser?.stop();
    try { localStorage.setItem('wax.sampleTab', name); } catch { /* not kept */ }
  };
  for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab));
  let first = 'browse'; try { first = localStorage.getItem('wax.sampleTab') === 'record' ? 'record' : 'browse'; } catch { /* default */ }
  show(first);
}

// Audio files can be dragged onto the sample screen. Dropping a file anywhere else would make the browser open it and
// leave the page, so the rest of the page just refuses.
{
  const pane = $('pane-samples'), hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); if (!pane.contains(e.target)) e.dataTransfer.dropEffect = 'none'; } });
  document.addEventListener('drop', e => { if (hasFiles(e) && !pane.contains(e.target)) e.preventDefault(); });
  let depth = 0;
  const mark = on => pane.classList.toggle('dropping', on);
  pane.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; mark(true); } });
  pane.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; mark(false); } });
  pane.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  pane.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; mark(false);
    const files = [...e.dataTransfer.files], audio = files.filter(f => f.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|ogg|oga|opus|m4a|aac|webm)$/i.test(f.name));
    if (audio.length) loadSampleFiles(audio); else projStatus('Only audio files can be dropped here.');
  });
}

// Recording a sample from another tab, the computer's audio or an input device (project/recorder.js).
{
  const btn = $('rec-take'), source = $('rec-source'), meter = $('rec-meter'), timeEl = $('rec-time'), mctx = meter.getContext('2d');
  let timer = null, peak = 0;
  const recorder = createRecorder({ getCtx: () => engine.ctx, onLevel: p => { peak = Math.max(peak, p); }, onEnd: take => finish(take) });
  const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const refreshInputs = async () => {
    const keep = source.value;
    source.replaceChildren(option('display', 'Another tab or screen (share audio)'), option('', 'Default input'));
    try { for (const d of await recorder.inputs()) if (d.id && d.id !== 'default') source.append(option(d.id, d.label)); } catch { /* no device list */ }
    if ([...source.options].some(o => o.value === keep)) source.value = keep;
  };
  const draw = () => {
    const w = meter.width, h = meter.height, db = peak > 0 ? 20 * Math.log10(peak) : -90, x = Math.max(0, Math.min(1, (db + 60) / 60)) * w;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = db > -1 ? '#d03040' : db > -12 ? '#d0a020' : '#30a060'; mctx.fillRect(0, 0, x, h);
    peak *= 0.8;
    timeEl.textContent = recorder.state.recording ? `${recorder.state.seconds.toFixed(1)} s` : timeEl.textContent;
  };
  function finish(take) {
    clearInterval(timer); timer = null; peak = 0; draw();
    btn.textContent = 'Record'; btn.classList.remove('live');
    if (!take) { projStatus('Nothing was recorded.'); timeEl.textContent = ''; return; }
    const id = addSample(project, 'rec', take.rate, take.data, take.right);
    sampleScreen.select(id);
    refreshProjectUi();
    timeEl.textContent = '';
    projStatus(`Recorded ${take.seconds.toFixed(1)} s as ${id}${take.right ? ' (stereo)' : ''}.`);
  }
  btn.addEventListener('click', async () => {
    if (recorder.state.recording) return finish(recorder.stop());
    try {
      const wait = $('rec-wait').checked;
      projStatus(source.value === 'display' ? 'Pick a tab and tick "Also share tab audio"…' : 'Starting…');
      await recorder.start(source.value, { waitForSound: wait });
      btn.textContent = 'Stop'; btn.classList.add('live'); timeEl.textContent = '0.0 s';
      projStatus(wait ? 'Recording: waiting for sound…' : 'Recording…');
      timer = setInterval(draw, 50);
      refreshInputs();
    } catch (err) {
      projStatus(err.name === 'NotAllowedError' ? 'Recording was not allowed.' : err.message);
    }
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && recorder.state.recording) { finish(recorder.stop()); e.preventDefault(); e.stopPropagation(); } }, true);
  refreshInputs();
}

// Takes from tap nodes (audio/nodes/tap.js): the audio arrives in blocks while the song plays. At the end the sample is
// assembled, faded, written to its pool slot (and to a normal sample too, when the node asks), and every sampler that
// plays it is given the new audio.
{
  const takes = new Map();
  const concat = (parts, n) => { const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const fade = (a, rate, msIn, msOut) => {   // a raised-cosine fade over the first msIn and the last msOut milliseconds
    const n = a.length, fi = Math.min(Math.round(msIn * rate / 1000), n >> 1), fo = Math.min(Math.round(msOut * rate / 1000), n >> 1);
    for (let i = 0; i < fi; i++) a[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
    for (let i = 0; i < fo; i++) a[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
  };
  const put = (id, t, data, right) => {
    const old = project.samples[id];
    project.samples[id] = { rate: t.rate, data, ...(right ? { right } : {}), ...(isPool(id) ? { pool: true, taken: true } : {}), loopStart: 0, loopEnd: data.length };
    if (old && !isPool(id)) { if (old.volume !== undefined) project.samples[id].volume = old.volume; if (old.pan !== undefined) project.samples[id].pan = old.pan; }
  };
  const refreshUsers = ids => {
    const seen = new Set();
    for (const id of ids) for (const { instrument, node } of usersOfSample(project, id)) {
      const stereo = JSON.stringify(project.instruments[instrument].graph.nodes.map(n => !!n.stereo));
      syncSamplerStereo(project.instruments[instrument], project.samples);
      const after = JSON.stringify(project.instruments[instrument].graph.nodes.map(n => !!n.stereo));
      if (stereo !== after) { if (!seen.has(instrument)) { loadInst(instrument); sendSamples(instrument); seen.add(instrument); } } else if (!seen.has(instrument)) sendSample(instrument, node);
    }
    auditionDirty = true;
  };
  const store = t => {
    const n = t.ls.reduce((a, c) => a + c.length, 0);
    if (!n) return;
    const data = concat(t.ls, n), right = t.rs.length ? concat(t.rs, n) : undefined;
    fade(data, t.rate, t.fadeIn, t.fade); if (right) fade(right, t.rate, t.fadeIn, t.fade);
    const id = poolId(t.smp), written = [id];
    sampleScreen.history.clear();
    put(id, t, data, right);
    let said = `Tap ${t.node}: ${(n / t.rate).toFixed(2)} s into ${id}`;
    if (t.copy > 0) {
      const normal = Object.keys(project.samples).filter(s => !isPool(s));
      let to = normal[t.copy - 1];
      if (to) put(to, t, data.slice(), right?.slice()); else { to = addSample(project, `take${t.copy}`, t.rate, data.slice(), right?.slice()); project.samples[to].loopStart = 0; project.samples[to].loopEnd = n; }
      written.push(to); said += ` and ${to}`;
    }
    refreshUsers(written);
    refreshProjectUi();
    projStatus(`${said}.`);
  };
  engine.onEmit = ({ instrument, node, msg }) => {
    if (msg.type === 'osc') { const [address, args] = noteMessage(msg, msg.p, instrument); osc.send(address, args); return; }
    if (msg.type === 'cloud') { patcher.feedCloud(instrument, node, msg, engine.ctx.sampleRate); return; }
    const key = `${instrument}\u0000${node}`;
    if (msg.phase === 'start') { takes.set(key, { ...msg, node, ls: [], rs: [] }); projStatus(`Tap ${node}: recording into ${poolId(msg.smp)}…`); return; }
    const t = takes.get(key);
    if (!t || t.take !== msg.take) return;
    if (msg.phase === 'chunk') { t.ls.push(msg.l); if (msg.r) t.rs.push(msg.r); } else if (msg.phase === 'end') { takes.delete(key); if (project) store(t); }
  };
}

// A new instrument of a kind ('synth:NAME' or 'sampler') with its own lane; the sampler plays the sample picked in the box.
function makeInstrument(value, name = '', side = null) {
  try {
    const at = cursorLane();
    const [type, kind] = value.split(':');
    const id = type === 'sampler' ? addSamplerInstrument(project, name, $('new-inst-sample').value) : addSynthInstrument(project, name, kind);
    loadInst(id);
    if (type === 'sampler') sendSamples(id);
    const lane = addLaneFor(id);
    patcher.load({ instruments: project.instruments });
    patcher.show(id);
    refreshProjectUi();
    if (side) placeLane(lane.id, at, side);
    $('new-inst-name').value = '';
    projStatus(`Added ${id} with its own lane.`);
  } catch (err) {
    projStatus(err.message);
  }
}

// One box makes any new instrument: a synth from the list, a sampler on a chosen sample, or an empty graph.
{
  const kinds = $('new-inst-kind'), sample = $('new-inst-sample');
  const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const group = (label, entries) => { const g = document.createElement('optgroup'); g.label = label; g.append(...entries); return g; };
  const synths = Object.entries(synthKinds).filter(([k]) => k !== 'empty' && k !== 'modchan').map(([k, { label }]) => option(`synth:${k}`, label));
  kinds.replaceChildren(group('Samplers', [option('sampler', 'Sampler (plays a sample)'), option('synth:modchan', synthKinds.modchan.label)]), group('Synths', synths), group('Blank', [option('synth:empty', synthKinds.empty.label)]));
  const showSample = () => { sample.hidden = kinds.value !== 'sampler'; };
  kinds.addEventListener('change', showSample);
  showSample();
  $('add-inst').addEventListener('click', () => makeInstrument(kinds.value, $('new-inst-name').value.trim()));
}

$('add-lane').addEventListener('click', () => {
  try {
    const lane = addLaneFor($('add-lane-inst').value || patcher.instrument);
    projStatus(`Added lane ${lane.id}.`);
  } catch (err) {
    projStatus(err.message);
  }
});
// On the instrument screen: Insert shows the machine menu; Ctrl+D duplicates and Ctrl+X or Delete removes the selected node, wherever the focus is (except in a field)
document.addEventListener('keydown', e => {
  if (tabs.active !== 'instruments' || e.defaultPrevented || !project || nodeHelp.hidden === false) return;
  const t = e.target;
  if (t.closest?.('input, select, textarea, [contenteditable], #inst-list, dialog, .insert-menu')) return;
  if (e.key === 'Insert' && !e.ctrlKey && !e.altKey && !e.metaKey) { menu.open(12, 24); e.preventDefault(); return; }
  if (t !== $('patch') && patcher.nodeKey(e)) e.preventDefault();   // the canvas does these itself
});

{
  const logo = $('logo'), go = () => { if (logo.classList.contains('idle')) $('start').click(); };   // the Wax logo is the Start button until the engine runs
  logo.addEventListener('click', go);
  logo.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}
const splash = config.get('splash') ? createSplash({ box: $('splash'), onStart: () => $('start').click() }) : null;
document.documentElement.classList.remove('pre-splash');   // the first screen (if any) now covers the page itself
document.addEventListener('visibilitychange', () => { if (!document.hidden && started) engine.wake(); });   // coming back to the tab wakes a context the browser put to sleep
$('start').addEventListener('click', async () => {
  try {
    splash?.say('checking cross-origin isolation', crossOriginIsolated ? 'ok' : 'no');
    await engine.start();
    splash?.say(`audio context  ${engine.ctx.sampleRate} Hz  latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`);
    splash?.say(engine.wasmModule ? 'dsp compiled  wasm' : 'dsp  javascript fallback', engine.wasmModule ? 'ok' : 'js');
    splash?.say('audio worklet  tracker-engine');
    splash?.say(`registering ${Object.keys(NODE_TYPES).length} node types`);
    {
      const el = $('loadmeter');
      let peak = 0, late = 0, avg = 0, lateAt = -1e9;
      const show = () => {
        const h = engine.health();
        const drops = h.drops ? ` drops ${h.drops}` : '';
        const chain = engine.chainDelay(), heavy = chain >= 1 ? `  chain ${chain.toFixed(0)} ms` : '';   // the slowest instrument's own delay (spectral and oversampled nodes)
        el.textContent = `cpu ${Math.round(avg * 100)}%  peak ≥${Math.round(peak * 100)}%  late ${late}${drops}  ${h.latency.toFixed(0)} ms${heavy}`;
        el.className = performance.now() - lateAt < 5000 ? 'bad' : peak > 1 ? 'warn' : '';   // red only while blocks are running late
      };
      engine.onLoad = d => { avg = avg ? avg * 0.7 + d.avg * 0.3 : d.avg; peak = Math.max(peak, d.peak); if (d.late) lateAt = performance.now(); late += d.late; show(); };
      el.addEventListener('click', () => { peak = 0; late = 0; show(); });
      const copy = $('loadcopy');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(`${document.title} · ${project?.song?.name ?? ''} · ${el.textContent}`); copy.textContent = 'copied'; } catch { copy.textContent = 'failed'; }
        setTimeout(() => { copy.textContent = 'copy'; }, 1200);
      });
    }
    engine.onScope = d => patcher.feedScope(d.instrument, d.node, d.l, d.r, engine.ctx.sampleRate);
    engine.onFault = id => projStatus(`Instrument "${id}" produced invalid audio and was reset. If you can repeat it, note what you changed.`);
    started = true;
    // the demo song is a saved project shipped beside the code; the generated one is the fallback
    // ?demo=arp opens the arpeggiator demo, ?demo=NAME the saved project demos/NAME.wax; anything else the usual demo song
    const wanted = new URLSearchParams(location.search).get('demo') ?? '';
    if (wanted === 'arp') openProject(createArpDemoProject());
    else {
      try {
        const file = /^[a-z0-9_-]{1,40}$/i.test(wanted) ? `./project/demos/${wanted}.wax` : './project/demo.wax';
        const reply = await fetch(new URL(file, import.meta.url));
        if (!reply.ok) throw new Error(`${file}: ${reply.status}`);
        openProject(parseProject(await reply.text()));
      } catch (err) {
        console.warn(err);
        openProject(createSynthwaveProject());
      }
    }
    splash?.say(`project  ${project?.song?.name ?? 'untitled'}  ${Object.keys(project?.instruments ?? {}).length} instruments`);
    backups.start();
    startDownloads();
    navigator.storage?.persist?.();   // ask the browser not to clear the snapshots when it is short of space
    for (const id of ['start']) $(id).disabled = true;
    $('logo').classList.remove('idle'); $('logo').removeAttribute('title'); $('logo').removeAttribute('role'); $('logo').removeAttribute('tabindex');
    for (const id of ['play', 'pause', 'panic', 'cut', 'new', 'save', 'load', 'backups', 'export', 'rec-take', 'rec-source', 'add-inst', 'add-lane', 'add-lane-inst', 'inst-voices', 'inst-notecols', 'inst-up', 'inst-down', 'inst-dup', 'inst-remove', 'lane-name', 'lane-rename', 'lane-left', 'lane-right', 'lane-dup', 'lane-remove', 'lane-remove-all', 'length', 'ins-n', 'ins-go', 'bpm', 'swing', 'tpb', 'bar', 'preset-name', 'preset-save', 'preset-over', 'preset-rename', 'preset-remove', 'inst-export', 'inst-import', 'lib-load', 'lib-add', 'lib-save']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    // Only the screen that is showing is drawn: a hidden one has nothing to measure or paint, and its work would only delay the one you are using.
    const frame = now => {
      const tab = tabs.active;
      if (vizOn && visual && !pip) drawViz(now);
      songInfo(); syncLaneName();
      if (tab === 'arrange' || !tab) seqView.draw();
      if (tab === 'patterns' || !tab) view.draw();
      if (tab === 'instruments' || !tab) patcher.draw(); else if (floatWanted) patcher.live();
      if (tab === 'dsp') dspView?.live();
      if (tab === 'nodeseq') nsView?.draw();
      if (streams.open) streams.place();
      if (tab === 'samples' || !tab) { sampleScreen.draw(); waveform.draw(); region.draw(); waveform.playhead(auditionHead()); }
      requestAnimationFrame(frame);
    };
    frame();
    splash?.say('starting engine', 'ready');
    splash?.finish();
  } catch (err) {
    $('status').textContent = err.message;
    splash?.fail(err.message);
  }
});

// Ctrl+W closes the tab in a normal browser window and no page can stop that, so the page asks before it goes
// (the "Leave site?" box); where the key does reach the page (installed app, fullscreen) it is swallowed.
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyW') e.preventDefault(); }, true);
window.addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
