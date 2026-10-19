import { Engine } from './audio/engine.js';
import { NODE_TYPES } from './audio/nodes/index.js';
import { pruneDef } from './graph/edit.js';
import { createPatcher } from './graph/patcher.js';
import { createInsertMenu } from './graph/menu.js';
import { createSynthwaveProject } from './project/synthwave.js';
import * as ops from './project/ops.js';
import { importMidi, parseMidi } from './project/midi.js';
import { modToProject, parseMod } from './project/mod.js';
import * as presets from './project/presets.js';
import { LIBRARY_EXT, addToLibrary, importFromLibrary, newLibrary, parseLibrary, serializeLibrary } from './project/library.js';
import { createRecorder } from './project/recorder.js';
import { poolId, isPool, ensurePool, usersOfSample } from './project/ops.js';
import { idFromName, uniqueId, addLane, addSample, addSamplerInstrument, addSynthInstrument, channelsOf, sampleMessage, slotsOf, syncSamplerStereo } from './project/ops.js';
import { MASTER, ensureMaster, synthKinds } from './instruments.js';
import { createSampleScreen } from './project/samplescreen.js';
import { createWaveformView } from './project/waveform.js';
import { showContextMenu } from './ui/ctxmenu.js';
import { buildInstrument, fitTail } from './project/ptr.js';
import { ABOUT, CHANGELOG } from './ui/about.js';
import { createMidiInput } from './ui/midiin.js';
import { createMidiWriter } from './seq/midiwrite.js';
import { createMarkerRegionView } from './project/markerregion.js';
import { FILE_EXT, INSTRUMENT_EXT, parseInstrument, parseProject, serializeInstrument, serializeProject } from './project/file.js';
import { createEditor } from './seq/editor.js';
import { prepareSong, rebuildInstrumentLanes } from './seq/lane.js';
import * as config from './ui/config.js';
import { createSequenceView } from './seq/seqview.js';
import { attachGrip } from './ui/grip.js';
import { createTrackerView } from './seq/view.js';
import { createTabs } from './ui/tabs.js';
import { createScriptRunner } from './script/client.js';
import { createScriptScreen } from './script/screen.js';
import { placementAt } from './seq/edit.js';

const engine = new Engine();
const $ = id => document.getElementById(id);
let started = false, playing = false, project = null, recording = false;

const PLAY_ICON = '<svg class="ico" viewBox="0 0 12 12"><path d="M2.5 1 L10.5 6 L2.5 11 Z" fill="currentColor"/></svg>';
const STOP_ICON = '<svg class="ico" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';
const setPlaying = (value, from = null) => {
  playing = value;
  if (playing) engine.play(from); else engine.stop();
  $('play').innerHTML = playing ? STOP_ICON : PLAY_ICON;
  $('play').title = playing ? 'Stop (F8)' : 'Play (F5)';
  $('play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  if (recording) { if (playing) writer.beginPass(); else writer.endPass(); }   // each run of the song is its own undo step
};
const togglePlay = () => setPlaying(!playing);
// Panic: every sounding note stops, and held keyjazz keys are let go.
$('cut').addEventListener('click', e => { if (playing) setPlaying(false); engine.cut(); patcher.releaseKeys(); e.currentTarget.blur(); });
$('panic').addEventListener('click', e => { engine.panic(); patcher.releaseKeys(); e.currentTarget.blur(); });
$('play').addEventListener('click', e => { togglePlay(); e.currentTarget.blur(); });

// Full-screen panes. Switching with an F-key or a click focuses the pane's main element.
const tabs = createTabs({
  tabs: [
    { id: 'patterns', key: 'F1', el: $('pane-patterns'), button: $('tab-patterns'), focus: $('view') },
    { id: 'samples', key: 'F2', el: $('pane-samples'), button: $('tab-samples'), focus: $('smp') },
    { id: 'instruments', key: 'F3', el: $('pane-instruments'), button: $('tab-instruments'), focus: $('inst-list') },
    { id: 'arrange', key: 'F4', el: $('pane-arrange'), button: $('tab-arrange'), focus: $('seq') },
    { id: 'config', key: 'F11', el: $('pane-config'), button: $('tab-config'), focus: $('cfg') },
    { id: 'script', key: null, combo: e => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS', el: $('pane-script'), button: $('tab-script'), focus: $('script') },
    { id: 'info', key: 'F10', el: $('pane-info'), button: $('tab-info'), focus: { focus: () => (!$('info').hidden ? $('info') : $('info-view')).focus() } },
  ],
});
document.addEventListener('keydown', e => {
  if (tabs.handleKey(e)) return;
  const here = () => (tabs.active === 'arrange' ? seqView : view).tick;   // the row the cursor is on
  // Ctrl+Shift+R arms and disarms MIDI recording; Alt+V switches MIDI velocity on and off.
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
  const fKeys = { F5: () => setPlaying(true), F6: () => setPlaying(true, here()), F7: () => engine.playRow(here()), F8: () => setPlaying(false), F9: toggleFollow };
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
function followLane(laneIdx) {
  if (laneIdx === lastLane) return;
  lastLane = laneIdx;
  const id = project?.lanes[laneIdx]?.instrument;
  if (!config.get('followLane') || !id || id === patcher.instrument || !(id in project.instruments)) return;
  patcher.show(id);
  renderInstList();
}

const view = createTrackerView({
  follow: () => following,
  el: $('view'), statusEl: $('cursor'), transport: engine.transport, onToggle: togglePlay,
  onBack: () => tabs.show('arrange'),
  onRow: tick => { if (started) engine.playRow(tick); },
  onMove: (lane, tick) => { seqView.goto(lane, tick); followLane(lane); },
  onSong: () => songChanged(),
  readParam: slot => engine.registry.values[slot],
  onNote: (instrument, note, on, vel = 1) => { if (!started) return; if (on) engine.noteOn(instrument, note, vel); else engine.noteOff(instrument, note); },
});
const seqView = createSequenceView({
  follow: () => following,
  el: $('seq'), statusEl: $('seq-status'), listEl: $('seq-list'), transport: engine.transport, onToggle: togglePlay,
  onOpen: (lane, tick, { solo = false } = {}) => { if (!solo || !view.enterSolo(lane, tick)) view.goto(lane, tick); tabs.show('patterns'); },
  onMove: (lane, tick) => { view.goto(lane, tick); followLane(lane); },
  onSong: () => songChanged(),
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
const scriptScreen = createScriptScreen({
  area: $('script'), hl: $('script-hl'), runButton: $('script-run'), status: $('script-status'), out: $('script-out'), line: $('script-line'),
  runner: createScriptRunner({ limit: () => config.get('scriptLimit') }),
  target: scriptTarget,
  onText: text => { if (project) { if (text) project.song.script = text; else delete project.song.script; } },
  midi: () => ({ window: config.get('midiWindow'), order: config.get('midiOrder') }),
});
// Ctrl+Alt+R in the pattern editor: run the whole script on the pattern there.
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') || tabs.active !== 'patterns') return;
  e.preventDefault();
  view.say('Running the script...');
  scriptScreen.run().then(text => view.say(text));
});

// ---- MIDI keyboard ----
// Plays the machine under the cursor (the selected instrument in the graph view, the sample on the sample screen), enters
// notes at the cursor in the pattern editor, and with Rec armed writes them into the playing song on the nearest tick.
const midiVoices = new Map();   // MIDI note -> what its press started, so the release stops that and nothing else
const midiSay = text => { (tabs.active === 'arrange' ? seqView : view).say(text); };
const writer = createMidiWriter({
  lanes: () => project?.lanes ?? [], editor: () => project.editor, length: () => project.song.length, loop: () => project.song.loop ?? null,
  settings: () => ({ chord: config.get('midiChord'), window: config.get('midiWindow'), velocity: config.get('midiVelocity'), offs: config.get('midiOffs'), shared: config.get('midiShared'), order: config.get('midiOrder') }),
});
const setRecording = on => {
  recording = on;
  $('rec').setAttribute('aria-pressed', String(on));
  if (on) writer.beginPass(); else writer.endPass();
  midiSay(on ? (playing ? 'Recording: play on the MIDI keyboard.' : 'Rec armed: it records while the song plays.') : 'Recording off.');
};
$('rec').addEventListener('click', e => { setRecording(!recording); e.currentTarget.blur(); });
const latencyTicks = () => {
  const ms = engine.health().latency + config.get('midiLatency');
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

const patcher = createPatcher({
  onNote: (id, note, on) => { if (!started) return; if (on) engine.noteOn(id, note, 1); else engine.noteOff(id, note); },
  canvas: $('patch'), panel: $('patch-panel'), paramPanel: $('patch-scroll'), exposedDock: $('exposed-scroll'), onEscape: () => $('inst-list').focus(), statusEl: $('patch-status'), nodeTypes: NODE_TYPES,
  onStructure: id => reloadInstrument(id),
  onContext: ({ x, y }) => menu.open(x, y),
  onData: (id, node, msg) => engine.sendToNode(id, node, msg),
  onScope: (id, node, on) => engine.scope(id, node, on),
  readLive: (id, node, name) => { const a = `${id}.${node}.${name}`; return engine.registry.slots.has(a) ? engine.registry.get(a) : undefined; },
  getSampleIds: () => Object.keys(project.samples),
  getSample: id => { const s = project.samples[id]; return s ? { data: s.right ? Float32Array.from(s.data, (v, i) => (v + s.right[i]) * 0.5) : s.data, rate: s.rate } : null; },
  onParam: (id, node, name, value) => {
    const address = `${id}.${node}.${name}`;
    if (engine.registry.slots.has(address)) engine.set(address, value);
  },
});

// The height of the graph area, the pattern editor and the arrangement: drag the bar under each (or Up/Down on it);
// the rest of the screen follows. The choices are remembered in this browser.
// The graph fills the space between the list and the shortcut panel.
if (globalThis.ResizeObserver) new ResizeObserver(() => { const w = $('patch-wrap').clientWidth; if (w > 0) patcher.fit(w - 2); }).observe($('patch-wrap'));
attachGrip({ grip: $('patch-grip'), key: 'webtracker.graphHeight', get: () => patcher.height, set: h => patcher.resize(h), step: 20, bigStep: 100, normal: 460 });
attachGrip({ grip: $('view-grip'), key: 'webtracker.patternRows', get: () => view.rows, set: n => view.setRows(n), unit: () => view.lineHeight(), step: 1, bigStep: 8, normal: 24 });
attachGrip({ grip: $('seq-grip'), key: 'webtracker.arrangementRows', get: () => seqView.rows, set: n => seqView.setRows(n), unit: () => 18, step: 1, bigStep: 8, normal: 24 });

// The keyboard shortcut panels can be hidden (the button in the tab bar, or "hide" in a panel); the screens then
// use the whole width. The choice is remembered in this browser.
{
  const toggle = $('keys-toggle');
  const apply = hidden => {
    document.body.classList.toggle('nokeys', hidden);
    toggle.setAttribute('aria-pressed', String(!hidden));
  };
  apply(config.get('hideKeys'));
  config.onChange((k, v) => { if (k === 'hideKeys') apply(v); });
  toggle.addEventListener('click', () => config.set('hideKeys', !document.body.classList.contains('nokeys')));
  for (const h of document.querySelectorAll('.keys h3')) {
    const hide = Object.assign(document.createElement('button'), { textContent: 'hide', title: 'Hide the shortcut panels' });
    hide.addEventListener('click', () => apply(true));
    h.append(hide);
  }
}

// The floating insert menu lives over the patcher canvas.
const menu = createInsertMenu({ parent: $('patch-wrap'), nodeTypes: NODE_TYPES, onPick: (type, at) => patcher.add(type, at) });
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
  const { name, length } = project.song;
  const tick = Atomics.load(engine.transport, 0);
  $('song-info').textContent = `${name ?? 'untitled'} · row ${String(tick).padStart(2, '0')}/${length}`;
};

const projStatus = text => { $('proj-status').textContent = text; };

// The lists that depend on what the project holds: instruments, samples, the sample list.
function refreshProjectUi() {
  const fill = (select, ids) => {
    const keep = select.value;
    select.replaceChildren(...ids.map(id => new Option(id, id)));
    if (ids.includes(keep)) select.value = keep;
  };
  renderInstList();
  fill($('new-inst-sample'), Object.keys(project.samples));
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
  $('inst-name').value = patcher.instrument ?? '';
  renderLaneInstruments();
  renderPresetList();
  syncPoly();
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
function reshape(change, { instrument = patcher.instrument, lane = cursorLane() } = {}) {
  try {
    if (playing) setPlaying(false);
    const result = change();
    const select = typeof result === 'object' && result !== null ? result : {};
    openProject(ops.projectData(project), { stay: true, instrument: select.instrument ?? instrument, lane: select.lane ?? lane });
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
    for (const s of config.SCHEMA) {
      if (s.group) {
        const sec = document.createElement('div'), head = document.createElement('div');
        sec.className = 'cfg-sec';
        head.append(Object.assign(document.createElement('h2'), { textContent: s.group }), Object.assign(document.createElement('p'), { textContent: config.GROUPS[s.group] ?? '' }));
        card = Object.assign(document.createElement('div'), { className: 'cfg-card' });
        sec.append(head, card);
        sections.push(sec);
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
    // the backup section holds the buttons
    const backup = document.createElement('div');
    backup.className = 'cfg-sec';
    const bhead = document.createElement('div');
    bhead.append(Object.assign(document.createElement('h2'), { textContent: 'Backup' }), Object.assign(document.createElement('p'), { textContent: 'Keep a copy of your settings or send them to someone.' }));
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
const songChanged = () => { engine.setSong(project.song); songInfo(); };
$('bpm').addEventListener('change', () => {
  project.song.bpm = Math.max(20, Math.min(400, Math.round(Number($('bpm').value)) || project.song.bpm));
  $('bpm').value = project.song.bpm;
  songChanged();
});
$('swing').addEventListener('change', () => {
  const pct = Math.max(50, Math.min(75, Math.round(Number($('swing').value)) || 50));
  project.song.swing = pct / 100;
  $('swing').value = pct;
  songChanged();
});
$('length').addEventListener('change', () => {
  const before = project.song.length;
  reshape(() => {
    try { const n = ops.setSongLength(project, $('length').value); return { message: `Song length ${n} ticks.` }; } catch (err) { $('length').value = before; throw err; }
  });
});
const insertSilence = n => {
  const tick = seqView.tick, lane = seqView.lane;
  reshape(() => { const k = ops.insertTicks(project, tick, n, { cut: config.get('insertCut') }); return { message: `Inserted ${k} ticks at ${Math.floor(tick / 16) * 16}.` }; }, { lane });
  seqView.goto(lane, tick);
  $('seq-status').textContent = $('patch-status').textContent;
};
$('ins-n').value = config.get('insertLength');
$('ins-cut').checked = config.get('insertCut');
$('ins-cut').addEventListener('change', () => config.set('insertCut', $('ins-cut').checked));
config.onChange((k, v) => { if (k === 'insertCut') $('ins-cut').checked = v; else if (k === 'insertLength') $('ins-n').value = v; });
$('ins-go').addEventListener('click', () => insertSilence($('ins-n').value));
$('ins-n').addEventListener('keydown', e => { if (e.key === 'Enter') insertSilence($('ins-n').value); });
for (const b of document.querySelectorAll('.ins-pre')) { b.disabled = false; b.addEventListener('click', () => { $('ins-n').value = b.dataset.n; insertSilence(b.dataset.n); }); }
for (const id of ['length', 'ins-n', 'bpm', 'swing']) $(id).addEventListener('keydown', e => e.stopPropagation());

$('inst-rename').addEventListener('click', () => {
  const id = patcher.instrument;
  if (id) reshape(() => { const next = ops.renameInstrument(project, id, $('inst-name').value); return { instrument: next, message: `Renamed to ${next}.` }; });
});
$('inst-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('inst-rename').click(); e.stopPropagation(); });
$('inst-up').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, -1); }); });
$('inst-down').addEventListener('click', () => { const id = patcher.instrument; if (id) reshape(() => { ops.moveInstrument(project, id, 1); }); });
$('inst-dup').addEventListener('click', () => {
  const id = patcher.instrument;
  if (id) reshape(() => { const next = ops.duplicateInstrument(project, id); return { instrument: next, message: `Copied to ${next}.` }; });
});
confirmed($('inst-remove'), 'Remove', () => { const id = patcher.instrument; if (id) reshape(() => { ops.removeInstrument(project, id); return { message: `Removed ${id}.` }; }); });

$('lane-rename').addEventListener('click', () => {
  const id = cursorLane();
  if (id) reshape(() => { const next = ops.renameLane(project, id, $('lane-name').value); return { lane: next, message: `Renamed to ${next}.` }; });
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
      { label: 'Silence', hint: `Shift+S · ${scope}`, run: edit('silence') },
      { separator: true },
      { label: 'Reverse', hint: `Shift+R · ${scope}`, run: edit('reverse') },
      { label: 'Normalise', hint: `Shift+N · ${scope}`, run: edit('normalise') },
      { label: 'Fade in', hint: `Shift+I · ${scope}`, run: edit('fadeIn') },
      { label: 'Fade out', hint: `Shift+O · ${scope}`, run: edit('fadeOut') },
      { label: 'Remove DC offset', hint: `Shift+D · ${scope}`, run: edit('removeDc') },
      { label: 'Bake loop crossfades', hint: 'Shift+B', run: edit('bakeCrossfade') },
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
const playSample = (id, note, on) => {
  if (!started || !(id in project.samples)) return;
  if (on) { prepareAudition(id); engine.noteOn(AUDITION, note, 1, { choke: true }); }   // a new note fades the old one, loop or not else if (audition) engine.noteOff(AUDITION, note);
};
const sampleScreen = createSampleScreen({
  el: $('smp'), statusEl: $('proj-status'), getProject: () => project,
  onChange: users => { sendLoop(users); auditionDirty = true; },   // loops, levels and edits change what the sample plays
  onSelect: id => { waveform.show(id); auditionDirty = true; },
  onRemove: refreshProjectUi,
  onRename: () => { refreshProjectUi(); patcher.show(patcher.instrument); },
  onNote: playSample,
  onSelection: (from, to) => waveform.setSelection(from, to),
  onSlice: i => waveform.setActiveSlice(i),
  onLoad: () => $('sample-file').click(),
  onKeep: id => {   // K: copy the sample under the cursor into a new normal sample
    const s = project.samples[id];
    if (!s) return;
    const copy = addSample(project, isPool(id) ? `${id}_kept` : `${id}_copy`, s.rate, s.data.slice(), s.right?.slice());
    for (const k of ['loopStart', 'loopEnd', 'loopOn', 'loopXfade', 'susStart', 'susEnd', 'susOn', 'susXfade', 'volume', 'globalVolume', 'pan', 'slices']) if (s[k] !== undefined) project.samples[copy][k] = structuredClone(s[k]);
    refreshProjectUi(); sampleScreen.select(copy); projStatus(`Copied ${id} to ${copy}.`);
  },
  onView: mode => waveform.setMode(mode),
});

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

function addLaneFor(instrumentId) {
  const lane = addLane(project, engine.registry, instrumentId);
  engine.setLane({ id: lane.id, instrument: lane.instrument, columns: lane.columns, pages: lane.pages, mask: lane.mask });
  project.editor.clear();
  view.relayout();
  return lane;
}

// The columns of an instrument's lanes need rebuilding (its exposed parameters or presets changed).
// Cells follow their column; undo history is cleared.
function refreshLanes(id) {
  for (const { id: laneId, instrument, columns, pages, mask } of rebuildInstrumentLanes(project.lanes, project.song, project.instruments, engine.registry, id)) {
    engine.setLane({ id: laneId, instrument, columns, pages, mask });
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
  } catch (err) {
    $('patch-status').textContent = err.message;
  }
}

// Loads a project into the running engine: { song, instruments, samples }.
function openProject({ song, instruments, samples }, { stay = false, instrument = null, lane = null } = {}) {
  ensureMaster({ song, instruments });
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
  for (const { id, instrument, columns, pages, mask } of lanes) engine.setLane({ id, instrument, columns, pages, mask });
  const editor = createEditor(lanes, song.length);
  project = { song, instruments, samples, lanes, editor };
  patcher.load({ instruments });
  if (instrument in instruments) patcher.show(instrument);
  refreshProjectUi();
  seqView.load({ lanes, song, editor });
  view.load({ lanes, song, editor });
  const at = Math.max(lanes.length > 1 ? 1 : 0, lanes.findIndex(l => l.id === lane));   // not the master lane, to start with
  view.goto(at, 0); seqView.goto(at, 0);
  scriptScreen.load(song.script);
  $('info').value = song.info ?? '';
  infoStatus();
  if (song.info) { renderInfo(); $('info').hidden = true; $('info-view').hidden = false; $('info-edit').textContent = 'Edit'; }
  else { $('info').hidden = false; $('info-view').hidden = true; $('info-edit').textContent = 'Done'; }
  $('length').value = song.length;
  $('bpm').value = song.bpm;
  $('swing').value = Math.round((song.swing ?? 0.5) * 100);
  if (!stay) tabs.show('patterns');
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

$('save').addEventListener('click', () => {
  download(`${project.song.name ?? 'untitled'}${FILE_EXT}`, serializeProject(project));
  $('status').textContent = 'Saved.';
});
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
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

$('load-samples').addEventListener('click', () => $('sample-file').click());
$('sample-file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
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
});

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
    const key = `${instrument}\u0000${node}`;
    if (msg.phase === 'start') { takes.set(key, { ...msg, node, ls: [], rs: [] }); projStatus(`Tap ${node}: recording into ${poolId(msg.smp)}…`); return; }
    const t = takes.get(key);
    if (!t || t.take !== msg.take) return;
    if (msg.phase === 'chunk') { t.ls.push(msg.l); if (msg.r) t.rs.push(msg.r); } else if (msg.phase === 'end') { takes.delete(key); if (project) store(t); }
  };
}

// One box makes any new instrument: a synth from the list, a sampler on a chosen sample, or an empty graph.
{
  const kinds = $('new-inst-kind'), sample = $('new-inst-sample');
  const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
  const group = (label, entries) => { const g = document.createElement('optgroup'); g.label = label; g.append(...entries); return g; };
  const synths = Object.entries(synthKinds).filter(([k]) => k !== 'empty').map(([k, { label }]) => option(`synth:${k}`, label));
  kinds.replaceChildren(group('Synths', synths), group('Sampler', [option('sampler', 'Sampler (plays a sample)')]), group('Blank', [option('synth:empty', synthKinds.empty.label)]));
  const showSample = () => { sample.hidden = kinds.value !== 'sampler'; };
  kinds.addEventListener('change', showSample);
  showSample();
  $('add-inst').addEventListener('click', () => {
    try {
      const [type, kind] = kinds.value.split(':');
      const name = $('new-inst-name').value.trim();
      const id = type === 'sampler' ? addSamplerInstrument(project, name, sample.value) : addSynthInstrument(project, name, kind);
      loadInst(id);
      if (type === 'sampler') sendSamples(id);
      addLaneFor(id);
      patcher.load({ instruments: project.instruments });
      patcher.show(id);
      refreshProjectUi();
      $('new-inst-name').value = '';
      projStatus(`Added ${id} with its own lane.`);
    } catch (err) {
      projStatus(err.message);
    }
  });
}

$('add-lane').addEventListener('click', () => {
  try {
    const lane = addLaneFor($('add-lane-inst').value || patcher.instrument);
    projStatus(`Added lane ${lane.id}.`);
  } catch (err) {
    projStatus(err.message);
  }
});
$('patch-add').addEventListener('click', () => menu.open(12, 24));

$('start').addEventListener('click', async () => {
  try {
    await engine.start();
    {
      const el = $('loadmeter');
      let peak = 0, late = 0, avg = 0, lateAt = -1e9;
      const show = () => {
        const h = engine.health();
        const drops = h.drops ? ` drops ${h.drops}` : '';
        el.textContent = `cpu ${Math.round(avg * 100)}%  peak ≥${Math.round(peak * 100)}%  late ${late}${drops}  ${h.latency.toFixed(0)} ms`;
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
    try {
      const reply = await fetch(new URL('./project/demo.wax', import.meta.url));
      if (!reply.ok) throw new Error(`demo.wax: ${reply.status}`);
      openProject(parseProject(await reply.text()));
    } catch (err) {
      console.warn(err);
      openProject(createSynthwaveProject());
    }
    for (const id of ['start']) $(id).disabled = true;
    for (const id of ['play', 'panic', 'cut', 'new', 'save', 'load', 'patch-add', 'load-samples', 'rec-take', 'rec-source', 'add-inst', 'add-lane', 'add-lane-inst', 'inst-voices', 'inst-notecols', 'inst-name', 'inst-rename', 'inst-up', 'inst-down', 'inst-dup', 'inst-remove', 'lane-name', 'lane-rename', 'lane-left', 'lane-right', 'lane-dup', 'lane-remove', 'lane-remove-all', 'length', 'ins-n', 'ins-go', 'bpm', 'swing', 'preset-name', 'preset-save', 'preset-over', 'preset-rename', 'preset-remove', 'inst-export', 'inst-import', 'lib-load', 'lib-add', 'lib-save']) $(id).disabled = false;
    $('status').textContent =
      `Running at ${engine.ctx.sampleRate} Hz, base latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`;
    // Only the screen that is showing is drawn: a hidden one has nothing to measure or paint, and its work would only delay the one you are using.
    const frame = () => {
      const tab = tabs.active;
      songInfo(); syncLaneName();
      if (tab === 'arrange' || !tab) seqView.draw();
      if (tab === 'patterns' || !tab) view.draw();
      if (tab === 'instruments' || !tab) patcher.draw();
      if (tab === 'samples' || !tab) { sampleScreen.draw(); waveform.draw(); region.draw(); }
      requestAnimationFrame(frame);
    };
    frame();
  } catch (err) {
    $('status').textContent = err.message;
  }
});
